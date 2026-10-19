/* npm run dev:api — the POC API on API_PORT (default 4000), bound to
   API_HOST (default 127.0.0.1; 0.0.0.0 in a container). */
import { createContext } from './context'
import { loadEnv } from './env'
import { buildApp } from './http/app'
import { seed, seedsOnStart } from './seed/seed'
import { startAuctionScheduler, startCampaignRetentionScheduler } from './exchange/scheduler'

loadEnv()
const ctx = createContext()
/* An empty database is filled with the prototype's sample data — the demo
   retailer, its stores and displays, two DSPs with placeholder credentials,
   campaigns and bookings — and DSP integration is switched ON for it, so
   sellers.json publishes the demo seller. That is what a laptop, the E2E
   runs and a demo cluster want; it is never what a client's real instance
   wants (pre-handover review, 18 Oct 2026: a production pod on a fresh volume
   published "Demo Retail Group" as its seller and served a real partner token
   the demo DSP and its inventory). So with NODE_ENV=production nothing is
   seeded unless PH_SEED_DEMO=true asks for it (seedsOnStart); a real instance
   starts empty and switched off (migration 0023). The hosted demo seeds
   through its own host (deploy/firebase/), not here. */
if (seedsOnStart(process.env) && (await seed(ctx))) console.log('Seeded an empty database with the prototype sample data.')
const app = buildApp(ctx, { logger: true })
const stops: (() => void | Promise<void>)[] = []
if (ctx.config.scheduler === 'in-process') {
  stops.push(startAuctionScheduler(ctx, (m) => app.log.info(m)), startCampaignRetentionScheduler(ctx, (m) => app.log.info(m)))
} else {
  app.log.info('Scheduler off (PH_SCHEDULER=off): billing, the auction and retention run from `npm run scheduler:tick`.')
}
await app.listen({ port: ctx.config.port, host: ctx.config.host })
console.log(`dspIntegration flag: ${ctx.flags.dspIntegration ? 'ON' : 'off'} · role: ${(await ctx.session.current()).role} · scheduler: ${ctx.config.scheduler}`)

/* A supervisor stops the process with SIGTERM (Kubernetes gives it
   terminationGracePeriodSeconds, 30 s, to comply): stop the schedulers,
   stop accepting connections and let in-flight requests finish, let a
   scheduler tick that is already running (an auction, billing) finish too —
   for up to SCHEDULER_DRAIN_MS, inside the grace — and close the database,
   which checkpoints the WAL, so the next start restores nothing. A window
   an auction still hadn't finished by then is retaken from auction_runs
   after the stale-claim period (exchange/scheduler.ts); each position's
   clear is its own transaction, so nothing is left half-written. */
const SCHEDULER_DRAIN_MS = 20_000
let stopping = false
const shutdown = async (signal: string) => {
  if (stopping) return
  stopping = true
  app.log.info(`${signal}: shutting down`)
  const drained = Promise.all(stops.map((stop) => stop()))
  await app.close()
  await Promise.race([drained, new Promise((r) => setTimeout(r, SCHEDULER_DRAIN_MS).unref())])
  ctx.db.close()
  process.exit(0)
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => void shutdown(signal))
