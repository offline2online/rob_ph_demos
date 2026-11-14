/* scripts/lib/results.mjs reading every file the runs produce, and the two scripts end to end on an e2e-run record. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error a plain .mjs helper with no type declarations
import { load, merge } from '../../../scripts/lib/results.mjs'

const ROOT = join(__dirname, '../../..')
const dir = mkdtempSync(join(tmpdir(), 'ph-results-'))
const write = (name: string, v: unknown) => { const f = join(dir, name); writeFileSync(f, JSON.stringify(v)); return f }
const benchCase = { id: 'bench:T:x:rps', caseId: 'bench:T:x:rps', run: 'Bench', title: 'Perf: T x — 10 → 1 req/s', status: 'fail', expected: '≥ 7.5 req/s', actual: '1 req/s', repro: 'npm run bench -- --assert --shapes=T' }
const record = {
  runAt: '2026-10-19T04:00:00.000Z', mode: 'full', commit: 'abc1234',
  steps: [
    { id: 'journey', label: 'Run 6 journey', status: 'pass', cases: [{ id: 'L2a', run: 'Run 6', title: 'L2a — x', status: 'pass', expected: 'ok', actual: 'ok', repro: 'npm run e2e:journey' }] },
    { id: 'bench', label: 'Bench with thresholds', status: 'fail', cases: [benchCase] },
    { id: 'layout', label: 'Visual layout check', status: 'skipped', reason: 'not configured', cases: [] },
  ],
}

describe('results.load', () => {
  it('gives a bench file its own run and repro', () => {
    const r = load(write('bench.json', { run: 'Bench', command: 'npm run bench -- --assert', cases: [benchCase] }))
    expect(r.run).toBe('Bench')
    expect(r.cases[0]).toMatchObject({ run: 'Bench', repro: 'npm run bench -- --assert --shapes=T' })
  })
  it('keeps the journey defaults and reads a bare array', () => {
    const j = load(write('journey.json', { run: 'Run 6 — full user journey', cases: [{ caseId: 'L2a', title: 't', status: 'pass', expected: 'a', actual: 'b' }] }))
    expect(j.cases[0]).toMatchObject({ run: 'Run 6', repro: 'npm run e2e:journey' })
    expect(load(write('arr.json', [benchCase])).cases[0].run).toBe('Bench')
  })
  it('reads an e2e-run record, one skipped case for a skipped step', () => {
    const r = load(write('rec.json', record))
    expect(r.cases.map((c: { run: string; caseId: string; status: string }) => `${c.run}|${c.caseId}|${c.status}`)).toEqual(['Run 6|L2a|pass', 'Bench|bench:T:x:rps|fail', 'Visual layout check|layout|skipped'])
    expect(r.cases[2].actual).toBe('not configured')
  })
})

describe('the scripts on E2E_RESULTS_FILE', () => {
  const env = { ...process.env, E2E_RESULTS_FILE: write('run.json', record), BOARD_API_KEY: '' }
  const run = (script: string) => spawnSync(process.execPath, [join(ROOT, 'scripts', script), '--dry-run'], { cwd: ROOT, env, encoding: 'utf8' })
  it('report-e2e --dry-run exits 0', () => { const r = run('report-e2e.mjs'); expect(r.status, r.stderr).toBe(0) })
  it('file-e2e-bugs --dry-run prints TICKETS_FILED=', () => {
    const r = run('file-e2e-bugs.mjs')
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toMatch(/Perf: T — 1 breach/)
    expect(r.stdout.trim().split('\n').pop()).toBe('TICKETS_FILED=0')
  })
  it('exit 2 with usage when there is no file at all', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/file-e2e-bugs.mjs'), '--dry-run'], { cwd: ROOT, env: { ...env, E2E_RESULTS_FILE: '' }, encoding: 'utf8' })
    expect(r.status).toBe(2)
  })
})

/* A red `npm test` in the nightly (ticket QCK6k1IsDKh5HoP8RhK0): the whole suite's own JSON report. */
describe('results.load on a whole-suite report (results/suites-<workspace>.json)', () => {
  const t = (title: string, status: string, ancestorTitles: string[] = ['A suite'], failureMessages: string[] = []) => ({ title, status, ancestorTitles, failureMessages })
  const vitest = (files: Record<string, unknown[]>) => ({ startTime: Date.parse('2026-11-13T15:06:51.000Z'), testResults: Object.entries(files).map(([name, assertionResults]) => ({ name, assertionResults })) })
  const dated = t('reads every unbooked window of the flight', 'failed', ['Direct advertiser deals'], ["AssertionError: expected 'unavailable' to be 'booked'"])
  const suites = vitest({
    '/runner/work/dsp-integration/apps/api/test/direct-deals.test.ts': [dated, t('saves as a draft', 'passed', ['Direct advertiser deals'])],
    '/runner/work/dsp-integration/apps/api/test/e2e/run5-reserved.test.ts': [t('E4 — an asset over the limit is refused', 'passed', ['Run 5'])],
  })
  type Case = { run: string; caseId: string; status: string; repro: string; actual: string }

  it('makes each test outside test/e2e a "Suites" case with an ID that is the same every night', () => {
    const a = load(write('suites-api.json', suites)).cases as Case[]
    const again = load(write('suites-api.json', suites)).cases as Case[]
    expect(a.map((c) => `${c.run}|${c.status}`)).toEqual(['Suites|fail', 'Suites|pass', 'Run 5|pass'])
    expect(a[0].caseId).toMatch(/^api\/direct-deals\.test\.ts#[0-9a-f]{6}$/)
    expect(a[0].caseId).toBe(again[0].caseId)
    expect(a[0].caseId).not.toBe(a[1].caseId)
    expect(a[0].repro).toBe('cd dsp-integration/apps/api && npx vitest run test/direct-deals.test.ts -t "reads every unbooked window of the flight"')
    expect(a[0].actual).toContain("expected 'unavailable' to be 'booked'")
    expect(a[2].caseId).toBe('E4')
  })
  it('names the workspace, so the same file name in two workspaces is two cases', () => {
    const admin = load(write('suites-admin.json', vitest({ '/runner/work/dsp-integration/apps/admin/test/direct-deals.test.ts': [dated] }))).cases as Case[]
    expect(admin[0].caseId).toMatch(/^admin\/direct-deals\.test\.ts#/)
    expect(admin[0].repro).toContain('cd dsp-integration/apps/admin && npx vitest run test/direct-deals.test.ts')
  })
  it('counts a test/e2e case once when Runs 1–5 reported it too, and keeps it when they did not run', () => {
    const quick = write('e2e-quick.json', vitest({ '/runner/work/dsp-integration/apps/api/test/e2e/run5-reserved.test.ts': [t('E4 — an asset over the limit is refused', 'passed', ['Run 5'])] }))
    const s = write('suites-api.json', suites)
    expect(merge([quick, s]).cases.filter((c: Case) => c.caseId === 'E4')).toHaveLength(1)
    expect(merge([quick, s]).counts).toMatchObject({ pass: 2, fail: 1 })
    expect(merge([s]).cases.filter((c: Case) => c.caseId === 'E4')).toHaveLength(1)
  })
  it('file-e2e-bugs plans one ticket for the failing suite case from that file alone', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/file-e2e-bugs.mjs'), write('suites-api.json', suites), '--dry-run'], { cwd: ROOT, env: { ...process.env, BOARD_API_KEY: '', E2E_RESULTS_FILE: '' }, encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toMatch(/created {2}\(dry run\) {2}E2E suites: api\/direct-deals\.test\.ts#[0-9a-f]{6} — reads every unbooked window of the flight/)
    expect(r.stdout).toMatch(/1 created, 0 commented/)
  })
})
