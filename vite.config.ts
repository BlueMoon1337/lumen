import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build loads from any folder (and inside the desktop app).
  base: './',
  server: { port: 5173, strictPort: true },
});
