import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/* One .env at the POC root serves the API and this app. Only the flag is
   exposed to the browser (envPrefix); secrets never are. */
/* Under CI the whole suite also writes results/suites-admin.json, which the nightly's report and ticket steps
   read (scripts/lib/results.mjs): a red `npm test` used to leave nothing for them (ticket QCK6k1IsDKh5HoP8RhK0).
   A --reporter on the command line (e2e:quick) replaces this. */
const suiteReport = '../../results/suites-admin.json'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: '../../',
  envPrefix: ['VITE_', 'DSP_INTEGRATION_ENABLED', 'SELF_SERVICE_ENABLED', 'CHANGE_HISTORY_ENABLED', 'DEAL_TARGETING_ENABLED'],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4000', '/assets': 'http://127.0.0.1:4000' },
  },
  test: {
    reporters: process.env.CI ? ['default', ['json', { outputFile: suiteReport }]] : ['default'],
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    css: false,
    /* jsdom + Ant Design page renders are slow when the whole suite runs in
       parallel, and slower again on a two-core CI runner (test/timeouts.ts). */
    testTimeout: process.env.CI ? 60000 : 20000,
  },
})
