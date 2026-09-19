import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const missingKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

export const isFirebaseConfigured = missingKeys.length === 0;
export const firebaseMissingKeys = missingKeys;

export const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;
export const googleProvider = new GoogleAuthProvider();

export function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function registerWithEmail(email, password) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  try {
    await sendEmailVerification(credential.user);
  } catch (error) {
    // The account exists; the user can request another email from the dashboard.
    console.error('Failed to send verification email', error);
  }
  return credential;
}

export function resendVerificationEmail() {
  if (!auth?.currentUser) return Promise.reject(new Error('Sign in to verify your email.'));
  return sendEmailVerification(auth.currentUser);
}

// Firestore and Storage rules read email_verified from the ID token, so a
// verified user needs a fresh token, not just a reloaded profile.
export async function refreshEmailVerification() {
  const current = auth?.currentUser;
  if (!current) return false;
  await current.reload();
  if (current.emailVerified) await current.getIdToken(true);
  return current.emailVerified;
}

export function logOut() {
  return signOut(auth);
}
