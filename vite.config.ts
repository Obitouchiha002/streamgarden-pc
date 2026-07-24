import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The renderer is a plain SPA loaded from disk in production, so asset URLs must be
// relative — Electron serves it over file://, where absolute paths resolve to the drive root.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  server: { port: 5180, strictPort: true },
});
