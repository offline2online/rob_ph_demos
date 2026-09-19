import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/* Runtime configuration. Open-question defaults (brief, "Defaults for open
   questions") live here so each is configurable in one place. */
export interface Config {
  port: number
  dbFile: string
  /* Q27 — auction play-window length. */
  playWindowHours: number
  /* Q46 — per-DSP bidder defaults. */
  bidderQps: number
  bidderTimeoutMs: number
  /* Q48 — max values (SKUs) per targeting condition. */
  maxValuesPerCondition: number
  /* Q38 — does a re-reviewed campaign's old version keep running? */
  oldVersionRunsDuringReview: boolean
  /* Q47 — block display type delete while positions are sold/reserved? */
  blockDeleteWithSoldPositions: boolean
}

/* Relative paths are resolved from the POC root, whatever the working directory. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const fromRoot = (p: string) => (p === ':memory:' || isAbsolute(p) ? p : resolve(ROOT, p))

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.API_PORT ?? 4000),
    dbFile: fromRoot(env.PH_DB_FILE ?? 'data/poc.sqlite'),
    playWindowHours: 24,
    bidderQps: 500,
    bidderTimeoutMs: 300,
    maxValuesPerCondition: 100,
    oldVersionRunsDuringReview: false,
    blockDeleteWithSoldPositions: false,
  }
}
