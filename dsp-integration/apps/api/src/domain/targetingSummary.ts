/* Human-readable summary of a content package's targeting (review panel):
   AND groups of OR conditions, labelled with the Targeting-tab names. */
import { OPERATOR_LABELS, TARGETING_VARIABLES } from '@ph-dsp/types'

export interface Condition { source: string; variable: string; op: string; values: string[] }
export interface StoredTargeting {
  /* Mandatory on every submission (decision, 22 Sep, superseding the
     earlier same-day "baseline optional" decision — ticket "Make default
     creative mandatory; retire localised-only booking path"): the
     untargeted layer every campaign must carry. Typed optional here only
     because older stored records predate the requirement. */
  default?: { pricingType: string }
  targeted?: { id: string; priority: number; pricingType: string; rules: Condition[][] }[]
}

const OPS: Record<string, string> = OPERATOR_LABELS
const label = (key: string) => TARGETING_VARIABLES.find((v) => v.key === key)?.label ?? key
const condition = (c: Condition) => `${label(c.variable)} ${OPS[c.op] ?? c.op} ${c.values.join(', ')}`

export function targetingSummary(t: unknown): string {
  const s = t as StoredTargeting | null
  if (!s || (!s.default && !s.targeted?.length)) return ''
  const lines = s.default ? [`Default (${s.default.pricingType})`] : []
  for (const v of s.targeted ?? []) {
    lines.push(`${v.id} (priority ${v.priority}, ${v.pricingType}): ${v.rules.map((g) => (g.length > 1 ? `(${g.map(condition).join(' OR ')})` : condition(g[0]))).join(' AND ')}`)
  }
  return lines.join('\n')
}
