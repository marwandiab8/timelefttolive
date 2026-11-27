import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase.js';

const functions = app ? getFunctions(app, 'northamerica-northeast1') : null;
// Local checks only (npm run dev:emulators): the callables run in the Functions emulator.
if (functions && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') connectFunctionsEmulator(functions, '127.0.0.1', 5001);

/** Adds an activity by hand (functions/src/activityEntries.js, createActivityEntry). */
export function createActivityEntry(data) {
  if (!functions) return Promise.reject(new Error('Adding activities is unavailable until Firebase is configured.'));
  return httpsCallable(functions, 'createActivityEntry')(data);
}

export function editActivityEntry(data) {
  if (!functions) return Promise.reject(new Error('Activity editing is unavailable until Firebase is configured.'));
  return httpsCallable(functions, 'editActivityEntry')(data);
}

export function deleteActivityEntry(data) {
  if (!functions) return Promise.reject(new Error('Activity deletion is unavailable until Firebase is configured.'));
  return httpsCallable(functions, 'deleteActivityEntry')(data);
}

export function restoreActivityEntry(data) {
  if (!functions) return Promise.reject(new Error('Restoring activities is unavailable until Firebase is configured.'));
  return httpsCallable(functions, 'restoreActivityEntry')(data);
}
