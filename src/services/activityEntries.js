import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase.js';

const functions = app ? getFunctions(app, 'northamerica-northeast1') : null;

export function editActivityEntry(data) {
  if (!functions) return Promise.reject(new Error('Activity editing is unavailable until Firebase is configured.'));
  return httpsCallable(functions, 'editActivityEntry')(data);
}

export function deleteActivityEntry(data) {
  if (!functions) return Promise.reject(new Error('Activity deletion is unavailable until Firebase is configured.'));
  return httpsCallable(functions, 'deleteActivityEntry')(data);
}
