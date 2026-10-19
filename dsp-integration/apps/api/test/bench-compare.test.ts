/* apps/api/bench/compare.ts: the bench gate's pure comparison. */
import { describe, expect, it } from 'vitest'
import { compare, type Shape } from '../bench/compare'

const shape: Shape = { args: '', note: 'T', rps: { 'POST /v1/reservations': 1111 }, p50: { 'GET /admin/v1/campaigns': 1326.4 }, ms: { auction: 100 } }
const m = (o: Record<string, number>) => o

describe('compare', () => {
  it('fails req/s below the bound and names it', () => {
    const { cases } = compare('T', shape, shape, m({ 'POST /v1/reservations|rps': 340, 'GET /admin/v1/campaigns|p50': 1326.4, 'auction|ms': 100 }), 0.25)
    const c = cases.find((x) => x.label === 'POST /v1/reservations')!
    expect(c).toMatchObject({ caseId: 'bench:T:POST /v1/reservations:rps', run: 'Bench', status: 'fail', title: 'Perf: T POST /v1/reservations — 1111 → 340 req/s', repro: 'npm run bench -- --assert --shapes=T' })
    expect(c.expected).toBe('≥ 833.3 req/s')
  })
  it('fails a p50 above the bound; values inside pass', () => {
    const { cases } = compare('T', shape, shape, m({ 'POST /v1/reservations|rps': 900, 'GET /admin/v1/campaigns|p50': 1707.9, 'auction|ms': 120 }), 0.25)
    const by = Object.fromEntries(cases.map((c) => [c.kind, c.status]))
    expect(by).toEqual({ rps: 'pass', p50: 'fail', ms: 'pass' })
  })
  it('fails an unmeasured req/s and skips an unmeasured p50', () => {
    const { cases } = compare('T', shape, shape, m({ 'auction|ms': 100 }), 0.25)
    expect(cases.map((c) => `${c.kind}:${c.status}`)).toEqual(['rps:fail', 'ms:pass'])
  })
})
