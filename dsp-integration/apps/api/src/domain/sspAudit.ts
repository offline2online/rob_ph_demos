/* SSP settings audit log (ticket W9b1lEcTUbEMphsmBma3, 9 Oct 2026).

   Every admin write to a retailer-side SSP setting is recorded field by
   field: who (a human, or an agent that identified itself), what object and
   field, the old and new value, and when. It is done once, around the request
   (http/app.ts), by comparing a snapshot of every in-scope setting taken
   before the handler with one taken after, so a setting added to a route
   later, or a per-display-type floor stored on a slot, is covered without
   its route remembering to log it.

   In scope (the objects below): the exchange settings, the pricing and
   auction settings (floor CPM, lookahead, play length, category lists,
   guarantee buffer, …), the per-advertiser settings (floor multiplier), the
   shared-variable access per DSP, every buyers list (deal), every display
   type's SSP extensions (slots: owner, reserve prices and the per-display-type
   floor, billing unit, assignment, deals, locks), and each DSP's bid settings
   (floor, committed plays, QPS, timeout, seats). A value changed any other
   way than the admin API (a seed script, a database edit) is not recorded.

   Who: the request's session is the HQ user; an agent acting through it
   says so with `X-Actor-Type: agent` and `X-Actor-Id` (and optionally
   `X-Actor-Name`, `X-Change-Reason`). An agent that does not identify itself is
   refused (400), so a change is never attributed to the wrong kind of actor. */
import type { FastifyRequest } from 'fastify'
import type { Context } from '../context'
import { DEFAULT_ADVERTISER_SETTING } from '../repos/CompanySettingsRepo'
import type { ActorType, AuditActor, AuditDraft } from '../repos/SspAuditRepo'
import { validationFailed } from '../http/errors'

/* The admin paths whose writes can change an SSP setting. */
const AUDITED = /^\/api\/admin\/v1\/(exchange|advertiser-settings|advertisers|available-inventory|buyers-lists|display-types|partners|targeting-variables)(\/|$)/
export const isAuditedWrite = (req: Pick<FastifyRequest, 'method' | 'url'>) =>
  req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && AUDITED.test(req.url.split('?')[0])

const header = (req: FastifyRequest, name: string) => {
  const v = req.headers[name]
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' && s.trim() ? s.trim().slice(0, 200) : undefined
}

export function auditActorOf(req: FastifyRequest): { actor: AuditActor; reason: string | null } {
  const type = (header(req, 'x-actor-type') ?? 'human').toLowerCase()
  if (type !== 'human' && type !== 'agent') throw validationFailed([{ field: 'X-Actor-Type', reason: 'human or agent.' }])
  const actorId = header(req, 'x-actor-id')
  if (type === 'agent' && !actorId) throw validationFailed([{ field: 'X-Actor-Id', reason: 'An agent must identify itself (X-Actor-Id) when it changes a setting.' }])
  const s = req.session
  const actor: AuditActor = type === 'agent'
    ? { type: 'agent' as ActorType, id: actorId!, name: header(req, 'x-actor-name') ?? actorId!, sessionUserId: s.userId }
    : { type: 'human', id: s.userId, name: s.name, sessionUserId: s.userId }
  return { actor, reason: header(req, 'x-change-reason') ?? null }
}

interface Entity { type: string; id: string; label: string; fields: Map<string, unknown> }
export type Snapshot = Map<string, Entity>

/* Fields that move on their own, or are derived, and so are not a setting someone changed. */
const NOISE = new Set(['createdAt', 'updatedAt', 'lockedWin', 'deliveredPlays', 'effectiveCommittedPlays', 'effectiveRateCpm', 'defaultVacdSource'])

/* Dotted paths: objects descend (a.b), arrays of objects index (slots[1].label); arrays of plain values, and empty ones, are one value. */
export function flatten(value: unknown, path = '', out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(value) && value.length && value.some((v) => v && typeof v === 'object')) {
    value.forEach((v, i) => flatten(v, `${path}[${i + 1}]`, out))
  } else if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) {
    for (const [k, v] of Object.entries(value)) if (!NOISE.has(k)) flatten(v, path ? `${path}.${k}` : k, out)
  } else if (path) out.set(path, value === undefined ? null : value)
  return out
}

export async function takeSnapshot(ctx: Context): Promise<Snapshot> {
  const s: Snapshot = new Map()
  const add = (type: string, id: string, label: string, value: unknown) => s.set(`${type}:${id}`, { type, id, label, fields: flatten(value) })
  add('exchange', 'exchange', 'Exchange settings', await ctx.exchange.get())
  add('pricing_settings', 'company', 'Advertiser settings (pricing, floors and auction)', await ctx.company.get())
  for (const [id, v] of Object.entries(await ctx.company.advertiserSettings())) add('advertiser_setting', id, `Advertiser ${id}`, v)
  const access = await ctx.company.variableAccess()
  add('targeting_variable_access', 'access', 'Shared targeting variables: which DSPs may target each', Object.fromEntries(Object.entries(access).map(([k, v]) => [k, v])))
  for (const l of await ctx.buyersLists.list()) add('buyers_list', l.id, l.name, l)
  for (const t of await ctx.displayTypes.list()) if (t.phExtensions) add('display_type', t.id, t.name, t.phExtensions)
  for (const p of await ctx.partners.list()) add('dsp_partner', p.id, p.name, { mode: p.mode, bidder: p.bidder, allowList: p.allowList, blockList: p.blockList, categoryAllowList: p.categoryAllowList, categoryBlockList: p.categoryBlockList })
  return s
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/* What an object that does not exist yet reads as, so saving a default for the first time is not a change. */
const ABSENT_AS: Record<string, () => Map<string, unknown>> = {
  advertiser_setting: () => flatten(DEFAULT_ADVERTISER_SETTING),
}

export function diffSnapshots(before: Snapshot, after: Snapshot): AuditDraft[] {
  const out: AuditDraft[] = []
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(key)
    const a = after.get(key)
    const e = (a ?? b)!
    const changeType: AuditDraft['changeType'] = !b ? 'created' : !a ? 'deleted' : 'updated'
    const was = b?.fields ?? ABSENT_AS[e.type]?.() ?? new Map<string, unknown>()
    const now = a?.fields ?? new Map<string, unknown>()
    for (const field of new Set([...was.keys(), ...now.keys()])) {
      const oldValue = was.get(field) ?? null
      const newValue = now.get(field) ?? null
      if (same(oldValue, newValue)) continue
      out.push({ objectType: e.type, objectId: e.id, objectLabel: a?.label ?? e.label, changeType: ABSENT_AS[e.type] && !b ? 'updated' : changeType, field, oldValue, newValue })
    }
  }
  return out
}
