/* DSP partner records. Secret credential fields are encrypted through
   SecretsStore before they reach the database and are never returned. */
import { secretFields } from '@ph-dsp/types'
import { type Db, fromJson, toJson } from '../db/db'
import type { SecretsStore } from '../secrets/SecretsStore'

export interface Seat { id: string; name: string }

export interface PartnerRecord {
  id: string
  provider: string
  name: string
  status: 'draft' | 'connected' | 'error'
  lastSync: string | null
  mode: 'test' | 'live'
  credsPublic: Record<string, string>
  /* Which secret fields are set (values stay encrypted). */
  secretsSet: string[]
  bidder: { bidderEndpoint?: string; seatIds?: string[] }
  seats: Seat[]
  listsLinked: boolean
  allowList: string[]
  blockList: string[]
}

interface Row {
  id: string; provider: string; name: string; status: PartnerRecord['status']; last_sync: string | null; mode: PartnerRecord['mode']
  creds_public: string; creds_secret: string | null; bidder: string; seats: string; lists_linked: number; allow_list: string; block_list: string
}

export interface PartnerRepo {
  list(): PartnerRecord[]
  get(id: string): PartnerRecord | null
  insert(p: Omit<PartnerRecord, 'secretsSet'> & { secrets?: Record<string, string> }): PartnerRecord
  /* Decrypted secret values — for the DSP client only, never for a response. */
  secrets(id: string): Record<string, string>
  update(id: string, patch: Partial<Omit<PartnerRecord, 'id' | 'provider' | 'secretsSet'>>, secrets?: Record<string, string>): PartnerRecord | null
}

export function sqlitePartnerRepo(db: Db, secrets: SecretsStore): PartnerRepo {
  const decode = (row: Row) => (row.creds_secret ? (JSON.parse(secrets.decrypt(row.creds_secret)) as Record<string, string>) : {})
  const toRecord = (r: Row): PartnerRecord => {
    const s = decode(r)
    return {
      id: r.id, provider: r.provider, name: r.name, status: r.status, lastSync: r.last_sync, mode: r.mode,
      credsPublic: fromJson(r.creds_public, {}), secretsSet: secretFields(r.provider).filter((k) => !!s[k]),
      bidder: fromJson(r.bidder, {}), seats: fromJson(r.seats, []), listsLinked: !!r.lists_linked,
      allowList: fromJson(r.allow_list, []), blockList: fromJson(r.block_list, []),
    }
  }
  const row = (id: string) => db.prepare('SELECT * FROM partners WHERE id = ?').get(id) as Row | undefined
  return {
    list: () => (db.prepare('SELECT * FROM partners ORDER BY rowid').all() as unknown as Row[]).map(toRecord),
    get: (id) => {
      const r = row(id)
      return r ? toRecord(r) : null
    },
    insert(p) {
      const now = new Date().toISOString()
      const secret = p.secrets && Object.keys(p.secrets).length ? secrets.encrypt(JSON.stringify(p.secrets)) : null
      db.prepare(
        `INSERT INTO partners (id, provider, name, status, last_sync, mode, creds_public, creds_secret, bidder, seats,
           lists_linked, allow_list, block_list, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        p.id, p.provider, p.name, p.status, p.lastSync, p.mode, toJson(p.credsPublic) ?? '{}', secret, toJson(p.bidder) ?? '{}',
        toJson(p.seats) ?? '[]', p.listsLinked ? 1 : 0, toJson(p.allowList) ?? '[]', toJson(p.blockList) ?? '[]', now, now,
      )
      return toRecord(row(p.id) as Row)
    },
    secrets(id) {
      const r = row(id)
      return r ? decode(r) : {}
    },
    update(id, patch, secretValues) {
      const r = row(id)
      if (!r) return null
      const cur = toRecord(r)
      const next = { ...cur, ...patch }
      const secret = secretValues === undefined ? r.creds_secret : Object.keys(secretValues).length ? secrets.encrypt(JSON.stringify(secretValues)) : null
      db.prepare(
        `UPDATE partners SET name = ?, status = ?, last_sync = ?, mode = ?, creds_public = ?, creds_secret = ?, bidder = ?, seats = ?,
           lists_linked = ?, allow_list = ?, block_list = ?, updated_at = ? WHERE id = ?`,
      ).run(
        next.name, next.status, next.lastSync, next.mode, toJson(next.credsPublic) ?? '{}', secret, toJson(next.bidder) ?? '{}', toJson(next.seats) ?? '[]',
        next.listsLinked ? 1 : 0, toJson(next.allowList) ?? '[]', toJson(next.blockList) ?? '[]', new Date().toISOString(), id,
      )
      return toRecord(row(id) as Row)
    },
  }
}
