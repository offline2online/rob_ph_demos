import { defineConfig } from '@playwright/test'

/* Visual layout check (ticket A3QkqCjHRP58R0lSAtKM). Serves the hosted-demo
   build — the same admin UI answering from the committed API snapshot with a
   pinned clock — so every run sees identical data and needs no API process.
   Tablet and desktop only; mobile is out of scope. */
export const VIEWPORTS = {
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
} as const

export default defineConfig({
  testDir: './layout',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  retries: 0,
  timeout: 20_000,
  reporter: [['list'], ['json', { outputFile: '../../results/layout.json' }]],
  snapshotPathTemplate: '{testDir}/baselines/{arg}-{projectName}{ext}',
  use: { baseURL: 'http://127.0.0.1:4173/' },
  projects: Object.entries(VIEWPORTS).map(([name, viewport]) => ({ name, use: { viewport, deviceScaleFactor: 1 } })),
  webServer: {
    command: 'DSP_INTEGRATION_ENABLED=true VITE_DEMO=1 npx vite build --base=./ --outDir dist-layout && node layout/serve.mjs dist-layout 4173',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
