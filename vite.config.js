import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `npm run dev:emulators` (vite --mode emulators) points the app at the local Firebase emulators. These are the demo
// project's placeholder settings, not secrets; they are set here rather than on the command line so the script works
// the same in cmd.exe, PowerShell and POSIX shells. Vite reads VITE_ variables from process.env after this file runs.
const EMULATOR_ENV = {
  VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_FIREBASE_API_KEY: 'demo-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-timelefttolive.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-timelefttolive',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-timelefttolive.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '0',
  VITE_FIREBASE_APP_ID: '1:0:web:demo'
};

export default defineConfig(({ mode }) => {
  if (mode === 'emulators') Object.assign(process.env, EMULATOR_ENV);
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/activity': 'http://127.0.0.1:5098'
      }
    }
  };
});
