/* What file-e2e-bugs.mjs does with a results set, as a pure function so it
   can be tested: planTickets(results, tickets) → [{kind: 'create' | 'comment', …}].
   `results` is merge()'s output; `tickets` the project's tickets
   ({id, title, status, type}). Two kinds of failure:
   - a journey / suite case: one ticket per case, "E2E <run>: <id> — …";
   - a bench case (run "Bench"): one ticket per SHAPE, "Perf: <shape> — <n>
     breach(es); worst: …" or "Perf: <shape> bench crashed — …". */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const open = (t) => !['published-live', 'archived'].includes(t.status)
const areaOf = (c) => /bill|cpm|floor|multiplier|price|VAC/i.test(c.title + c.actual) ? 'Pricing & Offers' : /asset|creative|upload|aspect/i.test(c.title) ? 'Product Assets' : 'Backend / Infrastructure'
const runTag = (c) => c.run.replace(/^Runs? /, 'run ').toLowerCase().replace(/–/g, '-')
const titleOf = (c) => `E2E ${runTag(c)}: ${c.caseId} — ${c.title.replace(/^[A-Z]{1,2}\d{1,2}[a-z]?\s*[—-]\s*/, '').slice(0, 120)}`
export const matches = (ticket, c) => new RegExp(`\\bE2E\\b.*(?<![\\w])${escapeRe(c.caseId)}(?![\\w])`).test(ticket.title)

const isBench = (c) => c.run === 'Bench'
const shapeOf = (c) => c.caseId.split(':')[1] ?? '?'
const isCrash = (c) => c.caseId.endsWith(':crash')
/* How far past its bound a bench case went, as a fraction of the baseline in its title ("a → b"). */
const relative = (c) => {
  const m = c.title.match(/([\d.]+) → ([\d.]+)/)
  return m && Number(m[1]) ? Math.abs(Number(m[2]) - Number(m[1])) / Number(m[1]) : 0
}

function benchPlan(fails, tickets, since, run) {
  const shapes = [...new Set(fails.map(shapeOf))]
  return shapes.map((shape) => {
    const mine = fails.filter((c) => shapeOf(c) === shape)
    const crash = mine.find(isCrash)
    const breaches = mine.filter((c) => !isCrash(c))
    const worst = [...breaches].sort((a, b) => relative(b) - relative(a))[0]
    const strip = (t) => t.replace(`Perf: ${shape} `, '')
    const title = crash && !breaches.length
      ? `Perf: ${shape} bench crashed — ${crash.actual.split('\n')[0].slice(0, 120)}`
      : `Perf: ${shape} — ${breaches.length} breach${breaches.length === 1 ? '' : 'es'}${crash ? ' and a crash' : ''}; worst: ${strip(worst.title).slice(0, 110)}`
    const lines = mine.map((c) => `- ${isCrash(c) ? `crash — ${c.actual}` : c.title}\n  Expected: ${c.expected}\n  Actual: ${c.actual.slice(0, 200)}\n  Repro: ${c.repro}`)
    const body = [`Bench shape ${shape}: ${mine.length} failing metric${mine.length === 1 ? '' : 's'} (${run}, ${since}).`, '', ...lines].join('\n')
    const existing = tickets.find((t) => open(t) && t.title.startsWith(`Perf: ${shape} `))
    return existing
      ? { kind: 'comment', id: existing.id, caseId: `bench:${shape}`, text: `Still failing in ${since}.\n${body.slice(0, 1800)}` }
      : { kind: 'create', caseId: `bench:${shape}`, title, desc: body.slice(0, 1990), category: 'Backend / Infrastructure' }
  })
}

export function planTickets(r, tickets) {
  const since = r.commit ? `commit ${r.commit}` : `the run of ${r.date}`
  const fails = r.cases.filter((c) => c.status === 'fail')
  const caseFails = fails.filter((c) => !isBench(c))
  const passes = r.cases.filter((c) => c.status === 'pass' && !isBench(c))
  const related = (c) => caseFails.filter((o) => o !== c && o.actual.split('\n')[0] === c.actual.split('\n')[0]).map((o) => o.caseId)
  const plan = []
  for (const c of caseFails) {
    const existing = tickets.find((t) => open(t) && matches(t, c))
    const desc = [
      `Case ${c.caseId} (${c.run}): ${c.title}`, '',
      `Expected: ${c.expected}`, `Actual: ${c.actual.slice(0, 900)}`, '',
      `Repro: ${c.repro}`, `Run: ${since}`,
      related(c).length ? `Same symptom as: ${related(c).join(', ')}` : '',
      'Spec: End-to-End Test Spec — DSP Demand Paths (v2); REQUIREMENTS section by case (§3 approval, §4 pricing/billing, §5 inventory, §6 submission, §7 exchange).',
    ].filter(Boolean).join('\n')
    if (existing) plan.push({ kind: 'comment', id: existing.id, caseId: c.caseId, text: `Still failing in ${since}.\nActual: ${c.actual.slice(0, 900)}\nRepro: ${c.repro}` })
    else plan.push({ kind: 'create', caseId: c.caseId, title: titleOf(c), desc, category: areaOf(c) })
  }
  plan.push(...benchPlan(fails.filter(isBench), tickets, since, 'Bench'))
  for (const c of passes) {
    const t = tickets.find((t) => open(t) && t.type === 'bug' && matches(t, c))
    if (t) plan.push({ kind: 'comment', id: t.id, caseId: c.caseId, text: `${c.caseId} passing since ${since}: flip its it.fails marker and close this once deployed.` })
  }
  return plan
}
