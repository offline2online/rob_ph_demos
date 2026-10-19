/* One record per case ID (E2E Testing Strategy §3.4), from either source:
   - vitest's JSON reporter over test/e2e (Runs 1–5): the case ID is the
     start of the test title ("E4 — an asset over…"); a title containing
     "known gap" is a known-gap, never a fail; `it.fails` tests report as
     passed by vitest while the bug reproduces, which is what we want.
   - the journey runner's own results (Run 6), the bench gate's (run
     "Bench"): {run, command, commit, startedAt, cases}, each case carrying
     its own run and repro when it has them (the journey's defaults are
     "Run 6" and `npm run e2e:journey`);
   - a bare array of such cases (results/cases/*.json);
   - e2e-run.mjs's record ({steps: [{id, label, status, cases}]}): a case's
     run is its own or else the step label, its id is caseId or else id, and
     a skipped step is one "skipped" case, "not configured".
   Several files can be merged into one run. */
import { readFileSync } from 'node:fs'

const CASE = /^([A-Z]{1,2}\d{1,2}[a-z]?)\b/
const RUN_OF = (ancestors, file) => {
  const m = (ancestors.join(' ') + ' ' + file).match(/Run (\d)/i)
  if (m) return `Run ${m[1]}`
  if (/open-auction/.test(file)) return 'Run 1'
  if (/run(\d)/.test(file)) return `Run ${file.match(/run(\d)/)[1]}`
  return 'Run ?'
}

const JOURNEY_REPRO = 'npm run e2e:journey'
const toCase = (c, dflt = {}) => ({
  run: c.run ?? dflt.run ?? 'Run 6',
  caseId: c.caseId ?? c.id ?? dflt.caseId,
  title: c.title ?? c.caseId ?? c.id ?? dflt.title ?? '',
  status: c.status,
  expected: c.expected ?? 'as specified',
  actual: String(c.actual ?? ''),
  repro: c.repro ?? dflt.repro ?? JOURNEY_REPRO,
})

export function load(file) {
  const j = JSON.parse(readFileSync(file, 'utf8'))
  if (Array.isArray(j)) return { run: 'Cases', command: JOURNEY_REPRO, commit: null, startedAt: undefined, stopped: null, cases: j.map((c) => toCase(c)) }
  if (Array.isArray(j.steps)) {
    const cases = j.steps.flatMap((s) => (s.status === 'skipped' && !s.cases?.length
      ? [{ run: s.label ?? s.id, caseId: s.id, title: s.label ?? s.id, status: 'skipped', expected: 'as specified', actual: s.reason ?? 'not configured', repro: `npm run e2e` }]
      : (s.cases ?? []).map((c) => toCase(c, { run: s.label ?? s.id, caseId: s.id, title: s.label ?? s.id, repro: j.mode ? `npm run e2e -- ${j.mode}` : 'npm run e2e' }))))
    return { run: 'E2E run', command: 'e2e-run', commit: j.commit ?? null, startedAt: j.runAt, stopped: null, cases }
  }
  if (Array.isArray(j.cases)) {
    return { run: j.run ?? 'Run 6', command: j.command ?? JOURNEY_REPRO, commit: j.commit ?? null, startedAt: j.startedAt, stopped: j.stopped ?? null, cases: j.cases.map((c) => toCase(c)) }
  }
  if (Array.isArray(j.testResults)) {
    const cases = []
    for (const f of j.testResults) {
      const file = f.name.split('/').slice(-1)[0]
      for (const t of f.assertionResults) {
        const id = t.title.match(CASE)?.[1] ?? t.title.slice(0, 24)
        const status = /known gap/i.test(t.title) ? 'known-gap' : t.status === 'passed' ? 'pass' : t.status === 'failed' ? 'fail' : 'skipped'
        cases.push({ run: RUN_OF(t.ancestorTitles ?? [], file), caseId: id, title: t.title, status, expected: 'as specified', actual: t.failureMessages?.join('\n').slice(0, 1500) || (status === 'pass' ? 'pass' : status), repro: `cd dsp-integration/apps/api && npx vitest run ${file.startsWith('test/') ? file : `test/e2e/${file}`} -t "${id}"` })
      }
    }
    return { run: 'Runs 1–5', command: 'cd dsp-integration/apps/api && npx vitest run test/e2e', commit: null, startedAt: new Date(j.startTime).toISOString(), stopped: null, cases }
  }
  throw new Error(`${file}: not a vitest JSON report, a cases file or an e2e-run record.`)
}

export function merge(files) {
  const parts = files.map(load)
  const cases = parts.flatMap((p) => p.cases)
  const counts = { pass: 0, fail: 0, 'known-gap': 0, skipped: 0 }
  for (const c of cases) counts[c.status] = (counts[c.status] ?? 0) + 1
  return { parts, cases, counts, commit: parts.map((p) => p.commit).find(Boolean) ?? process.env.GITHUB_SHA ?? null, date: (parts[0]?.startedAt ?? new Date().toISOString()).slice(0, 10) }
}

export const byRun = (cases) => {
  const m = new Map()
  for (const c of cases) m.set(c.run, [...(m.get(c.run) ?? []), c])
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
}
