/* npm run db:demo — add the demo estate (seed/demo.ts) to a database that
   already has the base data. Additive and idempotent: a second run reports
   zeros. */
import { createContext } from '../context'
import { loadEnv } from '../env'
import { seedDemo } from './demo'

loadEnv()
const ctx = createContext()
const r = await seedDemo(ctx)
console.log(`Demo estate: +${r.stores} stores, +${r.displays} displays, +${r.slots} slots, +${r.seats} seats, +${r.campaigns} campaigns, +${r.bookings} bookings.`)
