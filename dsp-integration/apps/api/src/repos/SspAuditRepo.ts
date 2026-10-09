/* SSP settings audit log (migration 0062): append-only. See domain/sspAudit.ts for what is recorded and how. */
import { randomUUID } from 'node:crypto'
import { type Db, fromJson, prepared, toJson, tx, type Awaitable } from '../db/db'

export type ActorType = 'human' | 'agent'
export interface AuditActor { type: ActorType; id: string; name: string; sessionUserId: string }
export interface AuditEntry {
  id: string; at: string; changeId: string
  actor: AuditActor
  request: string; reason: string | null
  objectType: string; objectId: string; objectLabel: string
  changeType: 'created' | 'updated' | 'deleted'
  field: string; oldValue: unknown; newValue: unknown
}
export type AuditDraft = Pick<AuditEntry, 'objectType' | 'objectId' | 'objectLabel' | 'changeType' | 'field' | 'oldValue' | 'newValue'>
export interface AuditQuery {
  objectType?: string; objectId?: string; field?: string; fieldPrefix?: string
  actorType?: ActorType; actorId?: string; changeId?: string
  from?: string; to?: string
  order?: 'asc' | 'desc'; limit?: number; before?: number
}

export interface SspAuditRepo {
  /* Append one request's entries, all with the same change id and time. */
  record(meta: { actor: AuditActor; request: string; reason: string | null; at: string }, drafts: AuditDraft[]): Awaitable<AuditEntry[]>
  /* Newest first by default; `next` is the cursor for the following page, or null at the end. */
  query(q: AuditQuery): Awaitable<{ items: AuditEntry[]; next: string | null }>
}

interface Row {
  seq: number; id: string; at: string; change_id: string; actor_type: ActorType; actor_id: string; actor_name: string; session_user_id: string
  request: string; reason: string | null; object_type: string; object_id: string; object_label: string
  change_type: AuditEntry['changeType']; field: string; old_value: string | null; new_value: string | null
}

export const MAX_PAGE = 500
export const DEFAULT_PAGE = 100

export function sqliteSspAuditRepo(db: Db): SspAuditRepo {
  const toEntry = (r: Row): AuditEntry => ({
    id: r.id, at: r.at, changeId: r.change_id,
    actor: { type: r.actor_type, id: r.actor_id, name: r.actor_name, sessionUserId: r.session_user_id },
    request: r.request, reason: r.reason, objectType: r.object_type, objectId: r.object_id, objectLabel: r.object_label,
    changeType: r.change_type, field: r.field, oldValue: fromJson(r.old_value, null), newValue: fromJson(r.new_value, null),
  })
  return {
    record(meta, drafts) {
      if (!drafts.length) return []
      const changeId = `chg_${randomUUID().slice(0, 12)}`
      /* One request's entries land together or not at all. */
      return tx(db, () => drafts.map((d) => {
        const id = `aud_${randomUUID().slice(0, 12)}`
        prepared(db, 'INSERT INTO ssp_audit_log (id, at, change_id, actor_type, actor_id, actor_name, session_user_id, request, reason, object_type, object_id, object_label, change_type, field, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, meta.at, changeId, meta.actor.type, meta.actor.id, meta.actor.name, meta.actor.sessionUserId, meta.request, meta.reason, d.objectType, d.objectId, d.objectLabel, d.changeType, d.field, toJson(d.oldValue), toJson(d.newValue))
        return toEntry(prepared(db, 'SELECT * FROM ssp_audit_log WHERE id = ?').get(id) as unknown as Row)
      }))
    },
    query(q) {
      const where: string[] = []
      const args: (string | number)[] = []
      const eq = (col: string, v: string | undefined) => { if (v !== undefined) { where.push(`${col} = ?`); args.push(v) } }
      eq('object_type', q.objectType); eq('object_id', q.objectId); eq('field', q.field)
      eq('actor_type', q.actorType); eq('actor_id', q.actorId); eq('change_id', q.changeId)
      if (q.fieldPrefix !== undefined) { where.push("(field = ? OR field LIKE ? ESCAPE '\\')"); args.push(q.fieldPrefix, `${q.fieldPrefix.replace(/[\\%_]/g, '\\$&')}.%`) }
      if (q.from !== undefined) { where.push('at >= ?'); args.push(q.from) }
      if (q.to !== undefined) { where.push('at <= ?'); args.push(q.to) }
      const desc = q.order !== 'asc'
      if (q.before !== undefined) { where.push(desc ? 'seq < ?' : 'seq > ?'); args.push(q.before) }
      const limit = Math.min(Math.max(q.limit ?? DEFAULT_PAGE, 1), MAX_PAGE)
      const rows = prepared(db, `SELECT * FROM ssp_audit_log${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY seq ${desc ? 'DESC' : 'ASC'} LIMIT ${limit + 1}`).all(...args) as unknown as Row[]
      const page = rows.slice(0, limit)
      return { items: page.map(toEntry), next: rows.length > limit ? String(page[page.length - 1].seq) : null }
    },
  }
}
