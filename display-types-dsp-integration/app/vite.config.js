import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built output is committed straight into ../prototype so GitHub Pages (and a
// rawcdn.githack preview of a feature branch) can serve it with zero
// server-side build step — same arrangement as menu-board-demo/product-app.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../prototype',
    emptyOutDir: true,
  },
});
