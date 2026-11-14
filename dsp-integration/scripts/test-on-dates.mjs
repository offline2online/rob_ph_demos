/* Run the suites as if today were another day (ticket QCK6k1IsDKh5HoP8RhK0, 14 Nov 2026).

     npm run test:dates                         # a month and three months from today
     npm run test:dates -- 2026-12-15 2027-02-15
     npm run test:dates -- 2027-02-15 -- -w @ph-dsp/api    # one workspace (anything after the second -- goes to npm test)

   For each date it runs `npm test` (or `npm run test <your arguments>`) with scripts/fake-system-date.mjs preloaded
   into every Node process, so `new Date()` and `Date.now()` start at noon UTC on that day. A suite that passes
   today and fails here depends on the day it runs: pin the clock in that test (helpers.ts, suiteClock) rather
   than moving its dates. Exits 1 if any date fails. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PRELOAD = pathToFileURL(fileURLToPath(new URL('./fake-system-date.mjs', import.meta.url))).href
const args = process.argv.slice(2)
const split = args.indexOf('--')
const wanted = (split === -1 ? args : args.slice(0, split))
const rest = split === -1 ? [] : args.slice(split + 1)
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const dates = wanted.length ? wanted : [inDays(31), inDays(93)]
for (const d of dates) if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) { console.error(`test:dates: "${d}" is not a date (YYYY-MM-DD).`); process.exit(2) }

const failed = []
for (const d of dates) {
  console.log(`\n=== test:dates — as if today were ${d} ===`)
  const env = { ...process.env, PH_FAKE_SYSTEM_DATE: `${d}T12:00:00.000Z`, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${PRELOAD}`.trim() }
  delete env.PH_FAKE_SYSTEM_DATE_OFFSET_MS
  const r = spawnSync('npm', rest.length ? ['run', 'test', ...rest] : ['test'], { cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) failed.push(d)
}
console.log(failed.length ? `\ntest:dates: FAILED as of ${failed.join(', ')}` : `\ntest:dates: the suites pass as of ${dates.join(', ')}`)
process.exit(failed.length ? 1 : 0)
