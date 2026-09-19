import { describe, expect, it } from 'vitest'
import { seed } from '../src/seed/seed'
import { testContext } from './helpers'

describe('seed data', () => {
  it('seeds the prototype sample data (Digital Signage / Kiosk types only) once', () => {
    const ctx = testContext()
    expect(ctx.displayTypes.list().map((d) => d.name)).toEqual(['Landscape', 'Portrait', 'Menu Board — Long Format'])
    expect(ctx.displayTypes.list().every((d) => ['Digital Signage', 'Kiosk'].includes(d.touchPoint))).toBe(true)
    expect(ctx.playlists.list()).toHaveLength(12)
    expect(ctx.displays.list()).toHaveLength(6)
    expect(ctx.partners.list().map((p) => [p.provider, p.status, p.mode])).toEqual([['google_dv360', 'connected', 'live'], ['amazon_dsp', 'error', 'test']])
    expect(seed(ctx)).toBe(false)
  })

  it('company settings, advertiser settings, variable access and exchange', () => {
    const ctx = testContext()
    expect(ctx.company.get()).toMatchObject({ currency: 'AUD', floorCpm: 100, personalisedMultiplier: 1.5, interactiveMultiplier: 3 })
    expect(ctx.company.advertiserSetting('nestle')).toEqual({ approvalRequired: false, floorMultiplier: 0.8 })
    expect(ctx.company.advertiserSetting('unknown')).toEqual({ approvalRequired: true, floorMultiplier: 1 })
    const access = ctx.company.variableAccess()
    expect(access['store.hours']).toBe('all')
    expect(access['store.suburb']).toEqual([])
    expect(access['visitor.age']).toEqual([])
    expect(access['visitor.purchase_intent']).toEqual(['p_google'])
    expect(ctx.exchange.get()).toEqual({ organisation: 'Demo Retail Group', domain: 'demoretail.example', sellerId: 'drg-4471', contactEmail: 'adops@demoretail.example' })
  })

  it('an unseeded database reports spec defaults', () => {
    const ctx = testContext({ seeded: false })
    expect(ctx.company.get()).toMatchObject({ currency: 'AUD', floorCpm: 100, personalisedMultiplier: 1.5, interactiveMultiplier: 3, advertiserBlacklist: [] })
    expect(ctx.company.variableAccess()['store.cv_gender']).toBe('all')
    expect(ctx.exchange.get()).toEqual({ organisation: '', domain: '', sellerId: '', contactEmail: '' })
  })
})
