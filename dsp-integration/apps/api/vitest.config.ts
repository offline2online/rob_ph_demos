import { defineConfig } from 'vitest/config'

/* Under CI the whole suite also writes results/suites-api.json, which the nightly's report and ticket steps
   read (scripts/lib/results.mjs): a red `npm test` used to leave nothing for them (ticket QCK6k1IsDKh5HoP8RhK0).
   A --reporter on the command line (e2e:quick) replaces this. */
const suiteReport = '../../results/suites-api.json'

export default defineConfig({
  test: { reporters: process.env.CI ? ['default', ['json', { outputFile: suiteReport }]] : ['default'], environment: 'node', include: ['test/**/*.test.ts'], pool: 'forks' },
})
