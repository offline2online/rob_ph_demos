/* npm run db:screens [-- all-scored | some-unscored | some-overridden]
   — assign unassigned screens to mock stores and give display types a
   default VAC-d, for testing Available Inventory. Re-runnable; test data only. */
import { createContext } from '../context'
import { loadEnv } from '../env'
import { SCENARIOS, type Scenario, printSummary, seedScreens } from './screens'

loadEnv()
const scenario = (process.argv[2] ?? 'all-scored') as Scenario
if (!SCENARIOS.includes(scenario)) {
  console.error(`Unknown scenario "${scenario}". One of: ${SCENARIOS.join(', ')}.`)
  process.exit(1)
}
printSummary(await seedScreens(createContext(), scenario))
