/* scripts/lib/report-latest.mjs: the one "E2E results — latest" document the
   nightly keeps within the board's 20,000-char cap. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error a plain .mjs helper with no type declarations
import { LATEST_NAME, publishE2eStatus, publishLatest, renderLatest, resultsUrl } from '../../../scripts/lib/report-latest.mjs'
// @ts-expect-error a plain .mjs helper with no type declarations
import { merge } from '../../../scripts/lib/results.mjs'

const RUNS = ['Run 1', 'Run 2', 'Run 3', 'Run 4', 'Run 5', 'Run 7', 'Run 8']
const dir = mkdtempSync(join(tmpdir(), 'e2e-latest-'))

function fixture(opts: { vitest: { n: number; status: string; actual?: string }; journey?: boolean }) {
  const assertionResults = Array.from({ length: opts.vitest.n }, (_, i) => ({
    title: `A${i + 1} — case ${i + 1} of the suite`, status: opts.vitest.status, ancestorTitles: [RUNS[i % RUNS.length]],
    failureMessages: opts.vitest.status === 'failed' ? [opts.vitest.actual ?? ''] : [],
  }))
  const v = join(dir, `v-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(v, JSON.stringify({ startTime: Date.parse('2026-10-19T02:00:00Z'), testResults: [{ name: '/x/test/e2e/run1.test.ts', assertionResults }] }))
  const files = [v]
  if (opts.journey) {
    const cases = Array.from({ length: 46 }, (_, i) => ({ caseId: `J${i + 1}`, title: `journey step ${i + 1}`, status: i < 40 ? 'pass' : 'skipped', expected: 'ok', actual: 'ok' }))
    const j = join(dir, `j-${Math.random().toString(36).slice(2)}.json`)
    writeFileSync(j, JSON.stringify({ run: 'Run 6', command: 'npm run e2e:journey', commit: 'abcdef1234567890', startedAt: '2026-10-19T02:05:00Z', cases }))
    files.push(j)
  }
  return merge(files)
}

type Doc = { id: string; name: string; status?: string | null; contentMd: string; updateTime?: string }
function stubBoard(docs: Doc[] = [], project = { e2eEnabled: true, hasE2eStatus: false }) {
  const calls = { create: vi.fn(), update: vi.fn(), status: vi.fn() }
  return {
    calls,
    docs,
    listDocuments: async () => docs.map(({ contentMd: _c, ...d }) => d),
    getDocument: async (id: string) => docs.find((d) => d.id === id)!,
    createDocument: async (d: { name: string; contentMd: string; kind: string; status: string }) => { calls.create(d); docs.push({ id: 'new1', name: d.name, status: d.status, contentMd: d.contentMd }); return 'new1' },
    updateDocument: async (id: string, f: Record<string, string>) => { calls.update(id, f); Object.assign(docs.find((d) => d.id === id)!, f) },
    getProject: async () => project,
    setE2eStatus: async (pid: string, s: unknown) => { calls.status(pid, s) },
  }
}

describe('renderLatest', () => {
  it('fits 172 cases, one row per run, lists the skipped, no passing case', () => {
    const r = fixture({ vitest: { n: 126, status: 'passed' }, journey: true })
    const md: string = renderLatest(r, { runUrl: 'https://github.com/o/r/actions/runs/1', runId: '1' })
    expect(md.length).toBeLessThanOrEqual(19000)
    const table = md.split('## Runs')[1].split('\n## ')[0]
    expect(table.match(/^\| Run \d /gm)).toHaveLength(8)
    for (let i = 41; i <= 46; i++) expect(md).toContain(`J${i} — journey step ${i}`)
    expect(md).not.toMatch(/A1 — case 1 of/)
    expect(md).not.toContain('J1 — journey step 1\n')
    expect(md).toContain('`e2e-nightly-1`')
  })

  it('cuts 300 failing cases to the limit and counts what is left out', () => {
    const r = fixture({ vitest: { n: 300, status: 'failed', actual: 'x'.repeat(1500) } })
    const md: string = renderLatest(r, { maxChars: 19000 })
    expect(md.length).toBeLessThanOrEqual(19000)
    const shown = (md.match(/^- \*\*/gm) ?? []).length
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThan(300)
    expect(md).toContain(`…${300 - shown} more in the run artifact`)
    expect(md).not.toMatch(/x{301}/)
  })

  it('keeps the last 14 runs, newest first, oldest dropped', () => {
    const r = fixture({ vitest: { n: 3, status: 'passed' } })
    const rows = Array.from({ length: 14 }, (_, i) => `| 2026-10-${String(i + 1).padStart(2, '0')} | \`c${i}\` | 1 | 0 | 0 | 0 | [run](https://x/${i}) |`)
    const prev = `## Recent runs\n\n| Date | Commit | Pass | Fail | Known gap | Skipped | Run |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`
    const md: string = renderLatest(r, { runUrl: 'https://x/new', previousMd: prev })
    const got = md.split('## Recent runs')[1].split('\n').filter((l) => l.startsWith('|')).slice(2)
    expect(got).toHaveLength(14)
    expect(got[0]).toContain('https://x/new')
    expect(got[1]).toContain('2026-10-01')
    expect(got.join('\n')).not.toContain('https://x/13')
  })

  it('says the bench is missing, or lists its shapes', () => {
    const r = fixture({ vitest: { n: 2, status: 'passed' } })
    expect(renderLatest(r, {})).toContain('The bench is not in these results.')
    r.cases.push({ run: 'Bench', caseId: 'B1', title: 'shape-a', status: 'pass' }, { run: 'Bench', caseId: 'B2', title: 'shape-b', status: 'fail', actual: 'p99 over' })
    const md: string = renderLatest(r, {})
    expect(md).toContain('- shape-a — pass')
    expect(md).toContain('- shape-b — **FAIL**: p99 over')
  })
})

describe('publishLatest', () => {
  it('creates once, then updates the same id', async () => {
    const board = stubBoard()
    const r = fixture({ vitest: { n: 3, status: 'passed' } })
    const a = await publishLatest(board, { projectId: 'p', results: r, runUrl: 'https://x/1' })
    expect(a.created).toBe(true)
    expect(board.calls.create).toHaveBeenCalledTimes(1)
    expect(board.calls.create.mock.calls[0][0]).toMatchObject({ name: 'E2E results — latest', kind: 'generated', status: 'current' })
    const b = await publishLatest(board, { projectId: 'p', results: r, runUrl: 'https://x/2' })
    expect(b.created).toBe(false)
    expect(board.calls.create).toHaveBeenCalledTimes(1)
    expect(board.calls.update.mock.calls[0][0]).toBe('new1')
    expect(board.docs.find((d) => d.id === 'new1')!.contentMd).toContain('https://x/1')
  })

  it('supersedes old dated documents once and leaves others alone', async () => {
    const long = `E2E Test Results — 2026-10-0${1} (Runs 1–5) ${'z'.repeat(150)}`
    const board = stubBoard([
      { id: 'o1', name: long, status: null, contentMd: 'old1' },
      { id: 'o2', name: 'E2E Test Results — 2026-10-02', status: 'current', contentMd: 'old2' },
      { id: 'o3', name: 'Superseded — E2E Test Results — 2026-10-03', status: 'superseded', contentMd: 'old3' },
      { id: 'u1', name: 'Architecture notes', status: null, contentMd: 'keep' },
    ])
    const r = fixture({ vitest: { n: 3, status: 'passed' } })
    await publishLatest(board, { projectId: 'p', results: r })
    const touched = board.calls.update.mock.calls.map((c: unknown[]) => c[0]).filter((id: unknown) => id !== 'new1')
    expect(touched.sort()).toEqual(['o1', 'o2'])
    for (const id of ['o1', 'o2']) {
      const d = board.docs.find((x) => x.id === id) as Doc & { supersededBy?: string; kind?: string }
      expect(d.status).toBe('superseded')
      expect(d.kind).toBe('generated')
      expect(d.supersededBy).toBe('new1')
      expect(d.name.startsWith('Superseded — ')).toBe(true)
      expect(d.name.length).toBeLessThanOrEqual(120)
      expect(d.contentMd).toMatch(/^old/)
    }
    expect(board.docs.find((d) => d.id === 'u1')!.name).toBe('Architecture notes')
    board.calls.update.mockClear()
    await publishLatest(board, { projectId: 'p', results: r })
    expect(board.calls.update.mock.calls.map((c: unknown[]) => c[0])).toEqual(['new1'])
    expect(LATEST_NAME).toBe('E2E results — latest')
  })
})

describe('publishE2eStatus', () => {
  const r = () => fixture({ vitest: { n: 4, status: 'passed' } })
  it('writes a nightly status for an opted-in project', async () => {
    const board = stubBoard([], { e2eEnabled: true, hasE2eStatus: false })
    expect(await publishE2eStatus(board, { projectId: 'p', results: r(), runUrl: 'https://x/1', env: {} })).toBe(true)
    const [pid, s] = board.calls.status.mock.calls[0]
    expect(pid).toBe('p')
    expect(s).toMatchObject({ mode: 'nightly', pass: 4, fail: 0, ticketsFiled: 0, resultsUrl: 'https://x/1' })
    expect(Number.isNaN(Date.parse(s.runAt))).toBe(false)
    expect(s.breakdown[0]).toMatchObject({ status: 'pass', fail: 0 })
  })
  it('writes for a project that already has an e2eStatus', async () => {
    const board = stubBoard([], { e2eEnabled: false, hasE2eStatus: true })
    expect(await publishE2eStatus(board, { projectId: 'p', results: r(), env: {} })).toBe(true)
  })
  it('does not write for a project that never opted in', async () => {
    const board = stubBoard([], { e2eEnabled: false, hasE2eStatus: false })
    expect(await publishE2eStatus(board, { projectId: 'p', results: r(), env: {} })).toBe(false)
    expect(board.calls.status).not.toHaveBeenCalled()
  })
  it('does not write when e2e-run.mjs started it', async () => {
    const board = stubBoard()
    expect(await publishE2eStatus(board, { projectId: 'p', results: r(), env: { E2E_RESULTS_FILE: 'x.json' } })).toBe(false)
    expect(board.calls.status).not.toHaveBeenCalled()
  })
})

describe('resultsUrl', () => {
  it('is built from the GITHUB_* variables and absent without them', () => {
    expect(resultsUrl({ GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '42' })).toBe('https://github.com/o/r/actions/runs/42')
    expect(resultsUrl({})).toBeNull()
    expect(resultsUrl({ GITHUB_RUN_ID: '42' })).toBeNull()
  })
})
