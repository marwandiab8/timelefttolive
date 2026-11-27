import { httpsCallable } from 'firebase/functions';
import { functions } from './functions.js';

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
