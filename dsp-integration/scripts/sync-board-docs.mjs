/* Push this project's docs to the Prototype Backlog board, byte for byte.

     npm run board:sync                      # REQUIREMENTS.md → projects/{id}/docs/requirements, README.md → …/docs/readme
     npm run board:sync -- --check           # compare only; exit 1 if the board has drifted
     npm run board:sync -- --check-mcp FILE  # same comparison, from a saved MCP read (no key needed)
     npm run board:sync -- --check-mcp FILE --print-diff
     npm run board:sync -- --check-cut       # cut every mirror offline; exit 1 if one would be refused (CI)

   A sync (and --check) also covers the project documents declared in
   board-docs.json: every handover document — the "0 — Start here" index
   (START-HERE.md), the handover review, PH-CORE-BOUNDARIES.md, the approval
   integration guide, API.md, the EKS deployment guide, the reviews, the AWS
   demo test flow, the E2E test spec and the hosted demo API guide. A file over the 20k cap on project documents is split
   into parts by heading, and `--check-cut` proves every part fits.

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
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_ID = 'mIPdOCAWevhrgD8g2tCZ' // Display Types & DSP Integration
const FIREBASE_KEY = 'AIzaSyDzG5MzavLWyKU7NXfTPskuWbFYFlc5W3g'
const BOARD = 'https://firestore.googleapis.com/v1/projects/backlog-tracker-e4ed2/databases/(default)/documents'

/* Which file lands in which document under projects/{id}/docs/ (the project
   doc itself keeps only a `docs` pointer). `field` is the name get_project_docs
   returns the text under, used for reporting and --check-mcp. */
const DOCS = [
  { field: 'requirementsMd', kind: 'requirements', file: 'docs/dsp-integration/REQUIREMENTS.md', repoPath: 'dsp-integration/docs/dsp-integration/REQUIREMENTS.md' },
  { field: 'readmeMd', kind: 'readme', file: 'README.md', repoPath: 'dsp-integration/README.md' },
]

/* Board documents that mirror a repo file are declared in board-docs.json
   (this folder), not here: which file — and which slice of it — goes where,
   each document's name and its opening line. Each sync writes name, text and
   sourcePath / sourceSlices / sourcePrefix together, so backlog-tracker's
   post-merge reconcile (reconcileManifest in backlog-tracker/scripts/
   docs-sync-lib.js) cuts the same slices on every deploy. That reconcile is
   also the only thing that CREATES a board document; this script only brings
   existing ones in step, and counts an entry with no document as behind.

   The board's rules refuse a project document over MIRROR_CAP characters,
   even from the automation user. A file that would not fit is split into
   parts at whole heading lines, and every part keeps headroom under the cap.
   `--check-cut` (run by e2e-quick on every PR) cuts every mirror offline and
   fails when a marker heading is missing or a part is over the cap. */
/* The same slicing the post-merge mirror uses — one implementation. */
import { MIRROR_CAP, cutEntry, loadManifest, matchEntries, specOf } from './lib/board-docs.mjs'

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
  const headers = { Authorization: `Bearer ${token}` }
  const res = await fetch(`${BOARD}/projects/${PROJECT_ID}`, { headers })
  if (!res.ok) throw new Error(`Reading the project failed (${res.status}): ${await res.text()}`)
  const legacy = (await res.json()).fields ?? {}
  const out = []
  for (const d of DOCS) {
    const sub = await fetch(`${BOARD}/projects/${PROJECT_ID}/docs/${d.kind}`, { headers })
    if (sub.ok) {
      out.push({ ...d, board: (await sub.json()).fields?.contentMd?.stringValue ?? '' })
    } else if (sub.status === 404) {
      /* Not migrated yet: the text is still on the project document. */
      out.push({ ...d, board: legacy[d.field]?.stringValue ?? '' })
    } else {
      throw new Error(`Reading docs/${d.kind} failed (${sub.status}): ${await sub.text()}`)
    }
  }
  return out
}

/* Mirrored project documents (board-docs.json): compare, and unless --check,
   write the slice config and the text, then read back. An entry with no
   document yet is reported, never created. Returns how many were behind
   (in --check) or failed (when writing). */
async function syncMirrors(token, { write }) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const manifest = loadManifest()
  const listed = await fetch(`${BOARD}:runQuery`, {
    method: 'POST', headers,
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'projectDocs' }], where: { fieldFilter: { field: { fieldPath: 'projectId' }, op: 'EQUAL', value: { stringValue: PROJECT_ID } } } } }),
  })
  if (!listed.ok) { console.error(`✗ could not list the project's documents (${listed.status})`); return manifest.mirrors.length }
  const docs = (await listed.json()).filter((r) => r.document).map((r) => ({
    id: r.document.name.split('/').pop(), sourcePath: r.document.fields?.sourcePath?.stringValue, sourceSlices: fromFs(r.document.fields?.sourceSlices),
  }))
  let behind = 0
  for (const { entry, doc, missing } of matchEntries(manifest, docs)) {
    if (missing || !doc) {
      console.log(`${entry.name}: not on the board yet. The post-merge manifest sync creates it.`)
      behind++
      continue
    }
    const id = doc.id
    let text
    try { text = cutEntry(manifest, entry) } catch (e) { console.error(`✗ projectDocs/${id}: ${e.message}`); behind++; continue }
    const spec = specOf(manifest, entry)
    const url = `${BOARD}/projectDocs/${id}`
    const cur = await fetch(url, { headers })
    if (!cur.ok) { console.error(`✗ projectDocs/${id}: read failed (${cur.status})`); behind++; continue }
    const f = (await cur.json()).fields ?? {}
    const sameConfig = f.sourcePath?.stringValue === spec.sourcePath && f.sourcePrefix?.stringValue === spec.sourcePrefix
      && JSON.stringify(fromFs(f.sourceSlices)) === JSON.stringify(spec.sourceSlices) && f.name?.stringValue === entry.name
    if (f.contentMd?.stringValue === text && sameConfig) { console.log(`✓ projectDocs/${id} in step (${text.length} chars)`); continue }
    if (!write) { console.log(`✗ projectDocs/${id} behind the repo${sameConfig ? '' : ' (slice config too)'}`); behind++; continue }
    const fields = {
      name: { stringValue: entry.name },
      contentMd: { stringValue: text },
      sourcePath: { stringValue: spec.sourcePath },
      sourceSlices: { arrayValue: { values: spec.sourceSlices.map((sl) => ({ mapValue: { fields: Object.fromEntries(Object.entries(sl).map(([k, v]) => [k, { stringValue: v }])) } })) } },
      sourcePrefix: { stringValue: spec.sourcePrefix },
      updatedAt: { timestampValue: new Date().toISOString() },
      updatedByEmail: { stringValue: 'board:sync' },
    }
    const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
    const put = await fetch(`${url}?${mask}`, { method: 'PATCH', headers, body: JSON.stringify({ fields }) })
    if (!put.ok) { console.error(`✗ projectDocs/${id}: write refused (${put.status}): ${(await put.text()).slice(0, 300)}`); behind++; continue }
    const back = await fetch(url, { headers })
    if (!back.ok || ((await back.json()).fields?.contentMd?.stringValue ?? '') !== text) { console.error(`✗ projectDocs/${id}: wrote, but the board does not match`); behind++; continue }
    console.log(`✓ projectDocs/${id} written and verified (${text.length} chars)`)
  }
  return behind
}
/* A Firestore array of string maps, as plain objects. */
const fromFs = (v) => (v?.arrayValue?.values ?? []).map((x) => Object.fromEntries(Object.entries(x.mapValue?.fields ?? {}).map(([k, y]) => [k, y.stringValue])))

/* ------------------------------- cut every mirror offline: no key, no network */

if (flag('--check-cut')) {
  let bad = 0
  let manifest
  try { manifest = loadManifest() } catch (e) { console.error(`✗ ${e.message}`); process.exit(1) }
  for (const m of manifest.mirrors) {
    const label = m.id ?? m.key
    try {
      const text = cutEntry(manifest, m)
      console.log(`✓ ${label} ${String(text.length).padStart(6)} chars  ${m.name}`)
    } catch (e) {
      console.error(`✗ ${label} (${m.name}): ${e.message}`)
      bad++
    }
  }
  const n = manifest.mirrors.length
  console.log(bad ? `\n${bad} of ${n} mirrors would be refused by the board.` : `\nAll ${n} mirrors cut, every one under ${MIRROR_CAP} characters.`)
  process.exit(bad ? 1 : 0)
}

const token = await idToken()
const pairs = await board(token)
const drifted = pairs.filter((p) => p.board !== read(p.file))
report(pairs, { print: flag('--print-diff') })
const mirrorsBehind = await syncMirrors(token, { write: !flag('--check') })

if (!drifted.length) process.exit(mirrorsBehind ? 1 : 0)
if (flag('--check')) {
  console.log(`\n${drifted.length + mirrorsBehind} document${drifted.length === 1 ? '' : 's'} behind. Run without --check to sync.`)
  process.exit(1)
}

/* No size guess here: the board's own rules and Firestore decide, and their
   answer is what gets reported (a client-side 200000 limit kept refusing the
   spec for a day after the rules went to 800000). */
const writable = drifted
const sha = (args) => { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim() || null } catch { return null } }
const head = process.env.GITHUB_SHA || sha(['rev-parse', 'HEAD'])
const lastCommit = (file) => sha(['log', '-1', '--format=%H', '--', join(ROOT, file)]) || head

/* docsSync / lastMergeCommit / lastMergeAt are written by one writer only:
   the backlog automation's sweep (backlog-tracker/scripts/docs-sync-lib.js,
   syncAllProjectDocs), which runs whenever main moves. This script writes
   content and exits non-zero on a failure; it records nothing about the sync. */
const nowTs = { timestampValue: new Date().toISOString() }
const failWrite = async (what, res) => {
  const answer = await res.text()
  throw new Error(`Writing ${what} failed (${res.status}): ${answer}`)
}
for (const d of writable) {
  const text = read(d.file)
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex')
  const sourceCommit = lastCommit(d.file)
  const strOrNull = (v) => (v ? { stringValue: v } : { nullValue: null })
  const put = await fetch(`${BOARD}/projects/${PROJECT_ID}/docs/${d.kind}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        contentMd: { stringValue: text },
        updatedAt: nowTs,
        updatedByEmail: { stringValue: 'board:sync' },
        sourceCommit: strOrNull(sourceCommit),
        sourcePath: { stringValue: d.repoPath },
        chars: { integerValue: String(text.length) },
        sha256: { stringValue: sha256 },
      },
    }),
  })
  if (!put.ok) await failWrite(`docs/${d.kind}`, put)
  /* The pointer on the project doc, one map entry per document so the other
     document's pointer is left alone. */
  const mask = [`updateMask.fieldPaths=docs.${d.kind}`, 'updateMask.fieldPaths=updatedAt'].join('&')
  const ptr = await fetch(`${BOARD}/projects/${PROJECT_ID}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        docs: { mapValue: { fields: { [d.kind]: { mapValue: { fields: {
          chars: { integerValue: String(text.length) }, sha256: { stringValue: sha256 },
          sourceCommit: strOrNull(sourceCommit), updatedAt: nowTs,
        } } } } } },
        updatedAt: nowTs,
      },
    }),
  })
  if (!ptr.ok) await failWrite(`the docs.${d.kind} pointer`, ptr)
}

/* Read it back: a sync that says it worked and didn't is worse than a failure. */
const after = await board(token)
const bad = after.filter((p) => writable.some((d) => d.field === p.field) && p.board !== read(p.file))
if (bad.length) {
  console.error(`\nWrote, but the board does not match: ${bad.map((d) => d.field).join(', ')}. Restore from the board's revision history.`)
  process.exit(1)
}
console.log(`\nSynced ${writable.map((d) => d.field).join(' and ')} — verified byte for byte.`)
if (mirrorsBehind) process.exit(1)
