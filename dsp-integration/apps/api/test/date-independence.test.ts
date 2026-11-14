/* The suites must pass on any day (ticket QCK6k1IsDKh5HoP8RhK0, 14 Nov 2026). The nightly was red on main from
   10 to 13 Nov 2026 because direct-deals.test.ts built a deal on fixed November dates and read the schedule
   against the real clock. testContext() now starts every context at the suite epoch (helpers.ts, NOW); this
   file is the static half of the guard, `npm run test:dates` (the suites on other days) the other half.

   Two rules for every file under test/:
   1. createContext() called directly passes its own `clock` (or a testClock config): the real clock is the
      production default, never a test's.
   2. A file that reads the real clock (`new Date()` with no argument, `Date.now()`) and also writes a literal
      date from 90 days before the suite epoch onward is on the reviewed list below, with why the real clock is
      safe there. Dates older than that stay in the past whatever the day, so they are not counted. */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NOW } from './helpers'

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url))
const SELF = 'date-independence.test.ts'
const DAY = 86_400_000

/* Reviewed: each reads the real clock only for what is named here, never to decide what a literal date means. */
const REAL_CLOCK_REVIEWED: Record<string, string> = {
  'helpers.ts': 'suiteClock() measures elapsed real time to make the pinned clock tick',
  'handover-review.test.ts': 'a real 200 ms deadline for the bid sender’s timeout',
  'realtime.test.ts': 'elapsed real time of one request, against tmax',
  'e2e/run2-hardening.test.ts': 'elapsed real time of a slow bidder call',
  'journey/run6.journey.ts': 'waits and run stamps; the API it drives runs on PH_TEST_CLOCK',
}
/* createContext() without `clock`, on purpose. */
const REAL_CONTEXT_REVIEWED: Record<string, string> = {
  'test-clock.test.ts': 'the context takes config.testClock, which is what it tests',
}

const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? files(join(dir, e.name)) : /\.ts$/.test(e.name) ? [join(dir, e.name)] : [])
const sources = files(TEST_DIR).map((f) => ({ name: relative(TEST_DIR, f).split('\\').join('/'), text: readFileSync(f, 'utf8') })).filter((f) => f.name !== SELF)

const readsRealClock = (text: string) => /\bnew Date\(\s*\)|\bDate\.now\(\s*\)/.test(text)
const datesFrom = (text: string, from: number) => [...new Set(text.match(/(?<!\d)20\d\d-[01]\d-[0-3]\d(?!\d)/g) ?? [])].filter((d) => Date.parse(`${d}T00:00:00Z`) >= from)
/* Every createContext({...}) call's own text, by matching its brackets. */
const contextCalls = (text: string) => {
  const calls: string[] = []
  for (let i = text.indexOf('createContext('); i !== -1; i = text.indexOf('createContext(', i + 1)) {
    let depth = 0
    let j = i + 'createContext'.length
    do { if (text[j] === '(') depth++; else if (text[j] === ')') depth--; j++ } while (depth > 0 && j < text.length)
    calls.push(text.slice(i, j))
  }
  return calls
}

describe('the suites do not depend on the day they run', () => {
  it('finds the test files', () => {
    expect(sources.length).toBeGreaterThan(100)
    expect(sources.map((s) => s.name)).toContain('direct-deals.test.ts')
  })

  it('no test builds a context on the real clock', () => {
    const offenders = sources
      .filter((s) => !(s.name in REAL_CONTEXT_REVIEWED) && contextCalls(s.text).some((c) => !/\bclock\b/.test(c)))
      .map((s) => `${s.name}: createContext() without a clock — pass clock, or build it with testContext()`)
    expect(offenders).toEqual([])
  })

  it('no test mixes the real clock with literal dates near or after the suite epoch, unless reviewed', () => {
    const from = NOW.getTime() - 90 * DAY
    const offenders = sources
      .filter((s) => !(s.name in REAL_CLOCK_REVIEWED) && readsRealClock(s.text) && datesFrom(s.text, from).length > 0)
      .map((s) => `${s.name}: reads the real clock (new Date() / Date.now()) beside ${datesFrom(s.text, from).slice(0, 3).join(', ')} — use ctx.clock(), or add it to REAL_CLOCK_REVIEWED with the reason`)
    expect(offenders).toEqual([])
  })

  it('the reviewed lists name only files that still need to be on them', () => {
    const from = NOW.getTime() - 90 * DAY
    const names = sources.map((s) => s.name)
    for (const name of [...Object.keys(REAL_CLOCK_REVIEWED), ...Object.keys(REAL_CONTEXT_REVIEWED)]) expect(names, name).toContain(name)
    const stale = sources.filter((s) => s.name in REAL_CLOCK_REVIEWED && !(readsRealClock(s.text) && datesFrom(s.text, from).length > 0)).map((s) => s.name)
    expect(stale).toEqual([])
  })

  it('testContext() starts at the suite epoch and ticks, whatever the day', async () => {
    const { testContext } = await import('./helpers')
    const ctx = await testContext({ seeded: false })
    const a = ctx.clock().getTime()
    expect(a - NOW.getTime()).toBeGreaterThanOrEqual(0)
    expect(a - NOW.getTime()).toBeLessThan(60_000)
    await new Promise((r) => setTimeout(r, 5))
    expect(ctx.clock().getTime()).toBeGreaterThan(a)
  })
})
