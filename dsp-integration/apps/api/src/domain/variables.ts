/* Shared Targeting Variables (spec §6): the platform's default variables,
   read-only, and which DSPs may target each one. A partner sees only what
   it may use — a smaller vocabulary, never a rejected request. */
import { ALL_DSPS, TARGETING_VARIABLES, type SharedVariable } from '@ph-dsp/types'
import type { Access, VariableValues } from '../repos/CompanySettingsRepo'
import type { PartnerRecord } from '../repos/PartnerRepo'

/* A variable is shared once at least one DSP may target it. */
export const isShared = (a: Access | undefined) => a === ALL_DSPS || (Array.isArray(a) && a.length > 0)

export const sharedVariables = (access: Record<string, Access>, values: Record<string, VariableValues> = {}): SharedVariable[] =>
  TARGETING_VARIABLES.map((v) => ({
    key: v.key, label: v.label, group: v.group, exampleValues: v.tip ?? `e.g. ${v.values}`, access: access[v.key],
    /* Values only exist for a shared variable. */
    values: isShared(access[v.key]) ? values[v.key]?.values ?? [] : [], freeText: isShared(access[v.key]) && !!values[v.key]?.freeText,
  }))

/* A buyers-list criterion may only match values defined for the variable, unless it is free text. A variable
   with nothing defined and not free text stays open, so lists saved before values existed keep working. */
export const undefinedValues = (key: string, matched: string[], values: Record<string, VariableValues>) => {
  const d = values[key]
  if (!d || d.freeText || !d.values.length) return []
  return matched.filter((m) => !d.values.includes(m))
}

export function validateValues(values: unknown, access: Record<string, Access>) {
  const out: { field: string; reason: string }[] = []
  if (values === undefined) return out
  if (!values || typeof values !== 'object' || Array.isArray(values)) return [{ field: 'values', reason: 'An object keyed by variable.' }]
  const known = new Set(TARGETING_VARIABLES.map((v) => v.key))
  for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
    const r = (v ?? {}) as { values?: unknown; freeText?: unknown }
    if (!known.has(k)) out.push({ field: `values.${k}`, reason: 'Not a shared targeting variable.' })
    else if (!Array.isArray(r.values) || r.values.length > 500 || r.values.some((x) => typeof x !== 'string' || !x.trim() || x.length > 200)) out.push({ field: `values.${k}.values`, reason: 'A list of up to 500 values, 200 characters each.' })
    else if (typeof r.freeText !== 'boolean') out.push({ field: `values.${k}.freeText`, reason: 'true or false.' })
    else if ((r.values.length || r.freeText) && !isShared(access[k])) out.push({ field: `values.${k}`, reason: 'Share the variable with a DSP before defining its values.' })
  }
  return out
}

/* "All connected DSPs" includes DSPs connected later; a named DSP is enabled
   whatever its connection state. */
export const permittedFor = (p: PartnerRecord, access: Record<string, Access>) =>
  TARGETING_VARIABLES.filter((v) => {
    const a = access[v.key]
    return a === ALL_DSPS ? p.status === 'connected' : a.includes(p.id)
  })

export function validateAccess(access: unknown, partnerIds: string[]) {
  const out: { field: string; reason: string }[] = []
  if (!access || typeof access !== 'object' || Array.isArray(access)) return [{ field: 'access', reason: 'Required.' }]
  const known = new Set(TARGETING_VARIABLES.map((v) => v.key))
  for (const [k, a] of Object.entries(access as Record<string, unknown>)) {
    if (!known.has(k)) out.push({ field: `access.${k}`, reason: 'Not a shared targeting variable.' })
    else if (a === ALL_DSPS) continue
    else if (!Array.isArray(a) || a.some((x) => typeof x !== 'string')) out.push({ field: `access.${k}`, reason: 'Must be "all" or a list of DSP ids.' })
    else for (const id of a) if (!partnerIds.includes(id)) out.push({ field: `access.${k}`, reason: `Unknown DSP ${id}.` })
  }
  return out
}
