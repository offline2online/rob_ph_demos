import { describe, expect, it } from 'vitest'
import { TARGETING_VARIABLES } from '@ph-dsp/types'
import { validateRules } from '../src/domain/targetingValidation'
import type { PartnerRecord } from '../src/repos/PartnerRepo'
import { buildApp } from '../src/http/app'
import { expectMatchesContract } from './contract'
import { NOW, testContext } from './helpers'

const partner = { id: 'p_google', name: 'Google DSP', status: 'connected' } as PartnerRecord
/* Localisation "all"; of Personalisation, only SKUs (named for this DSP) and Gender (another DSP). */
const access: Record<string, 'all' | string[]> = Object.fromEntries(TARGETING_VARIABLES.map((v) => [v.key, v.group === 'localisation' ? 'all' : []]))
access['visitor.skus'] = ['p_google']
access['visitor.gender'] = ['p_amazon']
const check = (rules: unknown, max = 100) => validateRules(rules, 'rules', partner, access, max)
const cond = (variable: string, op: string, values: string[], source = variable.split('.')[0]) => ({ source, variable, op, values })

describe('validateRules — targeting permission validation (spec §6)', () => {
  it('accepts rules that use only permitted variables, including a list of SKUs', () => {
    expect(check([[cond('store.fixed_segments', 'include', ['Metro']), cond('store.state', 'exclude_or', ['VIC'])], [cond('visitor.skus', 'include', ['SKU-10234', 'SKU-55871'])]])).toEqual({ invalid: [], notPermitted: [] })
  })

  it('rejects a variable not permitted for the DSP, naming it (once, however often it is used)', () => {
    expect(check([[cond('visitor.age', 'greater_than', ['30'])], [cond('visitor.gender', 'equal', ['Female']), cond('visitor.age', 'less_than', ['50'])]]).notPermitted).toEqual([
      { variable: 'visitor.age', reason: 'Not enabled for Google DSP.' },
      { variable: 'visitor.gender', reason: 'Not enabled for Google DSP.' },
    ])
  })

  it('"All connected DSPs" only counts while the DSP is connected', () => {
    const r = validateRules([[cond('store.state', 'include', ['NSW'])]], 'rules', { ...partner, status: 'error' }, access, 100)
    expect(r.notPermitted).toEqual([{ variable: 'store.state', reason: 'Not enabled for Google DSP.' }])
  })

  it('names variables that aren’t shared targeting variables', () => {
    expect(check([[cond('visitor.weather', 'equal', ['Rain'])]]).notPermitted).toEqual([{ variable: 'visitor.weather', reason: 'Not a shared targeting variable.' }])
  })

  it('checks each operator against the variable’s own set', () => {
    expect(check([[cond('store.hours', 'include', ['Open']), cond('store.cv_age', 'greater_than_or_equal', ['25']), cond('store.cv_gender', 'match_exactly', ['Female'])]]).invalid).toEqual([
      { field: 'rules[0][0].op', reason: 'Store Open / Closed takes equal, not equal.' },
    ])
  })

  it('caps values per condition (Q48: 100 SKUs) and needs at least one', () => {
    const skus = Array.from({ length: 101 }, (_, i) => `SKU-${i}`)
    expect(check([[cond('visitor.skus', 'include', skus)]]).invalid).toEqual([{ field: 'rules[0][0].values', reason: 'At most 100 values per condition.' }])
    expect(check([[cond('visitor.skus', 'include', skus.slice(0, 100))]]).invalid).toEqual([])
    expect(check([[cond('visitor.skus', 'include', [])]]).invalid).toEqual([{ field: 'rules[0][0].values', reason: 'A non-empty list of values.' }])
  })

  it('needs the Targeting-tab shape: AND groups of OR conditions, source matching the variable', () => {
    expect(check({}).invalid).toEqual([{ field: 'rules', reason: 'Must be a list of AND groups.' }])
    expect(check([[], 'x', [cond('store.state', 'include', ['NSW'], 'visitor')]]).invalid).toEqual([
      { field: 'rules[0]', reason: 'Each AND group is a non-empty list of OR conditions.' },
      { field: 'rules[1]', reason: 'Each AND group is a non-empty list of OR conditions.' },
      { field: 'rules[2][0].source', reason: 'State is store data.' },
    ])
  })
})

describe('Targeting on the forecast', () => {
  const setup = async () => {
    const app = buildApp(await testContext({ clock: () => NOW }))
    return (rules: unknown) => app.inject({ method: 'POST', url: '/api/v1/inventory/forecast', headers: { authorization: 'Bearer poc-token-google-dv360' }, payload: { positionIds: ['menu_board.s2'], from: '2026-09-21', to: '2026-09-21', rules } })
  }

  it('shrinks the forecast by the targeted share, and prices Personalisation targeting as personalised', async () => {
    const forecast = await setup()
    expect((await forecast([[cond('store.fixed_segments', 'include', ['Metro'])]])).json()).toEqual({ assumedViews: 618, currency: 'AUD', estimatedCost: 61.8 })
    /* Purchase Intent is a Personalisation Variable enabled for Google: 618 / 1000 × (100 × 1.5). */
    expect((await forecast([[cond('visitor.purchase_intent', 'include', ['Replenish'])]])).json()).toEqual({ assumedViews: 618, currency: 'AUD', estimatedCost: 92.7 })
  })

  it('rejects a variable the DSP may not target (422), and malformed rules (400)', async () => {
    const forecast = await setup()
    const refused = await forecast([[cond('visitor.age', 'less_than', ['30'])]])
    expect(refused.statusCode).toBe(422)
    expectMatchesContract('POST', '/v1/inventory/forecast', 422, refused.json())
    expect(refused.json().error.details).toEqual([{ variable: 'visitor.age', reason: 'Not enabled for Google DSP.' }])
    const bad = await forecast([[cond('store.hours', 'greater_than', ['Open'])]])
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.details).toEqual([{ field: 'rules[0][0].op', reason: 'Store Open / Closed takes equal, not equal.' }])
  })
})
