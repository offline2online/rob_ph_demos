/* Company-wide advertiser settings (pricing and lists), per-advertiser
   settings, and which DSPs may target each shared variable. */
import { TARGETING_VARIABLES, defaultVariableAccess } from '@ph-dsp/types'
import { type Db, fromJson, toJson } from '../db/db'

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
  advertiser_whitelist: string; advertiser_blacklist: string; category_whitelist: string; category_blacklist: string
}

export function sqliteCompanySettingsRepo(db: Db): CompanySettingsRepo {
  const now = () => new Date().toISOString()
  const ensure = () => db.prepare('INSERT INTO company_advertiser_settings (id, updated_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING').run(ID, now())
  const get = (): CompanySettings => {
    ensure()
    const r = db.prepare('SELECT * FROM company_advertiser_settings WHERE id = ?').get(ID) as unknown as Row
    return {
      currency: r.currency, floorCpm: r.floor_cpm, personalisedMultiplier: r.personalised_multiplier, interactiveCpe: r.interactive_cpe,
      auctionOpensHours: r.auction_opens_hours, playWindowHours: r.play_window_hours, auctionCutoffTime: r.auction_cutoff_time,
      advertiserWhitelist: fromJson(r.advertiser_whitelist, []), advertiserBlacklist: fromJson(r.advertiser_blacklist, []),
      categoryWhitelist: fromJson(r.category_whitelist, []), categoryBlacklist: fromJson(r.category_blacklist, []),
    }
  }
  const advertiserSettings = () => {
    const rows = db.prepare('SELECT * FROM advertiser_settings').all() as { advertiser_id: string; approval_required: number; floor_multiplier: number }[]
    return Object.fromEntries(rows.map((r) => [r.advertiser_id, { approvalRequired: !!r.approval_required, floorMultiplier: r.floor_multiplier }]))
  }
  return {
    get,
    save(s) {
      ensure()
      db.prepare(
        `UPDATE company_advertiser_settings SET currency = ?, floor_cpm = ?, personalised_multiplier = ?, interactive_cpe = ?,
           auction_opens_hours = ?, play_window_hours = ?, auction_cutoff_time = ?,
           advertiser_whitelist = ?, advertiser_blacklist = ?, category_whitelist = ?, category_blacklist = ?, updated_at = ? WHERE id = ?`,
      ).run(
        s.currency, s.floorCpm, s.personalisedMultiplier, s.interactiveCpe, s.auctionOpensHours, s.playWindowHours, s.auctionCutoffTime, toJson(s.advertiserWhitelist) ?? '[]',
        toJson(s.advertiserBlacklist) ?? '[]', toJson(s.categoryWhitelist) ?? '[]', toJson(s.categoryBlacklist) ?? '[]', now(), ID,
      )
      return get()
    },
    advertiserSettings,
    advertiserSetting: (id) => ({ ...DEFAULT_ADVERTISER_SETTING, ...(advertiserSettings()[id] ?? {}) }),
    saveAdvertiserSettings(settings) {
      const stmt = db.prepare(
        `INSERT INTO advertiser_settings (advertiser_id, approval_required, floor_multiplier, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (advertiser_id) DO UPDATE SET approval_required = excluded.approval_required,
           floor_multiplier = excluded.floor_multiplier, updated_at = excluded.updated_at`,
      )
      for (const [id, s] of Object.entries(settings)) stmt.run(id, s.approvalRequired ? 1 : 0, s.floorMultiplier, now())
    },
    variableAccess() {
      const rows = db.prepare('SELECT variable_key, access FROM variable_access').all() as { variable_key: string; access: string }[]
      const set = Object.fromEntries(rows.map((r) => [r.variable_key, fromJson<Access>(r.access, [])]))
      /* Unset keys take the spec §6 defaults. */
      return Object.fromEntries(TARGETING_VARIABLES.map((v) => [v.key, set[v.key] ?? defaultVariableAccess(v)]))
    },
    saveVariableAccess(access) {
      const stmt = db.prepare(
        `INSERT INTO variable_access (variable_key, access, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (variable_key) DO UPDATE SET access = excluded.access, updated_at = excluded.updated_at`,
      )
      for (const [k, a] of Object.entries(access)) stmt.run(k, toJson(a) as string, now())
    },
  }
}
