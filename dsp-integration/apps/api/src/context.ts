/* Composition root: every stand-in and repository, wired to one database. */
import { loadConfig, type Config } from './config'
import { type Db, openDb } from './db/db'
import { migrateUp } from './db/migrate'
import { type Flags, envFlags } from './flags/Flags'
import { type SessionSource, envSession } from './auth/session'
import { type SecretsStore, aesGcmSecretsStore } from './secrets/SecretsStore'
import { type DisplayTypeSource, sqliteDisplayTypeSource } from './platform/DisplayTypeSource'
import { type PlaylistSource, sqlitePlaylistSource } from './platform/PlaylistSource'
import { type DisplaySource, sqliteDisplaySource } from './platform/DisplaySource'
import { type CampaignSource, sqliteCampaignSource } from './platform/CampaignSource'
import { type PlaybackSource, sqlitePlaybackSource } from './platform/PlaybackSource'
import { type PartnerRepo, sqlitePartnerRepo } from './repos/PartnerRepo'
import { type CompanySettingsRepo, sqliteCompanySettingsRepo } from './repos/CompanySettingsRepo'
import { type ExchangeRepo, sqliteExchangeRepo } from './repos/ExchangeRepo'
import type { CampaignSource as ApprovalCampaignSource } from '@ph-dsp/campaign-approval/adapter'
import { pocCampaignSource } from '@ph-dsp/campaign-approval/poc'
import { type ApprovalService, createApprovalService } from '@ph-dsp/campaign-approval/server'
import { advertiserSlug } from '@ph-dsp/types'
import { type AssetStore, localAssetStore } from './platform/AssetStore'
import { type AudienceSource, sqliteAudienceSource } from './platform/AudienceSource'
import { type ReservationRepo, sqliteReservationRepo } from './repos/ReservationRepo'
import { targetingSummary } from './domain/targetingSummary'
import type { Fetch } from './dsp/DspClient'
import { dspClients } from './dsp/registry'
import { type Bidder, httpBidder } from './dsp/bidder'

export interface Context {
  config: Config
  db: Db
  flags: Flags
  session: SessionSource
  secrets: SecretsStore
  displayTypes: DisplayTypeSource
  playlists: PlaylistSource
  displays: DisplaySource
  campaigns: CampaignSource
  playback: PlaybackSource
  partners: PartnerRepo
  company: CompanySettingsRepo
  exchange: ExchangeRepo
  dsp: ReturnType<typeof dspClients>
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
  return {
    config,
    db,
    flags: opts.flags ?? envFlags(),
    session: opts.session ?? envSession(),
    secrets,
    displayTypes: sqliteDisplayTypeSource(db),
    playlists: sqlitePlaylistSource(db),
    displays: sqliteDisplaySource(db),
    campaigns: sqliteCampaignSource(db),
    playback: sqlitePlaybackSource(db),
    partners: sqlitePartnerRepo(db, secrets),
    company: sqliteCompanySettingsRepo(db),
    exchange: sqliteExchangeRepo(db),
    dsp: dspClients(config.dsp, opts.dspFetch),
    fetch: opts.dspFetch ?? ((url, init) => fetch(url, init)),
    bidder: httpBidder(opts.dspFetch ?? ((url, init) => fetch(url, init)), { timeoutMs: config.bidderTimeoutMs, qps: config.bidderQps }),
    audience: sqliteAudienceSource(db),
    reservations: sqliteReservationRepo(db),
    clock: opts.clock ?? (() => new Date()),
    ...approvalParts(db, config),
  }
}

/* Wires the campaign-approval module to this repo's stand-in campaign store. */
function approvalParts(db: Db, config: Config) {
  const assets = localAssetStore(config.assetsDir)
  /* Advertiser names come from the DSP seats (seats are not secret). */
  const seatNames = () => (db.prepare('SELECT seats FROM partners').all() as { seats: string }[]).flatMap((r) => JSON.parse(r.seats) as { name: string }[])
  const company = sqliteCompanySettingsRepo(db)
  const displayTypes = sqliteDisplayTypeSource(db)
  const approvalCampaigns = pocCampaignSource(db, {
    advertiserName: (id) => seatNames().find((s) => advertiserSlug(s.name) === id)?.name ?? id,
    partnerName: (id) => db.prepare('SELECT name FROM partners WHERE id = ?').get(id)?.name as string | undefined ?? null,
    canvas: (id) => displayTypes.get(id)?.displayCanvasSize ?? null,
    assetUrl: (file) => assets.url(file),
    targetingSummary,
  })
  const approvals = createApprovalService({
    db,
    campaigns: approvalCampaigns,
    requiresApproval: (advertiserId) => (advertiserId ? company.advertiserSetting(advertiserId).approvalRequired : true),
    oldVersionRunsDuringReview: config.oldVersionRunsDuringReview,
  })
  return { assets, approvalCampaigns, approvals }
}
