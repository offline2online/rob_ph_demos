/* The board's own rules for moving a card, for scripts that move cards when
   nobody clicks the board (board-tickets.mjs, file-e2e-bugs.mjs through
   lib/board.mjs). The board (backlog-tracker/public/js/app.js) and the
   automation (run-backlog-automation.js) enforce these; a script that skips
   them leaves a card the board cannot explain. Pure functions: git and the
   clock are passed in, so apps/api/test/board-tickets-guards.test.ts can
   drive every rule without a network or a repository.

   `git(args)` returns { code, stdout } and never throws. */

const DAY = 24 * 60 * 60 * 1000
const AUTHOR = 'backlog-automation'
const TRAIN_STATUSES = ['ready-for-testing', 'ready-to-publish']

/* ------------------------------------------------------------------ notes */

const noteValue = (text, at) => ({
  mapValue: { fields: { author: { stringValue: AUTHOR }, text: { stringValue: text }, at: { stringValue: at } } },
})

const appendNotes = (note) => ({ fieldPath: 'notes', appendMissingElements: { values: [note] } })

/* One write to `<BOARD>:commit` that appends a note and nothing else. The
   server applies the append to whatever the notes are at that moment, so a
   note written in between survives (reading the array and PATCHing it back
   is what lost them). `documentName` is the full resource name. */
export function noteAppendWrite(documentName, text, at = new Date().toISOString()) {
  return {
    writes: [{
      transform: { document: documentName, fieldTransforms: [appendNotes(noteValue(text, at))] },
      currentDocument: { exists: true },
    }],
  }
}

/* The same append alongside other fields (`fields` are Firestore values).
   'notes' is never in the mask: a mask entry would overwrite the array. */
export function noteWithFieldsWrite(documentName, fields, text, at = new Date().toISOString()) {
  const names = Object.keys(fields)
  if (names.includes('notes')) throw new Error("Pass the note as `text`, not as a field: a 'notes' field would rewrite the whole array.")
  if (!names.length) return noteAppendWrite(documentName, text, at)
  return {
    writes: [{
      update: { name: documentName, fields },
      updateMask: { fieldPaths: names },
      updateTransforms: [appendNotes(noteValue(text, at))],
      currentDocument: { exists: true },
    }],
  }
}

/* A checked move, as one atomic write: plain `fields` (see toFields), any
   notes appended as a transform, and a sha appended to deployCommits. */
export function cardWrite(documentName, { fields = {}, notes = [], appendCommit }, at = new Date().toISOString()) {
  if ('notes' in fields || 'deployCommits' in fields) throw new Error("'notes' and 'deployCommits' are appended, never passed as fields.")
  const updateTransforms = []
  if (notes.length) updateTransforms.push({ fieldPath: 'notes', appendMissingElements: { values: notes.map((t) => noteValue(t, at)) } })
  if (appendCommit) updateTransforms.push({ fieldPath: 'deployCommits', appendMissingElements: { values: [{ stringValue: appendCommit }] } })
  const names = Object.keys(fields)
  const write = names.length
    ? { update: { name: documentName, fields }, updateMask: { fieldPaths: names }, updateTransforms }
    : { transform: { document: documentName, fieldTransforms: updateTransforms } }
  return { writes: [{ ...write, currentDocument: { exists: true } }] }
}

/* ----------------------------------------------------------- git questions */

export const isTrainCard = (t) => TRAIN_STATUSES.includes(t.status) && !!t.deployCommit

const refused = (message) => ({ ok: false, exitCode: 1, message })
const cannot = (message) => ({ ok: false, exitCode: 2, message })

/* Fetch `branch` so origin/<branch> can answer. In dsp-board.yml's depth-1,
   main-only checkout the history is not there; a shallow repository is
   deepened to a day before the card existed (a commit for a card cannot be
   older), and a full clone is never made shallow. */
function fetchBranch(git, branch, createdAt) {
  const shallow = git(['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true'
  const args = ['fetch', '--quiet']
  if (shallow) {
    const since = new Date((Date.parse(createdAt) || Date.now()) - DAY).toISOString()
    args.push(`--shallow-since=${since}`)
  }
  args.push('origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`)
  const res = git(args)
  return res.code === 0 ? null : cannot(`Could not fetch origin/${branch} (git exited ${res.code}) — nothing written.`)
}

/* Resolve `sha` to 40 characters and require it to be an ancestor of
   origin/<branch>. */
export function resolveOnBranch(git, sha, branch, { createdAt } = {}) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha ?? '')) return refused(`"${sha}" is not a commit sha.`)
  const failed = fetchBranch(git, branch, createdAt)
  if (failed) return failed
  const parsed = git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`])
  const full = parsed.stdout.trim()
  if (parsed.code !== 0 || !/^[0-9a-f]{40}$/.test(full)) return refused(`${sha} is not a commit on origin/${branch}.`)
  const anc = git(['merge-base', '--is-ancestor', full, `origin/${branch}`])
  if (anc.code === 1) return refused(`${sha} is not on origin/${branch}.`)
  if (anc.code !== 0) return cannot(`git could not check ${sha} against origin/${branch} (exit ${anc.code}) — nothing written.`)
  return { ok: true, sha: full }
}

/* The fields the automation stamps when it applies a ticket's patch
   (processApplyPatch): deployBranch, deployCommit and deployCommits. The
   append is a transform, so it is returned beside the plain fields. */
export function stampDeployCommit(git, sha, card, branchOfProject) {
  const branch = card.deployBranch || branchOfProject
  if (!branch) return cannot(`${card.id}: no deployBranch on the card or the project to check ${sha} against.`)
  const r = resolveOnBranch(git, sha, branch, { createdAt: card.createdAt })
  if (!r.ok) return { ...r, message: `${card.id}: ${r.message}` }
  return { ok: true, sha: r.sha, fields: { deployBranch: branch, deployCommit: r.sha }, appendCommit: r.sha }
}

/* ---------------------------------------------------------------- --notify */

/* Which tickets a --notify may start, following the board: a locked train
   takes no new build (app.js hides Ready for Dev; run-backlog-automation.js
   won't build), and a blocked ticket is skipped by functions/index.js. */
export function checkNotify({ wanted, backlog, project, force = false }) {
  const isBlocked = (t) => !!t.blockedReason
  const messages = []
  let targets
  if (wanted) {
    const t = backlog.find((x) => x.id === wanted)
    if (!t) return { ok: false, targets: [], messages: [`${wanted} is not in ${project.name}'s Backlog.`] }
    if (isBlocked(t)) return { ok: false, targets: [], messages: [`${wanted} is blocked (${t.blockedReason}${t.blockedNote ? `: ${t.blockedNote}` : ''}) — clear that on the board first.`] }
    targets = [t]
  } else {
    for (const t of backlog.filter(isBlocked)) messages.push(`skipped ${t.id}: blocked (${t.blockedReason})`)
    targets = backlog.filter((t) => !isBlocked(t))
    if (!targets.length) return { ok: false, targets, messages: [...messages, `Nothing buildable in ${project.name}'s Backlog.`] }
  }
  if (project.trainLocked) {
    if (!force) return { ok: false, targets, messages: [...messages, "This project's train is closing. Click Ready for Dev once the train has merged."] }
    messages.push(`--force: starting the build although ${project.name}'s train is locked (use only for a stuck lock).`)
  }
  return { ok: true, targets, messages }
}

/* ------------------------------------------------------------ status moves */

/* Is there proof on main that this card's work shipped? Either the commit is
   an ancestor of origin/main, or a commit there carries `Backlog item: <id>`
   (backlogItemIdFromMessage's trailer). */
function proofOnMain(git, card, sha) {
  const failed = fetchBranch(git, 'main', card.createdAt)
  if (failed) return failed
  if (sha) {
    const r = resolveOnBranch(git, sha, 'main', { createdAt: card.createdAt })
    if (r.ok) return { ok: true, sha: r.sha, fields: { deployCommit: r.sha }, appendCommit: r.sha }
    if (r.exitCode === 2) return r
  }
  const log = git(['log', 'origin/main', '--fixed-strings', `--grep=Backlog item: ${card.id}`, '-n', '1', '--format=%H'])
  if (log.code !== 0) return cannot(`git could not search origin/main for ${card.id} (exit ${log.code}) — nothing written.`)
  const found = log.stdout.trim()
  if (found) return { ok: true, fields: {}, via: found }
  return refused(`${card.id}: no proof it is on main — ${sha ? `${sha} is not an ancestor of origin/main and no` : 'no deployCommit on the card and no'} commit there carries "Backlog item: ${card.id}". ` +
    'Work that reached main another way: --ticket <id> --deploy-commit <sha on main> --to published-live.')
}

/* One card's move. Returns { ok, fields, appendCommit?, notes[], lockTrain,
   exitCode, message }. `fields` are plain values (strings, booleans); the
   caller converts them. Nothing is written here. */
export function checkMove({ card, to, deployCommit, git, project, actor, reason, now = new Date().toISOString() }) {
  const id = card.id
  const fields = {}
  const notes = []
  let appendCommit
  let lockTrain = false
  const sha = deployCommit || card.deployCommit || undefined

  if (to === 'published-live') {
    const p = proofOnMain(git, card, sha)
    if (!p.ok) return p
    Object.assign(fields, p.fields)
    appendCommit = p.appendCommit
  } else if (to === 'ready-to-publish') {
    if (card.status !== 'ready-for-testing') return refused(`${id}: only a Ready for Testing card can be approved (it is ${card.status}).`)
    const by = actor ? `dsp-board.yml by ${actor}` : 'board-tickets.mjs (local run)'
    fields.approvedAt = { timestamp: now }
    fields.approvedVia = by
    notes.push(`Approved for Deployment via ${by}.`)
    lockTrain = true
  } else if (to === 'backlog' && isTrainCard(card)) {
    fields.revertRequested = true
    /* As the board's Failed testing (26 Oct 2026): rebuilt once its commits
       are off the train, with the reason as its brief. */
    fields.rebuildAfterRevert = true
    const why = String(reason || '').trim()
    if (why) fields.lastFailureReason = { category: "Doesn't work as described", text: why, action: 'failed-testing', at: { timestamp: now } }
    notes.push(why
      ? `Failed testing [Doesn't work as described]: ${why}`
      : 'Sent back to Backlog from the script — its commits are reverted off the train (as Failed testing does), and it is rebuilt once they are off.')
  } else if (to === 'archived' && isTrainCard(card)) {
    return refused(`${id}: it is on the train (${card.status}) — send it back with Failed testing first.`)
  }

  if (deployCommit && to !== 'published-live') {
    const s = stampDeployCommit(git, deployCommit, card, project.deployBranch)
    if (!s.ok) return s
    Object.assign(fields, s.fields)
    appendCommit = s.appendCommit
  }
  if (to) fields.status = to
  return { ok: true, fields, appendCommit, notes, lockTrain }
}

/* ------------------------------------------- test links → an immutable commit */

const PROTOTYPE_LINK = /^https:\/\/(?:rawcdn|raw)\.githack\.com\/offline2online\/rob_ph_demos\/(.+?)\/dsp-integration\/prototype\/(.*)$/

/* What --relink-prototype writes: one entry per card whose link should move
   to `sha`. Only testing cards (ready-for-testing / ready-to-publish) on
   `branch` are considered — on it by deployBranch, or by a link that already
   points at the branch (a hand-filed card has no deployBranch;
   wVhGSCVDsMotrATnADZ8 was skipped for exactly that) — and a card already at
   the sha is skipped. The write is previewUrl, previewSha,
   previewUpdatedAt and updatedAt in one PATCH, and never a note: the card
   shows the link's commit and time itself. */
export function relinkPlan(cards, sha, branch, now = new Date().toISOString()) {
  return cards.flatMap((t) => {
    if (!TRAIN_STATUSES.includes(t.status)) return []
    const m = t.previewUrl?.match(PROTOTYPE_LINK)
    if (!m) return []
    const [, ref, rest] = m
    if (ref === sha) return []
    if (branch && t.deployBranch !== branch && ref !== branch) return []
    const next = `https://rawcdn.githack.com/offline2online/rob_ph_demos/${sha}/dsp-integration/prototype/${rest || 'index.html'}`
    return [{
      id: t.id, title: t.title, ref, next,
      fields: { previewUrl: next, previewSha: sha, previewUpdatedAt: { timestamp: now }, updatedAt: { timestamp: now } },
    }]
  })
}

/* ------------------------------------------------------- Firestore values */

export function toValue(v) {
  if (v && typeof v === 'object' && 'timestamp' in v) return { timestampValue: v.timestamp }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (v && typeof v === 'object') return { mapValue: { fields: toFields(v) } }
  return { stringValue: String(v) }
}
export const toFields = (plain) => Object.fromEntries(Object.entries(plain).map(([k, v]) => [k, toValue(v)]))
