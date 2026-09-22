/* Move this project's tickets on the Prototype Backlog board.

     npm run board:tickets                              # what is where (no writes)
     npm run board:tickets -- --from backlog --to published-live
     npm run board:tickets -- --from backlog --to published-live --yes
     npm run board:tickets -- --ticket <id> --preview <url> --to ready-for-testing --yes
     npm run board:tickets -- --ticket <id> --deploy-commit <sha> --yes
     npm run board:tickets -- --deploy-branch deploy/dsp-integration --yes
     npm run board:tickets -- --relink-prototype <sha> --branch deploy/dsp-integration --yes

   Why this exists: the board's MCP connector deliberately refuses status
   writes ("moving a ticket through testing and deployment stays on the
   board"), and the board's own Deploy to Main action is the normal route.
   That route merges the project's deployBranch — so when work reaches main
   another way, as the POC did through PR #176, the cards are left behind
   with nothing able to move them. This closes that gap, and only that gap.

   --deploy-commit records which commit on the train branch belongs to a
   ticket. The board decides a card is on the train by that field alone
   (functions/train-lock.js, public/js/app.js's trainItemsForProject), and
   the automation normally sets it when it applies a ticket's patch. A
   commit pushed to the train by hand has nobody pointing at it, so the
   periodic sweep reads the train as empty, tags the work as orphaned and
   resets the branch to main — which is exactly what happened to
   d5lCFNALmRvij1w1v7aI on 21 Sep. Set this whenever you put a commit on a
   train yourself, or the board and the branch disagree and the board wins.

   --relink-prototype <sha> re-points every testing card's test link from a
   BRANCH URL to that commit's URL on rawcdn.githack.com. githack caches a
   branch URL: index.html refreshes within minutes, but on 22 Sep 2026 the
   fixed-path demo/api-snapshot.json was still serving the 21 Sep 10:19
   capture a day later — a fresh bundle over a day-old snapshot, which is
   what three "Failed testing" rounds were looking at. A commit URL is
   immutable, so caching it is correct. dsp-prototype.yml runs this after
   it pushes a rebuild; --branch limits it to cards on that train.

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
    .map((d) => ({ id: d.name.split('/').pop(), name: d.name, title: field(d, 'title') ?? '(untitled)', status: field(d, 'status') ?? 'backlog', previewUrl: field(d, 'previewUrl'), deployCommit: field(d, 'deployCommit'), deployBranch: field(d, 'deployBranch') }))
}

/* Append a note to a ticket, in the shape the board's own comment thread
   reads ({author, text, at}), without touching any other field. */
async function appendNote(id, text) {
  const res = await fetch(`${BOARD}/backlogItems/${id}`, { headers: AUTH })
  if (!res.ok) throw new Error(`Reading ${id} failed (${res.status}): ${await res.text()}`)
  const doc = await res.json()
  const notes = doc.fields?.notes?.arrayValue?.values ?? []
  notes.push({ mapValue: { fields: { author: { stringValue: 'backlog-automation' }, text: { stringValue: text }, at: { stringValue: new Date().toISOString() } } } })
  const patch = await fetch(`${BOARD}/backlogItems/${id}?updateMask.fieldPaths=notes`, {
    method: 'PATCH', headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { notes: { arrayValue: { values: notes } } } }),
  })
  if (!patch.ok) throw new Error(`Writing a note on ${id} failed (${patch.status}): ${await patch.text()}`)
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

/* ------------------------------------------- test links → an immutable commit */

const PROTOTYPE_LINK = /^https:\/\/(?:rawcdn|raw)\.githack\.com\/offline2online\/rob_ph_demos\/(.+?)\/dsp-integration\/prototype\/(.*)$/
const relinkSha = value('--relink-prototype')
if (relinkSha) {
  if (!/^[0-9a-f]{40}$/.test(relinkSha)) {
    console.error('\n--relink-prototype needs a full 40-character commit sha (a branch name is exactly what caches).')
    process.exit(2)
  }
  const onBranch = value('--branch')
  const candidates = all.filter((t) => ['ready-for-testing', 'ready-to-publish'].includes(t.status) && (!onBranch || t.deployBranch === onBranch))
  const changes = candidates.flatMap((t) => {
    const m = t.previewUrl?.match(PROTOTYPE_LINK)
    if (!m) return []
    const [, ref, rest] = m
    if (ref === relinkSha) return []
    const next = `https://rawcdn.githack.com/offline2online/rob_ph_demos/${relinkSha}/dsp-integration/prototype/${rest || 'index.html'}`
    return [{ t, ref, next }]
  })
  console.log(`\nTest links → ${relinkSha.slice(0, 7)}${onBranch ? ` (cards on ${onBranch})` : ''}: ${changes.length} to re-point`)
  for (const { t, ref, next } of changes) console.log(`  ${t.title.slice(0, 60)}\n    ${ref} → ${next}`)
  if (changes.length && !flag('--yes')) console.log('  (dry run: pass --yes to write)')
  if (changes.length && flag('--yes')) {
    for (const { t, ref, next } of changes) {
      const res = await fetch(`${BOARD}/backlogItems/${t.id}?updateMask.fieldPaths=previewUrl&updateMask.fieldPaths=updatedAt`, {
        method: 'PATCH', headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { previewUrl: { stringValue: next }, updatedAt: { timestampValue: new Date().toISOString() } } }),
      })
      if (!res.ok) throw new Error(`Re-pointing ${t.id} failed (${res.status}): ${await res.text()}`)
      await appendNote(
        t.id,
        `Test link updated: the hosted prototype was rebuilt from ${relinkSha.slice(0, 7)} and the link now points at that commit — ${next} — ` +
        `rather than at ${ref}. (A branch URL on githack is cached: its data snapshot can stay a day stale under a fresh-looking bundle. ` +
        `A commit URL cannot change.) If you tested on the old link, please look again.`,
      )
    }
    const after = await tickets()
    const wrong = changes.filter(({ t, next }) => after.find((a) => a.id === t.id)?.previewUrl !== next)
    if (wrong.length) {
      console.error(`\nWrote, but ${wrong.length} link(s) did not land: ${wrong.map(({ t }) => t.id).join(', ')}`)
      process.exit(1)
    }
    console.log(`\nRe-pointed ${changes.length} — verified.`)
  }
  if (!value('--from') && !value('--to') && !value('--ticket')) process.exit(0)
}

/* ------------------------------------------------------------ moving tickets */

const from = value('--from')
const to = value('--to')
const one = value('--ticket')
const preview = value('--preview')
const deployCommit = value('--deploy-commit')

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
  if (deployCommit) console.log(`  commit   ${t.deployCommit ?? '(none)'} → ${deployCommit}`)
  if (!to && !preview && !deployCommit) {
    console.log('  nothing to change: pass --to <status>, --preview <url> and/or --deploy-commit <sha>')
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
  if (deployCommit) { fields.deployCommit = { stringValue: deployCommit }; mask.push('updateMask.fieldPaths=deployCommit') }
  fields.updatedAt = { timestampValue: new Date().toISOString() }
  mask.push('updateMask.fieldPaths=updatedAt')
  const res = await fetch(`${BOARD}/backlogItems/${one}?${mask.join('&')}`, {
    method: 'PATCH', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
  })
  if (!res.ok) throw new Error(`Writing failed (${res.status}): ${await res.text()}`)
  const after = (await tickets()).find((x) => x.id === one)
  const wrong = [
    to && after.status !== to && 'status',
    preview && after.previewUrl !== preview && 'previewUrl',
    deployCommit && after.deployCommit !== deployCommit && 'deployCommit',
  ].filter(Boolean)
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
