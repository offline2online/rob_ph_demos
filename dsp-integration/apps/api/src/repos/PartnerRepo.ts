/* DSP partner records. Secret credential fields are encrypted through
   SecretsStore before they reach the database and are never returned. */
import { secretFields } from '@ph-dsp/types'
import { type Db, allOf, andThen, fromJson, onFree, prepared, toJson, type Awaitable } from '../db/db'
import type { SecretsStore } from '../secrets/SecretsStore'

export type { Seat } from '../dsp/DspClient'
import type { Seat } from '../dsp/DspClient'

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
  /* qps / timeoutMs: per-DSP overrides (Q46); absent means the platform default. */
  bidder: { bidderEndpoint?: string; seatIds?: string[]; qps?: number; timeoutMs?: number; floorCpm?: number; committedPlays?: number }
  seats: Seat[]
  listsLinked: boolean
  allowList: string[]
  blockList: string[]
  categoryAllowList: string[]
  categoryBlockList: string[]
}

interface Row {
  id: string; provider: string; name: string; status: PartnerRecord['status']; last_sync: string | null; mode: PartnerRecord['mode']
  creds_public: string; creds_secret: string | null; bidder: string; seats: string; lists_linked: number; allow_list: string; block_list: string
  category_allow_list: string; category_block_list: string
}

export interface PartnerRepo {
  list(): Awaitable<PartnerRecord[]>
  get(id: string): Awaitable<PartnerRecord | null>
  insert(p: Omit<PartnerRecord, 'secretsSet'> & { secrets?: Record<string, string> }): Awaitable<PartnerRecord>
  /* Decrypted secret values — for the DSP client only, never for a response. */
  secrets(id: string): Awaitable<Record<string, string>>
  update(id: string, patch: Partial<Omit<PartnerRecord, 'id' | 'provider' | 'secretsSet'>>, secrets?: Record<string, string>): Awaitable<PartnerRecord | null>
}

export function sqlitePartnerRepo(db: Db, secrets: SecretsStore): PartnerRepo {
  /* SecretsStore is awaitable (a platform KMS answers with a promise); the
     AES-GCM stand-in answers at once, and andThen keeps that path
     synchronous, so a partner read still costs no extra microtask. */
  const decode = (row: Row): Awaitable<Record<string, string>> =>
    row.creds_secret ? andThen(secrets.decrypt(row.creds_secret), (plain) => JSON.parse(plain) as Record<string, string>) : {}
  const encode = (values: Record<string, string> | undefined): Awaitable<string | null> =>
    values && Object.keys(values).length ? secrets.encrypt(JSON.stringify(values)) : null
  /* Which secret fields are set, per ciphertext. Every Partner API request
     loads its partner, and working this out used to decrypt the credentials
     (AES-GCM) each time just to list field names. The ciphertext changes
     whenever the secrets do (a fresh IV on every encrypt), so it is an exact
     cache key; nothing decrypted is kept, only the names. */
  const setFields = new Map<string, string[]>()
  const secretsSetOf = (r: Row): Awaitable<string[]> => {
    if (!r.creds_secret) return []
    const key = `${r.provider}|${r.creds_secret}`
    const names = setFields.get(key)
    if (names) return [...names]
    return andThen(decode(r), (s) => {
      const found = secretFields(r.provider).filter((k) => !!s[k])
      if (setFields.size > 1000) setFields.clear()
      setFields.set(key, found)
      return [...found]
    })
  }
  /* Everything but secretsSet, read straight off the row. */
  const base = (r: Row): Omit<PartnerRecord, 'secretsSet'> => ({
    id: r.id, provider: r.provider, name: r.name, status: r.status, lastSync: r.last_sync, mode: r.mode,
    credsPublic: fromJson(r.creds_public, {}),
    bidder: fromJson(r.bidder, {}), seats: fromJson(r.seats, []), listsLinked: !!r.lists_linked,
    allowList: fromJson(r.allow_list, []), blockList: fromJson(r.block_list, []),
    categoryAllowList: fromJson(r.category_allow_list, []), categoryBlockList: fromJson(r.category_block_list, []),
  })
  const toRecord = (r: Row): Awaitable<PartnerRecord> =>
    andThen(secretsSetOf(r), (secretsSet) => ({
      id: r.id, provider: r.provider, name: r.name, status: r.status, lastSync: r.last_sync, mode: r.mode,
      credsPublic: fromJson(r.creds_public, {}), secretsSet,
      bidder: fromJson(r.bidder, {}), seats: fromJson(r.seats, []), listsLinked: !!r.lists_linked,
      allowList: fromJson(r.allow_list, []), blockList: fromJson(r.block_list, []),
      categoryAllowList: fromJson(r.category_allow_list, []), categoryBlockList: fromJson(r.category_block_list, []),
    }))
  const row = (id: string) => prepared(db, 'SELECT * FROM partners WHERE id = ?').get(id) as Row | undefined
  /* The SQL after an encrypt that answered with a promise runs once the
     connection is free (db.ts onFree): gate() only checks at the call, and
     another call chain's transaction may have opened since. Answered at
     once, it runs in the same turn exactly as before. */
  const thenWrite = <T>(v: Awaitable<string | null>, write: (secret: string | null) => Awaitable<T>): Awaitable<T> =>
    v instanceof Promise ? (v.then((secret) => onFree(db, () => write(secret))) as Promise<T>) : write(v)
  return {
    list: () => allOf((prepared(db, 'SELECT * FROM partners ORDER BY seq').all() as unknown as Row[]).map(toRecord)),
    get: (id) => {
      const r = row(id)
      return r ? toRecord(r) : null
    },
    insert(p) {
      return thenWrite(encode(p.secrets), (secret) => {
        const now = new Date().toISOString()
        prepared(db,
          `INSERT INTO partners (id, provider, name, status, last_sync, mode, creds_public, creds_secret, bidder, seats,
             lists_linked, allow_list, block_list, category_allow_list, category_block_list, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          p.id, p.provider, p.name, p.status, p.lastSync, p.mode, toJson(p.credsPublic) ?? '{}', secret, toJson(p.bidder) ?? '{}',
          toJson(p.seats) ?? '[]', p.listsLinked ? 1 : 0, toJson(p.allowList) ?? '[]', toJson(p.blockList) ?? '[]',
          toJson(p.categoryAllowList) ?? '[]', toJson(p.categoryBlockList) ?? '[]', now, now,
        )
        return toRecord(row(p.id) as Row)
      })
    },
    secrets(id) {
      const r = row(id)
      return r ? decode(r) : {}
    },
    update(id, patch, secretValues) {
      /* undefined leaves the stored ciphertext as it is (read with the row, below). */
      const KEEP = Symbol('keep')
      const fresh: Awaitable<string | null | typeof KEEP> = secretValues === undefined ? KEEP : encode(secretValues)
      const write = (s: string | null | typeof KEEP): Awaitable<PartnerRecord | null> => {
        const r = row(id)
        if (!r) return null
        const next = { ...base(r), ...patch }
        const secret = s === KEEP ? r.creds_secret : s
        prepared(db,
          `UPDATE partners SET name = ?, status = ?, last_sync = ?, mode = ?, creds_public = ?, creds_secret = ?, bidder = ?, seats = ?,
             lists_linked = ?, allow_list = ?, block_list = ?, category_allow_list = ?, category_block_list = ?, updated_at = ? WHERE id = ?`,
        ).run(
          next.name, next.status, next.lastSync, next.mode, toJson(next.credsPublic) ?? '{}', secret, toJson(next.bidder) ?? '{}', toJson(next.seats) ?? '[]',
          next.listsLinked ? 1 : 0, toJson(next.allowList) ?? '[]', toJson(next.blockList) ?? '[]',
          toJson(next.categoryAllowList) ?? '[]', toJson(next.categoryBlockList) ?? '[]', new Date().toISOString(), id,
        )
        return toRecord(row(id) as Row)
      }
      return fresh instanceof Promise ? fresh.then((s) => onFree(db, () => write(s))) as Promise<PartnerRecord | null> : write(fresh)
    },
  }
}
