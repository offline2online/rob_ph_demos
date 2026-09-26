/* Company-wide advertiser settings (pricing and lists), per-advertiser
   settings, and which DSPs may target each shared variable. */
import { TARGETING_VARIABLES, defaultVariableAccess } from '@ph-dsp/types'
import { type Db, fromJson, prepared, toJson } from '../db/db'

export interface CompanySettings {
  currency: string
  floorCpm: number
  personalisedMultiplier: number
  /* Charged per engagement (a QR Control scan) on an interactive campaign, on top of the CPM. */
  interactiveCpe: number
  /* Auction schedule: bidding opens this long before the cutoff; window length; daily cutoff (HH:MM, UTC). */
  auctionOpensHours: number
  playWindowHours: number
  auctionCutoffTime: string
  /* Set together (route/admin/advertiserSettings.ts) when playWindowHours is
     changed while a non-test window is still pending/won/reserved: the
     requested length waits here, and playWindowHours keeps its current
     value, until every such window has played (schedulerTick promotes it
     then — see exchange/scheduler.ts). Both null when nothing is deferred. */
  pendingPlayWindowHours: number | null
  pendingPlayWindowEffectiveFrom: string | null
  advertiserWhitelist: string[]
  advertiserBlacklist: string[]
  categoryWhitelist: string[]
  categoryBlacklist: string[]
}
export interface AdvertiserSettingRecord { approvalRequired: boolean; floorMultiplier: number }
export type Access = 'all' | string[]

export const DEFAULT_ADVERTISER_SETTING: AdvertiserSettingRecord = { approvalRequired: true, floorMultiplier: 1 }

export interface CompanySettingsRepo {
  get(): CompanySettings
  save(s: CompanySettings): CompanySettings
  advertiserSetting(advertiserId: string): AdvertiserSettingRecord
  advertiserSettings(): Record<string, AdvertiserSettingRecord>
  saveAdvertiserSettings(settings: Record<string, AdvertiserSettingRecord>): void
  variableAccess(): Record<string, Access>
  saveVariableAccess(access: Record<string, Access>): void
}

const ID = 'company'
interface Row {
  currency: string; floor_cpm: number; personalised_multiplier: number; interactive_cpe: number
  auction_opens_hours: number; play_window_hours: number; auction_cutoff_time: string
  pending_play_window_hours: number | null; pending_play_window_effective_from: string | null
  advertiser_whitelist: string; advertiser_blacklist: string; category_whitelist: string; category_blacklist: string
}

/* Freeze a snapshot (and the arrays inside it) so a caller can't mutate the
   cached copy that every other request is reading. */
const frozen = <T extends object>(o: T): Readonly<T> => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') Object.freeze(v)
  return Object.freeze(o)
}

/* Performance note. These settings are read on every hot path — several
   times per play window in availability, forecast and the auction (window
   length, cutoff, floor, lists) — and change only when an admin presses
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

  const get = (): CompanySettings => {
    const c = fresh()
    if (!c.company) {
      const r = read()
      c.company = frozen({
        currency: r.currency, floorCpm: r.floor_cpm, personalisedMultiplier: r.personalised_multiplier, interactiveCpe: r.interactive_cpe,
        auctionOpensHours: r.auction_opens_hours, playWindowHours: r.play_window_hours, auctionCutoffTime: r.auction_cutoff_time,
        pendingPlayWindowHours: r.pending_play_window_hours, pendingPlayWindowEffectiveFrom: r.pending_play_window_effective_from,
        advertiserWhitelist: fromJson(r.advertiser_whitelist, []), advertiserBlacklist: fromJson(r.advertiser_blacklist, []),
        categoryWhitelist: fromJson(r.category_whitelist, []), categoryBlacklist: fromJson(r.category_blacklist, []),
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
        `UPDATE company_advertiser_settings SET currency = ?, floor_cpm = ?, personalised_multiplier = ?, interactive_cpe = ?,
           auction_opens_hours = ?, play_window_hours = ?, auction_cutoff_time = ?, pending_play_window_hours = ?, pending_play_window_effective_from = ?,
           advertiser_whitelist = ?, advertiser_blacklist = ?, category_whitelist = ?, category_blacklist = ?, updated_at = ? WHERE id = ?`,
      ).run(
        s.currency, s.floorCpm, s.personalisedMultiplier, s.interactiveCpe, s.auctionOpensHours, s.playWindowHours, s.auctionCutoffTime,
        s.pendingPlayWindowHours, s.pendingPlayWindowEffectiveFrom, toJson(s.advertiserWhitelist) ?? '[]',
        toJson(s.advertiserBlacklist) ?? '[]', toJson(s.categoryWhitelist) ?? '[]', toJson(s.categoryBlacklist) ?? '[]', now(), ID,
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
