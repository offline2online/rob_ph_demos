/* npm run auction:run — clear one play window now (for demos and testing).
   Default: the next window that can be sold; or --window=YYYY-MM-DD.
   Needs the mock DSP service running (npm run dev:mocks) for DSP bids. */
import { createContext } from '../context'
import { loadEnv } from '../env'
import { runAuction } from './auction'

loadEnv()
const ctx = createContext()
if (!ctx.flags.dspIntegration) {
  console.error('The dspIntegration flag is off (DSP_INTEGRATION_ENABLED): no auction runs.')
  process.exit(1)
}
const arg = process.argv.find((a) => a.startsWith('--window='))?.slice('--window='.length)
const window = arg ? new Date(`${arg}T00:00:00Z`) : undefined
if (window && Number.isNaN(window.getTime())) {
  console.error('--window must be a date, YYYY-MM-DD.')
  process.exit(1)
}
console.log(JSON.stringify(await runAuction(ctx, window), null, 2))
