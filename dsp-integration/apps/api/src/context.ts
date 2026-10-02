/* Composition root: every stand-in and repository, wired to one database. */
import { loadConfig, type Config } from './config'
import { type Db, gate, onFree, openDb, tx } from './db/db'
import { migrateUp } from './db/migrate'
import { type Flags, envFlags } from './flags/Flags'
import { type SessionSource, envSession } from './auth/session'
import { type SecretsStore, aesGcmSecretsStore } from './secrets/SecretsStore'
import { type DisplayTypeSource, sqliteDisplayTypeSource } from './platform/DisplayTypeSource'
import { type PlaylistSource, sqlitePlaylistSource } from './platform/PlaylistSource'
import { type DisplaySource, sqliteDisplaySource } from './platform/DisplaySource'
import { type StoreSource, sqliteStoreSource } from './platform/StoreSource'
import { type CampaignSource, sqliteCampaignSource } from './platform/CampaignSource'
import { type PlaybackSource, sqlitePlaybackSource } from './platform/PlaybackSource'
import { type PartnerRepo, sqlitePartnerRepo } from './repos/PartnerRepo'
import { type CompanySettingsRepo, sqliteCompanySettingsRepo } from './repos/CompanySettingsRepo'
import { type ExchangeRepo, sqliteExchangeRepo } from './repos/ExchangeRepo'
import { type BuyersListRepo, sqliteBuyersListRepo } from './repos/BuyersListRepo'
import type { CampaignSource as ApprovalCampaignSource } from '@ph-dsp/campaign-approval/adapter'
import { pocCampaignSource } from '@ph-dsp/campaign-approval/poc'
import { type ApprovalService, createApprovalService } from '@ph-dsp/campaign-approval/server'
import { advertiserSlug } from '@ph-dsp/types'
import { type AssetStore, localAssetStore } from './platform/AssetStore'
import { type AudienceSource, sqliteAudienceSource } from './platform/AudienceSource'
import { type ReservationRepo, sqliteReservationRepo } from './repos/ReservationRepo'
import { targetingSummary } from './domain/targetingSummary'
import type { Fetch } from './dsp/DspClient'
import { type DspProviders, dspProviders } from './dsp/registry'
import { type Bidder, httpBidder } from './dsp/bidder'
import { testClockFrom } from './testClock'

export interface Context {
  config: Config
  db: Db
  flags: Flags
  session: SessionSource
  secrets: SecretsStore
  displayTypes: DisplayTypeSource
  playlists: PlaylistSource
  displays: DisplaySource
  stores: StoreSource
  campaigns: CampaignSource
  playback: PlaybackSource
  partners: PartnerRepo
  company: CompanySettingsRepo
  exchange: ExchangeRepo
  buyersLists: BuyersListRepo
  /* The DSPs, one DspProvider each (dsp/DspProvider.ts): management client,
     bid URL, creative-path rule and pre-approval hook. Read by provider key
     through providerOf(); nothing else branches on which DSP it is. */
  dsp: DspProviders
  assets: AssetStore
  audience: AudienceSource
  reservations: ReservationRepo
  /* HTTP to the DSPs (the mock DSP service in the POC). */
  fetch: Fetch
  bidder: Bidder
  /* Now, for play windows (injectable for tests). */
  clock: () => Date
  /* The approval module's view of the campaigns (its CampaignSource adapter). */
  approvalCampaigns: ApprovalCampaignSource
  approvals: ApprovalService
}

export function createContext(opts: { config?: Config; db?: Db; flags?: Flags; session?: SessionSource; secrets?: SecretsStore; dspFetch?: Fetch; clock?: () => Date } = {}): Context {
  const config = opts.config ?? loadConfig()
  const db = opts.db ?? openDb(config.dbFile)
  migrateUp(db)
  const secrets = opts.secrets ?? aesGcmSecretsStore(process.env.PH_SECRETS_KEY)
  const clock = opts.clock ?? (config.testClock ? testClockFrom(config.testClock) : () => new Date())
  /* Every seam and repository goes through gate(): a call made while another
     call chain's transaction is open waits for it to end instead of running
     inside it (db.ts, "Transactions on one SQLite connection"). */
  const g = <T extends object>(t: T) => gate(db, t)
  const displayTypes = g(sqliteDisplayTypeSource(db))
  const company = g(sqliteCompanySettingsRepo(db))
  const partners = g(sqlitePartnerRepo(db, secrets))
  return {
    config,
    db,
    flags: opts.flags ?? envFlags(),
    session: opts.session ?? envSession(),
    secrets,
    displayTypes,
    playlists: g(sqlitePlaylistSource(db)),
    displays: g(sqliteDisplaySource(db)),
    stores: g(sqliteStoreSource(db)),
    campaigns: g(sqliteCampaignSource(db)),
    playback: g(sqlitePlaybackSource(db)),
    partners,
    company,
    exchange: g(sqliteExchangeRepo(db)),
    buyersLists: g(sqliteBuyersListRepo(db)),
    dsp: dspProviders(config.dsp, config.bidders, opts.dspFetch),
    fetch: opts.dspFetch ?? ((url, init) => fetch(url, init)),
    bidder: httpBidder(opts.dspFetch ?? ((url, init) => fetch(url, init)), { timeoutMs: config.bidderTimeoutMs, qps: config.bidderQps, maxResponseBytes: config.maxBidResponseBytes }),
    audience: g(sqliteAudienceSource(db)),
    reservations: g(sqliteReservationRepo(db)),
    clock,
    ...approvalParts(db, config, { displayTypes, company, partners }),
  }
}

/* Wires the campaign-approval module to this repo's stand-in campaign store.
   It reuses the context's own display types, company settings and partners:
   a second DisplayTypeSource would carry its own 1-second snapshot and weaken
   "a save is visible to this process immediately". */
function approvalParts(db: Db, config: Config, own: { displayTypes: DisplayTypeSource; company: CompanySettingsRepo; partners: PartnerRepo }) {
  const { displayTypes, company, partners } = own
  /* Files, not the database: no gate needed. */
  const assets = localAssetStore(config.assetsDir, config.publicUrl)
  /* Advertiser names come from the DSP seats (seats are not secret). */
  const seatNames = async () => (await partners.list()).flatMap((p) => p.seats)
  const approvalCampaigns = gate(db, pocCampaignSource(db, {
    advertiserName: async (id) => (await seatNames()).find((s) => advertiserSlug(s.name) === id)?.name ?? id,
    partnerName: async (id) => (await partners.get(id))?.name ?? null,
    canvas: async (id) => (await displayTypes.get(id))?.displayCanvasSize ?? null,
    assetUrl: (file) => assets.url(file),
    targetingSummary,
  }))
  const approvals = createApprovalService({
    db,
    campaigns: approvalCampaigns,
    requiresApproval: async (advertiserId) => (advertiserId ? (await company.advertiserSetting(advertiserId)).approvalRequired : true),
    /* The module's own statements wait for the connection like every seam's,
       and each decision is one transaction (db.ts). */
    run: (fn) => onFree(db, fn),
    transaction: (fn) => tx(db, fn),
  })
  return { assets, approvalCampaigns, approvals }
}
