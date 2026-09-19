import { isAbsolute, resolve } from 'node:path'
import type { DspEndpoints } from './dsp/registry'
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
  /* Q13 — bidding for a window opens `auctionOpensHours` before it starts and
     closes `auctionLeadHours` before, when the scheduled auction clears it. */
  auctionOpensHours: number
  auctionLeadHours: number
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
  dsp: DspEndpoints
  /* Where bid requests go, per provider, and the only base URL an unknown
     creative (a bid's iurl) may be fetched from. The POC points both at the
     mock DSP service and never at the partner's configured bidder endpoint;
     on integration, requests go to that endpoint instead. */
  bidders: Record<'google_dv360' | 'amazon_dsp' | 'the_trade_desk', { bidUrl: string; creativeBase: string }>
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
    auctionOpensHours: 7 * 24,
    auctionLeadHours: 6,
    bidderQps: 500,
    bidderTimeoutMs: 300,
    maxValuesPerCondition: 100,
    oldVersionRunsDuringReview: false,
    blockDeleteWithSoldPositions: false,
    assetLimits: { maxImageBytes: 10 * 1024 * 1024, maxVideoBytes: 100 * 1024 * 1024, maxBitrateKbps: 20_000 },
    dsp: {
      dv360TokenUrl: env.DV360_TOKEN_URL ?? `${mocks}/dv360/token`,
      dv360ApiBaseUrl: env.DV360_API_BASE_URL ?? `${mocks}/dv360`,
      /* Amazon Ads: one LWA host and one API host per region; the mock serves each under /amazon/<region>. */
      amazon: Object.fromEntries((['na', 'eu', 'fe'] as const).map((r) => {
        const root = env[`AMAZON_ADS_${r.toUpperCase()}_BASE_URL`] ?? (env.AMAZON_ADS_BASE_URL ? `${env.AMAZON_ADS_BASE_URL.replace(/\/$/, '')}/${r}` : `${mocks}/amazon/${r}`)
        return [r, { tokenUrl: `${root}/auth/o2/token`, apiBaseUrl: root }]
      })) as DspEndpoints['amazon'],
      ttdApiBaseUrl: env.TTD_BASE_URL ?? `${mocks}/ttd`,
    },
    bidders: {
      google_dv360: { bidUrl: env.DV360_BIDDER_URL ?? `${mocks}/dv360/openrtb2/bid`, creativeBase: `${mocks}/dv360/creatives/` },
      amazon_dsp: { bidUrl: env.AMAZON_BIDDER_URL ?? `${mocks}/amazon/openrtb2/bid`, creativeBase: `${mocks}/amazon/creatives/` },
      the_trade_desk: { bidUrl: env.TTD_BIDDER_URL ?? `${mocks}/ttd/openrtb2/bid`, creativeBase: `${mocks}/ttd/creatives/` },
    },
    partnerTokens: env.PARTNER_TOKENS ? (JSON.parse(env.PARTNER_TOKENS) as Record<string, string>) : DEFAULT_PARTNER_TOKENS,
  }
}
