/* Shared Targeting Variables (spec §6): the platform's default variables,
   read-only, and which DSPs may target each one. A partner sees only what
   it may use — a smaller vocabulary, never a rejected request. */
import { ALL_DSPS, TARGETING_VARIABLES, type SharedVariable } from '@ph-dsp/types'
import type { Access } from '../repos/CompanySettingsRepo'
import type { PartnerRecord } from '../repos/PartnerRepo'

export const sharedVariables = (access: Record<string, Access>): SharedVariable[] =>
  TARGETING_VARIABLES.map((v) => ({ key: v.key, label: v.label, group: v.group, exampleValues: v.tip ?? `e.g. ${v.values}`, access: access[v.key] }))

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
