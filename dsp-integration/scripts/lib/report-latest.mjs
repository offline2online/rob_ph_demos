/* The one compact "E2E results — latest" project document (E2E Testing
   Strategy §3.4), updated in place by the nightly instead of a new dated
   document per night. The board caps a document at 20,000 chars
   (firestore.rules, projectDocs), so renderLatest() never goes past
   maxChars (19,000) and counts what it leaves out. */
import { byRun } from './results.mjs'

export const LATEST_NAME = 'E2E results — latest'
export const OLD_PREFIX = 'E2E Test Results'
const RECENT_KEEP = 14
const HEAD = '## Recent runs'
const cell = (s, n = 300) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').slice(0, n)
const count = (cs, st) => cs.filter((c) => c.status === st).length

export function resultsUrl(env = process.env) {
  const { GITHUB_SERVER_URL: s, GITHUB_REPOSITORY: r, GITHUB_RUN_ID: id } = env
  return s && r && id ? `${s}/${r}/actions/runs/${id}` : null
}

/* The rows already in a previous "Recent runs" table (without header). */
function previousRows(md) {
  if (!md) return []
  const at = md.indexOf(HEAD)
  if (at < 0) return []
  return md.slice(at + HEAD.length).split('\n').filter((l) => l.startsWith('|')).slice(2)
}

export function renderLatest(results, { runUrl, runId, previousMd, maxChars = 19000 } = {}) {
  const { cases, counts, parts } = results
  const runs = byRun(cases)
  const id = runId ?? process.env.GITHUB_RUN_ID
  const generated = (parts[0]?.startedAt ?? new Date().toISOString()).slice(0, 16).replace('T', ' ') + 'Z'

  let head = `# ${LATEST_NAME}\n\n`
  head += `Generated ${generated} by \`scripts/report-e2e.mjs\`; nothing here is hand-written. Commit: ${results.commit ? `\`${String(results.commit).slice(0, 12)}\`` : 'not recorded'}`
  head += runUrl ? ` · Run: ${runUrl}` : ''
  head += id ? ` · Artifact: \`e2e-nightly-${id}\`` : ''
  head += `\n\n**Totals:** ${cases.length} cases — ${counts.pass} pass, ${counts.fail} fail, ${counts['known-gap']} known gap, ${counts.skipped} skipped.\n`

  let table = `\n## Runs\n\n| Run | Cases | Pass | Fail | Known gap | Skipped |\n|---|---|---|---|---|---|\n`
  for (const [run, cs] of runs) table += `| ${run} | ${cs.length} | ${count(cs, 'pass')} | ${count(cs, 'fail')} | ${count(cs, 'known-gap')} | ${count(cs, 'skipped')} |\n`
  for (const p of parts) if (p.stopped) table += `\n**${p.run} stopped early:** ${cell(p.stopped, 300)}\n`

  const bench = cases.filter((c) => c.run === 'Bench')
  let benchMd = `\n## Bench\n\n`
  if (!bench.length) benchMd += `The bench is not in these results.\n`
  else for (const c of bench) benchMd += c.status === 'fail' ? `- ${cell(c.title, 120)} — **FAIL**: ${cell(c.actual, 200)}\n` : `- ${cell(c.title, 120)} — ${c.status === 'pass' ? 'pass' : c.status}\n`

  const row = `| ${generated.slice(0, 10)} | ${results.commit ? `\`${String(results.commit).slice(0, 7)}\`` : '—'} | ${counts.pass} | ${counts.fail} | ${counts['known-gap']} | ${counts.skipped} | ${runUrl ? `[run](${runUrl})` : '—'} |`
  const rows = [row, ...previousRows(previousMd).filter((r) => !(runUrl && r.includes(`(${runUrl})`)))].slice(0, RECENT_KEEP)
  const recent = `\n${HEAD}\n\n| Date | Commit | Pass | Fail | Known gap | Skipped | Run |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`

  // Items that may be dropped, in priority order: failures in full, then one line each.
  const items = []
  const fails = cases.filter((c) => c.status === 'fail' && c.run !== 'Bench')
  for (const c of fails) items.push({ sec: 'fail', text: `- **${cell(c.caseId, 40)}** (${c.run}) — ${cell(c.title, 200)}\n  - expected: ${cell(c.expected)}\n  - actual: ${cell(c.actual)}\n  - repro: \`${cell(c.repro, 300)}\`\n` })
  for (const c of cases.filter((c) => c.status === 'known-gap')) items.push({ sec: 'gap', text: `- ${cell(c.caseId, 40)} — ${cell(c.title, 200)}\n` })
  for (const c of cases.filter((c) => c.status === 'skipped')) items.push({ sec: 'skip', text: `- ${cell(c.caseId, 40)} — ${cell(c.title, 200)}\n` })
  const titles = { fail: '\n## Failing cases\n\n', gap: '\n## Known gaps\n\n', skip: '\n## Skipped\n\n' }

  const fixed = head + table + benchMd + recent
  let budget = maxChars - fixed.length - 120 // room for the "…N more" line
  const kept = []
  let stopped = false
  for (const it of items) {
    const cost = it.text.length + (kept.some((k) => k.sec === it.sec) ? 0 : titles[it.sec].length)
    if (stopped || cost > budget) { stopped = true; continue }
    budget -= cost
    kept.push(it)
  }
  const omitted = items.length - kept.length
  let body = ''
  for (const sec of ['fail', 'gap', 'skip']) {
    const mine = kept.filter((k) => k.sec === sec)
    if (mine.length) body += titles[sec] + mine.map((k) => k.text).join('')
  }
  if (omitted) body += `\n…${omitted} more in the run artifact\n`
  return (head + table + body + benchMd + recent).slice(0, maxChars)
}

/* Upsert the one document, then mark the old dated ones. */
export async function publishLatest(board, { projectId, results, runUrl, runId }) {
  const docs = await board.listDocuments(projectId)
  const mine = docs.filter((d) => d.name === LATEST_NAME)
    .sort((a, b) => String(b.updateTime ?? '').localeCompare(String(a.updateTime ?? '')))
  let id = mine[0]?.id
  let created = false
  let latest
  if (id) {
    const prev = await board.getDocument(id)
    const md = renderLatest(results, { runUrl, runId, previousMd: prev.contentMd })
    await board.updateDocument(id, { contentMd: md, kind: 'generated', status: 'current' }, LATEST_NAME)
    latest = md
  } else {
    latest = renderLatest(results, { runUrl, runId })
    id = await board.createDocument({ projectId, name: LATEST_NAME, contentMd: latest, kind: 'generated', status: 'current' })
    created = true
  }
  const superseded = []
  for (const d of docs) {
    if (!d.name.startsWith(OLD_PREFIX) || d.status === 'superseded') continue
    await board.updateDocument(d.id, { name: `Superseded — ${d.name}`.slice(0, 120), status: 'superseded', kind: 'generated', supersededBy: id }, d.name)
    superseded.push(d.id)
  }
  return { id, created, md: latest, superseded }
}

/* The project header's chip, from the nightly: only when e2e-run.mjs did not
   start this (it writes e2eStatus itself) and the project opted in. */
export async function publishE2eStatus(board, { projectId, results, runUrl, env = process.env }) {
  if (env.E2E_RESULTS_FILE) return false
  const p = await board.getProject(projectId)
  if (!p.e2eEnabled && !p.hasE2eStatus) return false
  const { counts, cases } = results
  await board.setE2eStatus(projectId, {
    runAt: new Date().toISOString(), mode: 'nightly', commit: results.commit ? String(results.commit).slice(0, 7) : null,
    pass: counts.pass, fail: counts.fail, gap: counts['known-gap'], skipped: counts.skipped,
    resultsUrl: runUrl ?? null, ticketsFiled: 0,
    breakdown: byRun(cases).map(([run, cs]) => ({ id: run, label: run, status: count(cs, 'fail') ? 'fail' : 'pass', pass: count(cs, 'pass'), fail: count(cs, 'fail'), gap: count(cs, 'known-gap') })),
  })
  return true
}
