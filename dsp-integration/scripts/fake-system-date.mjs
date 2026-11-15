/* Run any Node process as if today were another day (ticket QCK6k1IsDKh5HoP8RhK0, 14 Nov 2026).

   NODE_OPTIONS="--import <abs path to this file>" PH_FAKE_SYSTEM_DATE=2026-12-15T12:00:00Z npm test

   It replaces the global Date with one shifted by a fixed offset, so `new Date()` and `Date.now()` start at
   PH_FAKE_SYSTEM_DATE and keep running; dates built from arguments are untouched. NODE_OPTIONS reaches every
   child process (vitest forks, the API processes multiprocess.test.ts starts), which is why this is a preload
   and not a vitest setup file. The first process works the offset out once and hands it down in
   PH_FAKE_SYSTEM_DATE_OFFSET_MS, so parent and children share one clock however late a child starts. Without PH_FAKE_SYSTEM_DATE it does nothing. `npm run test:dates` uses it to
   prove the suites do not depend on the day they run. Never load it in a real service. */
const wanted = process.env.PH_FAKE_SYSTEM_DATE
if (wanted && !globalThis.__phFakeSystemDate) {
  const target = Date.parse(wanted)
  if (Number.isNaN(target)) throw new Error(`PH_FAKE_SYSTEM_DATE: "${wanted}" is not an ISO date-time.`)
  if (process.env.NODE_ENV === 'production') throw new Error('PH_FAKE_SYSTEM_DATE must not be set in production.')
  const RealDate = Date
  const inherited = Number(process.env.PH_FAKE_SYSTEM_DATE_OFFSET_MS)
  const offset = Number.isFinite(inherited) && process.env.PH_FAKE_SYSTEM_DATE_OFFSET_MS ? inherited : target - RealDate.now()
  process.env.PH_FAKE_SYSTEM_DATE_OFFSET_MS = String(offset)
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset)
      else super(...args)
    }
    static now() { return RealDate.now() + offset }
  }
  globalThis.Date = ShiftedDate
  globalThis.__phFakeSystemDate = wanted
}
