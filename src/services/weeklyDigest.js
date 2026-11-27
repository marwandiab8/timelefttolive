import { httpsCallable } from 'firebase/functions';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { app, db } from './firebase.js';
import { functions } from './functions.js';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';
const IN_EMULATORS = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
const DEVICE_KEY = 'digestPushTokenId';

/** This week's digest as the server builds it, without sending anything. */
export async function previewWeeklyDigest(calendarId) {
  if (!functions) throw new Error('The digest is unavailable until Firebase is configured.');
  const result = await httpsCallable(functions, 'weeklyDigest')({ calendarId, action: 'preview' });
  return result.data.digest;
}

/** Sends this week's digest now on the channels that are on (at most once a minute). */
export async function sendTestDigest(calendarId) {
  if (!functions) throw new Error('The digest is unavailable until Firebase is configured.');
  const result = await httpsCallable(functions, 'weeklyDigest')({ calendarId, action: 'test' });
  return result.data.results;
}

export function saveDigestSettings(calendarId, { enabled, push, email }) {
  return setDoc(doc(db, 'lifeCalendars', calendarId, 'digestSettings', 'owner'), {
    enabled: Boolean(enabled),
    push: Boolean(push),
    email: Boolean(email),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

/**
 * Whether this browser can get the notification, and if not, why. On an iPhone that means the home-screen app
 * (iOS 16.4 or later); Safari itself can't.
 */
export function pushAvailability() {
  if (typeof window === 'undefined') return { ok: false, reason: 'Not in a browser.' };
  if (IN_EMULATORS) return { ok: false, reason: "Notifications can't be tried in the emulators." };
  if (!VAPID_KEY) return { ok: false, reason: "Notifications aren't set up yet: the Web Push key is missing (see docs/weekly-digest.md)." };
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const iPhone = /iPhone|iPad|iPod/.test(window.navigator.userAgent || '');
  if (iPhone && !standalone) return { ok: false, reason: 'On the iPhone, open Time Left from the home screen to turn notifications on (Share, then Add to Home Screen).' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { ok: false, reason: "This browser can't show notifications from a web app." };
  }
  if (Notification.permission === 'denied') return { ok: false, reason: 'Notifications are blocked for Time Left in this browser’s settings.' };
  return { ok: true, reason: '' };
}

export function thisDeviceTokenId() {
  try {
    return localStorage.getItem(DEVICE_KEY) || '';
  } catch {
    return '';
  }
}

async function sha256Hex(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const platformLabel = () => {
  const agent = window.navigator.userAgent || '';
  if (/iPhone/.test(agent)) return 'iPhone';
  if (/iPad/.test(agent)) return 'iPad';
  if (/Android/.test(agent)) return 'Android';
  if (/Windows/.test(agent)) return 'Windows';
  if (/Mac OS X/.test(agent)) return 'Mac';
  return 'Browser';
};

/** Asks for permission (it must follow a tap), registers this device and saves its token. Returns the device's id. */
export async function enablePushOnThisDevice(calendarId, uid) {
  const availability = pushAvailability();
  if (!availability.ok) throw new Error(availability.reason);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed.');
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const { getMessaging, getToken } = await import('firebase/messaging');
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new Error('This device did not give a notification token.');
  const tokenId = (await sha256Hex(token)).slice(0, 40);
  await setDoc(doc(db, 'lifeCalendars', calendarId, 'pushTokens', tokenId), {
    token,
    uid,
    platform: platformLabel(),
    createdAt: serverTimestamp()
  });
  try {
    localStorage.setItem(DEVICE_KEY, tokenId);
  } catch {
    // Not remembered in a private window; the device still gets the notification.
  }
  return tokenId;
}

/** Stops notifications on one device (this one, or another listed in the app). */
export async function removePushDevice(calendarId, tokenId) {
  await deleteDoc(doc(db, 'lifeCalendars', calendarId, 'pushTokens', tokenId));
  if (tokenId === thisDeviceTokenId()) {
    try {
      const { deleteToken, getMessaging } = await import('firebase/messaging');
      await deleteToken(getMessaging(app));
    } catch {
      // The saved token is gone, so nothing will be sent to it either way.
    }
    try {
      localStorage.removeItem(DEVICE_KEY);
    } catch {
      // Nothing to forget.
    }
  }
}
