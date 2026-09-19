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
}

export function createContext(opts: { config?: Config; db?: Db; flags?: Flags; session?: SessionSource; secrets?: SecretsStore } = {}): Context {
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
  }
}
