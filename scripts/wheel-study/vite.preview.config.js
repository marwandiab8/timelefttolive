// Builds the interactive wheel preview (scripts/wheel-study/preview) outside the app:
//   npx vite build --config scripts/wheel-study/vite.preview.config.js
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: `${here}preview`,
  base: './',
  publicDir: `${here}../../public`,
  plugins: [react()],
  build: { outDir: '/home/marwan/.cache/wheel-preview-app', emptyOutDir: true }
});
