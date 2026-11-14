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
   - vitest's JSON reporter over a whole workspace suite (`npm test` under
     CI writes results/suites-<workspace>.json; ticket QCK6k1IsDKh5HoP8RhK0):
     a test under test/e2e reads exactly as above; any other test is a case
     of the run "Suites", its ID "<workspace>/<file>#<6 hex of its full
     name>", so the same test keeps one ID night after night. Before this,
     a red "Full suites" step left no results file and skipped the steps
     that do, so the nightly was red for four nights with no ticket.
   Several files can be merged into one run; a case a suites file shares
   with another file (test/e2e, when Runs 1–5 also ran) is counted once. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const CASE = /^([A-Z]{1,2}\d{1,2}[a-z]?)\b/
const RUN_OF = (ancestors, file) => {
  const m = (ancestors.join(' ') + ' ' + file).match(/Run (\d)/i)
  if (m) return `Run ${m[1]}`
  if (/open-auction/.test(file)) return 'Run 1'
  if (/run(\d)/.test(file)) return `Run ${file.match(/run(\d)/)[1]}`
  return 'Run ?'
}

export const SUITES = 'Suites'
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
  const suite = basename(file).match(/^suites-(.+)\.json$/)?.[1]
  if (Array.isArray(j.testResults) && suite) {
    const cases = []
    for (const f of j.testResults) {
      const path = f.name.split('\\').join('/')
      const rel = path.split(/\/(?:apps|packages)\/[^/]+\//)[1] ?? path.split('/').slice(-1)[0]
      const dir = path.match(/(?:apps|packages)\/[^/]+(?=\/)/)?.[0] ?? `apps/${suite}`
      const e2e = /(^|\/)test\/e2e\//.test(rel)
      for (const t of f.assertionResults) {
        const known = /known gap/i.test(t.title)
        const status = known ? 'known-gap' : t.status === 'passed' ? 'pass' : t.status === 'failed' ? 'fail' : 'skipped'
        const actual = t.failureMessages?.join('\n').slice(0, 1500) || (status === 'pass' ? 'pass' : status)
        const name = rel.split('/').slice(-1)[0]
        if (e2e) {
          const id = t.title.match(CASE)?.[1] ?? t.title.slice(0, 24)
          cases.push({ run: RUN_OF(t.ancestorTitles ?? [], name), caseId: id, title: t.title, status, expected: 'as specified', actual, repro: `cd dsp-integration/apps/api && npx vitest run test/e2e/${name} -t "${id}"`, suite: true })
        } else {
          const full = [...(t.ancestorTitles ?? []), t.title].join(' > ')
          const id = `${suite}/${name}#${createHash('sha1').update(`${rel} ${full}`).digest('hex').slice(0, 6)}`
          cases.push({ run: SUITES, caseId: id, title: t.title, status, expected: 'the test passes', actual, repro: `cd dsp-integration/${dir} && npx vitest run ${rel} -t "${t.title.slice(0, 80).replace(/"/g, '\\"')}"`, suite: true })
        }
      }
    }
    return { run: `Suites (${suite})`, command: 'cd dsp-integration && npm test', commit: null, startedAt: new Date(j.startTime).toISOString(), stopped: null, cases }
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
  /* A suites file repeats what another file already reports (test/e2e, when Runs 1–5 ran too): keep the other. */
  const key = (c) => `${c.run}|${c.caseId}|${c.title}`
  const elsewhere = new Set(parts.flatMap((p) => p.cases).filter((c) => !c.suite).map(key))
  for (const p of parts) p.cases = p.cases.filter((c) => !c.suite || !elsewhere.has(key(c)))
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
