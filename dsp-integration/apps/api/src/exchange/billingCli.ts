/* npm run billing:print — bill every ended window not billed yet (the same
   step the scheduled job runs), then print all billing line items. For
   testing only: there is no billing UI, report or API. */
import { createContext } from '../context'
import { loadEnv } from '../env'
import { lineItems, runBilling } from './billing'

loadEnv()
const ctx = createContext()
if (!ctx.flags.dspIntegration) {
  console.error('The dspIntegration flag is off (DSP_INTEGRATION_ENABLED): no billing runs.')
  process.exit(1)
}
const added = runBilling(ctx)
console.log(`${added.length} new line item${added.length === 1 ? '' : 's'}.`)
console.log(JSON.stringify(lineItems(ctx), null, 2))
