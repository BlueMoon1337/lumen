import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build loads from any folder (and inside the desktop app).
  base: './',
  server: { port: 5173, strictPort: true },
  // The HEIC decoder loads only when a HEIC photo is added; bundle it up front in development so
  // its first use doesn't reload the page.
  optimizeDeps: { include: ['heic-to'] },
  // That decoder (libheif) is about 3 MB on its own, in a file of its own.
  build: { chunkSizeWarningLimit: 3300 },
});
