import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built output is committed straight into ../product so GitHub Pages can
// keep serving this repo with zero server-side build step.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../product',
    emptyOutDir: true,
  },
});
