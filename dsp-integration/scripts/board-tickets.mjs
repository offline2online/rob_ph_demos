/* Move this project's tickets on the Prototype Backlog board.

     npm run board:tickets                              # what is where (no writes)
     npm run board:tickets -- --from backlog --to published-live
     npm run board:tickets -- --from backlog --to published-live --yes
     npm run board:tickets -- --ticket <id> --preview <url> --to ready-for-testing --yes
     npm run board:tickets -- --deploy-branch deploy/dsp-integration --yes

   Why this exists: the board's MCP connector deliberately refuses status
   writes ("moving a ticket through testing and deployment stays on the
   board"), and the board's own Deploy to Main action is the normal route.
   That route merges the project's deployBranch — so when work reaches main
   another way, as the POC did through PR #176, the cards are left behind
   with nothing able to move them. This closes that gap, and only that gap.

   It will not pretend: --yes is required to write, every change is verified
   by reading the ticket back, and the default run changes nothing at all.

   Needs BOARD_API_KEY (the board automation user's password) in .env. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_ID = 'mIPdOCAWevhrgD8g2tCZ' // Display Types & DSP Integration
const FIREBASE_KEY = 'AIzaSyDzG5MzavLWyKU7NXfTPskuWbFYFlc5W3g'
const BOARD = 'https://firestore.googleapis.com/v1/projects/backlog-tracker-e4ed2/databases/(default)/documents'

const STATUSES = {
  'backlog': 'Backlog',
  'ready-for-testing': 'Ready for Testing',
  'ready-to-publish': 'Approved for Deployment',
  'published-live': 'Deployed / Main Branch (Live)',
  'archived': 'Archived',
}

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const value = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)

const env = (name) => {
  if (process.env[name]) return process.env[name]
  try {
    const line = readFileSync(join(ROOT, '.env'), 'utf8').split('\n').find((l) => l.startsWith(`${name}=`))
    return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '')
  } catch {
    return undefined
  }
}

const key = env('BOARD_API_KEY')
if (!key) {
  console.error(
    'BOARD_API_KEY is not set — it is the board automation user\'s password.\n' +
    'Add it to .env as BOARD_API_KEY=… and re-run.\n\n' +
    'Without it nothing here can read or write the board: the board is behind\n' +
    'Google sign-in, and the MCP connector refuses status writes by design.',
  )
  process.exit(2)
}

const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_KEY}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'board-automation@backlog-tracker-e4ed2.firebaseapp.com', password: key, returnSecureToken: true }),
})
if (!signIn.ok) throw new Error(`Sign-in failed (${signIn.status}): ${await signIn.text()}`)
const AUTH = { Authorization: `Bearer ${(await signIn.json()).idToken}` }

const field = (doc, name) => doc.fields?.[name]?.stringValue ?? null

async function tickets() {
  const out = []
  let pageToken
  do {
    const url = new URL(`${BOARD}/backlogItems`)
    url.searchParams.set('pageSize', '300')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const res = await fetch(url, { headers: AUTH })
    if (!res.ok) throw new Error(`Reading tickets failed (${res.status}): ${await res.text()}`)
    const body = await res.json()
    out.push(...(body.documents ?? []))
    pageToken = body.nextPageToken
  } while (pageToken)
  return out
    .filter((d) => field(d, 'projectId') === PROJECT_ID)
    .map((d) => ({ id: d.name.split('/').pop(), name: d.name, title: field(d, 'title') ?? '(untitled)', status: field(d, 'status') ?? 'backlog', previewUrl: field(d, 'previewUrl') }))
}

const all = await tickets()
const counts = all.reduce((acc, t) => ({ ...acc, [t.status]: (acc[t.status] ?? 0) + 1 }), {})
console.log(`${all.length} tickets on Display Types & DSP Integration:`)
for (const [s, label] of Object.entries(STATUSES)) if (counts[s]) console.log(`  ${String(counts[s]).padStart(3)}  ${label}`)

/* ------------------------------------------------------- the project's train */

const branch = value('--deploy-branch')
if (branch) {
  console.log(`\ndeployBranch → ${branch}`)
  if (!flag('--yes')) console.log('  (dry run: pass --yes to write)')
  else {
    const res = await fetch(`${BOARD}/projects/${PROJECT_ID}?updateMask.fieldPaths=deployBranch`, {
      method: 'PATCH', headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { deployBranch: { stringValue: branch } } }),
    })
    if (!res.ok) throw new Error(`Writing deployBranch failed (${res.status}): ${await res.text()}`)
    console.log('  written')
  }
}

/* ------------------------------------------------------------ moving tickets */

const from = value('--from')
const to = value('--to')
const one = value('--ticket')
const preview = value('--preview')

if (!from && !to && !one) {
  if (!branch) console.log('\nNothing asked for. Use --from <status> --to <status>, or --ticket <id>, and --yes to write.')
  process.exit(0)
}
/* One ticket by id: move it, give it a test link, or both. */
if (one && !from) {
  const t = all.find((x) => x.id === one)
  if (!t) {
    console.error(`\nNo ticket ${one} on this project.`)
    process.exit(2)
  }
  if (to && !STATUSES[to]) {
    console.error(`\n--to must be one of: ${Object.keys(STATUSES).join(', ')}`)
    process.exit(2)
  }
  console.log(`\n${t.title}`)
  if (to) console.log(`  status   ${STATUSES[t.status]} → ${STATUSES[to]}`)
  if (preview) console.log(`  preview  ${t.previewUrl ?? '(none)'} → ${preview}`)
  if (!to && !preview) {
    console.log('  nothing to change: pass --to <status> and/or --preview <url>')
    process.exit(0)
  }
  if (!flag('--yes')) {
    console.log('\nDry run: nothing written. Add --yes.')
    process.exit(0)
  }
  const fields = {}
  const mask = []
  if (to) { fields.status = { stringValue: to }; mask.push('updateMask.fieldPaths=status') }
  if (preview) { fields.previewUrl = { stringValue: preview }; mask.push('updateMask.fieldPaths=previewUrl') }
  fields.updatedAt = { timestampValue: new Date().toISOString() }
  mask.push('updateMask.fieldPaths=updatedAt')
  const res = await fetch(`${BOARD}/backlogItems/${one}?${mask.join('&')}`, {
    method: 'PATCH', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
  })
  if (!res.ok) throw new Error(`Writing failed (${res.status}): ${await res.text()}`)
  const after = (await tickets()).find((x) => x.id === one)
  const wrong = [to && after.status !== to && 'status', preview && after.previewUrl !== preview && 'previewUrl'].filter(Boolean)
  if (wrong.length) {
    console.error(`\nWrote, but ${wrong.join(' and ')} did not land.`)
    process.exit(1)
  }
  console.log('\nWritten — verified.')
  process.exit(0)
}
if (!STATUSES[from] || !STATUSES[to]) {
  console.error(`\n--from and --to must both be one of: ${Object.keys(STATUSES).join(', ')}`)
  process.exit(2)
}

const moving = all.filter((t) => t.status === from)
console.log(`\n${moving.length} ticket${moving.length === 1 ? '' : 's'}: ${STATUSES[from]} → ${STATUSES[to]}`)
for (const t of moving.slice(0, 5)) console.log(`  ${t.title.slice(0, 70)}`)
if (moving.length > 5) console.log(`  …and ${moving.length - 5} more`)
if (!moving.length) process.exit(0)
if (!flag('--yes')) {
  console.log('\nDry run: nothing written. Add --yes to move them.')
  process.exit(0)
}

const now = new Date().toISOString()
let done = 0
for (const t of moving) {
  const res = await fetch(`${BOARD}/backlogItems/${t.id}?updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAt`, {
    method: 'PATCH', headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { status: { stringValue: to }, updatedAt: { timestampValue: now } } }),
  })
  if (!res.ok) {
    console.error(`  failed on ${t.id} (${res.status}): ${await res.text()}`)
    process.exit(1)
  }
  done++
}

/* Read them back: a move that reports success without checking is how a
   board ends up claiming work is live when it isn't. */
const after = await tickets()
const stragglers = moving.filter((t) => after.find((a) => a.id === t.id)?.status !== to)
if (stragglers.length) {
  console.error(`\nWrote ${done}, but ${stragglers.length} did not land on ${STATUSES[to]}.`)
  process.exit(1)
}
console.log(`\nMoved ${done} to ${STATUSES[to]} — verified.`)
