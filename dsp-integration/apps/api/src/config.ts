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
  /* This API's public origin, prefixed to creative URLs when the admin UI
     is served from elsewhere (PH_PUBLIC_URL; empty in the POC). */
  publicUrl: string
  /* Q46 — per-DSP bidder defaults. */
  bidderQps: number
  bidderTimeoutMs: number
  /* Q48 — max values (SKUs) per targeting condition. */
  maxValuesPerCondition: number
  /* Q38 — does a re-reviewed campaign's old version keep running? */
  oldVersionRunsDuringReview: boolean
  /* Q47 — block display type delete while positions are sold/reserved? */
  blockDeleteWithSoldPositions: boolean
  /* Automated asset checks (spec §3). Limits are per asset, spec §3
     "Automated checks on upload": 100 MB images, 200 MB videos. */
  assetLimits: { maxImageBytes: number; maxVideoBytes: number; maxBitrateKbps: number }
  /* Spec §3 "Enforcement and audit": a Rejected campaign (and its assets) is
     auto-deleted once its rejection is older than this many days — the
     audit trail (campaign_approval_audit) is never touched, so the fact of
     the rejection is never lost. Un-reject takes a campaign out of Rejected,
     so its clock stops until (if ever) it is rejected again. */
  rejectedCampaignRetentionDays: number
  /* Partner API: one static bearer token per seeded partner (token → partner id). */
  partnerTokens: Record<string, string>
  /* ---- Security and scalability limits (review, 23 Sep 2026). Each bounds
     what one caller can make the exchange do, so one partner can't degrade
     it for everyone. Defaults are generous for real traffic. ---- */
  /* Highest CPM a DSP bid may carry; above it the bid is rejected, never billed. */
  maxBidCpm: number
  /* Bytes read from a DSP's bid response before it counts as no bid. */
  maxBidResponseBytes: number
  /* Partner API rate limit, per partner token: a token bucket refilled at
     `perSecond` and holding up to `burst`. Past it: 429 rate_limited. */
  partnerRateLimit: { perSecond: number; burst: number }
  /* Asset uploads a partner may have in flight at once (each is held in
     memory up to the asset size limit while it's checked). */
  maxConcurrentUploadsPerPartner: number
  /* POST /v1/inventory/forecast: positions per request (same as a page). */
  maxForecastPositions: number
  /* POST /v1/campaigns: shape limits on a content package. */
  campaignLimits: { nameLength: number; targetedVersions: number; groupsPerRules: number; conditionsPerGroup: number; valueLength: number }
  /* DSP API base URLs. Default: the local mock DSP service (apps/dsp-mocks). */
  dsp: DspEndpoints
  /* Where bid requests go, per provider, and the only base URL an unknown
     creative (a bid's iurl) may be fetched from. The POC points both at the
     mock DSP service and never at the partner's configured bidder endpoint;
     on integration, requests go to that endpoint instead. */
  bidders: Record<'google_dv360' | 'amazon_dsp' | 'the_trade_desk', { bidUrl: string; creativeBase: string }>
}

const DEFAULT_PARTNER_TOKENS = { 'poc-token-google-dv360': 'p_google', 'poc-token-amazon-dsp': 'p_amazon' }

/* The POC's well-known tokens are published in the README, so they must
   never be live on a real deployment: with NODE_ENV=production the API
   refuses to start unless PARTNER_TOKENS is set (and doesn't reuse them). */
function partnerTokensFrom(env: NodeJS.ProcessEnv): Record<string, string> {
  const tokens = env.PARTNER_TOKENS ? (JSON.parse(env.PARTNER_TOKENS) as Record<string, string>) : null
  if (env.NODE_ENV === 'production') {
    if (!tokens) throw new Error('PARTNER_TOKENS must be set in production: the default POC tokens are public.')
    if (Object.keys(tokens).some((t) => t in DEFAULT_PARTNER_TOKENS)) throw new Error('PARTNER_TOKENS must not reuse the public POC tokens in production.')
  }
  return tokens ?? DEFAULT_PARTNER_TOKENS
}

/* Relative paths are resolved from the POC root, whatever the working directory. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const fromRoot = (p: string) => (p === ':memory:' || isAbsolute(p) ? p : resolve(ROOT, p))

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mocks = env.DSP_MOCKS_URL ?? 'http://127.0.0.1:4100'
  return {
    port: Number(env.API_PORT ?? 4000),
    dbFile: fromRoot(env.PH_DB_FILE ?? 'data/poc.sqlite'),
    assetsDir: fromRoot(env.PH_ASSETS_DIR ?? 'data/assets'),
    publicUrl: (env.PH_PUBLIC_URL ?? '').replace(/\/$/, ''),
    bidderQps: 500,
    bidderTimeoutMs: 300,
    maxValuesPerCondition: 100,
    oldVersionRunsDuringReview: false,
    blockDeleteWithSoldPositions: false,
    assetLimits: { maxImageBytes: 100 * 1024 * 1024, maxVideoBytes: 200 * 1024 * 1024, maxBitrateKbps: 20_000 },
    rejectedCampaignRetentionDays: 30,
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
    partnerTokens: partnerTokensFrom(env),
    maxBidCpm: 10_000,
    maxBidResponseBytes: 64 * 1024,
    partnerRateLimit: { perSecond: Number(env.PARTNER_RATE_PER_SECOND ?? 50), burst: Number(env.PARTNER_RATE_BURST ?? 100) },
    maxConcurrentUploadsPerPartner: 2,
    maxForecastPositions: 200,
    campaignLimits: { nameLength: 200, targetedVersions: 20, groupsPerRules: 10, conditionsPerGroup: 20, valueLength: 200 },
  }
}
