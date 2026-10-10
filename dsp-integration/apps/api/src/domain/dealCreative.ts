/* Creative requirements of a deal (ticket lksouRswtc6CLFevvE4J). A buyers list
   carries no inventory; the slots it is attached to do. What a DSP buyer must
   size creative for is therefore DERIVED from those positions, never stored on
   the deal: one entry per distinct format (canvas size + max play length +
   creative types) across them. A list attached to a 1080x1920 and a 1920x1080
   slot returns two entries. The same derivation validates a campaign that picks
   the deal in PH Core authoring, so what the buyer is told and what is enforced
   cannot drift.

   Canvas and format per display type are owned by PH Core and read here
   read-only (api/PH-CORE-BOUNDARIES.md "Canvas and format per display type");
   max play length is the slot's resolved value (slot -> display type -> company). */
import { assignedOf } from '@ph-dsp/types'
import type { BuyersList } from '@ph-dsp/types'
import type { Context } from '../context'
import { allPositions, maxPlayLengthSecFor, type PositionRef } from './positions'

export type CreativeType = 'image' | 'video'

export interface CreativeRequirement {
  canvas: { width: number; height: number }
  orientation: 'landscape' | 'portrait' | 'square'
  maxPlayLengthSec: number
  formats: CreativeType[]
  positionIds: string[]
}

/* The creative types a display type plays. PH Core owns this; until it shares an explicit field the exchange offers what its bid request already advertises (banner + video). */
export const creativeFormatsOf = (_p: PositionRef): CreativeType[] => ['image', 'video']

const orientationOf = (w: number, h: number): CreativeRequirement['orientation'] => (w === h ? 'square' : w > h ? 'landscape' : 'portrait')

/* The set for an already-chosen group of positions: distinct (canvas, max play length, formats), each listing the positions it covers, in a stable order. */
export function requirementsOf(positions: PositionRef[], companyMaxPlayLengthSec: number): CreativeRequirement[] {
  const byKey = new Map<string, CreativeRequirement>()
  for (const p of positions) {
    const { width, height } = p.displayType.displayCanvasSize
    const maxPlayLengthSec = maxPlayLengthSecFor(companyMaxPlayLengthSec, p)
    const formats = [...creativeFormatsOf(p)].sort()
    const key = `${width}x${height}|${maxPlayLengthSec}|${formats.join('+')}`
    const hit = byKey.get(key)
    if (hit) hit.positionIds.push(p.positionId)
    else byKey.set(key, { canvas: { width, height }, orientation: orientationOf(width, height), maxPlayLengthSec, formats, positionIds: [p.positionId] })
  }
  return [...byKey.values()].sort((a, b) => b.canvas.width * b.canvas.height - a.canvas.width * a.canvas.height || a.canvas.width - b.canvas.width || a.maxPlayLengthSec - b.maxPlayLengthSec)
}

/* Every position a buyers list is attached to (any tier of a slot's waterfall). */
export const positionsOfList = async (ctx: Context, buyersListId: string): Promise<PositionRef[]> =>
  (await allPositions(ctx)).filter((p) => assignedOf(p.def).buyersListIds.includes(buyersListId))

/* The creative-requirements set of a deal: empty while the list is attached to no slot. */
export async function creativeRequirementsFor(ctx: Context, buyersListId: string): Promise<CreativeRequirement[]> {
  const company = await ctx.company.get()
  return requirementsOf(await positionsOfList(ctx, buyersListId), company.maxPlayLengthSec)
}

/* Does a creative fit at least one entry of the set? Used by authoring to validate a campaign that picks the deal. `null` = fits; else the reason. */
export function creativeMisfit(set: CreativeRequirement[], creative: { width: number; height: number; type: CreativeType; durationSec?: number }): string | null {
  if (!set.length) return null
  const sized = set.filter((r) => r.canvas.width === creative.width && r.canvas.height === creative.height)
  if (!sized.length) return `No position of this deal is ${creative.width}x${creative.height}; it needs ${set.map((r) => `${r.canvas.width}x${r.canvas.height}`).join(' or ')}.`
  const typed = sized.filter((r) => r.formats.includes(creative.type))
  if (!typed.length) return `This deal's ${creative.width}x${creative.height} positions do not play ${creative.type}.`
  if (creative.durationSec != null && !typed.some((r) => creative.durationSec! <= r.maxPlayLengthSec)) return `Longer than the ${Math.max(...typed.map((r) => r.maxPlayLengthSec))}s this deal allows at ${creative.width}x${creative.height}.`
  return null
}

/* What a DSP buyer transacts against: the list's identity and commercial terms plus the creative-requirements set from its attached positions. */
export async function dealOf(ctx: Context, list: BuyersList, rateCpm?: number) {
  return {
    buyersListId: list.id,
    name: list.name,
    dealId: list.dealId,
    dealType: list.dealType,
    activeFrom: list.activeFrom,
    activeTo: list.activeTo,
    auctionCloses: list.auctionCloses,
    ...(rateCpm !== undefined ? { rateCpm } : {}),
    creativeRequirements: await creativeRequirementsFor(ctx, list.id),
  }
}
