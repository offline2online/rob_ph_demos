/* Automatic end of flight (ticket bCcJ2e00CRLxtd98Utlr, 22 Oct 2026). A shared deal whose flight dates have ended
   and whose last window has played and been billed releases itself from every slot and is then archived, by
   'system'. Decided on booking and billing state only: a won or reserved window inside the flight that is not
   billed yet (still to play, or played and awaiting the Billing job) keeps the deal assigned until it is. Run on
   the scheduler tick after Billing. A deal with no end date never ends. */
import { assignedOf, type BuyersList } from '@ph-dsp/types'
import type { Context } from '../context'
import { tx } from '../db/db'
import { assignedSlotsByList } from './assignedSlots'
import { positionIdOf } from './positions'
import { diffSnapshots, takeSnapshot } from './sspAudit'
import type { AuditActor } from '../repos/SspAuditRepo'

export const SYSTEM_ACTOR: AuditActor = { type: 'agent', id: 'system', name: 'system', sessionUserId: 'system' }

const positionsOf = async (ctx: Context, listId: string) =>
  new Set((await ctx.displayTypes.list()).flatMap((t) => (t.phExtensions?.slots ?? []).flatMap((s, i) => (assignedOf(s).buyersListIds.includes(listId) ? [positionIdOf(t.id, i + 1)] : []))))

/* The slot without the deal; a slot left with no deal is real time again, as when a deal is unassigned by hand. */
const without = <S extends { buyersListIds?: string[]; openAuction?: boolean }>(s: S, listId: string): S => {
  const ids = assignedOf(s).buyersListIds.filter((id) => id !== listId)
  return { ...s, buyersListIds: ids, buyersListId: ids[0] ?? null, listMode: ids.length ? 'deal' : 'rtb', openAuction: ids.length ? s.openAuction : false }
}

export const flightHasEnded = (l: Pick<BuyersList, 'activeTo'>, now: number) => !!l.activeTo && Date.parse(l.activeTo) < now

/* Archives every ended, fully billed deal. Returns the names archived. */
export async function archiveEndedDeals(ctx: Context): Promise<string[]> {
  const now = ctx.clock().getTime()
  const ended = (await ctx.buyersLists.list('live')).filter((l) => l.status === 'shared' && flightHasEnded(l, now))
  if (!ended.length) return []
  const unbilled = await ctx.reservations.billable('9999')
  const before = await takeSnapshot(ctx)
  const done: string[] = []
  await tx(ctx.db, async () => {
    for (const l of ended) {
      const positions = await positionsOf(ctx, l.id)
      const from = l.activeFrom ? Date.parse(l.activeFrom) : -Infinity
      const to = Date.parse(l.activeTo as string)
      if (unbilled.some((r) => positions.has(r.positionId) && Date.parse(r.windowStart) >= from && Date.parse(r.windowStart) <= to)) continue
      /* Read before the slots are released: the archived deal keeps them. */
      const held = (await assignedSlotsByList(ctx)).get(l.id) ?? []
      for (const dt of await ctx.displayTypes.list()) {
        const slots = dt.phExtensions?.slots
        if (!slots?.some((s) => assignedOf(s).buyersListIds.includes(l.id))) continue
        await ctx.displayTypes.saveExtensions(dt.id, { ...dt.phExtensions!, slots: slots.map((s) => (assignedOf(s).buyersListIds.includes(l.id) ? without(s, l.id) : s)) })
      }
      await ctx.buyersLists.archive(l.id, SYSTEM_ACTOR.name, ctx.clock().toISOString(), held)
      done.push(l.name)
    }
  })
  if (done.length) {
    const drafts = diffSnapshots(before, await takeSnapshot(ctx))
    await ctx.sspAudit.record({ actor: SYSTEM_ACTOR, request: 'SCHEDULER end of flight', reason: 'The deal\'s flight ended and its last window was billed: released from its slots and archived.', at: new Date(now).toISOString() }, drafts)
  }
  return done
}
