/* Targeting permission validation (spec §6). Validation only: rules are
   checked, then stored in the existing targeting structure (AND groups of OR
   conditions) and evaluated by the existing platform. Nothing here decides
   what matches. */
import { OPERATOR_LABELS, TARGETING_VARIABLES, type Operator } from '@ph-dsp/types'
import type { Access } from '../repos/CompanySettingsRepo'
import type { PartnerRecord } from '../repos/PartnerRepo'
import { permittedFor } from './variables'

export interface Condition { source: string; variable: string; op: string; values: string[] }
export type Rules = Condition[][]
type Detail = { field?: string; variable?: string; reason: string }

export interface TargetingResult {
  /* 400 validation_failed: the rules aren't in the Targeting-tab shape. */
  invalid: Detail[]
  /* 422 variable_not_permitted: variables this DSP may not target, each named once. */
  notPermitted: Detail[]
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

export function validateRules(rules: unknown, at: string, partner: PartnerRecord, access: Record<string, Access>, maxValues: number): TargetingResult {
  const invalid: Detail[] = []
  const notPermitted = new Map<string, Detail>()
  if (!Array.isArray(rules)) return { invalid: [{ field: at, reason: 'Must be a list of AND groups.' }], notPermitted: [] }
  const allowed = new Set(permittedFor(partner, access).map((v) => v.key))
  rules.forEach((group, g) => {
    const gf = `${at}[${g}]`
    if (!Array.isArray(group) || !group.length) return invalid.push({ field: gf, reason: 'Each AND group is a non-empty list of OR conditions.' })
    group.forEach((c, i) => {
      const f = `${gf}[${i}]`
      if (!isObj(c)) return invalid.push({ field: f, reason: 'Must be a condition {source, variable, op, values}.' })
      const def = TARGETING_VARIABLES.find((v) => v.key === c.variable)
      if (typeof c.variable !== 'string' || !c.variable) return invalid.push({ field: `${f}.variable`, reason: 'Required.' })
      if (!def || !allowed.has(def.key)) {
        if (!notPermitted.has(c.variable)) notPermitted.set(c.variable, { variable: c.variable, reason: def ? `Not enabled for ${partner.name}.` : 'Not a shared targeting variable.' })
        return
      }
      if (c.source !== def.source) invalid.push({ field: `${f}.source`, reason: `${def.label} is ${def.source} data.` })
      if (!def.operators.includes(c.op as Operator)) {
        invalid.push({ field: `${f}.op`, reason: `${def.label} takes ${def.operators.map((o) => OPERATOR_LABELS[o]).join(', ')}.` })
      }
      const values = c.values
      if (!Array.isArray(values) || !values.length || values.some((v) => typeof v !== 'string' || !v.trim())) invalid.push({ field: `${f}.values`, reason: 'A non-empty list of values.' })
      else if (values.length > maxValues) invalid.push({ field: `${f}.values`, reason: `At most ${maxValues} values per condition.` })
    })
  })
  return { invalid, notPermitted: [...notPermitted.values()] }
}

/* Every rule set on a campaign (targeted versions only; the baseline has none). */
export const rulesOf = (targeted: { rules?: unknown }[] | undefined) => (targeted ?? []).map((t) => t.rules)
