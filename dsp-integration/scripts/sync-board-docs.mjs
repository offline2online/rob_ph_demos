/* Push this project's docs to the Prototype Backlog board, byte for byte.

     npm run board:sync                      # REQUIREMENTS.md → projects/{id}/docs/requirements, README.md → …/docs/readme
     npm run board:sync -- --check           # compare only; exit 1 if the board has drifted
     npm run board:sync -- --check-mcp FILE  # same comparison, from a saved MCP read (no key needed)
     npm run board:sync -- --check-mcp FILE --print-diff
     npm run board:sync -- --check-cut       # cut every mirror offline; exit 1 if one would be refused (CI)

   A sync (and --check) also covers the project documents in MIRRORS below:
   every handover document — the "0 — Start here" index (START-HERE.md), the
   handover review, PH-CORE-BOUNDARIES.md, the approval integration guide,
   API.md, the EKS deployment guide, the three reviews and the AWS demo test
   flow (18 Oct 2026). A file over the 20k cap on project documents is split
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
import { createRequire } from 'node:module'
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

/* Board documents that mirror a repo file, whole or in parts (ticket
   taUi7jWIwhCvfeDDUURl, Rob 2 Oct 2026; the handover set, 18 Oct 2026). The
   table is the source of truth for which file — and which slice of it — goes
   where, and for each document's name: each sync writes name, text and
   sourcePath / sourceSlices / sourcePrefix together, so backlog-tracker's
   post-merge mirror (syncMirroredDocs in backlog-tracker/scripts/
   docs-sync-lib.js) cuts the same slices on every deploy.

   The board's rules refuse a project document over MIRROR_CAP characters,
   even from the automation user. A file that would not fit is split into
   parts at whole heading lines, and every part keeps headroom under the cap
   so that ordinary edits don't push it over: on 18 Oct 2026 three mirrors
   went over by a few hundred to thirteen thousand characters, the board
   refused them after the merge, and nothing said so before it. `--check-cut`
   (run by e2e-quick on every PR) now cuts every mirror offline and fails
   when a marker heading is missing or a part is over the cap. Renaming a
   marker heading fails it too, instead of mirroring nothing. Each board copy
   opens with a line saying it is a mirror and which file wins. */
const repoMirror = (file, part) => `> Mirror of \`dsp-integration/${file}\`${part ? ` (part ${part[0]} of ${part[1]})` : ''} — the repo wins. Rewritten from the repo file on every merge to main; edit the file, not this copy.\n\n`
const BOUNDARIES = 'docs/dsp-integration/api/PH-CORE-BOUNDARIES.md'
const H_GUARANTEE = '### What each seam must guarantee'
const H_TABLES = '### Tables: whose they are'
const H_OUTBOUND = '## Outbound boundaries — what this build calls'
const H_AUTH = '## Authentication seams — partner identity, advertiser principal (spec only, REQUIREMENTS §9.5)'
const H_REALTIME = '## Real-time bidding — the player signals, the exchange fills (7 Oct 2026)'
const H_RESERVED = '## Reserved for later releases (REQUIREMENTS §9, spec only)'
const SCALE = 'docs/dsp-integration/api/SCALE-15000-EKS.md'
const H_PROCESSES = '## Running several processes'
const SECURITY = 'docs/dsp-integration/api/SECURITY-PERFORMANCE.md'
const H_STABILITY = '## Stability under concurrency and at the edges — 24 Sep 2026'
const START = 'docs/dsp-integration/START-HERE.md'
const HANDOVER = 'docs/dsp-integration/api/HANDOVER-REVIEW.md'
const H_MEASURED = '## 3. Measured'
const APPROVAL = 'docs/dsp-integration/CAMPAIGN-APPROVAL-INTEGRATION.md'
const H_MIGRATION = '## 4. Run the approval migration, or move the fields onto the campaign'
const API = 'docs/dsp-integration/api/API.md'
const H_PARTNER = '## Partner API — `/v1`'
const H_ADMIN = '## Admin API — `/admin/v1`'
const H_BUYERS = '### Buyers lists (private auctions; admin only)'
const H_STANDINS = '## POC stand-ins for the existing platform'
const EKS = 'deploy/kubernetes/README.md'
const AWS_DEMO = 'docs/dsp-integration/AWS-DEMO-TEST-FLOW.md'

const MIRRORS = [
  { id: 'tiApBmLe5GDkqrqrcIjD', name: '0 — Start here: handover index and reading order', file: START, sourceSlices: [], sourcePrefix: repoMirror(START) },
  { id: 'ezhL36100y402EButyl9', name: 'Handover review & porting checklist (1/2) — how it separates, what the review fixed', file: HANDOVER, sourceSlices: [{ end: H_MEASURED }], sourcePrefix: repoMirror(HANDOVER, [1, 2]) },
  { id: 'Rd8j4S10FYbXTBFG4efN', name: 'Handover review & porting checklist (2/2) — measured, left for engineering, porting order', file: HANDOVER, sourceSlices: [{ start: H_MEASURED }], sourcePrefix: repoMirror(HANDOVER, [2, 2]) },
  { id: 'mDJ50oQKTbgaKPvxeCUs', name: 'Boundaries with PH Core (1/7) — the rule and the seams PH Core must provide', file: BOUNDARIES, sourceSlices: [{ end: H_GUARANTEE }], sourcePrefix: repoMirror(BOUNDARIES, [1, 7]) },
  { id: 'W140rfmV19EdPYQnBeTJ', name: 'Boundaries with PH Core (2/7) — what each seam must guarantee', file: BOUNDARIES, sourceSlices: [{ start: H_GUARANTEE, end: H_TABLES }], sourcePrefix: repoMirror(BOUNDARIES, [2, 7]) },
  { id: 'PnWgzNqVScsyfEehXKbl', name: 'Boundaries with PH Core (3/7) — tables: whose they are', file: BOUNDARIES, sourceSlices: [{ start: H_TABLES, end: H_OUTBOUND }], sourcePrefix: repoMirror(BOUNDARIES, [3, 7]) },
  { id: 'DxlzNnE7612X3LhJVWYo', name: 'Boundaries with PH Core (4/7) — outbound, inbound, edge, more than one instance', file: BOUNDARIES, sourceSlices: [{ start: H_OUTBOUND, end: H_AUTH }], sourcePrefix: repoMirror(BOUNDARIES, [4, 7]) },
  { id: 'HFcBgw7dPEL9CQhcM6fY', name: 'Boundaries with PH Core (5/7) — authentication seams (AUTH)', file: BOUNDARIES, sourceSlices: [{ start: H_AUTH, end: H_REALTIME }], sourcePrefix: repoMirror(BOUNDARIES, [5, 7]) },
  { id: 'M2NrMcycXZ4TVWF8wkBK', name: 'Boundaries with PH Core (6/7) — real-time bidding, pre-caching, bandwidth, web and app slots', file: BOUNDARIES, sourceSlices: [{ start: H_REALTIME, end: H_RESERVED }], sourcePrefix: repoMirror(BOUNDARIES, [6, 7]) },
  { id: 'uXwdjH0eChupvSfSrukJ', name: 'Boundaries with PH Core (7/7) — reserved, open, venue, canvas and format, analytics', file: BOUNDARIES, sourceSlices: [{ start: H_RESERVED }], sourcePrefix: repoMirror(BOUNDARIES, [7, 7]) },
  { id: '6O7ZNvasbMcn3q9dycY7', name: 'Campaign approval integration guide (1/2) — adapter, components, eligibility', file: APPROVAL, sourceSlices: [{ end: H_MIGRATION }], sourcePrefix: repoMirror(APPROVAL, [1, 2]) },
  { id: 'tMoTHRAx74HWzyTs94B5', name: 'Campaign approval integration guide (2/2) — migrations, clean-up, contract tests, creative IDs', file: APPROVAL, sourceSlices: [{ start: H_MIGRATION }], sourcePrefix: repoMirror(APPROVAL, [2, 2]) },
  { id: 'pa2M9hncfxXsEYgSc33G', name: 'API reference (1/5) — surfaces, conventions, pricing maths', file: API, sourceSlices: [{ end: H_PARTNER }], sourcePrefix: repoMirror(API, [1, 5]) },
  { id: 'FfBh1EnAh58FPPhK6RU6', name: 'API reference (2/5) — Partner API /v1', file: API, sourceSlices: [{ start: H_PARTNER, end: H_ADMIN }], sourcePrefix: repoMirror(API, [2, 5]) },
  { id: 'GpUGYxHvdGsQYZ9UNxSC', name: 'API reference (3/5) — Admin API: exchange, advertiser settings, variables, DSPs, advertisers', file: API, sourceSlices: [{ start: H_ADMIN, end: H_BUYERS }], sourcePrefix: repoMirror(API, [3, 5]) },
  { id: 'ABIsJgZHbGv5iKiZb0fb', name: 'API reference (4/5) — Admin API: buyers lists, campaign approval, display types', file: API, sourceSlices: [{ start: H_BUYERS, end: H_STANDINS }], sourcePrefix: repoMirror(API, [4, 5]) },
  { id: 'tVxupKgza0snxjhLtUd4', name: 'API reference (5/5) — stand-ins, jobs, operations, sellers.json, OpenRTB', file: API, sourceSlices: [{ start: H_STANDINS }], sourcePrefix: repoMirror(API, [5, 5]) },
  { id: 'T6nK6QNidO4L30K7vsOo', name: "EKS deployment guide — the exchange in a client's VPC", file: EKS, sourceSlices: [], sourcePrefix: repoMirror(EKS) },
  { id: 'qudg1TvEwov2PINmJD4p', name: 'Security, scalability and performance review — 23 Sep 2026 (1/2) — measurements, what changed, left', file: SECURITY, sourceSlices: [{ end: H_STABILITY }], sourcePrefix: repoMirror(SECURITY, [1, 2]) },
  { id: '7GzQiBOdNo8vWHWNsNdq', name: 'Security, scalability and performance review — 23 Sep 2026 (2/2) — stability at the edges, addendum', file: SECURITY, sourceSlices: [{ start: H_STABILITY }], sourcePrefix: repoMirror(SECURITY, [2, 2]) },
  { id: 'xzYDhGNzY1iLTDoRtouA', name: 'Scale review — 15,000 displays on EKS, 24 Sep 2026 (1/2) — the deciding fact, measurements, what changed', file: SCALE, sourceSlices: [{ end: H_PROCESSES }], sourcePrefix: repoMirror(SCALE, [1, 2]) },
  { id: 'OYSF7AfeC4PCCPK7xdvf', name: 'Scale review — 15,000 displays on EKS, 24 Sep 2026 (2/2) — several processes, security, verified, addendum', file: SCALE, sourceSlices: [{ start: H_PROCESSES }], sourcePrefix: repoMirror(SCALE, [2, 2]) },
  { id: 'Vd6akDtwNOrUSKoiuZCg', name: 'Admin API performance review — 3 Oct 2026', file: 'docs/dsp-integration/api/ADMIN-API-PERFORMANCE.md', sourceSlices: [], sourcePrefix: repoMirror('docs/dsp-integration/api/ADMIN-API-PERFORMANCE.md') },
  { id: 'Stonlf6Pp1EaS34ZePzG', name: 'AWS demo — test flow (10 Dec 2026)', file: AWS_DEMO, sourceSlices: [], sourcePrefix: repoMirror(AWS_DEMO) },
]
/* The same slicing the post-merge mirror uses — one implementation. */
const { mirrorText, MIRROR_CAP } = createRequire(import.meta.url)('../../backlog-tracker/scripts/docs-sync-lib.js')

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

/* Mirrored project documents (MIRRORS above): compare, and unless --check,
   write the slice config and the text, then read back. Returns how many
   were behind (in --check) or failed (when writing). */
async function syncMirrors(token, { write }) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  let behind = 0
  for (const m of MIRRORS) {
    let text
    try { text = cutMirror(m) } catch (e) { console.error(`✗ projectDocs/${m.id}: ${e.message}`); behind++; continue }
    const url = `${BOARD}/projectDocs/${m.id}`
    const cur = await fetch(url, { headers })
    if (!cur.ok) { console.error(`✗ projectDocs/${m.id}: read failed (${cur.status})`); behind++; continue }
    const f = (await cur.json()).fields ?? {}
    const sameConfig = f.sourcePath?.stringValue === `dsp-integration/${m.file}` && f.sourcePrefix?.stringValue === m.sourcePrefix
      && JSON.stringify(fromFs(f.sourceSlices)) === JSON.stringify(m.sourceSlices) && f.name?.stringValue === m.name
    if (f.contentMd?.stringValue === text && sameConfig) { console.log(`✓ projectDocs/${m.id} in step (${text.length} chars)`); continue }
    if (!write) { console.log(`✗ projectDocs/${m.id} behind the repo${sameConfig ? '' : ' (slice config too)'}`); behind++; continue }
    const fields = {
      name: { stringValue: m.name },
      contentMd: { stringValue: text },
      sourcePath: { stringValue: `dsp-integration/${m.file}` },
      sourceSlices: { arrayValue: { values: m.sourceSlices.map((sl) => ({ mapValue: { fields: Object.fromEntries(Object.entries(sl).map(([k, v]) => [k, { stringValue: v }])) } })) } },
      sourcePrefix: { stringValue: m.sourcePrefix },
      updatedAt: { timestampValue: new Date().toISOString() },
      updatedByEmail: { stringValue: 'board:sync' },
    }
    const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
    const put = await fetch(`${url}?${mask}`, { method: 'PATCH', headers, body: JSON.stringify({ fields }) })
    if (!put.ok) { console.error(`✗ projectDocs/${m.id}: write refused (${put.status}): ${(await put.text()).slice(0, 300)}`); behind++; continue }
    const back = await fetch(url, { headers })
    if (!back.ok || ((await back.json()).fields?.contentMd?.stringValue ?? '') !== text) { console.error(`✗ projectDocs/${m.id}: wrote, but the board does not match`); behind++; continue }
    console.log(`✓ projectDocs/${m.id} written and verified (${text.length} chars)`)
  }
  return behind
}
/* One mirror's text, refused here — before any write — when it is over the
   cap, with what to do about it. */
function cutMirror(m) {
  const text = mirrorText(read(m.file), m)
  if (text.length > MIRROR_CAP) {
    throw new Error(`${text.length} chars, over the ${MIRROR_CAP} the board allows a project document. ` +
      `Split ${m.file} at another heading in MIRRORS (scripts/sync-board-docs.mjs) and create the new board document first.`)
  }
  return text
}
/* A Firestore array of string maps, as plain objects. */
const fromFs = (v) => (v?.arrayValue?.values ?? []).map((x) => Object.fromEntries(Object.entries(x.mapValue?.fields ?? {}).map(([k, y]) => [k, y.stringValue])))

/* ------------------------------- cut every mirror offline: no key, no network */

if (flag('--check-cut')) {
  let bad = 0
  const ids = new Set()
  for (const m of MIRRORS) {
    if (ids.has(m.id)) { console.error(`✗ ${m.id} is listed twice in MIRRORS`); bad++; continue }
    ids.add(m.id)
    if (!m.name || m.name.length > 120) { console.error(`✗ ${m.id}: a board document's name must be 1–120 characters`); bad++; continue }
    try {
      const text = cutMirror(m)
      console.log(`✓ ${m.id} ${String(text.length).padStart(6)} chars  ${m.name}`)
    } catch (e) {
      console.error(`✗ ${m.id} (${m.name}): ${e.message}`)
      bad++
    }
  }
  console.log(bad ? `\n${bad} of ${MIRRORS.length} mirrors would be refused by the board.` : `\nAll ${MIRRORS.length} mirrors cut, every one under ${MIRROR_CAP} characters.`)
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
