/* Push this project's docs to the Prototype Backlog board, byte for byte.

     npm run board:sync                      # REQUIREMENTS.md → requirementsMd, README.md → readmeMd
     npm run board:sync -- --check           # compare only; exit 1 if the board has drifted
     npm run board:sync -- --check-mcp FILE  # same comparison, from a saved MCP read (no key needed)
     npm run board:sync -- --check-mcp FILE --print-diff

   The board is the second home of these documents (root CLAUDE.md: "treat a
   divergence as a bug in whichever is stale"), and the repo file is the
   source of truth. This reads the files off disk and sends them unchanged,
   which is the point: a person or an agent retyping an 80 KB specification
   into a form is how a spec quietly acquires errors.

   Writing needs BOARD_API_KEY (the board automation user's password) in the
   POC's .env, or in the environment. Every write is kept in the board's own
   revision history, so a bad sync is recoverable there.

   `--check-mcp` needs no credentials at all. An agent with the board's MCP
   connector calls get_project_docs, whose result is large enough that the
   harness spills it to a file, and passes that file here: the comparison
   then happens locally. It is how an agent that cannot write to the board
   can still say, with an exit code, whether the board has drifted. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const valueAfter = (name) => args[args.indexOf(name) + 1]

const read = (file) => readFileSync(join(ROOT, file), 'utf8')

/* What changed, in git's words, so the report says more than "different".
   Falls back to a plain comparison if git isn't on the path. */
function describe(boardText, repoFile, print) {
  const dir = mkdtempSync(join(tmpdir(), 'board-sync-'))
  const boardFile = join(dir, 'board.md')
  writeFileSync(boardFile, boardText)
  const git = (...rest) => {
    try {
      return execFileSync('git', ['--no-pager', 'diff', '--no-index', ...rest, '--', boardFile, join(ROOT, repoFile)], { encoding: 'utf8' })
    } catch (e) {
      if (e.code === 'ENOENT') return null
      return e.stdout ?? '' // git exits 1 when the files differ, which is the normal case here
    }
  }
  const numstat = git('--numstat')
  if (numstat === null) return '  (git not available; compared as text only)'
  const [added = '?', removed = '?'] = numstat.trim().split(/\s+/)
  const lines = [`  ${added} lines only in the repo, ${removed} only on the board`]
  /* Which sections moved — more use than a line count on its own. */
  const headings = [...new Set((git('--unified=0') ?? '').split('\n')
    .filter((l) => /^[+-]#{2,4} /.test(l))
    .map((l) => l.replace(/^[+-]/, '').trim()))]
  if (headings.length) lines.push(`  sections touched: ${headings.slice(0, 6).join(' · ')}${headings.length > 6 ? ` · +${headings.length - 6} more` : ''}`)
  if (print) lines.push((git() ?? '').split('\n').map((l) => `  ${l}`).join('\n'))
  return lines.join('\n')
}

function report(pairs, { print = false } = {}) {
  let drifted = 0
  for (const { field, file, board } of pairs) {
    const repo = read(file)
    if (board === repo) {
      console.log(`${field.padEnd(16)} ${String(repo.length).padStart(6)} chars — in sync`)
      continue
    }
    drifted++
    console.log(`${field.padEnd(16)} board ${board.length} chars, repo ${repo.length} chars — DRIFTED`)
    console.log(describe(board, file, print))
  }
  return drifted
}

/* ------------------------------------------- compare against a saved MCP read */

if (flag('--check-mcp')) {
  const path = valueAfter('--check-mcp')
  if (!path || path.startsWith('--')) {
    console.error('--check-mcp needs the file the MCP read was saved to (or - for stdin):\n' +
      '  npm run board:sync -- --check-mcp /path/to/get_project_docs-result.txt')
    process.exit(2)
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path === '-' ? 0 : path, 'utf8'))
  } catch (e) {
    console.error(`Could not read that as the JSON get_project_docs returns: ${e.message}`)
    process.exit(2)
  }
  const pairs = DOCS.filter((d) => typeof parsed[d.field] === 'string').map((d) => ({ ...d, board: parsed[d.field] }))
  if (!pairs.length) {
    console.error(`No ${DOCS.map((d) => d.field).join(' or ')} in that file — read the project's docs with include: ["requirements", "readme"].`)
    process.exit(2)
  }
  const missing = DOCS.filter((d) => !pairs.some((p) => p.field === d.field))
  const drifted = report(pairs, { print: flag('--print-diff') })
  for (const m of missing) console.log(`${m.field.padEnd(16)} not in that read — not compared`)
  /* Never say the board matches when something wasn't looked at. */
  const caveat = missing.length ? ` (${missing.map((m) => m.field).join(', ')} not compared)` : ''
  console.log(drifted
    ? `\n${drifted} document${drifted === 1 ? '' : 's'} behind${caveat}. Run npm run board:sync (needs BOARD_API_KEY) to fix.`
    : `\nEverything compared is in sync${caveat || ': the board matches the repo'}.`)
  process.exit(drifted ? 1 : 0)
}

/* ----------------------------------------------------- talk to the board itself */

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
      'add it to .env as BOARD_API_KEY=… and re-run.\n\n' +
      'To compare without it, read the project\'s docs over the board\'s MCP\n' +
      'connector and pass the saved result:\n' +
      '  npm run board:sync -- --check-mcp <file>',
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

async function board(token) {
  const res = await fetch(`${BOARD}/projects/${PROJECT_ID}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Reading the project failed (${res.status}): ${await res.text()}`)
  const fields = (await res.json()).fields ?? {}
  return DOCS.map((d) => ({ ...d, board: fields[d.field]?.stringValue ?? '' }))
}

const token = await idToken()
const pairs = await board(token)
const drifted = pairs.filter((p) => p.board !== read(p.file))
report(pairs, { print: flag('--print-diff') })

if (!drifted.length) process.exit(0)
if (flag('--check')) {
  console.log(`\n${drifted.length} document${drifted.length === 1 ? '' : 's'} behind. Run without --check to sync.`)
  process.exit(1)
}

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
const bad = after.filter((p) => drifted.some((d) => d.field === p.field) && p.board !== read(p.file))
if (bad.length) {
  console.error(`\nWrote, but the board does not match: ${bad.map((d) => d.field).join(', ')}. Restore from the board's revision history.`)
  process.exit(1)
}
console.log(`\nSynced ${drifted.map((d) => d.field).join(' and ')} — verified byte for byte.`)
