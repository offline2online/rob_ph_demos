/* apps/api/bench/compare.ts: the bench gate's pure comparison. */
import { describe, expect, it } from 'vitest'
import { compare, confirmBreaches, type Shape } from '../bench/compare'

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

describe('confirmBreaches', () => {
  const avail: Shape = { args: '', note: 'A', rps: { 'GET  /v1/inventory?status=available (1 yr)': 117 }, p50: { 'GET  /v1/inventory?status=available (1 yr)': 295.1 }, ms: { auction: 100 } }
  const run = (rps: number, p50: number, auction = 100) =>
    compare('A', avail, avail, m({ 'GET  /v1/inventory?status=available (1 yr)|rps': rps, 'GET  /v1/inventory?status=available (1 yr)|p50': p50, 'auction|ms': auction }), 0.25).cases
  const p50Of = (cases: ReturnType<typeof run>) => cases.find((c) => c.kind === 'p50')!

  it('passes a breach the retry does not repeat, keeping both values', () => {
    const c = p50Of(confirmBreaches(run(117, 378.3), run(117, 300.2)))
    expect(c).toMatchObject({ status: 'pass', value: 300.2, runs: [378.3, 300.2] })
  })
  it('fails a breach repeated in both runs and reports the better value', () => {
    const cases = confirmBreaches(run(70, 378.3), run(80, 371))
    expect(p50Of(cases)).toMatchObject({ status: 'fail', value: 371, runs: [378.3, 371], title: 'Perf: A GET  /v1/inventory?status=available (1 yr) — p50 295.1 → 371 ms' })
    expect(cases.find((c) => c.kind === 'rps')).toMatchObject({ status: 'fail', value: 80, runs: [70, 80] })
  })
  it('leaves first-run passes alone and keeps the first result when the retry lacks the metric', () => {
    const first = run(117, 378.3, 90)
    const cases = confirmBreaches(first, [])
    expect(cases).toEqual(first)
    expect(confirmBreaches(first, run(117, 300, 500)).find((c) => c.kind === 'ms')).toBe(first.find((c) => c.kind === 'ms'))
  })
})
