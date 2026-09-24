/* Canonical playback/analytics event — schema version 1, RESERVED
   (REQUIREMENTS §9.1–§9.3, 22 Sep 2026 DSP analytics strategy session).

   What this is: the shape the spec reserves so that later work extends it
   instead of breaking it. Nothing in this build produces, stores, sends or
   reads these events — the existing Personalisation Hub analytics system
   stays the system of record (§9, "Relationship to existing analytics"),
   and the transport (S3 partitioning, batching, QuickSight) is deliberately
   not decided here: the event MODEL is separate from its TRANSPORT.

   What this is not: the exhaustive field reference (types, allowed values,
   changelog) — that is open question 53, to be written when a
   schema-consuming pipeline is commissioned. This file is where it will
   live; the validator below checks only what §9 already fixes.

   Rules §9.1 fixes, which any change to this file must keep:
   - every event carries schemaVersion, source and timestamp (when the event
     happened, not when it landed);
   - an additive, optional field is a compatible change within a version;
     changing what an existing field means is a NEW version plus an entry in
     the changelog below — never a silent redefinition;
   - computer-vision fields (§9.2) are optional and nullable from day one,
     each measurement paired with a confidence; a producer with no CV signal
     leaves them null;
   - sourceInstanceId (§9.3) identifies the PH INSTANCE that emitted the
     event, for cross-instance federation. It is NOT the sellers.json seller
     ID (that is the retailer's identity to the ad ecosystem); it maps to the
     instance's stable domain instead.

   Changelog
   - v1 (23 Sep 2026): reserved, per §9.1's illustrative shape. */

export const CANONICAL_EVENT_SCHEMA_VERSION = 1 as const

export type CanonicalEventType = 'play' | 'impression' | 'interaction'

/* Anonymised, non-identifying — the same shape the existing Computer Vision
   targeting variables use (§9.2 "Anonymisation is unchanged"). */
export interface CvMeasurement {
  opportunityToSee: number | null
  dwellSeconds: number | null
  attentionSeconds: number | null
  estimatedAgeBand: string | null
  estimatedGender: string | null
  /* 0–1. Lets a consumer (e.g. a DSP) apply its own threshold before
     treating a measurement as tradeable (§9.2, open question 34). */
  confidence: number | null
}

export interface CanonicalEventV1 {
  schemaVersion: typeof CANONICAL_EVENT_SCHEMA_VERSION
  eventId: string
  eventType: CanonicalEventType
  /* Which system emitted it: 'existing-playback-system', 'vision-ai', 'mist', … */
  source: string
  /* The PH instance that emitted it (§9.3). Optional until federation is built. */
  sourceInstanceId?: string | null
  /* ISO 8601, when the event occurred. */
  timestamp: string
  displayId: string
  displayTypeId: string
  campaignId: string | null
  advertiserId: string | null
  partnerId: string | null
  playWindowId: string | null
  assumedViews: number | null
  cv?: CvMeasurement | null
}

/* The instance identity §9.3 reserves, held ALONGSIDE (never inside) the
   exchange's seller-of-record details. `domain` is the same stable domain
   sellers.json publishes under, kept separately so the two can be
   cross-checked rather than conflated. */
export interface PlatformInstance {
  instanceId: string
  domain: string
}

const CV_KEYS: (keyof CvMeasurement)[] = ['opportunityToSee', 'dwellSeconds', 'attentionSeconds', 'estimatedAgeBand', 'estimatedGender', 'confidence']
const nullableNumber = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)
const nullableString = (v: unknown) => v === null || typeof v === 'string'

/* Checks what §9 fixes; returns one message per problem ([] when valid).
   For a future producer's own tests — nothing in this build calls it on
   live data, because nothing in this build produces events. */
export function canonicalEventErrors(e: unknown): string[] {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['An event is an object.']
  const x = e as Record<string, unknown>
  const errs: string[] = []
  if (x.schemaVersion !== CANONICAL_EVENT_SCHEMA_VERSION) errs.push(`schemaVersion must be ${CANONICAL_EVENT_SCHEMA_VERSION}.`)
  for (const k of ['eventId', 'source', 'displayId', 'displayTypeId'] as const) if (typeof x[k] !== 'string' || !(x[k] as string)) errs.push(`${k} is required.`)
  if (!['play', 'impression', 'interaction'].includes(x.eventType as string)) errs.push('eventType is play, impression or interaction.')
  if (typeof x.timestamp !== 'string' || Number.isNaN(Date.parse(x.timestamp))) errs.push('timestamp is an ISO 8601 date-time.')
  for (const k of ['campaignId', 'advertiserId', 'partnerId', 'playWindowId'] as const) if (!nullableString(x[k] ?? null)) errs.push(`${k} is a string or null.`)
  if (x.sourceInstanceId !== undefined && !nullableString(x.sourceInstanceId)) errs.push('sourceInstanceId is a string or null.')
  if (!nullableNumber(x.assumedViews ?? null)) errs.push('assumedViews is a non-negative number or null.')
  if (x.cv !== undefined && x.cv !== null) {
    if (typeof x.cv !== 'object' || Array.isArray(x.cv)) errs.push('cv is an object or null.')
    else {
      const cv = x.cv as Record<string, unknown>
      for (const k of ['opportunityToSee', 'dwellSeconds', 'attentionSeconds'] as const) if (!nullableNumber(cv[k] ?? null)) errs.push(`cv.${k} is a non-negative number or null.`)
      for (const k of ['estimatedAgeBand', 'estimatedGender'] as const) if (!nullableString(cv[k] ?? null)) errs.push(`cv.${k} is a string or null.`)
      const conf = cv.confidence ?? null
      if (!(conf === null || (typeof conf === 'number' && conf >= 0 && conf <= 1))) errs.push('cv.confidence is between 0 and 1, or null.')
      /* A measurement without its confidence can't be judged tradeable. */
      const measured = CV_KEYS.filter((k) => k !== 'confidence').some((k) => cv[k] !== null && cv[k] !== undefined)
      if (measured && conf === null) errs.push('cv.confidence is required when any cv measurement is set.')
      for (const k of Object.keys(cv)) if (!CV_KEYS.includes(k as keyof CvMeasurement)) errs.push(`cv.${k} is not a v1 field.`)
    }
  }
  return errs
}
