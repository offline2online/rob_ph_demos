/* Which version of a campaign plays for a visitor (ticket dmcbOIDGV3FnBQ66KYIb, 22 Oct 2026). The campaign system
   evaluates targeting (platform/CampaignSource.ts); this is the reference for what it must do with the Visitor Segments
   variable, used by the end-to-end stand-in for PH Core's player. Targeted versions are tried in ascending `priority`
   (1 first); the default plays when none matches. A rule is AND groups of OR conditions. */
import { SEGMENT_VARIABLE } from './audiences'
import type { Condition, Rules } from './targetingValidation'

export interface Selected { versionId: 'default' | string; tier: 'default' | 'localised' | 'personalised' }

const holds = (c: Condition, segments: Set<string>): boolean => {
  const any = c.values.some((v) => segments.has(v))
  if (c.op === 'include') return any
  if (c.op === 'match_exactly') return c.values.length === segments.size && c.values.every((v) => segments.has(v))
  if (c.op === 'exclude_or') return !any
  if (c.op === 'exclude_and') return c.values.every((v) => !segments.has(v))
  return false
}

/* Segment conditions only: a version that needs anything else (a store segment, the time) is not decided here, so it does not match. */
export const rulesMatchSegments = (rules: Rules, segments: string[]): boolean => {
  const set = new Set(segments)
  return rules.length > 0 && rules.every((group) => group.length > 0 && group.some((c) => c.variable === SEGMENT_VARIABLE && holds(c, set)))
}

export function selectVersion(targeting: unknown, segments: string[]): Selected {
  const targeted = (targeting as { targeted?: { id: string; priority: number; pricingType: Selected['tier'] | 'interactive'; rules: Rules }[] } | null)?.targeted ?? []
  const hit = [...targeted].sort((a, b) => a.priority - b.priority).find((t) => rulesMatchSegments(t.rules, segments))
  return hit ? { versionId: hit.id, tier: hit.pricingType === 'localised' ? 'localised' : 'personalised' } : { versionId: 'default', tier: 'default' }
}
