/* npm run db:seed — seed an empty POC database with the prototype's data. */
import { createContext } from '../context'
import { loadEnv } from '../env'
import { seed } from './seed'

loadEnv()
const ctx = createContext()
console.log(seed(ctx) ? 'Seeded.' : 'Database already has data; nothing seeded.')
