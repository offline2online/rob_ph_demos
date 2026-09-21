/* Push this project's docs to the Prototype Backlog board, byte for byte.

     npm run board:sync            # REQUIREMENTS.md → requirementsMd, README.md → readmeMd
     npm run board:sync -- --check # compare only; exit 1 if the board has drifted

   The board is the second home of these documents (root CLAUDE.md: "treat a
   divergence as a bug in whichever is stale"), and the repo file is the
   source of truth. This reads the files off disk and sends them unchanged,
   which is the point: a person or an agent retyping an 80 KB specification
   into a form is how a spec quietly acquires errors.

   Needs BOARD_API_KEY (the board automation user's password) in the POC's
   .env, or in the environment. Every write is kept in the board's own
   revision history, so a bad sync is recoverable there. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_ID = 'mIPdOCAWevhrgD8g2tCZ' // Display Types & DSP Integration
const FIREBASE_KEY = 'AIzaSyDzG5MzavLWyKU7NXfTPskuWbFYFlc5W3g'
const BOARD = 'https://firestore.googleapis.com/v1/projects/backlog-tracker-e4ed2/databases/(default)/documents'

/* Which file lands in which field on the project's Firestore document. */
const DOCS = [
  { field: 'requirementsMd', file: 'docs/dsp-integration/REQUIREMENTS.md' },
  { field: 'readmeMd', file: 'README.md' },
]

const env = (name) => {
  if (process.env[name]) return process.env[name]
  try {
    const line = readFileSync(join(ROOT, '.env'), 'utf8').split('\n').find((l) => l.startsWith(`${name}=`))
    return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '')
  } catch {
    return undefined
  }
}

async function idToken() {
  const key = env('BOARD_API_KEY')
  if (!key) {
    console.error(
      'BOARD_API_KEY is not set. It is the board automation user\'s password;\n' +
      'add it to .env as BOARD_API_KEY=… and re-run. Without it this script can\n' +
      'only be run by someone who has it — the board itself is behind Google sign-in.',
    )
    process.exit(2)
  }
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'board-automation@backlog-tracker-e4ed2.firebaseapp.com', password: key, returnSecureToken: true }),
  })
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}): ${await res.text()}`)
  return (await res.json()).idToken
}

const read = (file) => readFileSync(join(ROOT, file), 'utf8')

async function board(token) {
  const res = await fetch(`${BOARD}/projects/${PROJECT_ID}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Reading the project failed (${res.status}): ${await res.text()}`)
  const fields = (await res.json()).fields ?? {}
  return Object.fromEntries(DOCS.map((d) => [d.field, fields[d.field]?.stringValue ?? '']))
}

const check = process.argv.includes('--check')
const token = await idToken()
const before = await board(token)
const drifted = DOCS.filter((d) => before[d.field] !== read(d.file))

if (!drifted.length) {
  console.log('The board matches the repo: nothing to sync.')
  process.exit(0)
}
for (const d of drifted) {
  console.log(`${d.field}: board ${before[d.field].length} chars, repo ${read(d.file).length} chars — ${check ? 'DRIFTED' : 'syncing'}`)
}
if (check) process.exit(1)

const mask = drifted.map((d) => `updateMask.fieldPaths=${d.field}`).concat('updateMask.fieldPaths=updatedAt').join('&')
const res = await fetch(`${BOARD}/projects/${PROJECT_ID}?${mask}`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fields: {
      ...Object.fromEntries(drifted.map((d) => [d.field, { stringValue: read(d.file) }])),
      updatedAt: { timestampValue: new Date().toISOString() },
    },
  }),
})
if (!res.ok) throw new Error(`Writing failed (${res.status}): ${await res.text()}`)

/* Read it back: a sync that says it worked and didn't is worse than a failure. */
const after = await board(token)
const bad = drifted.filter((d) => after[d.field] !== read(d.file))
if (bad.length) {
  console.error(`Wrote, but the board does not match: ${bad.map((d) => d.field).join(', ')}. Restore from the board's revision history.`)
  process.exit(1)
}
console.log(`Synced ${drifted.map((d) => d.field).join(' and ')} — verified byte for byte.`)
