/* REQUIREMENTS §9 — reserved, spec-only foundations. Nothing here is built
   beyond names and places; these tests pin that the reservation exists, is
   unused, and doesn't leak into any API. */
import { canonicalEventErrors, CANONICAL_EVENT_SCHEMA_VERSION } from '@ph-dsp/types'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/http/app'
import { testContext } from './helpers'

const EVENT = {
  schemaVersion: 1, eventId: 'evt_1', eventType: 'play', source: 'existing-playback-system', timestamp: '2026-09-22T12:00:00Z',
  displayId: 'd_1', displayTypeId: 'landscape', campaignId: 'c_1', advertiserId: 'nestle', partnerId: 'p_google', playWindowId: null, assumedViews: 1,
  cv: { opportunityToSee: null, dwellSeconds: null, attentionSeconds: null, estimatedAgeBand: null, estimatedGender: null, confidence: null },
}

describe('§9.1–9.2 canonical event schema v1 (reserved)', () => {
  it('accepts the spec’s illustrative event, with or without CV, and with a source instance', () => {
    expect(CANONICAL_EVENT_SCHEMA_VERSION).toBe(1)
    expect(canonicalEventErrors(EVENT)).toEqual([])
    expect(canonicalEventErrors({ ...EVENT, cv: undefined })).toEqual([])
    expect(canonicalEventErrors({ ...EVENT, sourceInstanceId: 'inst_blackmores' })).toEqual([])
    expect(canonicalEventErrors({ ...EVENT, cv: { ...EVENT.cv, dwellSeconds: 4.2, estimatedAgeBand: '25-34', confidence: 0.8 } })).toEqual([])
  })

  it('requires schemaVersion, source and timestamp, and a confidence with any CV measurement', () => {
    expect(canonicalEventErrors({ ...EVENT, schemaVersion: 2 })).toContain('schemaVersion must be 1.')
    expect(canonicalEventErrors({ ...EVENT, source: '' })).toContain('source is required.')
    expect(canonicalEventErrors({ ...EVENT, timestamp: 'yesterday' })).toContain('timestamp is an ISO 8601 date-time.')
    expect(canonicalEventErrors({ ...EVENT, cv: { ...EVENT.cv, attentionSeconds: 3 } })).toContain('cv.confidence is required when any cv measurement is set.')
    expect(canonicalEventErrors({ ...EVENT, cv: { ...EVENT.cv, faceId: 'x' } })).toContain('cv.faceId is not a v1 field.')
    expect(canonicalEventErrors(null)).toEqual(['An event is an object.'])
  })
})

describe('§9.3 source-instance identity (reserved)', () => {
  it('has a place on the exchange and on reservations, left empty and never returned by the API', async () => {
    const ctx = await testContext()
    const cols = (t: string) => (ctx.db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)
    expect(cols('exchange')).toContain('platform_instance_id')
    expect(cols('reservations')).toContain('source_instance_id')
    const app = buildApp(ctx)
    const exchange = await app.inject({ url: '/api/admin/v1/exchange' })
    expect(JSON.stringify(exchange.json())).not.toMatch(/instance/i)
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE source_instance_id IS NOT NULL').get() as { n: number }).n).toBe(0)
  })
})
