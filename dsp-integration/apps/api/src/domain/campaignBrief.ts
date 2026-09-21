/* The advertiser's campaign brief, sent with a campaign (Rob, 20 Sep):
   the platform's own Campaign Brief fields. Every field is optional — an
   advertiser sends as much as it has — but what it does send must be the
   right shape and within the contract's limits. Nothing here targets,
   prices or filters anything; it is what the reviewer reads. */
import { TOUCH_POINTS, type CampaignBrief } from '@ph-dsp/types'

type Detail = { field: string; reason: string }
const TEXTS = [['details', 2000], ['objective', 200], ['landingPageUrl', 500]] as const
const LISTS = [['promotedProducts', 50], ['skus', 100], ['targetAudiences', 50]] as const
const POINTS = TOUCH_POINTS.map((t) => t.name) as string[]

const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim())

export function validateBrief(brief: unknown): { errors: Detail[]; brief?: CampaignBrief } {
  if (brief === undefined) return { errors: [] }
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return { errors: [{ field: 'brief', reason: 'Must be an object.' }] }
  const b = brief as Record<string, unknown>
  const errors: Detail[] = []
  const known = new Set<string>([...TEXTS.map(([k]) => k), ...LISTS.map(([k]) => k), 'touchPoints'])
  for (const k of Object.keys(b)) if (!known.has(k)) errors.push({ field: `brief.${k}`, reason: 'Not a campaign brief field.' })
  for (const [k, max] of TEXTS) {
    const v = b[k]
    if (v === undefined) continue
    if (typeof v !== 'string' || !v.trim()) errors.push({ field: `brief.${k}`, reason: 'Must be text.' })
    else if (v.length > max) errors.push({ field: `brief.${k}`, reason: `At most ${max} characters.` })
  }
  for (const [k, max] of LISTS) {
    const v = b[k]
    if (v === undefined) continue
    if (!strings(v)) errors.push({ field: `brief.${k}`, reason: 'Must be a list of non-empty strings.' })
    else if ((v as string[]).length > max) errors.push({ field: `brief.${k}`, reason: `At most ${max} entries.` })
  }
  if (b.touchPoints !== undefined) {
    if (!strings(b.touchPoints) || (b.touchPoints as string[]).some((t) => !POINTS.includes(t))) errors.push({ field: 'brief.touchPoints', reason: `One or more of: ${POINTS.join(', ')}.` })
  }
  if (errors.length) return { errors }
  const clean = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : (v as string[]).map((x) => x.trim())]))
  return { errors: [], brief: clean as CampaignBrief }
}
