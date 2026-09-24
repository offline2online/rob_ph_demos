/* npm run dev:api — the POC API on API_PORT (default 4000), bound to
   API_HOST (default 127.0.0.1; 0.0.0.0 in a container). */
import { createContext } from './context'
import { loadEnv } from './env'
import { buildApp } from './http/app'
import { seed } from './seed/seed'
import { startAuctionScheduler, startCampaignRetentionScheduler } from './exchange/scheduler'

loadEnv()
const ctx = createContext()
if (await seed(ctx)) console.log('Seeded an empty database with the prototype sample data.')
const app = buildApp(ctx, { logger: true })
const stops: (() => void)[] = []
if (ctx.config.scheduler === 'in-process') {
  stops.push(startAuctionScheduler(ctx, (m) => app.log.info(m)), startCampaignRetentionScheduler(ctx, (m) => app.log.info(m)))
} else {
  app.log.info('Scheduler off (PH_SCHEDULER=off): billing, the auction and retention run from `npm run scheduler:tick`.')
}
await app.listen({ port: ctx.config.port, host: ctx.config.host })
console.log(`dspIntegration flag: ${ctx.flags.dspIntegration ? 'ON' : 'off'} · role: ${ctx.session.current().role} · scheduler: ${ctx.config.scheduler}`)

/* A supervisor stops the process with SIGTERM (Kubernetes gives it
   terminationGracePeriodSeconds to comply): stop accepting connections,
   let in-flight requests finish, stop the schedulers, and close the
   database — which checkpoints the WAL, so the next start restores nothing.
   An auction in progress finishes its current positions inside app.close's
   grace; any window it hadn't finished is retaken from auction_runs after
   the stale-claim period (exchange/scheduler.ts). */
let stopping = false
const shutdown = async (signal: string) => {
  if (stopping) return
  stopping = true
  app.log.info(`${signal}: shutting down`)
  for (const stop of stops) stop()
  await app.close()
  ctx.db.close()
  process.exit(0)
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => void shutdown(signal))
