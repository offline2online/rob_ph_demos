/* File or update tickets from E2E results (E2E Testing Strategy §3.4).

     node scripts/file-e2e-bugs.mjs results/*.json [--dry-run]

   For every failing case: find an OPEN ticket (not deployed, not archived)
   whose title carries the case ID in the spec's form "E2E <run>: <case id>
   — …"; comment the new actual on it, or create one (type bug, title per
   the spec's "Raising tickets on failure", area by best fit). Known gaps are
   recorded in the results document, never filed. A case that PASSES while
   an open ticket for it exists gets one "passing since <commit>" comment so
   its it.fails marker can be flipped. Cases sharing an actual (same first
   line) are cross-referenced. Needs BOARD_API_KEY to write; --dry-run or no
   key prints the plan. */
import { connect } from './lib/board.mjs'
import { merge } from './lib/results.mjs'

const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const files = args.filter((a) => !a.startsWith('--'))
if (!files.length) { console.error('usage: node scripts/file-e2e-bugs.mjs <results.json...> [--dry-run]'); process.exit(2) }

const r = merge(files)
const since = r.commit ? `commit ${r.commit}` : `the run of ${r.date}`
const areaOf = (c) => /bill|cpm|floor|multiplier|price|VAC/i.test(c.title + c.actual) ? 'Pricing & Offers' : /asset|creative|upload|aspect/i.test(c.title) ? 'Product Assets' : 'Backend / Infrastructure'
const runTag = (c) => c.run.replace(/^Runs? /, 'run ').toLowerCase().replace(/–/g, '-')
const titleOf = (c) => `E2E ${runTag(c)}: ${c.caseId} — ${c.title.replace(/^[A-Z]{1,2}\d{1,2}[a-z]?\s*[—-]\s*/, '').slice(0, 120)}`
const matches = (ticket, c) => new RegExp(`\\bE2E\\b.*\\b${c.caseId}\\b`).test(ticket.title)
const open = (t) => !['published-live', 'archived'].includes(t.status)

const board = dry ? null : await connect()
const tickets = board ? await board.tickets() : []
if (!board && !dry) console.log('BOARD_API_KEY is not set: dry run.')

const fails = r.cases.filter((c) => c.status === 'fail')
const passes = r.cases.filter((c) => c.status === 'pass')
const related = (c) => fails.filter((o) => o !== c && o.actual.split('\n')[0] === c.actual.split('\n')[0]).map((o) => o.caseId)
const plan = []
for (const c of fails) {
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
for (const c of passes) {
  const t = tickets.find((t) => open(t) && t.type === 'bug' && matches(t, c))
  if (t) plan.push({ kind: 'comment', id: t.id, caseId: c.caseId, text: `${c.caseId} passing since ${since}: flip its it.fails marker and close this once deployed.` })
}
if (!plan.length) { console.log(`Nothing to file: ${r.counts.fail} failing cases, ${r.counts['known-gap']} known gaps (never filed).`); process.exit(0) }
for (const p of plan) {
  if (p.kind === 'create') {
    const id = board ? await board.createTicket({ title: p.title, desc: p.desc, category: p.category, type: 'bug' }) : '(dry run)'
    console.log(`created  ${id}  ${p.title}`)
  } else {
    if (board) await board.addComment(p.id, p.text)
    console.log(`comment  ${p.id}  ${p.caseId}: ${p.text.split('\n')[0]}`)
  }
}
console.log(`${plan.filter((p) => p.kind === 'create').length} created, ${plan.filter((p) => p.kind === 'comment').length} commented${board ? '' : ' (dry run, nothing written)'}.`)
