/* npm run scheduler:tick — one pass of the scheduled work, then exit: bill
   the windows that have ended, clear any window whose auction cutoff has
   passed, run the retention sweeps. For a scheduler outside the API process
   (a Kubernetes CronJob, deploy/kubernetes/optional/scheduler-cronjob.yaml)
   when several API replicas share one database and none of them should
   run the in-process scheduler (PH_SCHEDULER=off).

   Safe to run as often as every minute, and alongside another tick or an
   API's own scheduler: which process clears a window is settled in the
   database (auction_runs, migration 0024), so a window is auctioned once
   however many ticks see its cutoff pass. */
import { createContext } from '../context'
import { loadEnv } from '../env'
import { schedulerTick } from './scheduler'

loadEnv()
const ctx = createContext()
if (!ctx.flags.dspIntegration) {
  console.error('The dspIntegration flag is off (DSP_INTEGRATION_ENABLED): nothing to do.')
  process.exit(1)
}
await schedulerTick(ctx, (m) => console.log(m))
ctx.db.close()
