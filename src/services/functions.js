import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { app } from './firebase.js';

/** The app's callable functions (northamerica-northeast1); in emulator mode they run in the Functions emulator. */
export const functions = app ? getFunctions(app, 'northamerica-northeast1') : null;
if (functions && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') connectFunctionsEmulator(functions, '127.0.0.1', 5001);
