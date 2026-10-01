/* PH_TEST_CLOCK — a test-only "now" for a real process (E2E Testing Strategy
   §3.2). The journey runner and `npm run scheduler:tick` use it to move past
   an auction cutoff or a window end without touching any company setting.

   The value is either an ISO instant (fixed) or the path of a file holding
   one. A file is re-read on every call, so the runner advances the clock for
   the API process and for a separate tick process by rewriting that one file.
   Refused when NODE_ENV=production (config.ts), like the public POC tokens. */
import { readFileSync } from 'node:fs'

const parse = (text: string, source: string): Date => {
  const d = new Date(text.trim())
  if (Number.isNaN(d.getTime())) throw new Error(`PH_TEST_CLOCK: "${source}" is not an ISO date-time.`)
  return d
}

export function testClockFrom(value: string): () => Date {
  const fixed = Number.isNaN(new Date(value).getTime()) ? null : new Date(value)
  if (fixed) return () => new Date(fixed)
  const read = () => parse(readFileSync(value, 'utf8'), value)
  read() // fail at start-up, not on the first request
  return read
}
