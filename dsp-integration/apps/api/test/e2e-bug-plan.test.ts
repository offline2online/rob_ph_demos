/* scripts/lib/bug-plan.mjs: which tickets a results set files or updates. */
import { describe, expect, it } from 'vitest'
// @ts-expect-error a plain .mjs helper with no type declarations
import { SUITE_CAP, planTickets } from '../../../scripts/lib/bug-plan.mjs'

const bench = (shape: string, label: string, kind: string, from: number, to: number, unit = 'req/s') => ({ run: 'Bench', caseId: `bench:${shape}:${label}:${kind}`, title: `Perf: ${shape} ${label} — ${kind === 'p50' ? 'p50 ' : ''}${from} → ${to} ${unit}`, status: 'fail', expected: 'x', actual: `${to}`, repro: `npm run bench -- --assert --shapes=${shape}` })
const crash = { run: 'Bench', caseId: 'bench:A:crash', title: 'Perf: A bench crashed — load.ts exited 134 — out of memory', status: 'fail', expected: 'exits 0', actual: 'load.ts exited 134 — out of memory', repro: 'npm run bench -- --assert --shapes=A' }
const journey = (id: string, title = 'a thing') => ({ run: 'Run 6', caseId: id, title, status: 'fail', expected: 'ok', actual: 'bad', repro: 'npm run e2e:journey' })
const results = (cases: unknown[]) => ({ cases, commit: 'abc1234', date: '2026-10-19' })
const T = [bench('T', 'POST /v1/reservations', 'rps', 1111, 340), bench('T', 'GET /admin/v1/campaigns', 'p50', 1326.4, 1707.9, 'ms'), bench('T', 'GET /v1/x', 'rps', 100, 70)]

describe('planTickets', () => {
  it('files one ticket per bench shape, and one for a crash', () => {
    const plan = planTickets(results([...T, crash]), [])
    expect(plan.map((p: { kind: string }) => p.kind)).toEqual(['create', 'create'])
    const titles = plan.map((p: { title: string }) => p.title).sort()
    expect(titles[0]).toMatch(/^Perf: A bench crashed — load\.ts exited 134/)
    expect(titles[1]).toMatch(/^Perf: T — 3 breaches; worst: POST \/v1\/reservations — 1111 → 340 req\/s/)
    const t = plan.find((p: { title: string }) => p.title.startsWith('Perf: T'))
    expect(t.category).toBe('Backend / Infrastructure')
    expect(t.desc).toContain('npm run bench -- --assert --shapes=T')
  })
  it('comments on an open Perf ticket for the shape and ignores an archived one', () => {
    const open = planTickets(results(T), [{ id: 't1', title: 'Perf: T — 2 breaches; worst: x', status: 'backlog', type: 'bug' }])
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ kind: 'comment', id: 't1' })
    const archived = planTickets(results(T), [{ id: 't1', title: 'Perf: T — 2 breaches', status: 'archived', type: 'bug' }])
    expect(archived[0].kind).toBe('create')
  })
  it('gives bench passes no "passing since" comment', () => {
    const pass = { ...T[0], status: 'pass' }
    expect(planTickets(results([pass]), [{ id: 't1', title: 'Perf: T — 1 breach', status: 'backlog', type: 'bug' }])).toEqual([])
  })
  it('does not throw on regex characters in a case id', () => {
    for (const id of ['X(1', 'a{2', 'q?']) expect(() => planTickets(results([journey(id)]), [{ id: 't', title: 'E2E run 6: L2a — x', status: 'backlog', type: 'bug' }])).not.toThrow()
  })
  it('comments on an open "E2E run 6: L2a" ticket rather than duplicating it', () => {
    const plan = planTickets(results([journey('L2a')]), [{ id: 't9', title: 'E2E run 6: L2a — a thing', status: 'backlog', type: 'bug' }])
    expect(plan).toEqual([expect.objectContaining({ kind: 'comment', id: 't9' })])
  })
  /* The nightly's full suites (ticket QCK6k1IsDKh5HoP8RhK0): one ticket per failing case, a note on later nights. */
  const suite = (n: number, status = 'fail') => ({ run: 'Suites', caseId: `api/direct-deals.test.ts#${String(n).padStart(6, '0')}`, title: `suite test ${n}`, status, expected: 'the test passes', actual: `boom ${n}`, repro: 'cd dsp-integration/apps/api && npx vitest run test/direct-deals.test.ts' })
  it('files one "E2E suites:" ticket per failing suite case', () => {
    const plan = planTickets(results([suite(1), suite(2)]), [])
    expect(plan.map((p: { kind: string; title: string }) => `${p.kind} ${p.title}`)).toEqual(['create E2E suites: api/direct-deals.test.ts#000001 — suite test 1', 'create E2E suites: api/direct-deals.test.ts#000002 — suite test 2'])
    expect(plan[0].desc).toContain('npx vitest run test/direct-deals.test.ts')
    expect(plan[0].desc).not.toContain('End-to-End Test Spec')
  })
  it('on a later night comments on the open ticket for that case instead of filing again; a closed one is filed afresh', () => {
    const ticket = { id: 't5', title: 'E2E suites: api/direct-deals.test.ts#000001 — suite test 1', status: 'backlog', type: 'bug' }
    const plan = planTickets(results([suite(1), suite(2)]), [ticket])
    expect(plan.map((p: { kind: string }) => p.kind)).toEqual(['comment', 'create'])
    expect(plan[0]).toMatchObject({ id: 't5', text: expect.stringContaining('Still failing in commit abc1234') })
    expect(planTickets(results([suite(1)]), [{ ...ticket, status: 'archived' }])[0].kind).toBe('create')
  })
  it('says so on the open ticket once the case passes again', () => {
    const plan = planTickets(results([suite(1, 'pass')]), [{ id: 't5', title: 'E2E suites: api/direct-deals.test.ts#000001 — suite test 1', status: 'backlog', type: 'bug' }])
    expect(plan).toEqual([expect.objectContaining({ kind: 'comment', id: 't5', text: expect.stringContaining('can be closed once the fix is deployed') })])
  })
  it(`files ONE roll-up ticket when more than ${SUITE_CAP} suite cases fail at once, and comments on it the next night`, () => {
    const many = Array.from({ length: SUITE_CAP + 1 }, (_, i) => suite(i))
    const first = planTickets(results([...many, journey('L2a')]), [])
    expect(first.map((p: { kind: string }) => p.kind)).toEqual(['create', 'create'])
    const roll = first.find((p: { caseId: string }) => p.caseId === 'many-failing')
    expect(roll.title).toBe(`E2E suites: many-failing — ${SUITE_CAP + 1} suite cases red, first: suite test 0`)
    expect(roll.desc).toContain('api/direct-deals.test.ts#000003')
    const next = planTickets(results(many), [{ id: 't7', title: roll.title, status: 'backlog', type: 'bug' }])
    expect(next).toEqual([expect.objectContaining({ kind: 'comment', id: 't7' })])
  })
})
