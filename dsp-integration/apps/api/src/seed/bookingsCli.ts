/* npm run db:bookings — add the sample bookings to a database that already
   has data (the dev one), without touching anything else in it. */
import { createContext } from '../context'
import { loadEnv } from '../env'
import { seedBookings } from './bookings'

loadEnv()
const ctx = createContext()
const n = await seedBookings(ctx)
console.log(n ? `Added ${n} booking${n === 1 ? '' : 's'}.` : 'Nothing to add: no advertiser positions, no connected DSP seats, or they are all booked already.')
