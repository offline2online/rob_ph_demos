import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/* Runtime configuration. Open-question defaults (brief, "Defaults for open
   questions") live here so each is configurable in one place. */
export interface Config {
  port: number
  dbFile: string
  /* AssetStore folder (git-ignored). */
  assetsDir: string
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
  /* Automated asset checks (spec §3). The spec names the checks, not the
     limits: these are POC defaults (BUILD-PLAN Q8). */
  assetLimits: { maxImageBytes: number; maxVideoBytes: number; maxBitrateKbps: number }
  /* Partner API: one static bearer token per seeded partner (token → partner id). */
  partnerTokens: Record<string, string>
  /* DSP API base URLs. Default: the local mock DSP service (apps/dsp-mocks). */
  dsp: { dv360TokenUrl: string; dv360ApiBaseUrl: string }
}

const DEFAULT_PARTNER_TOKENS = { 'poc-token-google-dv360': 'p_google', 'poc-token-amazon-dsp': 'p_amazon' }

/* Relative paths are resolved from the POC root, whatever the working directory. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const fromRoot = (p: string) => (p === ':memory:' || isAbsolute(p) ? p : resolve(ROOT, p))

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mocks = env.DSP_MOCKS_URL ?? 'http://127.0.0.1:4100'
  return {
    port: Number(env.API_PORT ?? 4000),
    dbFile: fromRoot(env.PH_DB_FILE ?? 'data/poc.sqlite'),
    assetsDir: fromRoot(env.PH_ASSETS_DIR ?? 'data/assets'),
    playWindowHours: 24,
    bidderQps: 500,
    bidderTimeoutMs: 300,
    maxValuesPerCondition: 100,
    oldVersionRunsDuringReview: false,
    blockDeleteWithSoldPositions: false,
    assetLimits: { maxImageBytes: 20 * 1024 * 1024, maxVideoBytes: 200 * 1024 * 1024, maxBitrateKbps: 20_000 },
    dsp: {
      dv360TokenUrl: env.DV360_TOKEN_URL ?? `${mocks}/dv360/token`,
      dv360ApiBaseUrl: env.DV360_API_BASE_URL ?? `${mocks}/dv360`,
    },
    partnerTokens: env.PARTNER_TOKENS ? (JSON.parse(env.PARTNER_TOKENS) as Record<string, string>) : DEFAULT_PARTNER_TOKENS,
  }
}
