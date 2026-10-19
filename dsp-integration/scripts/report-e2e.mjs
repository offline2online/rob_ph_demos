/* Turn E2E results files into the ONE project document "E2E results — latest"
   (E2E Testing Strategy §3.4), updated in place, and mark the old dated
   "E2E Test Results — …" documents Superseded.

     node scripts/report-e2e.mjs results/*.json             # update the document
     node scripts/report-e2e.mjs results/*.json --dry-run   # print it instead
     node scripts/report-e2e.mjs results/*.json --out results/report.md

   The document stays under 19,000 chars (the board refuses 20,000): header,
   per-run table, failing cases in full, known gaps and skipped one line
   each, a Bench block, and the last 14 runs. Passing cases are counted, not
   listed. Prints RESULTS_URL=<GitHub run page> when the GITHUB_* variables
   are set. When the project opted in (e2eEnabled or an e2eStatus) and
   E2E_RESULTS_FILE is unset (e2e-run.mjs writes it itself), it also writes
   projects/{id}.e2eStatus with mode "nightly" for the header chip.

   Inputs: vitest JSON reports of test/e2e (`npx vitest run test/e2e
   --reporter=json --outputFile=results/e2e.json`) and/or the journey
   runner's results (`npm run e2e:journey`). Needs BOARD_API_KEY to write;
   without it, it prints and exits 2 (unless --dry-run or --out). */
import { writeFileSync } from 'node:fs'
import { connect, PROJECT_ID } from './lib/board.mjs'
import { merge } from './lib/results.mjs'
import { publishE2eStatus, publishLatest, renderLatest, resultsUrl } from './lib/report-latest.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const value = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
const files = args.filter((a) => !a.startsWith('--') && a !== value('--out'))
if (!files.length) { console.error('usage: node scripts/report-e2e.mjs <results.json...> [--dry-run] [--out file.md]'); process.exit(2) }

const r = merge(files)
const runUrl = resultsUrl()
const printUrl = () => { if (runUrl) console.log(`RESULTS_URL=${runUrl}`) }

if (value('--out') || flag('--dry-run')) {
  const md = renderLatest(r, { runUrl })
  if (value('--out')) writeFileSync(value('--out'), md)
  console.log(flag('--dry-run') ? md : `Wrote ${value('--out')}`)
  printUrl()
  process.exit(0)
}
const board = await connect()
if (!board) { console.log(renderLatest(r, { runUrl })); console.error('\nBOARD_API_KEY is not set: printed instead of updating the document (exit 2).'); process.exit(2) }
try {
  const out = await publishLatest(board, { projectId: PROJECT_ID, results: r, runUrl })
  console.log(`${out.created ? 'Created' : 'Updated'} "E2E results — latest" (${out.id}, ${out.md.length} chars); marked ${out.superseded.length} older document(s) Superseded.`)
  if (await publishE2eStatus(board, { projectId: PROJECT_ID, results: r, runUrl })) console.log('Wrote e2eStatus (nightly) for the project header chip.')
  printUrl()
} catch (e) { console.error(e.message); process.exit(1) }
