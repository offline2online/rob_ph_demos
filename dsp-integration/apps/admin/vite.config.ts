import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/* One .env at the POC root serves the API and this app. Only the flag is
   exposed to the browser (envPrefix); secrets never are. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: '../../',
  envPrefix: ['VITE_', 'DSP_INTEGRATION_ENABLED'],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4000' },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    css: false,
    /* jsdom + Ant Design page renders are slow when the whole suite runs in parallel. */
    testTimeout: 20000,
  },
})
