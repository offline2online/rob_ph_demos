/* File or update tickets from E2E results (E2E Testing Strategy §3.4).

     node scripts/file-e2e-bugs.mjs results/*.json [--dry-run]
     E2E_RESULTS_FILE=results/<run>.json node scripts/file-e2e-bugs.mjs   # what e2e-run.mjs does

   For every failing case: find an OPEN ticket (not deployed, not archived)
   whose title carries the case ID in the spec's form "E2E <run>: <case id>
   — …"; comment the new actual on it, or create one (type bug, title per
   the spec's "Raising tickets on failure", area by best fit). Known gaps are
   recorded in the results document, never filed. A case that PASSES while
   an open ticket for it exists gets one "passing since <commit>" comment so
   its it.fails marker can be flipped. Cases sharing an actual (same first
   line) are cross-referenced. Needs BOARD_API_KEY to write; --dry-run or no
   key prints the plan. A failing BENCH case is not filed per case but per
   shape ("Perf: <shape> — <n> breaches; worst: …", or "Perf: <shape> bench
   crashed — …"; an open "Perf: <shape> …" ticket gets a comment instead).
   The plan itself is scripts/lib/bug-plan.mjs. The last line printed is
   TICKETS_FILED=<number created> (0 on a dry run), which e2e-run.mjs reads. */
import { connect } from './lib/board.mjs'
import { merge } from './lib/results.mjs'
import { planTickets } from './lib/bug-plan.mjs'

const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const argFiles = args.filter((a) => !a.startsWith('--'))
const files = argFiles.length ? argFiles : process.env.E2E_RESULTS_FILE ? [process.env.E2E_RESULTS_FILE] : []
if (!files.length) { console.error('usage: node scripts/file-e2e-bugs.mjs <results.json...> [--dry-run]  (or set E2E_RESULTS_FILE)'); process.exit(2) }

const r = merge(files)
const board = dry ? null : await connect()
const tickets = board ? await board.tickets() : []
if (!board && !dry) console.log('BOARD_API_KEY is not set: dry run.')

const plan = planTickets(r, tickets)
let filed = 0
if (!plan.length) console.log(`Nothing to file: ${r.counts.fail} failing cases, ${r.counts['known-gap']} known gaps (never filed).`)
for (const p of plan) {
  if (p.kind === 'create') {
    const id = board ? await board.createTicket({ title: p.title, desc: p.desc, category: p.category, type: 'bug' }) : '(dry run)'
    if (board) filed++
    console.log(`created  ${id}  ${p.title}`)
  } else {
    if (board) await board.addComment(p.id, p.text)
    console.log(`comment  ${p.id}  ${p.caseId}: ${p.text.split('\n')[0]}`)
  }
}
if (plan.length) console.log(`${plan.filter((p) => p.kind === 'create').length} created, ${plan.filter((p) => p.kind === 'comment').length} commented${board ? '' : ' (dry run, nothing written)'}.`)
console.log(`TICKETS_FILED=${filed}`)
