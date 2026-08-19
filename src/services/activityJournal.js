import { auth } from './firebase.js';

const DETAIL_BATCH_SIZE = 100;
const MAX_DETAIL_EVENTS = 500;

function cleanToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function isJournalOrMediaLifeEvent(event) {
  if (event?.sourceApp !== 'gridlineai') return false;
  if (event?.sourceFirebaseProjectId && event.sourceFirebaseProjectId !== 'gridlineai') return false;
  if (/^1:\d+:(?:web|ios|android):/i.test(String(event?.sourceProjectId || ''))) return false;
  const combined = [event?.eventType, event?.activityFamily, event?.categoryId, event?.title]
    .map(cleanToken)
    .join('_');
  return /(journal|note|memo|image|photo|picture|attachment|media)/.test(combined);
}

async function authorizationHeader() {
  const user = auth?.currentUser;
  if (!user) throw new Error('Sign in to view journal details.');
  const token = await user.getIdToken();
  return `Bearer ${token}`;
}

export async function loadActivityJournalDetails(calendarId, lifeEvents, signal) {
  const ids = [...new Set((Array.isArray(lifeEvents) ? lifeEvents : [])
    .filter(isJournalOrMediaLifeEvent)
    .map((event) => event.id)
    .filter(Boolean))].slice(0, MAX_DETAIL_EVENTS);
  if (!calendarId || !ids.length) {
    return { details: [], media: [], unavailable: [], partial: false };
  }
  const authorization = await authorizationHeader();
  const merged = { details: [], media: new Map(), unavailable: [] };
  for (let index = 0; index < ids.length; index += DETAIL_BATCH_SIZE) {
    const response = await fetch('/api/activity/journal-details', {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ calendarId, lifeEventIds: ids.slice(index, index + DETAIL_BATCH_SIZE) }),
      cache: 'no-store',
      credentials: 'omit',
      signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.error || 'Journal details could not be loaded.');
    }
    merged.details.push(...(payload.details || []));
    (payload.media || []).forEach((item) => merged.media.set(item.id, item));
    merged.unavailable.push(...(payload.unavailable || []));
  }
  return {
    details: merged.details,
    media: [...merged.media.values()],
    unavailable: merged.unavailable,
    partial: (Array.isArray(lifeEvents) ? lifeEvents : []).filter(isJournalOrMediaLifeEvent).length > ids.length
  };
}

export async function loadAuthorizedActivityImage(calendarId, media, signal) {
  const lifeEventId = media?.journalLifeEventId || media?.lifeEventId;
  if (!calendarId || !lifeEventId || !media?.id) throw new Error('Photo reference is incomplete.');
  const authorization = await authorizationHeader();
  const query = new URLSearchParams({ calendarId, lifeEventId, mediaId: media.id });
  const response = await fetch(`/api/activity/media?${query}`, {
    headers: { Authorization: authorization },
    cache: 'no-store',
    credentials: 'omit',
    signal
  });
  if (!response.ok) {
    const message = await response.text().catch(() => 'Photo unavailable.');
    const error = new Error(message || 'Photo unavailable.');
    error.status = response.status;
    throw error;
  }
  return response.blob();
}
