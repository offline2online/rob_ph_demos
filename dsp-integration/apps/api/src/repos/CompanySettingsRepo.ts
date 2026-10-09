/* Company-wide advertiser settings (pricing and category lists), per-advertiser
   settings, and which DSPs may target each shared variable. */
import { TARGETING_VARIABLES, defaultVariableAccess } from '@ph-dsp/types'
import { type Db, fromJson, onRollback, prepared, toJson, type Awaitable } from '../db/db'

export interface CompanySettings {
  currency: string
  floorCpm: number
  /* Charged per engagement (a QR Control scan) on an interactive campaign, on top of the CPM. */
  interactiveCpe: number
  categoryWhitelist: string[]
  categoryBlacklist: string[]
  /* Guaranteed deals: the contingency haircut (percent, 0–50) taken off a window's forecast impressions
     before the rest is committed as the guaranteed volume. Instance-wide; default 10. */
  guaranteeBufferPct: number
  /* Bandwidth protection: see domain/uncachedRestriction.ts. */
  uncachedRestriction: 'off' | 'fixed' | 'store_open'
  uncachedRestrictionStart: string
  uncachedRestrictionEnd: string
  /* Real-time bidding: seconds before a slot plays that its auction opens (domain/bidLookahead.ts). */
  bidLookaheadSeconds: number
  /* Pre-caching: hours the player may retain a cached approved creative, an upper bound (domain/cachedAssetRetention.ts). */
  cachedAssetRetentionHours: number
  /* Play config: the committed-plays figure a new buyers list is pre-filled with; null = none (per play). */
  defaultCommittedPlays: number | null
  /* Max play length: the company-wide default fixed duration of one play, in seconds (a display type and a slot can override it). Plays per window = floor(window / this), never the loop. */
  maxPlayLengthSec: number
}
export interface AdvertiserSettingRecord { approvalRequired: boolean; floorMultiplier: number }
export interface DirectAdvertiserRecord { advertiserId: string; name: string }
export type Access = 'all' | string[]

export const DEFAULT_ADVERTISER_SETTING: AdvertiserSettingRecord = { approvalRequired: true, floorMultiplier: 1 }

export interface CompanySettingsRepo {
  get(): Awaitable<CompanySettings>
  save(s: CompanySettings): Awaitable<CompanySettings>
  advertiserSetting(advertiserId: string): Awaitable<AdvertiserSettingRecord>
  advertiserSettings(): Awaitable<Record<string, AdvertiserSettingRecord>>
  saveAdvertiserSettings(settings: Record<string, AdvertiserSettingRecord>): Awaitable<void>
  /* Advertisers with a direct relationship with the retailer (no DSP), by name. */
  directAdvertisers(): Awaitable<DirectAdvertiserRecord[]>
  addDirectAdvertiser(advertiserId: string, name: string): Awaitable<void>
  removeDirectAdvertiser(advertiserId: string): Awaitable<void>
  variableAccess(): Awaitable<Record<string, Access>>
  saveVariableAccess(access: Record<string, Access>): Awaitable<void>
}

const ID = 'company'
interface Row {
  currency: string; floor_cpm: number; interactive_cpe: number
  category_whitelist: string; category_blacklist: string; guarantee_buffer_pct: number
  uncached_restriction: 'off' | 'fixed' | 'store_open'; uncached_restriction_start: string; uncached_restriction_end: string
  bid_lookahead_seconds: number; cached_asset_retention_hours: number; default_committed_plays: number | null; max_play_length_sec: number
}

/* Freeze a snapshot (and the arrays inside it) so a caller can't mutate the
   cached copy that every other request is reading. */
const frozen = <T extends object>(o: T): Readonly<T> => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') Object.freeze(v)
  return Object.freeze(o)
}

/* Performance note. These settings are read on every hot path — several
   times per play window in availability, forecast and the auction (floor, lists) — and change only when an admin presses
   Save changes. So reads are served from an in-process snapshot that every
   write through this repository replaces, and a read never writes (it used
   to run an INSERT … ON CONFLICT on each call, taking SQLite's write lock
   for what is a read).

   The snapshot also expires after CACHE_TTL_MS, which bounds how stale
   another process's view can be (the auction CLI, or a second API instance
   once this runs on the platform's database): an admin save is seen
   everywhere within that time, and immediately in the process that made it. */
export const CACHE_TTL_MS = 1_000

export function sqliteCompanySettingsRepo(db: Db): CompanySettingsRepo {
  const now = () => new Date().toISOString()
  const ensure = () => prepared(db, 'INSERT INTO company_advertiser_settings (id, updated_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING').run(ID, now())
  const read = (): Row => {
    const sel = () => prepared(db, 'SELECT * FROM company_advertiser_settings WHERE id = ?').get(ID) as unknown as Row | undefined
    let r = sel()
    /* The row is created on first use only; every later read is read-only. */
    if (!r) { ensure(); r = sel() as Row }
    return r
  }

  let cache: { at: number; company?: Readonly<CompanySettings>; advertisers?: Readonly<Record<string, AdvertiserSettingRecord>>; access?: Readonly<Record<string, Access>> } = { at: 0 }
  const fresh = () => {
    if (Date.now() - cache.at > CACHE_TTL_MS) cache = { at: Date.now() }
    return cache
  }
  const invalidate = () => { cache = { at: 0 } }
  onRollback(db, invalidate)

  const get = (): CompanySettings => {
    const c = fresh()
    if (!c.company) {
      const r = read()
      c.company = frozen({
        currency: r.currency, floorCpm: r.floor_cpm, interactiveCpe: r.interactive_cpe,
        categoryWhitelist: fromJson(r.category_whitelist, []), categoryBlacklist: fromJson(r.category_blacklist, []), guaranteeBufferPct: r.guarantee_buffer_pct,
        uncachedRestriction: r.uncached_restriction, uncachedRestrictionStart: r.uncached_restriction_start, uncachedRestrictionEnd: r.uncached_restriction_end, bidLookaheadSeconds: r.bid_lookahead_seconds, cachedAssetRetentionHours: r.cached_asset_retention_hours, defaultCommittedPlays: r.default_committed_plays, maxPlayLengthSec: r.max_play_length_sec,
      })
    }
    return c.company as CompanySettings
  }
  const advertiserMap = (): Readonly<Record<string, AdvertiserSettingRecord>> => {
    const c = fresh()
    if (!c.advertisers) {
      const rows = prepared(db, 'SELECT * FROM advertiser_settings').all() as { advertiser_id: string; approval_required: number; floor_multiplier: number }[]
      c.advertisers = Object.freeze(Object.fromEntries(rows.map((r) => [r.advertiser_id, Object.freeze({ approvalRequired: !!r.approval_required, floorMultiplier: r.floor_multiplier })])))
    }
    return c.advertisers
  }
  /* A copy: callers (the Advertisers screen, the demo seed) build on it. */
  const advertiserSettings = (): Record<string, AdvertiserSettingRecord> => ({ ...advertiserMap() })
  return {
    get,
    save(s) {
      ensure()
      prepared(db,
        `UPDATE company_advertiser_settings SET currency = ?, floor_cpm = ?, interactive_cpe = ?,
           category_whitelist = ?, category_blacklist = ?, guarantee_buffer_pct = ?,
           uncached_restriction = ?, uncached_restriction_start = ?, uncached_restriction_end = ?, bid_lookahead_seconds = ?, cached_asset_retention_hours = ?, default_committed_plays = ?, max_play_length_sec = ?, updated_at = ? WHERE id = ?`,
      ).run(
        s.currency, s.floorCpm, s.interactiveCpe,
        toJson(s.categoryWhitelist) ?? '[]', toJson(s.categoryBlacklist) ?? '[]', s.guaranteeBufferPct,
        s.uncachedRestriction, s.uncachedRestrictionStart, s.uncachedRestrictionEnd, s.bidLookaheadSeconds, s.cachedAssetRetentionHours, s.defaultCommittedPlays, s.maxPlayLengthSec, now(), ID,
      )
      invalidate()
      return get()
    },
    advertiserSettings,
    /* Per bid and per position: one lookup, no copy of the whole map. */
    advertiserSetting: (id) => ({ ...DEFAULT_ADVERTISER_SETTING, ...(advertiserMap()[id] ?? {}) }),
    saveAdvertiserSettings(settings) {
      const stmt = prepared(db,
        `INSERT INTO advertiser_settings (advertiser_id, approval_required, floor_multiplier, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (advertiser_id) DO UPDATE SET approval_required = excluded.approval_required,
           floor_multiplier = excluded.floor_multiplier, updated_at = excluded.updated_at`,
      )
      try {
        for (const [id, s] of Object.entries(settings)) stmt.run(id, s.approvalRequired ? 1 : 0, s.floorMultiplier, now())
      } finally {
        invalidate()
      }
    },
    directAdvertisers: () => (prepared(db, 'SELECT advertiser_id, name FROM direct_advertisers ORDER BY name').all() as { advertiser_id: string; name: string }[]).map((r) => ({ advertiserId: r.advertiser_id, name: r.name })),
    addDirectAdvertiser(advertiserId, name) {
      prepared(db, 'INSERT INTO direct_advertisers (advertiser_id, name, created_at) VALUES (?, ?, ?) ON CONFLICT (advertiser_id) DO NOTHING').run(advertiserId, name, now())
    },
    removeDirectAdvertiser(advertiserId) {
      prepared(db, 'DELETE FROM direct_advertisers WHERE advertiser_id = ?').run(advertiserId)
    },
    variableAccess() {
      const c = fresh()
      if (!c.access) {
        const rows = prepared(db, 'SELECT variable_key, access FROM variable_access').all() as { variable_key: string; access: string }[]
        const set = Object.fromEntries(rows.map((r) => [r.variable_key, fromJson<Access>(r.access, [])]))
        /* Unset keys take the spec §6 defaults. */
        c.access = Object.freeze(Object.fromEntries(TARGETING_VARIABLES.map((v) => [v.key, Object.freeze(set[v.key] ?? defaultVariableAccess(v)) as Access])))
      }
      return { ...c.access }
    },
    saveVariableAccess(access) {
      const stmt = prepared(db,
        `INSERT INTO variable_access (variable_key, access, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (variable_key) DO UPDATE SET access = excluded.access, updated_at = excluded.updated_at`,
      )
      try {
        for (const [k, a] of Object.entries(access)) stmt.run(k, toJson(a) as string, now())
      } finally {
        invalidate()
      }
    },
  }
}
