// Runs inside .github/workflows/backlog-automation.yml, on a fully trusted
// GitHub-hosted runner, authenticated with that run's own ephemeral
// GITHUB_TOKEN (see the workflow's `permissions:` block) — never with a
// long-lived PAT, and never with anything handed to a Claude Code session.
//
// Why this exists: the "Notify Claude" Routine fires a brand-new, bare
// Claude Code session with no repo checked out and no GitHub-aware tools —
// it can investigate and implement a fix locally, but it structurally has
// no way to push a branch or open a PR itself (see backlog-tracker/README.md
// "Notify Claude can't push — how a fix actually reaches GitHub" for the
// full story of why, and why we deliberately did NOT hand that session a
// real GitHub credential: backlogItems are publicly, unauthenticatedly
// writable, so a malicious backlog item's `desc` could otherwise prompt-
// inject that session into leaking a push-capable secret). Instead, the
// Routine packages its finished fix as plain file contents into Firestore
// (`patchFiles` + `patchReady: true` on the item) and this script — running
// with no AI involved at all, on a schedule — turns that into real commits
// using the runner's own credentials.
//
// Since the deployment train (see "The deployment train" further down), a
// ticket does NOT get its own branch and PR: it becomes one commit on its
// project's single integration branch, `deploy/<project-slug>`. One project
// therefore has one PR per release, not one per ticket, which is what
// removed the merge conflicts two concurrent tickets used to guarantee.
// The steps this script runs, each driven by one Firestore flag:
//
//   backlogItems.patchReady      -> processApplyPatch: commit on the train
//   backlogItems.revertRequested -> processRevertFromTrain: take a rejected
//                                   ticket's commits back off the train
//   projects.trainReady          -> processDeployTrain: merge the whole
//                                   train to main as one PR, one version
//                                   bump, and reset the branch
//   backlogItems.revertReady     -> processRevertPr: undo something already
//                                   merged to main (still its own PR)
//
// `mergeReady`/`mergePrNumber` (processMergePr, reconcileHumanMergedPrs)
// are the pre-train per-ticket merge path, kept only so cards that were
// already in flight when the train shipped can still finish. Nothing
// writes them for new work.
//
// Idempotent and safe to run on a schedule: a record only gets processed
// while its own flag is still true, and the flag is cleared as part of the
// same write that records success.

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildIndexFromArticleFiles, validateIndexAgainstArticleFiles, serializeIndex } = require("./faq-index-lib");
// Shared with functions/index.js's onBacklogItemTrainLockRecompute — see
// that file for the "why" (fixes the stuck-trainLocked bug). Kept as its
// own dependency-free module specifically so it's unit-testable
// (test/train-lock.test.js) without requiring this whole script, which
// runs main() for real the moment it's required (see the bottom of this
// file).
const { trainLockShouldClear, trainHandoverReason } = require("../functions/train-lock");
const { syncProjectDocs, resolveRepoFolder } = require("./docs-sync-lib");
const { hasIntakePlaceholder } = require("../functions/intake");

const PROJECT_ID = "backlog-tracker-e4ed2";
const REPO = "offline2online/rob_ph_demos";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

function fv(value) {
  // Decode a single Firestore REST "Value" object into a plain JS value.
  if (value == null) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fv);
  if ("mapValue" in value) return fdoc(value.mapValue.fields || {});
  return null;
}

function fdoc(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fv(v);
  return out;
}

function tv(value) {
  // Encode a plain JS value back into a Firestore REST "Value" object.
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  // A Date is a real Firestore timestamp — what a Cloud Function's
  // `toMillis()` guard needs (an ISO string would be a stringValue). The
  // pipeline's own updatedAt fields are ISO strings and stay that way.
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "number") return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(tv) } };
  if (typeof value === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, tv(v)])) } };
  return { stringValue: String(value) };
}

// firestore.rules requires a signed-in editor for every board collection, so
// this script authenticates as the deploy service account (the workflow
// writes the key to GOOGLE_APPLICATION_CREDENTIALS). Service accounts bypass
// rules. Token minting is done by hand — a signed JWT exchanged at Google's
// token endpoint — so scripts/ keeps zero runtime dependencies for this job.
let cachedToken = null;
async function getAccessToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 60000) return cachedToken.value;
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not set — the backlog automation needs the Firebase service account to read/write Firestore now that the board requires sign-in");
  const key = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email, scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`;
  const signature = require("crypto").createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${signature}`,
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  cachedToken = { value: json.access_token, expires: Date.now() + (json.expires_in || 3600) * 1000 };
  return cachedToken.value;
}
async function firestoreHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${await getAccessToken()}` };
}

async function runQuery(structuredQuery) {
  const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
    method: "POST",
    headers: await firestoreHeaders(),
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error(`runQuery failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows
    .filter((r) => r.document)
    .map((r) => ({ id: r.document.name.split("/").pop(), ...fdoc(r.document.fields) }));
}

async function patchItem(itemId, fields) {
  const fieldPaths = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const res = await fetch(`${FIRESTORE_BASE}/backlogItems/${itemId}?${fieldPaths}`, {
    method: "PATCH",
    headers: await firestoreHeaders(),
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, tv(v)])) }),
  });
  if (!res.ok) throw new Error(`PATCH ${itemId} failed: ${res.status} ${await res.text()}`);
}

// Removes a card's patchFiles — the full contents of every file its ticket
// changed (up to ~180 KB). Nothing reads them once the change is merged, but
// the board's backlogItems listener cannot mask fields, so every blob left on
// a card is downloaded by every open tab on every load and re-sent on every
// small write. A PATCH whose updateMask names a field the body omits deletes
// that field. Best-effort: a failure here must never undo a merge that has
// already happened, and the hourly sweep below catches whatever it misses.
async function dropPatchFiles(itemId) {
  try {
    const res = await fetch(`${FIRESTORE_BASE}/backlogItems/${itemId}?updateMask.fieldPaths=patchFiles`, {
      method: "PATCH",
      headers: await firestoreHeaders(),
      body: JSON.stringify({ fields: {} }),
    });
    if (!res.ok) console.log(`[patch-files] couldn't drop patchFiles from ${itemId}: ${res.status} ${await res.text()}`);
    // And the copy functions/patch-offload.js moved off the card.
    const sub = await fetch(`${FIRESTORE_BASE}/${patchDocPath(itemId)}`, { method: "DELETE", headers: await firestoreHeaders() });
    if (!sub.ok && sub.status !== 404) console.log(`[patch-files] couldn't drop ${patchDocPath(itemId)}: ${sub.status} ${await sub.text()}`);
  } catch (err) {
    console.log(`[patch-files] couldn't drop patchFiles from ${itemId}: ${err.message}`);
  }
}

// functions/patch-offload.js moves patchFiles off the card into this
// sub-document as soon as the Routine writes it (Firebase cost review,
// 5 Oct 2026: the board's live listener was downloading it into every open
// tab). A card still carrying the field — the move hasn't run yet, or failed
// — is read as before; the move is a transaction, so one of the two always
// holds the files.
function patchDocPath(itemId) {
  return `backlogItems/${itemId}/pipeline/patch`;
}
async function patchFilesFor(item) {
  if (Array.isArray(item.patchFiles) && item.patchFiles.length) return item.patchFiles;
  const res = await fetch(`${FIRESTORE_BASE}/${patchDocPath(item.id)}`, { headers: await firestoreHeaders() });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GET ${patchDocPath(item.id)} failed: ${res.status} ${await res.text()}`);
  const files = fdoc((await res.json()).fields || {}).patchFiles;
  return Array.isArray(files) ? files : [];
}

const PATCH_FILES_SWEEP_EVERY_MS = 60 * 60 * 1000;
const PATCH_FILES_SWEEP_BATCH = 25;
// Hourly, bounded: prunes any already-shipped or archived card still carrying
// patchFiles (everything merged before this existed, plus anything a merge
// path missed). The query is server-side filtered and field-masked down to
// `status`, so finding the cards does not itself download the blobs.
async function sweepShippedPatchFiles() {
  try {
    const statusRes = await fetch(`${FIRESTORE_BASE}/systemStatus/pipeline`, { headers: await firestoreHeaders() });
    if (statusRes.ok) {
      const doc = fdoc((await statusRes.json()).fields || {});
      const last = Date.parse(doc.patchFilesSweptAt || "");
      if (Number.isFinite(last) && Date.now() - last < PATCH_FILES_SWEEP_EVERY_MS) return;
    }
    const rows = await runQuery({
      from: [{ collectionId: "backlogItems" }],
      where: { fieldFilter: { field: { fieldPath: "patchFiles" }, op: "NOT_EQUAL", value: { nullValue: "NULL_VALUE" } } },
      select: { fields: [{ fieldPath: "status" }] },
      limit: 150,
    });
    const shipped = rows.filter((r) => r.status === "published-live" || r.status === "archived").slice(0, PATCH_FILES_SWEEP_BATCH);
    for (const r of shipped) await dropPatchFiles(r.id);
    console.log(`[patch-files] sweep: ${rows.length} card(s) carry patchFiles, pruned ${shipped.length} shipped/archived`);
    // A full batch means there is more to do: leave the clock alone so the
    // next run continues instead of waiting an hour.
    if (shipped.length < PATCH_FILES_SWEEP_BATCH) {
      const fields = { patchFilesSweptAt: new Date().toISOString() };
      await fetch(`${FIRESTORE_BASE}/systemStatus/pipeline?updateMask.fieldPaths=patchFilesSweptAt`, {
        method: "PATCH",
        headers: await firestoreHeaders(),
        body: JSON.stringify({ fields: { patchFilesSweptAt: tv(fields.patchFilesSweptAt) } }),
      });
    }
  } catch (err) {
    console.log(`[patch-files] sweep failed: ${err.message}`);
  }
}

async function appendNote(item, text) {
  const notes = Array.isArray(item.notes) ? item.notes : [];
  notes.push({ author: "backlog-automation", text, at: new Date().toISOString() });
  return notes;
}

// ── The deployment train ─────────────────────────────────────────────────
// Every ticket a project builds now lands as ONE COMMIT on that project's
// single long-lived integration branch, `deploy/<project-slug>` — not on a
// per-ticket `claude/<slug>-<id6>` branch cut fresh from `main`.
//
// Why: two tickets alive at once drifted apart and nothing in the pipeline
// ever brought them back together (the Routine has no push credential by
// design; processMergePr only ever ran `gh pr merge`), so the second PR to
// merge was conflicted, `gh pr merge` failed with "Pull Request has merge
// conflicts", and the card sat in Approved for Deployment until a human
// resolved it by hand — PR #77, then #141 and #139 on 15 Sep 2026.
// `version.js` made it structural rather than occasional: every PR bumped
// APP_VERSION on the same line, so any two open PRs conflicted on that file
// alone. Building onto one branch means tickets are written on top of each
// other, tested in the combination they will actually ship in, and merged
// as one PR with exactly one version bump (see processDeployTrain).
function deployBranchForName(name) {
  const slug = String(name || "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "project";
  return `deploy/${slug}`;
}

async function getProject(projectId) {
  const res = await fetch(`${FIRESTORE_BASE}/projects/${projectId}`, { headers: await firestoreHeaders() });
  if (!res.ok) throw new Error(`GET projects/${projectId} failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { id: projectId, ...fdoc(json.fields) };
}

async function patchProject(projectId, fields) {
  const fieldPaths = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const res = await fetch(`${FIRESTORE_BASE}/projects/${projectId}?${fieldPaths}`, {
    method: "PATCH",
    headers: await firestoreHeaders(),
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, tv(v)])) }),
  });
  if (!res.ok) throw new Error(`PATCH projects/${projectId} failed: ${res.status} ${await res.text()}`);
}

// projects/{id}/docs/{requirements|readme}: the Requirements and README text,
// one Firestore document each (see docs-sync-lib.js).
async function getProjectDoc(projectId, kind) {
  const res = await fetch(`${FIRESTORE_BASE}/projects/${projectId}/docs/${kind}`, { headers: await firestoreHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET projects/${projectId}/docs/${kind} failed: ${res.status} ${await res.text()}`);
  return fdoc((await res.json()).fields);
}

async function putProjectDoc(projectId, kind, fields) {
  const res = await fetch(`${FIRESTORE_BASE}/projects/${projectId}/docs/${kind}`, {
    method: "PATCH",
    headers: await firestoreHeaders(),
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, tv(v)])) }),
  });
  if (!res.ok) throw new Error(`PATCH projects/${projectId}/docs/${kind} failed: ${res.status} ${await res.text()}`);
}

// projectDocs/{id}: the Docs page's "Additional documents". One with a
// `sourcePath` mirrors a repo file (see syncMirroredDocs in docs-sync-lib.js).
async function listProjectDocsFor(projectId) {
  const rows = await runQuery({
    from: [{ collectionId: "projectDocs" }],
    where: { fieldFilter: { field: { fieldPath: "projectId" }, op: "EQUAL", value: { stringValue: projectId } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, sourcePath: r.sourcePath, sourceSlices: r.sourceSlices, sourcePrefix: r.sourcePrefix }));
}

async function getProjectDocById(docId) {
  const res = await fetch(`${FIRESTORE_BASE}/projectDocs/${docId}`, { headers: await firestoreHeaders() });
  if (!res.ok) throw new Error(`GET projectDocs/${docId} failed: ${res.status} ${await res.text()}`);
  return fdoc((await res.json()).fields);
}

async function patchProjectDocFields(docId, fields) {
  const fieldPaths = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const res = await fetch(`${FIRESTORE_BASE}/projectDocs/${docId}?${fieldPaths}&currentDocument.exists=true`, {
    method: "PATCH",
    headers: await firestoreHeaders(),
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, tv(v)])) }),
  });
  if (!res.ok) throw new Error(`PATCH projectDocs/${docId} failed: ${res.status} ${await res.text()}`);
}

async function itemsForProject(projectId, fields) {
  return runQuery({
    from: [{ collectionId: "backlogItems" }],
    ...(fields ? { select: selectFields(fields) } : {}),
    where: { fieldFilter: { field: { fieldPath: "projectId" }, op: "EQUAL", value: { stringValue: projectId } } },
  });
}

// Firebase cost review (4 Oct 2026): Firestore's bill was almost all
// internet egress (~99 GB in a month, ~80 KB per document read), and this
// job runs every 2 minutes from a GitHub runner. The sweeps that run on
// every pass ask only for the fields they read, so a ticket's patchFiles
// (~180 KB) and a project's markdown (up to 200k chars) are never
// downloaded just to check a status; anything that then acts on a document
// re-reads it in full first.
function selectFields(fields) {
  return { fields: fields.map((fieldPath) => ({ fieldPath })) };
}
// What trainLockShouldClear / isTrainRelevantItem (functions/train-lock.js)
// read on an item.
const TRAIN_LOCK_ITEM_FIELDS = ["status", "deployCommit", "revertRequested"];

// ── "Ready for Testing" hand-off: tell a person the build landed ────────────
// Every card this run moves into Ready for Testing is collected per project,
// and main() writes projects/{id}.readyForTestingNotifyRequestedAt (plus the
// ids, and the member whose click started the build) once per project at
// the end of the apply-patch loop. functions/index.js's
// notifyOnItemsReadyForTesting reacts to that write by firing a Claude
// session whose only job is to PRESENT the column — the board's
// get_ready_for_testing_board MCP App where the Routine has the PH Agent
// Console connector, plain text otherwise — so the person sees what just
// landed without asking for it. One fire per run per project, not one per
// ticket: the run is the batch, same as a Notify Claude click is.
const readyForTestingLanded = new Map(); // projectId -> { ids, project }
function noteReadyForTesting(project, itemId) {
  if (!project || !project.id || !itemId) return;
  const entry = readyForTestingLanded.get(project.id) || { ids: [], project };
  if (!entry.ids.includes(itemId)) entry.ids.push(itemId);
  readyForTestingLanded.set(project.id, entry);
}
function readyForTestingNotifyFields(project, ids) {
  return {
    // A Date, so it lands as a Firestore timestamp (see tv()).
    readyForTestingNotifyRequestedAt: new Date(),
    readyForTestingNotifyItemIds: ids.slice(),
    // The member whose Notify Claude click started this build, so the
    // presentation session fires under their own Routine binding when they
    // have one (resolveRoutineCredentials in functions/index.js).
    readyForTestingNotifyRequestedByEmail: (project && project.notifyRequestedByEmail) || null,
  };
}
// Pure: the tickets of a Notify Claude click that are still being built —
// still in Backlog, not errored and not blocked — so the presentation (and the
// Slack post that rides on it) waits until the whole click has landed rather
// than going out ticket by ticket. A click older than BATCH_WAIT_MAX_MS never
// holds anything back, so a hung session can't silence the project for good.
const BATCH_WAIT_MAX_MS = 3 * 60 * 60 * 1000;
function batchStillBuilding(project, itemsById, now = Date.now()) {
  const nr = project && project.notifyRoutine;
  if (!nr || nr.status !== "in-progress" || !Array.isArray(nr.sentItemIds)) return [];
  const firedMs = nr.firedAt ? Date.parse(String(nr.firedAt)) : NaN;
  if (Number.isFinite(firedMs) && now - firedMs > BATCH_WAIT_MAX_MS) return [];
  return nr.sentItemIds.filter((id) => {
    const it = itemsById[id];
    if (!it || it.status !== "backlog") return false;
    if (it.blocked) return false;
    if (it.buildSession && it.buildSession.status === "error") return false;
    return true;
  });
}
async function requestReadyForTestingNotify() {
  for (const [projectId, { ids, project }] of readyForTestingLanded) {
    try {
      // Ids held back by an earlier run of the same click join this one.
      const held = Array.isArray(project.readyForTestingPendingItemIds) ? project.readyForTestingPendingItemIds : [];
      const allIds = [...new Set([...held, ...ids])];
      const sent = project.notifyRoutine && Array.isArray(project.notifyRoutine.sentItemIds) ? project.notifyRoutine.sentItemIds : [];
      const itemsById = {};
      for (const id of sent) {
        if (!allIds.includes(id)) itemsById[id] = await getItem(id).catch(() => null);
      }
      const building = batchStillBuilding(project, itemsById);
      if (building.length) {
        await patchProject(projectId, { readyForTestingPendingItemIds: allIds });
        console.log(`[ready-for-testing] ${projectId}: holding the notification — ${building.length} ticket(s) of this click still building (${allIds.length} landed so far)`);
        continue;
      }
      await patchProject(projectId, { ...readyForTestingNotifyFields(project, allIds), readyForTestingPendingItemIds: [] });
      console.log(`[ready-for-testing] ${projectId}: asked for the column to be presented (${allIds.length} ticket(s): ${allIds.join(", ")})`);
    } catch (err) {
      // The cards are already in Ready for Testing; a missed presentation is
      // a nuisance, not a reason to fail the run.
      console.error(`[ready-for-testing] ${projectId}: couldn't request the presentation: ${err.message}`);
    }
  }
  readyForTestingLanded.clear();
}

// ── Parallel builds (4 Oct 2026) ────────────────────────────────────────────
// A Notify Claude click now starts one Routine session per ticket
// (functions/index.js fireBuildSessionsPerItem), so several patches for the
// same train arrive at once, each written against the branch as its session
// read it. Two things make that safe and keep it moving without a person:
//
//  - patchBaseSha: the train commit a session read its files from. Every
//    patched file is three-way merged from that commit onto the train as it
//    is now (patchBaseFor / rebasePatchFilesOnto), so a ticket that landed
//    in between keeps its change instead of being overwritten by a whole-
//    file copy taken before it existed.
//  - dependsOnItemIds: a ticket that needs another ticket's code first is
//    flagged blocked with the ids it waits for; when they reach Ready for
//    Testing, releaseDependents() clears the flag and asks for a build of it
//    — the same project write a Ready for Dev click makes.
const SHA_RE = /^[0-9a-f]{40}$/;

// Numbered migration files are the one clash a three-way merge cannot see:
// two tickets built in parallel each add "the next" migration — different
// new files with the SAME number (4 Oct 2026: 0040_dsp_creative_content_
// identity and 0040_partner_advertiser_lists_per_dsp on deploy/dsp-integration;
// the runner keys on the number, so one of them never ran). Given the files
// this patch ADDS and a directory listing, returns the added migrations whose
// number another, pre-existing file in the same directory already uses.
const MIGRATION_FILE_RE = /(^|\/)migrations\/(\d{3,5})_[^/]+$/;
function migrationNumberClashes(addedPaths, listDir) {
  const added = new Set(addedPaths);
  const clashes = [];
  for (const p of addedPaths) {
    const m = MIGRATION_FILE_RE.exec(p);
    if (!m) continue;
    const dir = p.slice(0, p.lastIndexOf("/"));
    const taken = (listDir(dir) || [])
      .map((name) => `${dir}/${name}`)
      .filter((other) => !added.has(other) && (MIGRATION_FILE_RE.exec(other) || [])[2] === m[2]);
    if (taken.length) clashes.push({ path: p, number: m[2], takenBy: taken });
  }
  return clashes;
}
function stagedAddedPaths() {
  try {
    const out = run("git", ["diff", "--cached", "--name-only", "--diff-filter=A"]);
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

// The commit to three-way merge a patch from, or null to write it as given.
function patchBaseFor(item, sync, { resolvable = commitResolvable } = {}) {
  const sha = typeof item.patchBaseSha === "string" ? item.patchBaseSha.trim().toLowerCase() : "";
  if (SHA_RE.test(sha) && resolvable(sha)) return sha;
  return sync && sync.kind !== "current" ? sync.baseTip : null;
}

function commitResolvable(sha) {
  try { run("git", ["cat-file", "-e", `${sha}^{commit}`]); return true; } catch { /* not fetched yet */ }
  try { run("git", ["fetch", "origin", sha, "--quiet"]); run("git", ["cat-file", "-e", `${sha}^{commit}`]); return true; } catch { return false; }
}

// projectId -> { project, ids:Set } — builds to request at the end of the run,
// one project write each (a second write in the same second could be folded
// into the first by the trigger).
const pendingBuildRequests = new Map();
function queueBuildRequest(project, itemId) {
  if (!project || !project.id || !itemId) return;
  const entry = pendingBuildRequests.get(project.id) || { project, ids: new Set() };
  entry.ids.add(itemId);
  pendingBuildRequests.set(project.id, entry);
}
function buildRequestFields(project, ids) {
  return {
    notifyRequestedAt: new Date(),
    notifyItemIds: ids.slice(),
    notifyRequestedByEmail: (project && project.notifyRequestedByEmail) || null,
  };
}
async function flushBuildRequests() {
  for (const [projectId, { project, ids }] of pendingBuildRequests) {
    try {
      await patchProject(projectId, buildRequestFields(project, [...ids]));
      console.log(`[parallel] ${projectId}: requested builds for ${[...ids].join(", ")}`);
    } catch (err) {
      console.error(`[parallel] ${projectId}: couldn't request builds: ${err.message}`);
    }
  }
  pendingBuildRequests.clear();
}

async function getItem(itemId) {
  const res = await fetch(`${FIRESTORE_BASE}/backlogItems/${itemId}`, { headers: await firestoreHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET backlogItems/${itemId} failed: ${res.status} ${await res.text()}`);
  return { id: itemId, ...fdoc((await res.json()).fields) };
}

// Pure: is every dependency off the Backlog (landed, shipped, or gone)?
function dependenciesLanded(depIds, statusById) {
  return (depIds || []).every((id) => {
    const st = statusById[id];
    return st === undefined || st === null || st !== "backlog";
  });
}

async function releaseDependents(landed) {
  for (const [projectId, { ids, project }] of landed) {
    for (const landedId of ids) {
      let waiting = [];
      try {
        waiting = await runQuery({
          from: [{ collectionId: "backlogItems" }],
          where: { fieldFilter: { field: { fieldPath: "dependsOnItemIds" }, op: "ARRAY_CONTAINS", value: { stringValue: landedId } } },
        });
      } catch (err) {
        console.log(`[parallel] couldn't look up tickets waiting on ${landedId}: ${err.message}`);
        continue;
      }
      for (const w of waiting.filter((x) => x.status === "backlog")) {
        const deps = Array.isArray(w.dependsOnItemIds) ? w.dependsOnItemIds : [];
        const statusById = {};
        for (const d of deps) {
          if (d === landedId) { statusById[d] = "ready-for-testing"; continue; }
          const dep = await getItem(d).catch(() => undefined);
          statusById[d] = dep === undefined ? "backlog" : dep && dep.status;
        }
        if (!dependenciesLanded(deps, statusById)) continue;
        const locked = !!project.trainLocked;
        const notes = await appendNote(w,
          `Released: ${deps.join(", ")} ${deps.length === 1 ? "has" : "have"} reached Ready for Testing, so this ticket is no longer blocked. ` +
          (locked
            ? `This project's train is closing (an approval locked it), so the build was NOT started — click Ready for Dev once the train has merged.`
            : `A build was started for it automatically.`));
        await patchItem(w.id, { blocked: null, notes, updatedAt: new Date().toISOString() });
        if (!locked) queueBuildRequest(project, w.id);
        console.log(`[parallel] ${w.id}: released (waited on ${deps.join(", ")})${locked ? " — train locked, not rebuilt" : ""}`);
      }
    }
  }
}

// Every card on a project's train right now: it has a commit on the
// integration branch and hasn't shipped yet. This is the set §2.4's Deploy
// gate reasons about on the board, and the set one merge carries — merging
// the branch ships all of them, which is exactly why the board hides Deploy
// to Main until every one of them is approved.
const ON_TRAIN_STATUSES = new Set(["ready-for-testing", "ready-to-publish"]);
function onTrainItems(items) {
  return items.filter((i) => i.deployCommit && ON_TRAIN_STATUSES.has(i.status));
}

// ── Cards carried by a sibling's commit ────────────────────────────────────
// A shared-file batch delivers two tickets' content in one commit: the first
// item's full-file patchFiles carry both changes, so the second item's
// patchFiles then produce no diff against the train. That second card has no
// commit of its own — but its fix IS on the branch, inside the first item's
// commit, and it must go live when, and only when, that train merges.
//
// Until 25 Sep 2026 the no-diff path stamped such a card noDeploymentRequired
// instead. That flag means "nothing ever touches GitHub" and hands the card
// the board's one-click "Confirm tested — mark Merged to Main", so two cards
// on Backlog Tracker & FAQs (OhKUnoGbpUAeJiXiLIvc, yUISCow4tCg9uxnMJFOy) read
// "Deployed / Main Branch (Live)" while their code sat unmerged on
// deploy/backlog-tracker-faqs inside 419bb79 (ORUeAQ4b3vmv2EhEni5O's commit),
// which only reached main later as PR #211. The Deploy run flagged both.
//
// So a carried card is stamped with the commit that carried it instead:
//   deployCommit    = that commit — so every membership check (the board's
//                     Deploy gate, train-lock.js, onTrainItems, finishTrain,
//                     the Deploy Routine's ancestor check) counts it as on
//                     the train with no special case, and it ships with it;
//   carriedByCommit = the same sha, the explicit marker; and
//   carriedByItem   = the sibling's id from that commit's `Backlog item:`
//                     trailer (null for a commit with no trailer).
// It is NOT added to deployCommits: that array is "commits this card put on
// the branch" — what processRevertFromTrain takes off — and the carrying
// commit is the sibling's own work, never this card's to revert.

// The id on a train commit's `Backlog item: <id>` trailer, or null.
function backlogItemIdFromMessage(message) {
  const m = String(message || "").match(/^Backlog item:\s*([A-Za-z0-9_-]+)\s*$/m);
  return m ? m[1] : null;
}

// The commit on the train (origin/main..origin/<deployBranch>) that delivered
// this item's content — the newest commit touching any of `paths` that is
// neither a revert nor itself reverted — as { sha, itemId }. null when the
// branch does not differ from main in those paths at all (the content is
// already live, and anything that once touched them there has been reverted).
// Plain git over the refs checkoutTrain() has already fetched.
function carryingCommitOnTrain(deployBranch, paths) {
  const wanted = (paths || []).filter((p) => typeof p === "string" && p);
  if (!wanted.length) return null;
  const range = `origin/main..origin/${deployBranch}`;
  // `git diff --quiet` exits 1 when there IS a difference, which run() turns
  // into a throw — so a throw here means "the train changes these paths".
  let differs = false;
  try { run("git", ["diff", "--quiet", "origin/main", `origin/${deployBranch}`, "--", ...wanted]); }
  catch { differs = true; }
  if (!differs) return null;

  let out = "";
  try { out = run("git", ["log", "--format=%H%x1f%B%x1e", range, "--", ...wanted]); } catch { return null; }
  const commits = [];
  const revertedShas = new Set();
  for (const record of String(out).split("\x1e")) {
    const [sha, body] = record.replace(/^\s+/, "").split("\x1f");
    if (!sha) continue;
    const text = String(body || "");
    const undoes = [...text.matchAll(/This reverts commit ([0-9a-f]{7,40})/g)].map((m) => m[1]);
    undoes.forEach((s) => revertedShas.add(s));
    commits.push({ sha, body: text, isRevert: undoes.length > 0 });
  }
  if (!commits.length) return null;
  const surviving = commits.find((c) => !c.isRevert && ![...revertedShas].some((r) => c.sha.startsWith(r)));
  const chosen = surviving || commits[0];
  return { sha: chosen.sha, itemId: backlogItemIdFromMessage(chosen.body) };
}

// Pure: what a no-diff patch means for the card, and exactly what to write on
// it. `carrying` is carryingCommitOnTrain()'s answer. Three outcomes:
//   already-on-train — the item has commits there (a re-patch matched what it
//                      had already put on the branch), or the carrying commit
//                      carries THIS item's own trailer: a commit someone pushed
//                      by hand and never stamped on the card (CLAUDE.md →
//                      "Putting a commit on a deployment train by hand"), so
//                      adopt it. Back to testing on those commits either way.
//   carried          — a sibling's commit delivered the content: ride on it.
//   already-on-main  — nothing on the train changes these paths, so the
//                      content is live already: genuinely nothing to deploy,
//                      and the one case noDeploymentRequired is honest for.
function noDiffPatchFields(item, carrying, { deployBranch, testVersion, previewUrl, mainPreviewUrl } = {}) {
  const base = {
    status: "ready-for-testing",
    patchReady: false,
    patchAttempts: 0,
    ...(testVersion ? { testVersion } : {}),
  };
  const own = Array.isArray(item.deployCommits) ? item.deployCommits.filter(Boolean) : [];
  if (own.length) {
    return { kind: "already-on-train", commits: own, adopted: false, fields: base };
  }
  if (carrying && carrying.sha && carrying.itemId && carrying.itemId === item.id) {
    return {
      kind: "already-on-train", commits: [carrying.sha], adopted: true,
      fields: {
        ...base, deployBranch,
        deployCommit: carrying.sha, deployCommits: [carrying.sha],
        carriedByCommit: null, carriedByItem: null,
        ...(previewUrl ? { previewUrl } : {}),
      },
    };
  }
  if (carrying && carrying.sha) {
    return {
      kind: "carried", sha: carrying.sha, carriedByItem: carrying.itemId || null,
      fields: {
        ...base, deployBranch,
        deployCommit: carrying.sha,
        carriedByCommit: carrying.sha,
        carriedByItem: carrying.itemId || null,
        // A re-patch answers whatever Failed testing said, same as the
        // real-commit path below.
        revertRequested: false,
        revertBlockedBy: [],
        ...(previewUrl ? { previewUrl } : {}),
      },
    };
  }
  return {
    kind: "already-on-main",
    fields: { ...base, noDeploymentRequired: true, deployBranch, ...(mainPreviewUrl ? { previewUrl: mainPreviewUrl } : {}) },
  };
}

// The cards riding on any of `shas` and still on the train — the ones a
// revert of those commits takes the content away from.
function carriedCardsOn(items, shas) {
  const set = new Set((shas || []).filter(Boolean));
  if (!set.size) return [];
  return (items || []).filter((i) => i && i.carriedByCommit && set.has(i.carriedByCommit) && ON_TRAIN_STATUSES.has(i.status));
}

// True for a test link this pipeline generated itself — a githack page or a
// GitHub tree link for this repo — as opposed to a person's own "Set test
// link" choice, which is always kept. Used by the no-diff path to decide
// whether to regenerate a carried card's link pinned to its carrying commit.
function isPipelinePreviewUrl(url) {
  const s = String(url || "");
  return s.startsWith(`https://rawcdn.githack.com/${REPO}/`) || s.startsWith(`https://github.com/${REPO}/tree/`);
}

function remoteBranchExists(branch) {
  try {
    return !!run("git", ["ls-remote", "--heads", "origin", branch]);
  } catch (err) {
    console.log(`[train] couldn't ls-remote ${branch} (${err.message}) — assuming it doesn't exist yet`);
    return false;
  }
}

// Resolves (and, first time, creates and records) the project's integration
// branch. Stored on the project doc so the board, the Routine and this
// script all name the same branch without re-deriving a slug each time —
// a later project rename must NOT silently move the train.
async function ensureDeployBranch(project) {
  const branch = project.deployBranch || deployBranchForName(project.name);
  if (!remoteBranchExists(branch)) {
    console.log(`[train] creating integration branch ${branch} from main`);
    run("git", ["fetch", "origin", "main", "--quiet"]);
    // An earlier item in this same run may have left files on disk; they
    // must not ride along into a brand-new branch.
    try { run("git", ["reset", "--hard", "--quiet"]); } catch { /* nothing staged */ }
    try { run("git", ["clean", "-fdq"]); } catch { /* nothing to clean */ }
    run("git", ["checkout", "-B", branch, "origin/main", "--quiet"]);
    run("git", ["push", "-u", "origin", branch, "--quiet"]);
  }
  if (project.deployBranch !== branch) {
    await patchProject(project.id, { deployBranch: branch, updatedAt: new Date().toISOString() });
  }
  return branch;
}

// A clean checkout of the integration branch exactly as it is on origin.
// Deliberately destructive about the working tree: every caller is about to
// write full-file patchFiles over it, and a leftover file from an earlier
// item in the same run must never ride along into this item's commit.
function checkoutTrain(branch) {
  run("git", ["fetch", "origin", "main", branch, "--quiet"]);
  try { run("git", ["reset", "--hard", "--quiet"]); } catch { /* nothing staged */ }
  try { run("git", ["clean", "-fdq"]); } catch { /* nothing to clean */ }
  run("git", ["checkout", "-B", branch, `origin/${branch}`, "--quiet"]);
}

// ── Keep the train on top of main before a ticket lands ───────────────────
// A ticket is committed onto the branch exactly as it is on origin. When
// main has moved since the branch was last reset — a hotfix merged straight
// to main, another project's train, PRs #271/#272 — and this train has no
// ticket of its own yet, building on the old base is how the 30 Sep 2026
// conflict happened: the Routine (rightly) wrote backlog-tracker/MCP.md
// against main, this script committed that whole file onto a branch four
// commits behind it, and at Deploy time `git merge origin/main` found both
// sides changing the same hunks and stopped the train with "conflict"
// (ticket Hdt4M6dEGe7uN8dmS8mT). So, before any patch is applied:
//   - a train with nothing of its own is fast-forwarded to main — there is
//     nothing to lose and no merge to get wrong;
//   - a train carrying tickets gets main merged in first, with the same
//     derived-file resolvers the Deploy step uses — a real conflict is then
//     surfaced NOW, on this card and on the project, instead of after
//     everyone has approved.
// Idempotent: a train already on top of main is left exactly as it is.
// `baseTip` is the branch tip BEFORE the sync — what the Routine most
// likely read its files from; rebasePatchFilesOnto needs it.
function syncTrainWithMain(deployBranch) {
  checkoutTrain(deployBranch);
  const baseTip = run("git", ["rev-parse", `origin/${deployBranch}`]);
  const behind = Number(run("git", ["rev-list", "--count", `origin/${deployBranch}..origin/main`])) || 0;
  if (!behind) return { kind: "current", behind: 0, baseTip };
  const ahead = Number(run("git", ["rev-list", "--count", `origin/main..origin/${deployBranch}`])) || 0;
  if (!ahead) {
    run("git", ["reset", "--hard", "origin/main", "--quiet"]);
    pushTrain(deployBranch);
    return { kind: "fast-forwarded", behind, baseTip };
  }
  try {
    run("git", ["-c", "user.name=backlog-automation", "-c", "user.email=backlog-automation@users.noreply.github.com",
      "merge", "origin/main", "--no-edit", "--quiet"]);
  } catch (err) {
    const conflicted = conflictedPaths();
    let resolution = tryAutoResolveFaqIndexConflict(conflicted);
    if (!resolution.resolved && !conflicted.includes("faq/data/index.json")) {
      resolution = tryAutoResolveGeneratedOutputConflict(conflicted);
    }
    if (!resolution.resolved) {
      try { run("git", ["merge", "--abort"]); } catch { /* nothing in progress */ }
      discardWorkingTree();
      return { kind: "conflict", behind, baseTip, paths: conflicted, detail: resolution.detail, error: scrubSecrets(err.message) };
    }
    run("git", ["-c", "user.name=backlog-automation", "-c", "user.email=backlog-automation@users.noreply.github.com",
      "commit", "--no-edit", "--quiet"]);
  }
  pushTrain(deployBranch);
  return { kind: "merged", behind, baseTip };
}

// A Routine hands back whole files. If the branch moved under them (see
// syncTrainWithMain), writing those files as given would silently put back
// whatever main had changed since the Routine read them. So each patched
// file is re-based with a three-way merge — base: the file as the branch
// had it before the sync (what the Routine most likely read); ours: the
// file on the synced branch; theirs: the Routine's version — which carries
// the Routine's edits onto the current content and keeps main's changes.
// Identical hunks on both sides (a Routine that already wrote against main,
// as the 30 Sep 2026 one did) merge cleanly. A file that is new, that the
// sync did not change, or that no longer exists is used exactly as given.
function rebasePatchFilesOnto(patchFiles, baseRef) {
  const files = [];
  const rebased = [];
  const conflicts = [];
  const show = (ref, p) => {
    try { return execFileSync("git", ["show", `${ref}:${p}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
    catch { return null; }
  };
  for (const f of patchFiles || []) {
    if (!f || typeof f.path !== "string" || typeof f.content !== "string") { files.push(f); continue; }
    const abs = path.join(process.cwd(), f.path);
    const base = show(baseRef, f.path);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    if (base === null || current === null || base === current || current === f.content) { files.push(f); continue; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "train-rebase-"));
    const [oursPath, basePath, theirsPath] = ["ours", "base", "theirs"].map((n) => path.join(dir, n));
    fs.writeFileSync(oursPath, current);
    fs.writeFileSync(basePath, base);
    fs.writeFileSync(theirsPath, f.content);
    try {
      const merged = execFileSync("git", ["merge-file", "-p", "-L", "current branch", "-L", "before sync", "-L", "this patch", oursPath, basePath, theirsPath],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      files.push({ ...f, content: merged });
      rebased.push(f.path);
    } catch (err) {
      // git merge-file exits with the number of conflicts (1..127); anything
      // else is a real error.
      if (typeof err.status === "number" && err.status > 0 && err.status < 128) { conflicts.push(f.path); files.push(f); }
      else throw err;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return { files, rebased, conflicts };
}

// One push helper for every train write. The run's own GITHUB_TOKEN can
// never push a file under .github/workflows/ (see WORKFLOW_PUSH_TOKEN
// above), so a push that fails falls back to the App token when one is
// configured rather than failing the item outright — the guardrails that
// decide whether a workflow change may be pushed at all still run before
// we get here, in processApplyPatch.
function pushTrain(branch) {
  try {
    run("git", ["push", "origin", branch, "--quiet"]);
    return;
  } catch (err) {
    if (!WORKFLOW_PUSH_TOKEN) throw err;
    console.log(`[train] plain push of ${branch} failed (${scrubSecrets(err.message)}) — retrying with the workflow-push App token`);
    pushWithWorkflowToken(branch);
  }
}

function headSha() {
  return run("git", ["rev-parse", "HEAD"]);
}

// The commit message every ticket's own commit on the train carries. The
// `Backlog item: <id>` line is the same marker PR bodies have always
// carried, so exact-id lookups keep working — now against `git log --grep`
// as well as a PR body search.
function trainCommitMessage(item) {
  const subject = String(item.patchCommitMessage || item.title || item.desc || item.id).split("\n")[0].slice(0, 120);
  return `${subject}\n\nBacklog item: ${item.id}`;
}

function commitOnTrain(message) {
  run("git", ["-c", "user.name=backlog-automation", "-c", "user.email=backlog-automation@users.noreply.github.com",
    "commit", "-m", message, "--quiet"]);
  return headSha();
}

function stagedChangedPaths() {
  try {
    const out = run("git", ["diff", "--cached", "--name-only"]);
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

// The backlog items whose work is still LIVE on the commits in `range`.
// Used to name the later tickets sitting on top of a ticket being reverted
// off the train (§2.3) — the ones that make the revert conflict and that a
// human has to decide about.
//
// Reverting doesn't rewrite history: a ticket taken off the train leaves
// both its original commit and the revert of it in the log, so a naive scan
// would keep naming an already-removed ticket as blocking the next one.
// Each `Revert "..."` commit names the sha it undoes ("This reverts commit
// <sha>"), so those shas are struck out before the ids are collected — a
// ticket counts as live only while it has at least one un-reverted commit.
function itemIdsInRange(range) {
  let out = "";
  try { out = run("git", ["log", "--format=%H%x1f%B%x1e", range]); } catch { return []; }
  const commits = [];
  const revertedShas = new Set();
  for (const record of String(out).split("\x1e")) {
    const [sha, body] = record.replace(/^\s+/, "").split("\x1f");
    if (!sha) continue;
    for (const m of String(body || "").matchAll(/This reverts commit ([0-9a-f]{7,40})/g)) revertedShas.add(m[1]);
    commits.push({ sha, body: String(body || "") });
  }
  const live = new Set();
  for (const c of commits) {
    if (revertedShas.has(c.sha)) continue;
    // A revert commit's own body carries no `Backlog item:` line, so it
    // contributes nothing here beyond the strike-out above.
    for (const m of c.body.matchAll(/Backlog item:\s*([A-Za-z0-9_-]+)/g)) live.add(m[1]);
  }
  return [...live];
}

// APP_VERSION as it stands on a given git ref (rather than readAppVersion()'s
// "whatever is on disk right now"). The train's single version bump is
// computed from `main`, so a train that has been open across several
// deployments can't drift: it always lands exactly one patch ahead of what
// is actually live.
function readAppVersionFromRef(ref) {
  try {
    const content = run("git", ["show", `${ref}:backlog-tracker/public/js/version.js`]);
    const match = content.match(/APP_VERSION\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch (err) {
    console.log(`[train] couldn't read APP_VERSION from ${ref} (${err.message})`);
    return null;
  }
}

function bumpPatchVersion(version) {
  const parts = String(version).split(".");
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
}

// A link to the integration branch itself, for a ticket whose change has no
// directly viewable .html page (a Cloud Function, a script) — the same role
// the PR URL played as guessPreviewUrl's fallback before the train existed,
// except a train ticket has no PR of its own until the deploy PR opens.
function trainTreeUrl(branch) {
  return `https://github.com/${REPO}/tree/${branch}`;
}

// A `claude/revert-<slug>-<id6>` branch name for processRevertPr's own
// post-live revert PR — the one place this pipeline still cuts a branch of
// its own, since undoing something already merged to main is not train work.
// Kept as its own function rather than a parameter on a shared helper: this
// branch name
// only ever needs to be item-scoped-and-distinguishable-from-the-original,
// not configurable, and a shared helper with an optional prefix would make
// every existing call site re-readable for a case that only this one needs.
function sanitizeRevertBranchName(name, itemId) {
  const slug = String(name || "revert")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "revert";
  return `claude/revert-${slug}-${itemId.slice(0, 6).toLowerCase()}`;
}

// The backlog-tracker APP_VERSION a Ready for Testing item gets stamped
// with (see the item's own testVersion field, set in processApplyPatch) —
// read straight off disk *after* applyPatchFiles has run, i.e. the version
// on the integration branch the ticket is actually testable at.
//
// patchFiles no longer carry a version bump of their own: every PR bumping
// APP_VERSION on the same line is precisely what made any two open PRs
// conflict on that file alone. The train bumps it once, at deploy time, in
// processDeployTrain (see readAppVersionFromRef, which reads main's value
// rather than disk).
function readAppVersion() {
  try {
    const content = fs.readFileSync(path.join(process.cwd(), "backlog-tracker/public/js/version.js"), "utf8");
    const match = content.match(/APP_VERSION\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch (err) {
    console.log(`[apply-patch] couldn't read APP_VERSION off disk (${err.message}) — leaving testVersion unset`);
    return null;
  }
}

// Where a project's files live in this repo: the folder its deploy branch is
// named after (deploy/dsp-integration -> dsp-integration/), or an explicit
// projects/{id}.repoFolder. null when the project has no folder of its own
// (the backlog tracker's train is deploy/backlog-tracker-faqs and its files
// are under backlog-tracker/ and faq/ — no single folder, no normalising).
function projectFolderOf(project, exists = (p) => fs.existsSync(path.join(process.cwd(), p)) && fs.statSync(path.join(process.cwd(), p)).isDirectory()) {
  return resolveRepoFolder(project, exists);
}

// A Routine session that worked inside a project's folder can hand over
// patchFiles whose paths are relative to that folder, not the repo root —
// "apps/admin/src/App.tsx" for dsp-integration/apps/admin/src/App.tsx. On
// 22 Sep 2026 seven tickets (PR #185) shipped that way: the automation
// wrote them as NEW files at the repo root, overwrote the root README.md
// with the project's, and the real files never changed — so the cards said
// "Deployed / Main Branch (Live)" while nothing was live, and the rebuild
// workflow (which watches dsp-integration/) never fired.
//
// Rewrites such paths under the project's folder. Two grades of evidence:
//   - unambiguous on its own: the path does not exist at the root but does
//     under the folder (a modified file), or it is a new file whose
//     directory exists only under the folder;
//   - once any path in the patch is unambiguous, the whole patch shares the
//     same frame of reference, so the rest moves too — a path that exists
//     in BOTH places (README.md), a new file, a new directory — except a
//     path whose first segment is a real root entry with no counterpart
//     under the folder (menu-board-demo/…, backlog-tracker/…, CLAUDE.md),
//     which can only have meant the root.
// Anything already under the folder, or under .github/, is left alone.
// Returns the rewritten list and what moved, for the card's note.
function normalisePatchPaths(patchFiles, folder, exists = (p) => fs.existsSync(path.join(process.cwd(), p))) {
  const files = (patchFiles || []).map((f) => (f && typeof f === "object" ? { ...f } : f));
  const moved = [];
  if (!folder) return { files, moved };
  const under = (p) => `${folder}/${p}`;
  const dirOf = (p) => { const d = path.posix.dirname(p); return d === "." ? "" : d; };
  const eligible = (f) => f && typeof f.path === "string" && !f.path.includes("..") && !f.path.startsWith(`${folder}/`) && !f.path.startsWith(".github/");
  const unambiguous = (p) => {
    if (!exists(p) && exists(under(p))) return true;
    const d = dirOf(p);
    return !exists(p) && d !== "" && !exists(d) && exists(under(d));
  };
  const firm = new Set(files.filter(eligible).filter((f) => unambiguous(f.path)).map((f) => f.path));
  for (const f of files) {
    if (!eligible(f)) continue;
    let move = firm.has(f.path);
    if (!move && firm.size) {
      const seg = f.path.split("/")[0];
      move = !(exists(seg) && !exists(under(seg)));
    }
    if (!move) continue;
    moved.push({ from: f.path, to: under(f.path) });
    f.path = under(f.path);
  }
  return { files, moved };
}

// A project with no resolvable folder (projectFolderOf() returned null —
// no repoFolder set, or it's set to something that doesn't exist in this
// repo) has nowhere to place a patch written relative to that folder:
// normalisePatchPaths is a no-op without a candidate folder to test paths
// against, so such a patch would land literally where it says, which is
// exactly how PR #185 (22 Sep 2026) wrote seven tickets' files to the repo
// root. This is the signal that guards against a repeat: without a folder
// to compare against, the strongest available evidence a patch is written
// relative to SOME folder rather than the repo root is that none of its
// paths' top-level segments are real entries at the root at all — a
// genuinely root-relative patch almost always touches at least one
// (backlog-tracker/, faq/, menu-board-demo/, a root file, or .github/).
function patchFilesLookFolderRelative(patchFiles, exists = (p) => fs.existsSync(path.join(process.cwd(), p))) {
  const real = (patchFiles || []).filter((f) => f && typeof f.path === "string" && !f.path.includes(".."));
  if (!real.length) return false;
  return !real.some((f) => f.path.startsWith(WORKFLOW_PATH_PREFIX) || exists(f.path.split("/")[0]));
}

function applyPatchFiles(patchFiles) {
  for (const f of patchFiles || []) {
    if (!f || typeof f.path !== "string" || f.path.includes("..")) {
      throw new Error(`Refusing unsafe patchFiles entry: ${JSON.stringify(f)}`);
    }
    const abs = path.join(process.cwd(), f.path);
    if (f.content === null || f.content === undefined) {
      if (fs.existsSync(abs)) fs.rmSync(abs);
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.content);
    }
  }
}

// GitHub will not let this job push a change to its own workflows. The push
// is made with the run's own GITHUB_TOKEN (see the workflow's
// `permissions:` block and actions/checkout's persisted credential), and
// GitHub refuses any push from an App credential that creates or updates a
// file under .github/workflows/ — there is no `workflows` permission
// available to a GITHUB_TOKEN to grant, so this is not a configuration
// mistake that can be fixed from here.
//
// Before this check, such an item failed the only way it could: `git push`
// threw deep inside processApplyPatch, main()'s per-item catch logged it,
// the step still exited 0, and the item kept patchReady:true — so the board
// showed a greyed, locked "In development" card retrying every two minutes,
// for hours, with nothing on the card to say why. Two real items sat like
// that (e30o8m7yeEU3aE5sOPxF, VSeC6QxmYa9UYctFiRSn, 2026-09-12/13).
//
// Refusing the whole item rather than pushing the other files: a patch is
// one change, and half of one is worse than none. The item that prompted
// this added a Cloud Function declaring a new secret in the same breath as
// the workflow step that creates it — shipping only the function would have
// broken every subsequent deploy.
const WORKFLOW_PATH_PREFIX = ".github/workflows/";

function workflowPathsIn(patchFiles) {
  return (patchFiles || [])
    .map((f) => (f && typeof f.path === "string" ? f.path : ""))
    .filter((p) => p.startsWith(WORKFLOW_PATH_PREFIX));
}

// Build outputs that are checked into the repo, and the workflow that
// regenerates each one on a runner.
//
// dsp-integration/prototype/ is a built bundle of the admin UI — what the
// board's githack test links and GitHub Pages actually serve. A ticket's
// patch changes the SOURCE (apps/admin/src/...), which changes nothing a
// tester can see until the bundle is rebuilt, and this script can't do
// that: patchFiles come through Firestore (1 MiB per document) and the
// bundle is ~2 MB. On 21–22 Sep 2026 three tickets in a row failed testing
// on a link that still served the previous build, and two trains reached
// "Deployed / Main Branch (Live)" with the live site unchanged. So every
// push this script makes that touches a build's source dispatches its
// workflow for that branch (an explicit dispatch, exempt from the
// GITHUB_TOKEN no-recursion rule, exactly like deploy-backlog-tracker.yml),
// and a merge conflict confined to a build's OUTPUTS is resolved by taking
// either side — they are derived files, and the workflow regenerates them
// from the merged source.
const GENERATED_BUILDS = [
  {
    workflow: "dsp-prototype.yml",
    sources: ["dsp-integration/apps/", "dsp-integration/packages/", "dsp-integration/package.json", "dsp-integration/package-lock.json"],
    outputs: ["dsp-integration/prototype/", "dsp-integration/apps/admin/public/demo/"],
  },
];

// HOSTED_DEPLOYS: a service deployed by its own workflow whose `on: push`
// paths never fire for a merge this script makes (GITHUB_TOKEN's
// no-recursion rule — the same reason deploy-backlog-tracker.yml is
// dispatched explicitly in finishTrain). Found the hard way on 28 Sep 2026:
// eleven API commits merged by the train between 26 and 28 Sep never
// reached the hosted DSP API, so the GitHub Pages client was two days ahead
// of the server it talks to — saves were rejected, and when the API was
// finally deployed by hand a migration ran against live data. `sources`
// mirrors the workflow's own `on.push.paths`.
const HOSTED_DEPLOYS = [
  {
    workflow: "dsp-api-deploy.yml",
    sources: [
      "dsp-integration/apps/api/", "dsp-integration/apps/dsp-mocks/", "dsp-integration/packages/", "dsp-integration/deploy/firebase/",
      "dsp-integration/package-lock.json", ".github/workflows/dsp-api-deploy.yml",
    ],
  },
];

const underAny = (p, prefixes) => prefixes.some((s) => (s.endsWith("/") ? p.startsWith(s) : p === s));

// The hosted services a merge of these paths leaves stale.
function deployWorkflowsFor(paths) {
  const changed = (paths || []).filter(Boolean);
  return HOSTED_DEPLOYS.filter((d) => changed.some((p) => underAny(p, d.sources))).map((d) => d.workflow);
}

// Dispatches each stale service's deploy workflow on main. Never throws: a
// failed dispatch is logged, and the note on the card says the service
// still needs deploying by hand. Returns the workflows dispatched.
function dispatchHostedDeploys(paths, label) {
  const dispatched = [];
  for (const workflow of deployWorkflowsFor(paths)) {
    try {
      run("gh", ["workflow", "run", workflow, "--repo", REPO, "--ref", "main"]);
      console.log(`[${label}] triggered ${workflow} — the merge touched what it deploys`);
      dispatched.push(workflow);
    } catch (err) {
      console.log(`[${label}] failed to trigger ${workflow} (${scrubSecrets(err.message)}) — the merge still succeeded, but that service is stale until the workflow is run by hand (Actions → Run workflow on main)`);
    }
  }
  return dispatched;
}

function isGeneratedOutput(p) {
  return GENERATED_BUILDS.some((b) => underAny(p, b.outputs));
}

// The workflows whose build is stale once these paths change: a source
// path that is not itself an output (the bundle's own snapshot lives under
// apps/, so outputs are checked first).
function rebuildWorkflowsFor(paths) {
  const changed = (paths || []).filter((p) => p && !isGeneratedOutput(p));
  return GENERATED_BUILDS.filter((b) => changed.some((p) => underAny(p, b.sources))).map((b) => b.workflow);
}

// Dispatches each stale build's workflow for `branch`. Never throws: a
// failed dispatch is logged and the workflow's own schedule catches up.
// Returns the workflows dispatched, so the caller's note can say so.
function dispatchRebuilds(branch, paths, label) {
  const dispatched = [];
  for (const workflow of rebuildWorkflowsFor(paths)) {
    try {
      run("gh", ["workflow", "run", workflow, "--repo", REPO, "--ref", "main", "-f", `branch=${branch}`]);
      console.log(`[${label}] triggered ${workflow} to rebuild ${branch}`);
      dispatched.push(workflow);
    } catch (err) {
      console.log(`[${label}] failed to trigger ${workflow} for ${branch} (${scrubSecrets(err.message)}) — its schedule will rebuild within the next few minutes`);
    }
  }
  return dispatched;
}

// ── Train tests on every train push, not only at Deploy to Main ─────────────
// A train PR's required check used to run for the first time when Deploy to
// Main opened the PR — after every ticket on the train had been tested and
// approved. On 3 Oct 2026 (PR #301) a ticket gave auth-gate.js an import
// the sign-in test harness didn't expect; all 15 scenarios failed, and it
// surfaced only as a refused deploy. On 6 Oct 2026 (PR #330) the same thing
// happened to the DSP train: ticket zhHpMXphZs0r0CK3mn8X named a DSP outside
// dsp/, e2e-quick's architecture test failed, and nine approved tickets sat
// behind a "conflict" train for a failure nobody had been shown — the fix
// below had only ever been wired for backlog-tracker/.
//
// A workflow-file change can't fix that: a push made with this run's
// GITHUB_TOKEN never triggers another workflow's `push` event (GitHub's own
// loop guard), and a train carrying a workflow change is left for a person
// to merge. workflow_dispatch IS allowed from GITHUB_TOKEN and each test
// workflow accepts it — so this script starts the run itself against the
// train branch whenever a ticket lands there, and reportTrainTestResults()
// notes a failure on the train's cards while they are still in Ready for
// Testing. One entry per project folder whose train has a required check.
const TRAIN_TEST_WORKFLOWS = [
  { workflow: "firestore-rules-test.yml", prefix: "backlog-tracker/", label: "console tests" },
  { workflow: "e2e-quick.yml", prefix: "dsp-integration/", label: "DSP tests (e2e-quick)" },
];
const CONSOLE_TEST_WORKFLOW = TRAIN_TEST_WORKFLOWS[0].workflow;

// The test workflows a change to these paths needs run. Generated build
// output alone (a prototype rebuild) starts nothing: its source already did.
function trainTestsFor(paths) {
  const changed = (paths || []).filter((p) => typeof p === "string" && !isGeneratedOutput(p));
  return TRAIN_TEST_WORKFLOWS.filter((t) => changed.some((p) => p.startsWith(t.prefix)));
}
const touchesConsoleTests = (paths) => trainTestsFor(paths).some((t) => t.workflow === CONSOLE_TEST_WORKFLOW);

// Starts each needed test workflow on `branch`. Never throws. Returns the
// entries started, so the caller's note can say so.
function dispatchTrainTests(branch, paths, label) {
  const started = [];
  for (const t of trainTestsFor(paths)) {
    try {
      run("gh", ["workflow", "run", t.workflow, "--repo", REPO, "--ref", branch]);
      console.log(`[${label}] started ${t.workflow} on ${branch}`);
      started.push(t);
    } catch (err) {
      console.log(`[${label}] couldn't start ${t.workflow} on ${branch} (${scrubSecrets(err.message)}) — the train PR still runs it at Deploy to Main`);
    }
  }
  return started;
}

// Which of a train's Ready for Testing cards to tell about a failed run.
// Pure, for test/train-tests.test.js.
//   testRun: newest run on the branch, { headSha, status, conclusion, url } or null
//   head:    the commit that run has to have tested to still count — the
//            branch's head, or (see testedHeadOf) the last commit before a
//            prototype rebuild that changed only generated output
//   cards:   the train's Ready for Testing cards ({ id, testsFailedShas })
// Only a completed, failed run on that commit counts (an older head's
// failure may already be fixed), and each card is told once per head and
// workflow.
function trainTestFailureTargets(testRun, head, cards, workflow = CONSOLE_TEST_WORKFLOW) {
  if (!testRun || !head || testRun.headSha !== head) return [];
  if (String(testRun.status).toLowerCase() !== "completed") return [];
  if (!["failure", "timed_out", "startup_failure"].includes(String(testRun.conclusion).toLowerCase())) return [];
  const key = `${workflow}@${head}`;
  return (cards || []).filter((c) => !(c.testsFailedShas || []).includes(key) && !(workflow === CONSOLE_TEST_WORKFLOW && c.testsFailedSha === head));
}

// The DSP train's head is usually a "Rebuild the hosted prototype" commit
// that dsp-prototype.yml pushed on top of the ticket (with GITHUB_TOKEN, so
// it starts no tests of its own). A run on the ticket's commit still speaks
// for that head when everything since it is generated build output. Pure:
// `changedSince` is the file list between the run's commit and the head
// (null when GitHub says the run's commit isn't behind the head at all).
function testedHeadOf(runSha, head, changedSince) {
  if (!runSha || runSha === head) return head;
  if (!Array.isArray(changedSince) || !changedSince.length) return head;
  return changedSince.every((p) => isGeneratedOutput(p)) ? runSha : head;
}

// What projects/{id}.trainTestsRed should become after reading one test
// workflow's newest run. Pure, for test/train-tests.test.js. The field is a
// map keyed by workflow (a project can be red on two at once), each entry
// { sha, url, at }. Returns the new map, or undefined for "no change": a
// failed run on the tested commit sets the entry, a passed one clears it,
// and anything still running (or on a stale commit) leaves it as it was.
function nextTrainTestsRed(current, workflow, testRun, tested, nowIso) {
  const key = workflow.replace(/\.ya?ml$/, "");
  const cur = current && typeof current === "object" ? current : {};
  if (!testRun || !tested || testRun.headSha !== tested) return undefined;
  if (String(testRun.status).toLowerCase() !== "completed") return undefined;
  const conclusion = String(testRun.conclusion).toLowerCase();
  if (["failure", "timed_out", "startup_failure"].includes(conclusion)) {
    if (cur[key] && cur[key].sha === tested) return undefined;
    return { ...cur, [key]: { sha: tested, url: testRun.url || "", at: nowIso } };
  }
  if (conclusion === "success" && cur[key]) {
    const next = { ...cur };
    delete next[key];
    return next;
  }
  return undefined;
}

// Every card on a train, tested or already approved, hears about a red run:
// on 7 Oct 2026 (PR #335) four DSP tickets were approved within minutes of
// landing, before e2e-quick had finished, so a reporter that only read Ready
// for Testing found nobody to tell and Deploy to Main went ahead on a train
// that had been red for 45 minutes. The project also carries the result
// (trainTestsRed), which is what hides Deploy to Main on the board and makes
// approve_deploy_to_main refuse until the train is green again.
// The newest run that actually ran (or is running). GitHub HOLDS a run on a
// bot-pushed PR head as `action_required` — a prototype rebuild commit gets
// one every time — and a held run tested nothing: it is neither a pass nor
// a failure. Taking it as "the newest run" left trainTestsRed set over a
// green train (7 Oct 2026, PR #337), which would have hidden Deploy to Main
// for good. Pure, for test/train-tests.test.js; runs are newest first.
function newestRealRun(runs) {
  return (runs || []).find((r) => r && String(r.conclusion || "").toLowerCase() !== "action_required"
    && !["waiting", "requested", "pending"].includes(String(r.status || "").toLowerCase())) || null;
}

// ── Deploy to Main waits for the train's own tests ─────────────────────────
// PR #337 (7 Oct 2026): the last ticket landed at 21:44, the train was
// approved and Deploy to Main clicked while its e2e-quick run was still
// going, the run went red at 21:51, and the deploy opened a PR that parked
// red two minutes later. trainTestsRed (above) can only stop a click once a
// run has FAILED; this gate makes the deploy itself refuse to open a PR
// until the train's required checks have PASSED on the commit it ships, and
// hold — not give up — when they haven't, so a fix pushed to the train
// carries the approved deploy through with nobody clicking again.
//
// Pure, for test/train-tests.test.js. `checks`: one entry per required
// workflow, { workflow, label, run: newest run or null, speaksForHead }
// where speaksForHead says that run tested the head being shipped (itself,
// or the commit before a prototype rebuild — testedHeadOf). Returns
// { state: "green" | "pending" | "missing" | "red", workflows: [...] } —
// the worst state wins, red over missing over pending.
function trainTestGate(checks) {
  const rank = { green: 0, pending: 1, missing: 2, red: 3 };
  let state = "green";
  const workflows = [];
  for (const c of checks || []) {
    const r = c.run;
    let st;
    if (!r || !c.speaksForHead) st = "missing";
    else if (String(r.status).toLowerCase() !== "completed") st = "pending";
    else {
      const concl = String(r.conclusion).toLowerCase();
      if (concl === "success") st = "green";
      else if (["failure", "timed_out", "startup_failure"].includes(concl)) st = "red";
      else st = "missing"; // cancelled, skipped, stale: nothing tested this head
    }
    if (st !== "green") workflows.push({ workflow: c.workflow, label: c.label, state: st, url: (r && r.url) || "", sha: (r && r.headSha) || "" });
    if (rank[st] > rank[state]) state = st;
  }
  return { state, workflows };
}

// Reads the gate for a train that checkoutTrain() has fetched. Never throws:
// anything it can't read counts as "missing", and missing tests are started.
function readTrainTestGate(deployBranch) {
  let paths = [];
  try {
    run("git", ["fetch", "origin", "main", "--quiet"]);
    paths = run("git", ["diff", "--name-only", `origin/main...origin/${deployBranch}`]).split("\n").filter(Boolean);
  } catch (err) {
    console.log(`[deploy-train] couldn't diff ${deployBranch} against main (${scrubSecrets(err.message)}) — gating on every train test`);
    paths = TRAIN_TEST_WORKFLOWS.map((t) => `${t.prefix}x`);
  }
  const head = run("git", ["rev-parse", `origin/${deployBranch}`]).trim();
  const checks = trainTestsFor(paths).map((t) => {
    let testRun = null;
    let speaksForHead = false;
    try {
      testRun = newestRealRun(JSON.parse(run("gh", ["run", "list", "--repo", REPO, "--workflow", t.workflow, "--branch", deployBranch,
        "--limit", "10", "--json", "headSha,status,conclusion,url"]) || "[]"));
      if (testRun && testRun.headSha === head) speaksForHead = true;
      else if (testRun && testRun.headSha) {
        let ancestor = false;
        try { run("git", ["merge-base", "--is-ancestor", testRun.headSha, head]); ancestor = true; } catch { /* not behind the head */ }
        const since = ancestor ? run("git", ["diff", "--name-only", testRun.headSha, head]).split("\n").filter(Boolean) : null;
        speaksForHead = testedHeadOf(testRun.headSha, head, since) === testRun.headSha;
      }
    } catch (err) {
      console.log(`[deploy-train] couldn't read ${t.workflow} on ${deployBranch} (${scrubSecrets(err.message)})`);
    }
    return { workflow: t.workflow, label: t.label, run: testRun, speaksForHead };
  });
  return { head, ...trainTestGate(checks) };
}

// ── Auto-eject the ticket that turned the train red ─────────────────────────
// Each ticket's train tests run on its own commit (e2e-quick's per-commit
// dispatch group), so a red train names its culprit: the first ticket whose
// own run failed while everything before it on the train passed. On 8 Oct
// 2026 such a ticket (booking schedule plays-per-day) held five approved
// tickets for an hour until someone noticed. If the culprit is still in
// Ready for Testing — nobody has approved it — this does exactly what a
// person's "Failed testing" click does (back to Backlog + revertRequested,
// so processRevertFromTrain takes its commits off the branch and the train
// is green again) and rebuilds it once with the failing run on its notes.
// An approved culprit is never ejected: that is a person's call, and the
// deploy gate already holds the train for it.
//
// Pure, for test/train-tests.test.js.
//   order: the train's commits, oldest first
//   cards: the train's cards ({ id, status, deployCommit })
//   runs:  { [sha]: newest real run on that commit ({ status, conclusion }) }
// Returns the card to eject, or null (nothing red yet, the culprit is
// approved, or the evidence is incomplete — a run still going or missing).
function pickRedCulprit(order, cards, runs) {
  const at = new Map((order || []).map((sha, i) => [sha, i]));
  const onTrain = (cards || []).filter((c) => c && at.has(c.deployCommit)).sort((a, b) => at.get(a.deployCommit) - at.get(b.deployCommit));
  for (const card of onTrain) {
    const r = (runs || {})[card.deployCommit];
    if (!r || String(r.status).toLowerCase() !== "completed") return null;
    const concl = String(r.conclusion).toLowerCase();
    if (concl === "success") continue;
    if (!["failure", "timed_out"].includes(concl)) return null; // cancelled etc.: no verdict on this ticket
    return card.status === "ready-for-testing" ? card : null;
  }
  return null;
}

async function ejectRedCulprits() {
  const cards = await runQuery({
    from: [{ collectionId: "backlogItems" }],
    select: { fields: ["projectId", "title", "status", "deployBranch", "deployCommit", "autoRebuilds", "notes", "revertRequested"].map((fieldPath) => ({ fieldPath })) },
    where: { fieldFilter: { field: { fieldPath: "status" }, op: "IN", value: { arrayValue: { values: [{ stringValue: "ready-for-testing" }, { stringValue: "ready-to-publish" }] } } } },
  });
  const byBranch = new Map();
  for (const c of cards) {
    if (!c.deployBranch || !c.deployCommit || c.revertRequested) continue;
    if (!byBranch.has(c.deployBranch)) byBranch.set(c.deployBranch, []);
    byBranch.get(c.deployBranch).push(c);
  }
  for (const [branch, trainCards] of byBranch) {
    try {
      const order = JSON.parse(run("gh", ["api", `repos/${REPO}/compare/main...${encodeURIComponent(branch)}`, "-q", "[.commits[].sha]"]) || "[]");
      for (const t of TRAIN_TEST_WORKFLOWS) {
        const runs = {};
        for (const c of trainCards) {
          const list = JSON.parse(run("gh", ["api", `repos/${REPO}/actions/workflows/${t.workflow}/runs?head_sha=${c.deployCommit}&per_page=10`,
            "-q", "[.workflow_runs[] | {headSha: .head_sha, status, conclusion, url: .html_url}]"]) || "[]");
          const real = newestRealRun(list);
          if (real) runs[c.deployCommit] = real;
        }
        const culprit = pickRedCulprit(order, trainCards, runs);
        if (!culprit) continue;
        const r = runs[culprit.deployCommit];
        const project = await getProject(culprit.projectId).catch(() => null);
        const autoRebuild = !!project && (Number(culprit.autoRebuilds) || 0) < 1;
        const text = `${t.label} (${t.workflow}) failed on this ticket's own commit ${culprit.deployCommit.slice(0, 7)} while everything before it on ${branch} passed: ${r.url || ""}`;
        const notes = await appendNote(culprit,
          `Sent back automatically (Failed testing [tests]): ${text}. Its commits are being reverted off the train so the tickets around it can still ship. ` +
          (autoRebuild ? `A rebuild was started with this failure on its notes — the build must make that check pass before handing the patch back.` : `It was already rebuilt once automatically; a person needs to look at it.`));
        await patchItem(culprit.id, {
          status: "backlog",
          revertRequested: true,
          lastFailureReason: { category: "tests", text, action: "failed-testing", at: new Date() },
          notes,
          updatedAt: new Date().toISOString(),
          // The rebuild must start from the train WITHOUT this ticket's
          // commits, so it is queued by processRevertFromTrain once they are
          // off the branch, not here.
          ...(autoRebuild ? { autoRebuilds: (Number(culprit.autoRebuilds) || 0) + 1, rebuildAfterRevert: true } : {}),
        });
        console.log(`[train-eject] ${branch}: ${culprit.id} turned ${t.workflow} red at ${culprit.deployCommit.slice(0, 7)} — sent back to Backlog and off the train${autoRebuild ? ", rebuild follows the revert" : ""}`);
        break; // one ejection per branch per run; the next run re-reads the train after the revert
      }
    } catch (err) {
      console.log(`[train-eject] ${branch}: couldn't check for a red culprit (${scrubSecrets(err.message)})`);
    }
  }
}

async function reportTrainTestResults() {
  const cards = await runQuery({
    from: [{ collectionId: "backlogItems" }],
    select: { fields: ["projectId", "deployBranch", "deployCommit", "testsFailedSha", "testsFailedShas", "notes"].map((fieldPath) => ({ fieldPath })) },
    where: { fieldFilter: { field: { fieldPath: "status" }, op: "IN", value: { arrayValue: { values: [{ stringValue: "ready-for-testing" }, { stringValue: "ready-to-publish" }] } } } },
  });
  const byBranch = new Map();
  for (const c of cards) {
    if (!c.deployBranch || !c.deployCommit) continue;
    if (!byBranch.has(c.deployBranch)) byBranch.set(c.deployBranch, []);
    byBranch.get(c.deployBranch).push(c);
  }
  for (const [branch, trainCards] of byBranch) {
    let head;
    try {
      head = run("gh", ["api", `repos/${REPO}/branches/${encodeURIComponent(branch)}`, "-q", ".commit.sha"]);
    } catch (err) {
      console.log(`[train-tests] ${branch}: couldn't read the branch head (${scrubSecrets(err.message)})`);
      continue;
    }
    const projectId = (trainCards.find((c) => c.projectId) || {}).projectId || null;
    let project = null;
    if (projectId) {
      try { project = await getProject(projectId); }
      catch (err) { console.log(`[train-tests] ${branch}: couldn't read project ${projectId} (${scrubSecrets(err.message)})`); }
    }
    let red = project ? (project.trainTestsRed || {}) : null;
    let redChanged = false;
    for (const t of TRAIN_TEST_WORKFLOWS) {
      try {
        const testRun = newestRealRun(JSON.parse(run("gh", ["run", "list", "--repo", REPO, "--workflow", t.workflow, "--branch", branch,
          "--limit", "10", "--json", "headSha,status,conclusion,url"]) || "[]"));
        if (!testRun) continue;
        let changedSince = null;
        if (testRun.headSha && testRun.headSha !== head) {
          const cmp = JSON.parse(run("gh", ["api", `repos/${REPO}/compare/${testRun.headSha}...${head}`,
            "-q", "{status: .status, files: [.files[].filename]}"]) || "{}");
          if (cmp.status === "ahead") changedSince = cmp.files || [];
        }
        const tested = testedHeadOf(testRun.headSha, head, changedSince);
        if (red) {
          const next = nextTrainTestsRed(red, t.workflow, testRun, tested, new Date().toISOString());
          if (next !== undefined) { red = next; redChanged = true; }
        }
        const targets = trainTestFailureTargets(testRun, tested, trainCards, t.workflow);
        for (const card of targets) {
          const notes = await appendNote(card,
            `The ${t.label} (${t.workflow}) FAILED on this train at ${tested.slice(0, 7)}: ${testRun.url} — ` +
            `the same check Deploy to Main waits on, so Deploy to Main is withheld until it is green. ` +
            `If this ticket caused it, use Failed testing; otherwise look at the other tickets on ${branch}.`);
          card.notes = notes;
          const testsFailedShas = (card.testsFailedShas || []).concat([`${t.workflow}@${tested}`]).slice(-20);
          card.testsFailedShas = testsFailedShas;
          await patchItem(card.id, { notes, testsFailedShas, updatedAt: new Date().toISOString() });
        }
        if (targets.length) console.log(`[train-tests] ${branch}: ${t.workflow} red on ${tested.slice(0, 7)} — noted on ${targets.length} card(s)`);
      } catch (err) {
        console.log(`[train-tests] ${branch}: couldn't read the ${t.workflow} result (${scrubSecrets(err.message)})`);
      }
    }
    if (project && redChanged) {
      await patchProject(project.id, { trainTestsRed: Object.keys(red).length ? red : null, updatedAt: new Date().toISOString() });
      console.log(`[train-tests] ${branch}: trainTestsRed is now ${Object.keys(red).join(", ") || "clear"}`);
    }
  }
}

// What a rebuild means for whoever reads the card next: the link exists,
// but for a few minutes it still shows the build from before this commit.
// When the rebuild lands, dsp-prototype.yml re-points the card's test link
// at that commit (githack caches a branch URL; a commit URL is immutable),
// so the tester's cue is the link itself changing from a branch to a sha.
function rebuildNote(dispatched, sha) {
  if (!dispatched.length) return "";
  return ` The test link serves a built bundle, which is being rebuilt from ${sha.slice(0, 7)} now (${dispatched.join(", ")}). Allow a few minutes: when the rebuild lands, this card's test link is switched to that build's own commit URL and a note here says so. Until then the link still shows the previous build — don't fail testing on it.`;
}

function changedPathsBetween(fromRef, toRef) {
  try {
    const out = run("git", ["diff", "--name-only", fromRef, toRef]);
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

function prFilePaths(prNumber) {
  try {
    const parsed = JSON.parse(run("gh", ["pr", "view", String(prNumber), "--repo", REPO, "--json", "files"]));
    return (parsed.files || []).map((f) => f.path).filter(Boolean);
  } catch (err) {
    console.log(`[deploy-train] couldn't list PR #${prNumber}'s files (${err.message}) — assuming nothing to rebuild`);
    return [];
  }
}

// Mid-merge resolver for a conflict that touches nothing but generated
// build output (see GENERATED_BUILDS). Both sides are a build of source the
// merge is about to combine, so neither is "right"; the branch's own copy
// is kept only so the merge leaves a consistent bundle behind, and the
// build's workflow replaces it from the merged source. Anything else in
// the conflict, and this declines — same contract as
// tryAutoResolveFaqIndexConflict.
//
// "The branch's copy" is HEAD's tree, never the index's stage 2. On 25 Sep
// 2026 both sides had rebuilt the DSP prototype under different hashed
// names, git reported the bundle as a rename/rename conflict, and for that
// shape git writes a two-way content merge WITH conflict markers into both
// renamed paths — and records that marker-laden blob as stages 2 and 3. So
// `git checkout --ours` "succeeded" and kept the markers, `git add` staged
// them, the merge (f361e65, shipped as PR #216) committed a bundle that
// threw `Unexpected token '==='` on load, and the hosted prototype was a
// blank page from 09:37 until a forced rebuild at 21:34. HEAD:<path> is the
// train's real file for anything the train has; anything it doesn't (the
// other side's rename target, the pre-rename path) is dropped; nothing is
// called resolved while any output file still carries a marker; and the
// kept build's stamp is spoiled so the next scheduled run rebuilds from
// the merged source rather than trusting a bundle built before the merge.
function tryAutoResolveGeneratedOutputConflict(conflicted) {
  if (!conflicted.length || !conflicted.every(isGeneratedOutput)) {
    return { resolved: false, detail: `conflicted on ${conflicted.join(", ") || "(unknown files)"}` };
  }
  for (const p of conflicted) {
    let inHead = true;
    try { run("git", ["cat-file", "-e", `HEAD:${p}`]); } catch { inHead = false; }
    try {
      if (inHead) {
        run("git", ["checkout", "HEAD", "--", p]);
        run("git", ["add", "--", p]);
      } else {
        // The other side's hashed asset, or the path both sides renamed
        // away from: not part of the branch's build, so it goes.
        run("git", ["rm", "--quiet", "--force", "--", p]);
      }
    } catch (err) {
      return { resolved: false, detail: `conflicted on ${conflicted.join(", ")} — generated build output, but keeping the branch's copy of ${p} failed (${err.message})` };
    }
  }
  const remaining = conflictedPaths();
  if (remaining.length) {
    return { resolved: false, detail: `conflicted on ${remaining.join(", ")} even after keeping the branch's copy of ${conflicted.join(", ")}` };
  }
  const marked = generatedOutputsWithConflictMarkers();
  if (marked.length) {
    return { resolved: false, detail: `conflicted on ${conflicted.join(", ")} — generated build output, but conflict markers are still inside ${marked.join(", ")} after keeping the branch's copy; leaving the merge for a person rather than committing a broken bundle` };
  }
  invalidateBuildStamps();
  return {
    resolved: true,
    detail: `conflicted only on generated build output (${conflicted.join(", ")}) — kept the branch's copy, which its rebuild workflow regenerates from the merged source, and the merge completed`,
  };
}

// Tracked files under a generated build's outputs that still carry a merge
// marker: 7 characters for an ordinary conflict, 8 for the rename/rename
// shape. `git grep` exits 1 when nothing matches, which run() turns into a
// throw — that is the "none" answer.
function generatedOutputsWithConflictMarkers() {
  const prefixes = GENERATED_BUILDS.flatMap((b) => b.outputs).filter((dir) => fs.existsSync(path.join(process.cwd(), dir)));
  if (!prefixes.length) return [];
  let out = "";
  try { out = run("git", ["grep", "-l", "-E", "^(<{7,8}|={7,8}|>{7,8})( |$)", "--", ...prefixes]); } catch { return []; }
  return out ? out.split("\n").filter(Boolean) : [];
}

// Rewrites each kept build's build-info.json stamp so its rebuild script
// sees the output as stale (rebuild-prototype.sh compares the recorded
// stamp with a hash of the source tree). Without this, a merge that brought
// no source change of its own left a stamp that still matched, and the
// scheduled rebuild did nothing for twelve hours on 25 Sep 2026.
function invalidateBuildStamps() {
  for (const b of GENERATED_BUILDS) {
    for (const dir of b.outputs) {
      const rel = path.posix.join(dir, "build-info.json");
      const file = path.join(process.cwd(), rel);
      if (!fs.existsSync(file)) continue;
      try {
        const info = JSON.parse(fs.readFileSync(file, "utf8"));
        info.sourceStamp = `rebuild-after-merge:${headSha().slice(0, 7)}`;
        fs.writeFileSync(file, JSON.stringify(info, null, 2) + "\n");
        run("git", ["add", "--", rel]);
      } catch (err) {
        console.log(`[deploy-train] couldn't spoil ${rel}'s build stamp (${err.message}) — the build may not be rebuilt until its source next changes`);
      }
    }
  }
}

// Optional escape hatch for the restriction above: backlog-automation.yml
// mints a short-lived GitHub App installation token (Contents + Workflows
// write, installed on this one repository only — see backlog-tracker/
// README.md → "The workflow-push GitHub App") and passes it in as
// WORKFLOW_PUSH_TOKEN. When it is present, an item whose patchFiles touch
// .github/workflows/ is pushed with THAT token instead of being refused.
//
// A workflow file runs with every repo secret, and patchFiles come from
// the Notify Claude Routine, which builds them from card text anyone on
// the editor list can write — a prompt-injection surface. So the token is
// used for nothing but the branch push of such an item, and only after
// workflowChangeProblems() has checked that the change can't run itself:
// no new workflow files, no deletions, and each touched workflow's `on:`
// trigger block identical (ignoring comments/blank lines) to main's.
// Every workflow in this repo fires only on main, a schedule, or an
// explicit dispatch, so a branch push — which, unlike a GITHUB_TOKEN push,
// DOES trigger `on: push` workflows — can never execute the pushed file.
// The merge is then a human's job (processMergePr refuses it), so nothing
// under .github/workflows/ reaches main without a person reading the diff.
const WORKFLOW_PUSH_TOKEN = (process.env.WORKFLOW_PUSH_TOKEN || "").trim();

function triggerBlock(yamlText) {
  const lines = String(yamlText).split("\n");
  const out = [];
  let inOn = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, "").replace(/\r$/, "");
    if (/^on:/.test(line)) { inOn = true; out.push(line.trim()); continue; }
    if (inOn && /^[A-Za-z_][\w-]*:/.test(line)) break; // next top-level key
    if (inOn && line.trim() && !line.trim().startsWith("#")) out.push(line.trimEnd());
  }
  return out.join("\n");
}

function workflowChangeProblems(patchFiles) {
  const problems = [];
  for (const f of patchFiles || []) {
    if (!f || typeof f.path !== "string" || !f.path.startsWith(WORKFLOW_PATH_PREFIX)) continue;
    let onMain = null;
    try { onMain = run("git", ["show", `origin/main:${f.path}`]); } catch { onMain = null; }
    if (onMain === null) { problems.push(`${f.path}: new workflow files can't be added by the pipeline`); continue; }
    if (f.content === null || f.content === undefined) { problems.push(`${f.path}: workflow files can't be deleted by the pipeline`); continue; }
    if (triggerBlock(onMain) !== triggerBlock(f.content)) problems.push(`${f.path}: its \`on:\` trigger block differs from main's`);
  }
  return problems;
}

// Pushes with the App token via git's own config environment rather than
// a token-bearing URL or -c argument: execFileSync puts the full argument
// list in its error message, and those messages end up on the card
// (recordAttemptFailure), so the token must never be an argument.
//
// `force` is opt-in and used only for a branch this script owns outright (a
// per-item revert branch). The integration branch is shared history that
// other tickets' commits live on, so its pushes are never forced.
function pushWithWorkflowToken(branch, { force = false } = {}) {
  const basic = Buffer.from(`x-access-token:${WORKFLOW_PUSH_TOKEN}`).toString("base64");
  run("git", ["push", "-u", "origin", branch, ...(force ? ["--force"] : []), "--quiet"], {
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_1: `AUTHORIZATION: basic ${basic}`,
    },
  });
}

function scrubSecrets(text) {
  let out = String(text);
  if (WORKFLOW_PUSH_TOKEN) out = out.split(WORKFLOW_PUSH_TOKEN).join("***");
  return out;
}

// How many consecutive failed attempts an item gets before this job stops
// retrying it and hands it back to a human. Transient failures (a network
// blip, a GitHub 5xx, a runner hiccup) genuinely do succeed on the next
// tick, so retrying is right; retrying *forever* is what turned a permanent
// failure into an invisible one.
const MAX_PATCH_ATTEMPTS = 5;

// Records a failed attempt on the item itself. The note is written on the
// first failure (so the reason is visible immediately, not after 5 more
// minutes) and again on the attempt that gives up; in between it just
// counts, so a flaky run can't bury the card under a note per tick.
// Generalized over every flag-driven step: the patch-apply path
// (attemptsField: "patchAttempts", readyField: "patchReady", the default),
// the legacy merge path ("mergeAttempts"/"mergeReady"), the post-live
// revert ("revertAttempts"/"revertReady") and the train revert
// ("trainRevertAttempts"/"revertRequested", the one that never clears its
// flag — see clearReadyOnGiveUp) — same shape of bug every way:
// a transient failure (a network blip, a GitHub 5xx) genuinely does
// succeed on a later run, but retrying it forever with nothing recorded on
// the card is how a permanent failure hides for hours with no visible
// reason. The merge path used to just console.error a failed `gh pr merge`
// and leave the card at Approved for Deployment showing "Waiting for
// Notify Claude — Deploy" forever (yLzaj00wwFI5qxjOGbRe) — this gives it
// the exact same note-then-give-up treatment the patch path already had.
async function recordAttemptFailure(item, err, { attemptsField = "patchAttempts", readyField = "patchReady", verb = "open a PR for", clearReadyOnGiveUp = true } = {}) {
  const attempts = (Number(item[attemptsField]) || 0) + 1;
  const reason = scrubSecrets(err instanceof Error ? (err.message || String(err)) : String(err));
  const giveUp = attempts >= MAX_PATCH_ATTEMPTS;
  const fields = { [attemptsField]: attempts, updatedAt: new Date().toISOString() };

  // Noted on the first failure (so the reason is visible immediately) and
  // again on the attempt that gives up — `=== MAX`, not `>= MAX`, because a
  // flag that is deliberately never cleared (see clearReadyOnGiveUp) would
  // otherwise add a near-identical note on every tick forever.
  if (attempts === 1 || attempts === MAX_PATCH_ATTEMPTS) {
    const text = giveUp
      ? (clearReadyOnGiveUp
          ? `Gave up after ${attempts} failed attempts to ${verb} this item. ${readyField} has been cleared so the job stops retrying; the work packaged on the card is untouched. Last error:\n\n${reason}`
          : `${attempts} failed attempts to ${verb} this item. ${readyField} is deliberately LEFT SET — clearing it would silently accept a state the pipeline treats as unsafe — so the job keeps retrying quietly, without adding another note. A human needs to look. Last error:\n\n${reason}`)
      : `Attempt ${attempts} to ${verb} this item failed; it will be retried on the next run (up to ${MAX_PATCH_ATTEMPTS}). Error:\n\n${reason}`;
    fields.notes = await appendNote(item, text);
  }
  if (giveUp && clearReadyOnGiveUp) fields[readyField] = false;

  await patchItem(item.id, fields);
  console.error(`[${readyField}] ${item.id}: attempt ${attempts}/${MAX_PATCH_ATTEMPTS} failed${giveUp ? (clearReadyOnGiveUp ? ` — giving up, ${readyField} cleared` : ` — still retrying, ${readyField} left set`) : ""}: ${reason}`);
}

// Builds a rawcdn.githack.com preview link for the ref (a commit sha, or a
// branch name for the odd caller that has no commit to pin to yet) a PR was
// just opened from, so a Ready for Testing card is testable the moment it
// arrives instead of sitting with no way to look at it until someone sets
// previewUrl by hand (AfOWSFNfos2BZRpDeph1). BOTH githack hosts cache a
// BRANCH URL indefinitely, confirmed twice: 22 Sep 2026 on the DSP project
// (index.html refreshed within minutes, but the fixed-path
// `demo/api-snapshot.json` behind it kept serving a day-old capture across
// several pushes) and again 25 Sep 2026 on this very project (mIHraVz8fQXRe
// 549UYD1 — commit 7b09a4b changed faq/css/faq.css and the branch URL was
// STILL serving the pre-change file 20 minutes later, while the commit-sha
// URL for the same file was correct immediately). A tester following a
// stale branch link sees no change and fails a correct ticket — the cause
// of three false "Failed testing" rounds on the DSP project alone. There is
// no page plain enough to be exempt from this: **every previewUrl this
// pipeline generates is pinned to a commit sha, never a branch name** — see
// processApplyPatch, which passes this item's own just-made commit, and
// repointTrainPreviewUrls, which keeps every other in-flight card on the
// same train pointed at the branch's current head as later tickets land on
// it. The DSP project's own rebuild-then-relink step
// (dsp-integration/scripts/board-tickets.mjs --relink-prototype) is one
// instance of this same rule for its checked-in build bundle, not a special
// case of it.
//
// "Most relevant changed page" is necessarily a guess — there's no
// metadata saying which patched file is the one to look at — so this picks
// the shortest surviving .html path (a page nearer a project's own root is
// more likely to be the thing that changed, and it's at least a stable,
// deterministic choice) and excludes anything under functions/, which is
// never directly viewable as a page. Falls back to the PR URL itself for
// anything that can't be githack'd directly (no .html touched at all —
// e.g. a Cloud Function-only change), same fallback the card's own manual
// "Set test link" flow already documents — on the train that fallback is a
// link to the integration branch itself (trainTreeUrl), since there is no
// single commit to pin a no-page change to and the branch is at least never
// wrong about which commits it contains, only slow to reflect them.
//
// A ticket with NO front-end change gets no link at all — guessPreviewUrl
// returns null and the card shows no "Test this" CTA (there is nothing
// visual to click into). Front-end means a page or its assets (isFrontEndPath):
// back-end code, scripts, tests, docs, FAQ content data and workflows are not.
// fallbackUrl is kept only for call-site compatibility and is ignored.
const FRONT_END_EXT = /\.(html?|css|scss|js|mjs|jsx|ts|tsx|vue|svg|png|jpe?g|gif|webp|ico|woff2?)$/i;
const NON_FRONT_END_DIR = /(^|\/)(functions|scripts|test|tests|__tests__|docs|\.github|node_modules|data)\//;
function isFrontEndPath(p) {
  return FRONT_END_EXT.test(p) && !NON_FRONT_END_DIR.test(p) && !/\.(test|spec)\.[a-z]+$/i.test(p);
}

function guessPreviewUrl(patchFiles, ref, fallbackUrl) { // eslint-disable-line no-unused-vars
  const changed = (patchFiles || [])
    .filter((f) => f && typeof f.path === "string" && f.content !== null && f.content !== undefined)
    .map((f) => f.path)
    .filter(isFrontEndPath);

  // A changed page is the best answer: it IS the thing to look at.
  const htmlPaths = changed.filter((p) => p.endsWith(".html"));
  if (htmlPaths.length) {
    const page = htmlPaths.sort((a, b) => a.length - b.length)[0];
    return `https://rawcdn.githack.com/${REPO}/${ref}/${page}`;
  }

  // No page changed, but a stylesheet or script did — so there IS a page
  // that renders the change, it just isn't in patchFiles. Find the page
  // those assets belong to: the nearest index.html above them.
  //
  // Without this, a CSS-only ticket got the bare fallback below — a GitHub
  // source listing, which cannot show the change at all. That is not
  // hypothetical: the first ticket to go through the train
  // (iaX9egVd8k8gFOd27LCn, "Triple the PH Agent Console logo") touched only
  // styles.css, so its "Test this ->" button opened a directory of files and
  // there was no way to see whether the logo was actually bigger.
  const pages = changed.map(nearestPageFor).filter(Boolean);
  if (pages.length) {
    const page = pages.sort((a, b) => a.length - b.length)[0];
    return `https://rawcdn.githack.com/${REPO}/${ref}/${page}`;
  }

  return null;
}

// Walks up from a changed file looking for the index.html that renders it,
// reading the branch as it is actually checked out (this runs after
// applyPatchFiles, on the integration branch). Deliberately stops before the
// repository root: a change under scripts/ or functions/ has no page, and
// the repo-root index.html — an unrelated static site — would be a
// confidently wrong answer rather than an honest "no preview".
function nearestPageFor(filePath) {
  let dir = path.dirname(filePath);
  while (dir && dir !== "." && dir !== path.sep) {
    const candidate = `${dir}/index.html`;
    if (fs.existsSync(path.join(process.cwd(), candidate)) && !isBundlerTemplate(candidate)) return candidate;
    // A bundler's own index.html is not a page, but the build it produces
    // usually sits beside the source it was built from.
    for (const built of [`${dir}/prototype/index.html`, `${dir}/dist/index.html`]) {
      if (fs.existsSync(path.join(process.cwd(), built))) return built;
    }
    dir = path.dirname(dir);
  }
  return null;
}

// An index.html that loads a source module — Vite's `<script type="module"
// src="/src/main.tsx">` and friends — is a build input, not something a
// static host can serve: opened from githack it is a blank page with a 404
// in the console. Before this check, a ticket touching
// dsp-integration/apps/admin/src/… got exactly that as its "Test this ->"
// link (xvb2ZtHQoMvdrtKIL3hN, 22 Sep), because apps/admin/index.html is the
// nearest index.html above the change and it exists. The built bundle two
// directories up was the real answer.
function isBundlerTemplate(candidate) {
  try {
    const html = fs.readFileSync(path.join(process.cwd(), candidate), "utf8");
    return /<script[^>]+src=["'](\.?\/)?src\//i.test(html);
  } catch {
    return false; // unreadable: treat it as an ordinary page, as before
  }
}

// The two shapes guessPreviewUrl ever produces. Distinguishing "this
// pipeline generated it" from "a human typed a custom link into Set test
// link" is what lets a re-patch safely refresh its own stale commit-pinned
// link (mIHraVz8fQXRe549UYD1) without ever overwriting a deliberate human
// choice — the same distinction the old `/${deployBranch}/`-substring check
// used to make, before every link here was pinned to a branch and that
// check could no longer tell the two apart.
const GITHACK_PREFIX = `https://rawcdn.githack.com/${REPO}/`;
const TRAIN_TREE_PREFIX = `https://github.com/${REPO}/tree/`;
function isAutoGeneratedPreviewUrl(url) {
  return typeof url === "string" && (url.startsWith(GITHACK_PREFIX) || url.startsWith(TRAIN_TREE_PREFIX));
}

// Swaps the ref (branch name or commit sha) out of a previewUrl this
// pipeline generated, keeping whatever page path followed it. Used to keep
// every OTHER in-flight card on a train honest about the branch's current
// head each time a new ticket's commit lands — see repointTrainPreviewUrls.
function repointPreviewUrlRef(url, newRef) {
  if (url.startsWith(GITHACK_PREFIX)) {
    const rest = url.slice(GITHACK_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash === -1) return url; // no page path to keep — leave it alone
    return `${GITHACK_PREFIX}${newRef}${rest.slice(slash)}`;
  }
  if (url.startsWith(TRAIN_TREE_PREFIX)) return `${TRAIN_TREE_PREFIX}${newRef}`;
  return url;
}

// A commit-pinned previewUrl is honest about the state it was generated
// from, but the whole point of a train is that every card tests the
// combination it will actually ship in — so the moment another ticket's
// commit lands on `deployBranch`, every OTHER Ready for Testing card
// already on that same train needs its own link moved to the new head too,
// or it quietly stops showing what it claims to (mIHraVz8fQXRe549UYD1).
// Never throws: a card whose link couldn't be re-pointed just keeps
// showing an earlier-but-still-correct commit until the next ticket lands.
async function repointTrainPreviewUrls(projectId, deployBranch, newSha, excludeItemId) {
  let siblings;
  try {
    siblings = await itemsForProject(projectId);
  } catch (err) {
    console.log(`[apply-patch] couldn't list sibling items to re-point preview links (${err.message}) — their links stay as they were until their own next commit`);
    return;
  }
  const stale = siblings.filter((i) =>
    i.id !== excludeItemId &&
    i.status === "ready-for-testing" &&
    i.deployBranch === deployBranch &&
    isAutoGeneratedPreviewUrl(i.previewUrl)
  );
  for (const sib of stale) {
    const repointed = repointPreviewUrlRef(sib.previewUrl, newSha);
    if (repointed === sib.previewUrl) continue;
    try {
      await patchItem(sib.id, { previewUrl: repointed, updatedAt: new Date().toISOString() });
      console.log(`[apply-patch] re-pointed ${sib.id}'s preview link to ${newSha.slice(0, 7)} (another ticket landed on ${deployBranch})`);
    } catch (err) {
      console.log(`[apply-patch] couldn't re-point ${sib.id}'s preview link to ${newSha.slice(0, 7)} (${err.message})`);
    }
  }
}

// Finds a PR by exact head branch, in ANY state. Reconciliation-specific:
// "does this branch already have a PR, left over from an earlier run of
// this same job that didn't finish?" Used for a project's integration
// branch (processDeployTrain reusing an already-open train PR rather than
// opening a second one) and for a post-live revert branch.
//
// It replaced a body-text search for the item's own `Backlog item: <id>`
// marker across every open PR, which existed to stop a half-finished item
// opening a duplicate PR (#61, closed as a duplicate of #62). That whole
// class of bug is gone with per-ticket PRs: a re-patch is just another
// commit on the train, and the marker now lives in commit messages, where
// `git log --grep` finds it without api.github.com.
function findPrForBranch(branch) {
  let json;
  try {
    json = run("gh", ["pr", "list", "--repo", REPO, "--head", branch, "--state", "all", "--json", "number,state,url"]);
  } catch (err) {
    console.log(`[apply-patch] couldn't check for an existing PR on branch ${branch} (${err.message}) — proceeding without this reconciliation check`);
    return null;
  }
  const prs = JSON.parse(json);
  return prs.length ? prs[0] : null;
}

function viewPr(prNumber) {
  try {
    const json = run("gh", ["pr", "view", String(prNumber), "--repo", REPO, "--json", "number,state,url,headRefName"]);
    return JSON.parse(json);
  } catch (err) {
    console.log(`[apply-patch] couldn't read PR #${prNumber} (${err.message})`);
    return null;
  }
}

// Restores a clean checkout of main after patchFiles were written on some
// other branch and are not going to be committed there.
function discardWorkingTree() {
  try { run("git", ["reset", "--hard", "--quiet"]); } catch { /* nothing staged */ }
  try { run("git", ["clean", "-fdq"]); } catch { /* nothing to clean */ }
  run("git", ["checkout", "main", "--quiet"]);
}

// The paths `git merge` left with unresolved conflict markers, mid-merge.
function conflictedPaths() {
  const out = run("git", ["diff", "--name-only", "--diff-filter=U"]);
  return out ? out.split("\n").filter(Boolean) : [];
}

// Auto-resolving a faq/data/index.json merge conflict.
//
// The hourly "FAQ content" export (faq-export.js) commits straight to main
// any time an article is edited in the console, and index.json aggregates
// every article's metadata into one file — so merging main into a train
// that has *also* touched any FAQ article (its own patchFiles, or an
// earlier export commit already on the branch) conflicts on index.json
// even when the two sides touched completely different articles, the
// moment either side's edit lands on a line the other side's `generatedAt`
// stamp or article ordering also touched. See ROUTINE_INSTRUCTIONS.md and
// faq/README.md for the incident this fixes (main commit a2d7740 against
// this project's own train, 17 Sep 2026).
//
// index.json is fully derivable from faq/data/articles/*.json plus the
// categories list (see faq-index-lib.js) — so when index.json is the ONLY
// conflicted path, there is nothing to actually merge by hand: git will
// already have merged every non-conflicting article file cleanly into the
// working tree (a merge only leaves conflict markers in the files that
// actually collided), so rebuilding index.json from what's already on disk
// after the attempted merge reconstructs exactly what the merge "should"
// have produced, with no risk of silently dropping either side's article
// edits. If anything OTHER than index.json also conflicted, this declines
// to guess and leaves the merge for a human, same as before.
//
// Returns { resolved, detail } — `detail` is always set (whether resolved
// or not) so the caller can report which file(s) conflicted and whether
// this resolver handled it, per the ticket that added this function.
function tryAutoResolveFaqIndexConflict(conflicted) {
  if (conflicted.length !== 1 || conflicted[0] !== "faq/data/index.json") {
    return { resolved: false, detail: `conflicted on ${conflicted.join(", ") || "(unknown files)"}` };
  }
  const indexPath = path.join(process.cwd(), "faq/data/index.json");
  const articlesDir = path.join(process.cwd(), "faq/data/articles");
  let ours, theirs;
  try {
    ours = JSON.parse(run("git", ["show", ":2:faq/data/index.json"]));
    theirs = JSON.parse(run("git", ["show", ":3:faq/data/index.json"]));
  } catch (err) {
    return { resolved: false, detail: `conflicted on faq/data/index.json, and the automatic resolver couldn't read both sides to rebuild it (${err.message})` };
  }
  // The categories list rarely changes and isn't derivable from the article
  // files alone — take it from whichever side's export ran more recently,
  // and keep generatedAt as the later of the two, per the ticket.
  const newerIsTheirs = new Date(theirs.generatedAt) > new Date(ours.generatedAt);
  const categories = newerIsTheirs ? theirs.categories : ours.categories;
  const generatedAt = newerIsTheirs ? theirs.generatedAt : ours.generatedAt;
  let rebuilt;
  try {
    rebuilt = buildIndexFromArticleFiles(articlesDir, categories, generatedAt);
    validateIndexAgainstArticleFiles(rebuilt, articlesDir);
  } catch (err) {
    return { resolved: false, detail: `conflicted on faq/data/index.json — tried the automatic resolver, but rebuilding it from faq/data/articles/*.json failed validation (${err.message})` };
  }
  fs.writeFileSync(indexPath, serializeIndex(rebuilt));
  run("git", ["add", "faq/data/index.json"]);
  if (conflictedPaths().length) {
    // Shouldn't happen given the length-1 check above, but never commit a
    // merge that still has other unresolved paths.
    return { resolved: false, detail: "conflicted on faq/data/index.json and other path(s) that appeared after resolving it — leaving the merge for a human" };
  }
  return {
    resolved: true,
    detail: `conflicted on faq/data/index.json only — the automatic resolver rebuilt it from faq/data/articles/*.json (${rebuilt.articles.length} articles) and the categories list from the ${newerIsTheirs ? "incoming main" : "branch's own"} export, and the merge completed`,
  };
}

async function processApplyPatch(item) {
  console.log(`[apply-patch] ${item.id}: ${item.title || item.desc}`);
  item = { ...item, patchFiles: await patchFilesFor(item) };
  if (!Array.isArray(item.patchFiles) || item.patchFiles.length === 0) {
    console.log(`[apply-patch] ${item.id}: no patchFiles present, leaving patchReady set for a human to check`);
    return;
  }

  // ph-ticket-intake, enforced before the train: a board ticket may enter
  // Ready for Dev with only its Outcome written, but its build session must
  // fill in Test steps, Dependencies and Spec reference before it hands the
  // patch over (ROUTINE_INSTRUCTIONS.md → "Complete the intake sections
  // first"). A patch whose ticket still carries a placeholder doesn't land.
  if (hasIntakePlaceholder(item.desc)) {
    console.log(`[apply-patch] ${item.id}: refusing — the description still has an intake section to complete`);
    const project = await getProject(item.projectId).catch(() => null);
    const autoRebuild = !!project && (Number(item.autoRebuilds) || 0) < 1 && !project.trainLocked;
    const notes = await appendNote(item,
      `Not built: this ticket's description still has an unfilled intake section (Test steps, Dependencies or Spec reference). ` +
      `The build session has to complete them from the code and the spec in the same PATCH as its patch (ROUTINE_INSTRUCTIONS.md → "Complete the intake sections first"). ` +
      (autoRebuild ? `A rebuild was started automatically.` : `Fill them in (or click Ready for Dev again) to rebuild.`));
    await patchItem(item.id, {
      patchReady: false, patchAttempts: 0, updatedAt: new Date().toISOString(), notes,
      ...(autoRebuild ? { autoRebuilds: (Number(item.autoRebuilds) || 0) + 1 } : {}),
    });
    if (autoRebuild) queueBuildRequest(project, item.id);
    return;
  }

  // Checked before any git work: this can never succeed, so there is
  // nothing to gain by getting further in.
  const workflowPaths = workflowPathsIn(item.patchFiles);
  if (workflowPaths.length && !WORKFLOW_PUSH_TOKEN) {
    console.log(`[apply-patch] ${item.id}: refusing — patchFiles touch ${workflowPaths.length} workflow file(s) and no WORKFLOW_PUSH_TOKEN is configured`);
    const notes = await appendNote(
      item,
      `Cannot be delivered by backlog-automation.yml: patchFiles include ${workflowPaths.length} file(s) under ` +
      `${WORKFLOW_PATH_PREFIX} (${workflowPaths.join(", ")}). This job pushes with its run's own ` +
      `GITHUB_TOKEN, and GitHub refuses any push from that credential that creates or updates a workflow ` +
      `file. patchReady has been cleared so the job stops retrying; everything packaged on this card is ` +
      `untouched and still correct.\n\n` +
      `To let the pipeline deliver workflow changes, set up the workflow-push GitHub App (see ` +
      `backlog-tracker/README.md → "The workflow-push GitHub App": two repo secrets, WORKFLOW_APP_ID and ` +
      `WORKFLOW_APP_PRIVATE_KEY) and set patchReady again. Otherwise apply the card's patchFiles on a ` +
      `branch and open the PR with a human credential.`
    );
    await patchItem(item.id, {
      patchReady: false,
      patchAttempts: 0,
      updatedAt: new Date().toISOString(),
      notes,
    });
    return;
  }
  if (workflowPaths.length) {
    run("git", ["fetch", "origin", "main", "--quiet"]);
    const problems = workflowChangeProblems(item.patchFiles);
    if (problems.length) {
      console.log(`[apply-patch] ${item.id}: refusing workflow change — ${problems.join("; ")}`);
      const notes = await appendNote(
        item,
        `Refused to push this workflow change: ${problems.join("; ")}. The pipeline only pushes edits to ` +
        `existing workflow files whose \`on:\` triggers are unchanged, so a pushed branch can never run ` +
        `itself with the repository's secrets. patchReady has been cleared; a change that genuinely needs ` +
        `a new workflow or new triggers has to be pushed by a person.`
      );
      await patchItem(item.id, { patchReady: false, patchAttempts: 0, updatedAt: new Date().toISOString(), notes });
      return;
    }
  }

  const projectId = item.projectId;
  if (!projectId) {
    // Nothing to build onto: the train is a per-project branch, and an item
    // with no projectId belongs to the board's synthesized "General"
    // grouping, which has no Firestore project doc to hang a branch off.
    console.log(`[apply-patch] ${item.id}: no projectId — can't resolve an integration branch`);
    const notes = await appendNote(
      item,
      "This item has no projectId, so there is no project integration branch (deploy/<project-slug>) to build it onto. " +
      "patchReady has been cleared. Move the card into a real project on the board and set patchReady again."
    );
    await patchItem(item.id, { patchReady: false, patchAttempts: 0, updatedAt: new Date().toISOString(), notes });
    return;
  }
  const project = await getProject(projectId);

  // Refuse rather than guess (root CLAUDE.md → "Linking a new project to
  // GitHub", item 3): a project this script cannot place under a real
  // folder gets a comment instead of files quietly written to the repo
  // root. Checked before ensureDeployBranch/checkoutTrain — a refused item
  // gets no branch work at all.
  if (!projectFolderOf(project) && patchFilesLookFolderRelative(item.patchFiles)) {
    console.log(`[apply-patch] ${item.id}: refusing — patchFiles look folder-relative but project ${projectId} has no resolvable repoFolder`);
    const notes = await appendNote(
      item,
      `Refused to apply this patch: none of its patchFiles paths' top-level segments exist at the repo root, ` +
      `which is exactly the shape a patch written relative to a project's own folder has — writing it as given ` +
      `would create new files at the repo root instead of touching the real ones (see PR #185, 22 Sep 2026). ` +
      (project.repoFolder
        ? `This project's repoFolder is set to "${project.repoFolder}", but that folder doesn't exist in this repo ` +
          `— check it for a typo.`
        : `This project has no repoFolder set.`) +
      ` patchReady has been cleared. Set this project's repo folder correctly (its Docs page → "Repo folder", or ` +
      `a direct Firestore write to projects/${projectId}.repoFolder) and set patchReady again — or, if this ` +
      `project genuinely has no single folder, mark that there instead and re-patch with paths already relative ` +
      `to the repo root.`
    );
    await patchItem(item.id, { patchReady: false, patchAttempts: 0, updatedAt: new Date().toISOString(), notes });
    return;
  }

  const deployBranch = await ensureDeployBranch(project);

  // Build on top of current main, never on a stale base (syncTrainWithMain).
  const sync = syncTrainWithMain(deployBranch);
  if (sync.kind === "conflict") {
    console.log(`[apply-patch] ${item.id}: ${deployBranch} is ${sync.behind} commit(s) behind main and merging main ${sync.detail} — leaving the item patch-ready until the train is resolved`);
    // One note per card, not one per two-minute run: the item stays
    // patch-ready and lands by itself once a person has resolved the branch.
    const lastNote = Array.isArray(item.notes) && item.notes.length ? item.notes[item.notes.length - 1] : null;
    if (!(lastNote && lastNote.author === "backlog-automation" && String(lastNote.text || "").startsWith("Not built yet:"))) {
      const notes = await appendNote(
        item,
        `Not built yet: ${deployBranch} is ${sync.behind} commit(s) behind main and merging main into it ${sync.detail}. ` +
        `This item stays patch-ready and lands on the next run once the branch is resolved — merge main into ${deployBranch} by hand, ` +
        `or send back the ticket whose commit conflicts with Failed testing.`
      );
      await patchItem(item.id, { notes, updatedAt: new Date().toISOString() });
    }
    await patchProject(projectId, {
      trainStatus: "conflict",
      trainNote: `${deployBranch} has drifted from main: merging main into it ${sync.detail}, so no new ticket can be built onto it. ` +
        `Resolve it by merging main into ${deployBranch} by hand (or Failed-testing the ticket whose commit conflicts); patch-ready items then land on the next run.\n\n${sync.error}`,
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  if (sync.kind !== "current") {
    console.log(`[apply-patch] ${item.id}: ${deployBranch} was ${sync.behind} commit(s) behind main — ${sync.kind}`);
    // A drift conflict this same step recorded earlier is over now.
    if (project.trainStatus === "conflict" && /has drifted from main/.test(String(project.trainNote || ""))) {
      await patchProject(projectId, { trainStatus: "idle", trainNote: null, updatedAt: new Date().toISOString() });
    }
  }

  // Build onto the head of the integration branch, retrying once if someone
  // else pushed the train between our checkout and our push. checkoutTrain()
  // re-fetches and hard-resets, so the retry genuinely re-applies this
  // item's full-file patchFiles on top of the newer head rather than
  // replaying a stale commit.
  let sha = null;
  let changedPaths = [];
  let testVersion = null;
  let attempt = 0;
  let patchedFiles = item.patchFiles;
  let movedPaths = [];
  let rebasedPaths = [];
  // The commit this patch's files were read from (see "Parallel builds").
  const patchBase = patchBaseFor(item, sync);
  for (;;) {
    checkoutTrain(deployBranch);
    // Paths written relative to the project's folder go under it (see
    // normalisePatchPaths); decided against the train's actual tree.
    ({ files: patchedFiles, moved: movedPaths } = normalisePatchPaths(item.patchFiles, projectFolderOf(project)));
    if (movedPaths.length) console.log(`[apply-patch] ${item.id}: ${movedPaths.length} patch path(s) were relative to ${projectFolderOf(project)}/ — placed under it (${movedPaths.map((m) => m.from).join(", ")})`);
    if (patchBase && patchBase !== headSha()) {
      // The branch moved under this patch — main was merged in, or another
      // ticket (built in parallel) landed first: carry this patch's edits
      // onto the branch as it is now rather than writing its copies over it.
      const rebase = rebasePatchFilesOnto(patchedFiles, patchBase);
      if (rebase.conflicts.length) {
        discardWorkingTree();
        console.log(`[apply-patch] ${item.id}: ${rebase.conflicts.join(", ")} changed on ${deployBranch} since this patch was written and its edits can't be carried over — clearing patchReady`);
        // One automatic rebuild against the current files; a second clash
        // goes to a person rather than looping.
        const autoRebuild = (Number(item.autoRebuilds) || 0) < 1 && !project.trainLocked;
        const notes = await appendNote(
          item,
          `Not built: since this patch was written, ${deployBranch} changed ${rebase.conflicts.join(", ")} in the same places it does ` +
          `(another ticket landed first, or main was merged in), so its edits could not be carried onto the current file automatically. ` +
          (autoRebuild
            ? `A rebuild against the current files was started automatically.`
            : `Click Ready for Dev again so the fix is rebuilt against the current files.`)
        );
        await patchItem(item.id, {
          patchReady: false, patchAttempts: 0, updatedAt: new Date().toISOString(), notes,
          ...(autoRebuild ? { autoRebuilds: (Number(item.autoRebuilds) || 0) + 1 } : {}),
        });
        if (autoRebuild) queueBuildRequest(project, item.id);
        return;
      }
      patchedFiles = rebase.files;
      rebasedPaths = rebase.rebased;
      if (rebasedPaths.length) console.log(`[apply-patch] ${item.id}: carried this patch's edits onto the branch's newer ${rebasedPaths.join(", ")}`);
    }
    applyPatchFiles(patchedFiles);
    // Read while the patched files are still on disk, so testVersion
    // reflects the branch this item will actually be tested on.
    testVersion = readAppVersion();
    run("git", ["add", "-A"]);
    changedPaths = stagedChangedPaths();

    // A migration number another ticket already took (see migrationNumberClashes).
    const clashes = migrationNumberClashes(stagedAddedPaths(),
      (dir) => { try { return fs.readdirSync(path.join(process.cwd(), dir)); } catch { return []; } });
    if (clashes.length) {
      discardWorkingTree();
      const autoRebuild = (Number(item.autoRebuilds) || 0) < 1 && !project.trainLocked;
      const what = clashes.map((c) => `${c.path} (number ${c.number} is already ${c.takenBy.map((t) => t.split("/").pop()).join(", ")})`).join("; ");
      console.log(`[apply-patch] ${item.id}: migration number clash — ${what}`);
      const notes = await appendNote(item,
        `Not built: this patch adds a migration whose number another ticket on ${deployBranch} already uses — ${what}. ` +
        `Built in parallel, both picked the same "next" number, and the migration runner keys on it, so one of the two would never run. ` +
        (autoRebuild
          ? `A rebuild against the current branch (which will pick the next free number) was started automatically.`
          : `Click Ready for Dev again so it is rebuilt with the next free number.`));
      await patchItem(item.id, {
        patchReady: false, patchAttempts: 0, updatedAt: new Date().toISOString(), notes,
        ...(autoRebuild ? { autoRebuilds: (Number(item.autoRebuilds) || 0) + 1 } : {}),
      });
      if (autoRebuild) queueBuildRequest(project, item.id);
      return;
    }

    if (!changedPaths.length) {
      // Same "stuck forever with no record of why" class of bug the old
      // per-ticket path already had to fix: patchFiles that produce no diff
      // used to just log and return, leaving patchReady set to retry every
      // scheduled run forever. On a train there are three genuinely
      // different reasons for no diff, and they need different outcomes —
      // noDiffPatchFields() is the rule, and the "Cards carried by a
      // sibling's commit" comment above it is the bug the middle one fixes:
      // a card whose content a sibling's commit delivered used to be flagged
      // noDeploymentRequired, which let the board mark it Merged to Main
      // before its train had merged.
      run("git", ["checkout", "main", "--quiet"]);
      const carrying = carryingCommitOnTrain(deployBranch, patchedFiles.map((f) => f && f.path));
      // Test link: pinned to the commit the content actually lives in — the
      // carrying commit, or main's head when the content is already there —
      // never a branch name. githack caches a branch URL's fixed-path files
      // (measured 25 Sep 2026: faq.css still served the old base size 20
      // minutes after the train changed it) and a commit URL is immutable.
      // A link this pipeline didn't generate (a person's own "Set test
      // link") is kept as it is.
      const ownLink = item.previewUrl && !isPipelinePreviewUrl(item.previewUrl) ? item.previewUrl : null;
      const pinnedTo = (ref, fallback) => ownLink || guessPreviewUrl(patchedFiles, ref, fallback);
      let mainRef = "main";
      try { mainRef = run("git", ["rev-parse", "origin/main"]); } catch { /* fall back to the branch name */ }
      const outcome = noDiffPatchFields(item, carrying, {
        deployBranch, testVersion,
        previewUrl: carrying && carrying.sha ? pinnedTo(carrying.sha, trainTreeUrl(deployBranch)) : null,
        // Content that is already on main is tested against main.
        mainPreviewUrl: pinnedTo(mainRef, trainTreeUrl("main")),
      });
      let text;
      if (outcome.kind === "already-on-train") {
        text = outcome.adopted
          ? `Re-patched, but the new patchFiles are identical to what is already on ${deployBranch} — and commit ${outcome.commits[0].slice(0, 7)} there carries this card's own \`Backlog item:\` trailer ` +
            `(pushed by hand and never stamped on the card). Adopted it as this card's train commit and moved to Ready for Testing.`
          : `Re-patched, but the new patchFiles are identical to what this item already has on ${deployBranch} — nothing new was committed. ` +
            `Moved back to Ready for Testing against the same train commits (${outcome.commits.join(", ")}).`;
      } else if (outcome.kind === "carried") {
        text = `No commit of its own: patchFiles produced no diff against ${deployBranch} because ${outcome.carriedByItem ? `ticket ${outcome.carriedByItem}'s` : "an earlier"} commit ${outcome.sha.slice(0, 7)} on that branch already carries this change ` +
          `(a shared-file patch in the same batch — see "Group multi-item fixes into one deployment"). ` +
          `This card now rides on that commit: it is on the train like any other ticket, is tested on the same test link, needs the same approval, and goes live only when the train merges to main. ` +
          `It is deliberately NOT flagged "no deployment required" — its code is not on main yet.`;
      } else {
        text = `No commit made: patchFiles produced no diff against ${deployBranch}, and that branch does not change these files either — this content is already on main. ` +
          `Moved to Ready for Testing directly and flagged as needing no deployment of its own, since there is genuinely nothing left to ship.`;
      }
      const notes = await appendNote(item, text);
      await patchItem(item.id, { ...outcome.fields, updatedAt: new Date().toISOString(), notes });
      if (outcome.fields.status === "ready-for-testing") noteReadyForTesting(project, item.id);
      console.log(`[apply-patch] ${item.id}: no diff against ${deployBranch} — ${outcome.kind}` +
        (outcome.kind === "carried" ? ` (rides on ${outcome.sha.slice(0, 7)}${outcome.carriedByItem ? `, ${outcome.carriedByItem}` : ""})` : ""));
      return;
    }

    const commitSha = commitOnTrain(trainCommitMessage(item));
    try {
      pushTrain(deployBranch);
      sha = commitSha;
      break;
    } catch (err) {
      if (attempt >= 1) throw err;
      attempt += 1;
      console.log(`[apply-patch] ${item.id}: push of ${deployBranch} was rejected (${scrubSecrets(err.message)}) — re-applying on the new head and retrying once`);
    }
  }

  // The source is on the train; the bundle a tester opens is not, until its
  // workflow rebuilds it (see GENERATED_BUILDS).
  const rebuilds = dispatchRebuilds(deployBranch, changedPaths, "apply-patch");
  // Run the console tests on the train now, not first at Deploy to Main.
  const testsStarted = dispatchTrainTests(deployBranch, changedPaths, "apply-patch");

  // A train carrying a workflow-file change can't be merged by the pipeline
  // (see processDeployTrain): flag the project so the Deploy step leaves the
  // PR open for a person instead of attempting a merge that would be refused.
  if (workflowPaths.length && !project.needsHumanMerge) {
    await patchProject(projectId, { needsHumanMerge: true, updatedAt: new Date().toISOString() });
  }

  const deployCommits = (Array.isArray(item.deployCommits) ? item.deployCommits.slice() : []).concat([sha]);
  // Pinned to the commit just made, never the branch name — see
  // guessPreviewUrl's own comment for why a branch link goes stale under a
  // tester's nose with no visible error. A genuinely custom previewUrl a
  // human set by hand (anything that isn't one of this pipeline's own
  // auto-generated shapes) is still preserved rather than overwritten.
  const previewUrl = (item.previewUrl && !isAutoGeneratedPreviewUrl(item.previewUrl))
    ? item.previewUrl
    : guessPreviewUrl(patchedFiles, sha, trainTreeUrl(deployBranch));

  const syncNote = (sync.kind === "current" ? "" :
    ` The branch was first brought up to date with main (${sync.kind === "fast-forwarded" ? "fast-forwarded" : "main merged in"}, ${sync.behind} commit(s)).`) +
    (rebasedPaths.length ? ` This patch's edits were merged onto the branch's newer ${rebasedPaths.join(", ")} (changed since the patch was written), so nothing that landed meanwhile was overwritten.` : "");
  const notes = await appendNote(
    item,
    `Committed to the project's integration branch \`${deployBranch}\` as ${sha.slice(0, 7)} (${changedPaths.join(", ")}). ` +
    `It is built on top of every ticket already on that branch, so the test link shows this change in the combination it will ship in. ` +
    `Nothing merges to main until every ticket on the train is approved and someone clicks Deploy to Main.` +
    syncNote +
    (movedPaths.length
      ? ` Note: ${movedPaths.length} of this patch's paths were relative to the project's folder rather than the repo root (${movedPaths.map((m) => m.from).join(", ")}) and were placed under ${projectFolderOf(project)}/ — patchFiles paths must start at the repo root.`
      : "") +
    rebuildNote(rebuilds, sha) +
    (testsStarted.length ? ` The ${testsStarted.map((t) => `${t.label} (${t.workflow})`).join(" and ")} ${testsStarted.length === 1 ? "was" : "were"} started on the train; a failure will be noted here.` : "") +
    (workflowPaths.length
      ? ` This ticket changes ${workflowPaths.join(", ")}, so it was pushed with the workflow-push App token and the train's deploy PR will NOT be merged by the pipeline — a person has to review and merge it on GitHub.`
      : "")
  );

  await patchItem(item.id, {
    status: "ready-for-testing",
    patchReady: false,
    patchAttempts: 0,
    updatedAt: new Date().toISOString(),
    notes,
    deployBranch,
    deployCommit: sha,
    deployCommits,
    // Its own commit now — no longer riding on a sibling's (see
    // carryingCommitOnTrain), if it ever was.
    carriedByCommit: null,
    carriedByItem: null,
    previewUrl,
    // A re-patch answers whatever Failed testing said, so a revert request
    // (and any block it was stuck behind) from that round is spent.
    revertRequested: false,
    revertBlockedBy: [],
    ...(testVersion ? { testVersion } : {}),
    ...(workflowPaths.length ? { requiresHumanMerge: true } : {}),
  });
  console.log(`[apply-patch] ${item.id}: committed ${sha.slice(0, 7)} on ${deployBranch}, moved to ready-for-testing${testVersion ? ` (testVersion ${testVersion})` : ""}`);
  noteReadyForTesting(project, item.id);

  // This item's own card now shows the branch's new head; every OTHER
  // Ready for Testing card already on the same train still shows whatever
  // commit existed when IT was patched, which is exactly the staleness
  // this pipeline's own links are supposed to never have.
  await repointTrainPreviewUrls(projectId, deployBranch, sha, item.id);

  run("git", ["checkout", "main", "--quiet"]);
}

// Failed testing on a Ready for Testing card sends it back to Backlog — and,
// because the card built onto a shared integration branch, its commit would
// otherwise stay on that branch and ship in the next train anyway. The rule
// this enforces: NOTHING LEAVES READY FOR TESTING REJECTED WITHOUT COMING
// OFF THE BRANCH, i.e. a card in Backlog must never have live commits on a
// train. app.js's failTesting() writes revertRequested; this reverts every
// commit the item has on the branch, newest first, and pushes.
//
// Distinct from processRevertPr further down, which undoes something already
// merged to main by opening a revert PR. This one never touches main — it
// only rewinds work that has not shipped yet.
async function processRevertFromTrain(item) {
  console.log(`[train-revert] ${item.id}: ${item.title || item.desc}`);
  const commits = Array.isArray(item.deployCommits) ? item.deployCommits.filter(Boolean) : [];
  const deployBranch = item.deployBranch;
  if (!commits.length && item.carriedByCommit) {
    // A card riding on a sibling's commit (see carryingCommitOnTrain) has
    // nothing of its own on the branch: the commit it points at is the
    // sibling's work, and reverting it here would silently take the
    // sibling's ticket off the train too. Detach this card instead — it is a
    // plain Backlog ticket again — and say what would actually remove the
    // content.
    const who = item.carriedByItem ? `ticket ${item.carriedByItem}'s` : "another ticket's";
    const notes = await appendNote(
      item,
      `Nothing of its own to revert: this card's change rode on \`${deployBranch || "the integration branch"}\` inside ${who} commit ${String(item.carriedByCommit).slice(0, 7)}, ` +
      `which is that ticket's own work and has been left on the branch. This card is a plain Backlog ticket again and no longer counts as on the train. ` +
      `If the change itself must come off the branch, send ${item.carriedByItem ? `ticket ${item.carriedByItem}` : "that ticket"} back with Failed testing too.`
    );
    await patchItem(item.id, {
      revertRequested: false,
      revertBlockedBy: [],
      deployCommit: null,
      carriedByCommit: null,
      carriedByItem: null,
      updatedAt: new Date().toISOString(),
      notes,
    });
    console.log(`[train-revert] ${item.id}: rode on ${String(item.carriedByCommit).slice(0, 7)} — detached, nothing reverted`);
    return;
  }
  if (!deployBranch || !commits.length) {
    console.log(`[train-revert] ${item.id}: nothing on a train to revert — clearing the flag`);
    await patchItem(item.id, {
      revertRequested: false,
      revertBlockedBy: [],
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  if (!remoteBranchExists(deployBranch)) {
    console.log(`[train-revert] ${item.id}: integration branch ${deployBranch} no longer exists — clearing the flag`);
    const notes = await appendNote(item, `Nothing to revert off \`${deployBranch}\`: that integration branch no longer exists (the train it was on has already shipped and been reset). revertRequested has been cleared.`);
    await patchItem(item.id, { revertRequested: false, revertBlockedBy: [], updatedAt: new Date().toISOString(), notes });
    return;
  }

  checkoutTrain(deployBranch);
  const tipBeforeRevert = headSha();

  // Newest first — reverting an older commit before a newer one that builds
  // on it is the guaranteed way to manufacture a conflict.
  const ordered = commits.slice().reverse();
  const reverted = [];
  const revertedOriginals = [];
  for (const sha of ordered) {
    let onBranch = true;
    try { run("git", ["merge-base", "--is-ancestor", sha, "HEAD"]); } catch { onBranch = false; }
    if (!onBranch) {
      console.log(`[train-revert] ${item.id}: ${sha.slice(0, 7)} isn't on ${deployBranch} any more — skipping it`);
      continue;
    }
    const mainline = parentCount(sha) >= 2 ? ["-m", "1"] : [];
    try {
      run("git", ["-c", "user.name=backlog-automation", "-c", "user.email=backlog-automation@users.noreply.github.com",
        "revert", "--no-edit", ...mainline, sha]);
      reverted.push(headSha());
      revertedOriginals.push(sha);
    } catch (err) {
      try { run("git", ["revert", "--abort"]); } catch { /* nothing in progress */ }
      // Whose work sits on top of this commit — that's who a human has to
      // decide about (send them back too, or fix the branch by hand).
      const blockedBy = itemIdsInRange(`${sha}..HEAD`).filter((id) => id !== item.id);
      discardWorkingTree();
      const previousBlock = Array.isArray(item.revertBlockedBy) ? item.revertBlockedBy : [];
      const sameBlock = previousBlock.length === blockedBy.length && previousBlock.every((id) => blockedBy.includes(id));
      console.log(`[train-revert] ${item.id}: revert of ${sha.slice(0, 7)} conflicted — blocked by ${blockedBy.join(", ") || "(unidentified later work)"}`);
      const fields = {
        // Deliberately NOT cleared: the card is still on the branch, so the
        // board must keep showing it as blocked rather than quietly
        // pretending the rejection took effect.
        revertRequested: true,
        revertBlockedBy: blockedBy,
        updatedAt: new Date().toISOString(),
      };
      // Re-diagnosing an unchanged permanent blocker on every 2-minute tick
      // is noise, not progress (same rule ROUTINE_INSTRUCTIONS.md applies to
      // a `dirty` PR) — note it when it first appears or when it changes.
      if (!sameBlock) {
        fields.notes = await appendNote(
          item,
          `Could not take this ticket off the train automatically: reverting ${sha.slice(0, 7)} from \`${deployBranch}\` conflicted, because ` +
          (blockedBy.length
            ? `later ticket(s) on the same branch build on top of it — ${blockedBy.join(", ")}. `
            : `later work on the same branch touches the same lines. `) +
          `The card has still been sent back, but its code is still on the branch, so Deploy to Main stays hidden until this is cleared. ` +
          `Resolve it by sending the later ticket(s) back too (Failed testing on each), or by fixing \`${deployBranch}\` by hand. Nothing was force-pushed.\n\nDetails:\n${scrubSecrets(err.message)}`
        );
      }
      await patchItem(item.id, fields);
      return;
    }
  }

  if (!reverted.length) {
    const notes = await appendNote(item, `Nothing to revert off \`${deployBranch}\`: none of this card's recorded commits are still on that branch. revertRequested has been cleared.`);
    await patchItem(item.id, {
      revertRequested: false,
      revertBlockedBy: [],
      deployCommits: [],
      deployCommit: null,
      updatedAt: new Date().toISOString(),
      notes,
    });
    run("git", ["checkout", "main", "--quiet"]);
    return;
  }

  pushTrain(deployBranch);
  // The revert changed the train's source, so any bundle built from it is
  // stale in the other direction: it would keep showing the reverted change.
  dispatchRebuilds(deployBranch, changedPathsBetween(tipBeforeRevert, "HEAD"), "train-revert");
  // Anything riding on the commits just reverted lost its content with them.
  await detachCarriedCards(item, revertedOriginals, deployBranch);

  const notes = await appendNote(
    item,
    `Taken off the train: reverted ${commits.length === 1 ? "its commit" : `its ${commits.length} commits`} (${commits.map((s) => s.slice(0, 7)).join(", ")}) off \`${deployBranch}\` ` +
    `as ${reverted.map((s) => s.slice(0, 7)).join(", ")}. This card's change is no longer on the branch, so the next Deploy to Main will not carry it — ` +
    `it's a plain Backlog ticket again, and a fresh Ready for Dev sweep will rebuild it on top of whatever the branch looks like then.`
  );
  await patchItem(item.id, {
    revertRequested: false,
    revertBlockedBy: [],
    revertedCommits: (Array.isArray(item.revertedCommits) ? item.revertedCommits : []).concat(reverted),
    deployCommits: [],
    deployCommit: null,
    updatedAt: new Date().toISOString(),
    notes,
  });
  console.log(`[train-revert] ${item.id}: reverted ${reverted.length} commit(s) off ${deployBranch}`);
  if (item.rebuildAfterRevert) {
    // Sent back by ejectRedCulprits: rebuild it now the train is clean.
    const project = await getProject(item.projectId).catch(() => null);
    if (project) queueBuildRequest(project, item.id);
    await patchItem(item.id, { rebuildAfterRevert: false, updatedAt: new Date().toISOString() });
    console.log(`[train-revert] ${item.id}: rebuild queued after the automatic send-back`);
  }
  run("git", ["checkout", "main", "--quiet"]);
}

// The cards riding on `shas` (see carriedCardsOn) just lost their content
// with the revert of those commits: send each back to Backlog, so the board
// never shows a Ready for Testing or Approved for Deployment card whose fix
// is no longer on the branch — and never lets finishTrain mark one live on
// a merge that no longer carries it.
async function detachCarriedCards(revertedItem, shas, deployBranch) {
  if (!shas.length || !revertedItem.projectId) return;
  let riders = [];
  try {
    riders = carriedCardsOn(await itemsForProject(revertedItem.projectId), shas).filter((i) => i.id !== revertedItem.id);
  } catch (err) {
    console.log(`[train-revert] ${revertedItem.id}: couldn't look for cards riding on ${shas.map((s) => s.slice(0, 7)).join(", ")} (${err.message}) — the next sweep's Deploy verification is the backstop`);
    return;
  }
  for (const rider of riders) {
    const notes = await appendNote(
      rider,
      `Sent back to Backlog: this card's change rode on \`${deployBranch}\` inside ticket ${revertedItem.id}'s commit ${String(rider.carriedByCommit).slice(0, 7)}, ` +
      `which has just been reverted off the branch (${revertedItem.ejectedFromTrain ? "Eject from train" : "Failed testing"} on that ticket) — so this fix is no longer on the train either. ` +
      `A fresh Ready for Dev sweep rebuilds it on top of whatever the branch looks like then.`
    );
    await patchItem(rider.id, {
      status: "backlog",
      deployCommit: null,
      carriedByCommit: null,
      carriedByItem: null,
      revertRequested: false,
      revertBlockedBy: [],
      updatedAt: new Date().toISOString(),
      notes,
    });
    console.log(`[train-revert] ${rider.id}: rode on ${String(rider.carriedByCommit).slice(0, 7)} — sent back to Backlog with ${revertedItem.id}`);
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Finds the deploy-backlog-tracker.yml run this script's own `gh workflow
// run` dispatch just started, so the merging item can carry a real link to
// "the run that's supposed to ship this" rather than nothing at all.
// workflow_dispatch is an explicit API call, not a webhook — there's no
// run id handed back from triggering it, only from listing runs
// afterward, and the new run can take a few seconds to even appear in
// that list, hence the short retry loop. Matches on event type
// (workflow_dispatch, not push — a human's own merge around the same time
// would trigger a push-triggered run instead) and createdAt >= the moment
// we dispatched, so a concurrent unrelated dispatch can't be mismatched
// onto this item.
function findDispatchedDeployRun(dispatchedAtISO) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const json = run("gh", [
        "run", "list", "--repo", REPO, "--workflow", "deploy-backlog-tracker.yml",
        "--branch", "main", "--limit", "5",
        "--json", "databaseId,url,createdAt,status,conclusion,event",
      ]);
      const match = JSON.parse(json).find((r) => r.event === "workflow_dispatch" && r.createdAt >= dispatchedAtISO);
      if (match) return match;
    } catch (err) {
      console.log(`[merge-pr] couldn't list deploy-backlog-tracker.yml runs (${err.message})`);
      return null;
    }
    sleepSync(3000);
  }
  return null;
}

async function processMergePr(item) {
  console.log(`[merge-pr] ${item.id}: ${item.title || item.desc}`);
  const prNumber = item.mergePrNumber;
  if (!prNumber) {
    console.log(`[merge-pr] ${item.id}: no mergePrNumber set, skipping`);
    return;
  }

  // Fetch state alongside the file list in one call — needed before
  // merging either way. Same class of "already-done treated as stuck"
  // bug as processApplyPatch's own no-diff branch above (see its comment):
  // an item can legitimately reach here
  // with mergeReady:true pointing at a PR that's already been merged by
  // some other path (e.g. an interactive session merging it directly —
  // see item RR68JuZDRHtZncsfwyKl the same day, merged via GitHub's API
  // rather than this script). `gh pr merge` on an already-merged PR fails
  // ("Pull request is already merged"), and the old code treated any
  // merge failure as "retry next run" — which never stops being true for
  // an already-merged PR, so the item sat at ready-to-publish forever.
  // Checking state up front and skipping straight to the success path
  // when it's already MERGED makes this idempotent instead.
  let touchesBacklogTracker = false;
  let touchesWorkflows = false;
  let prState = null;
  try {
    const viewJson = run("gh", ["pr", "view", String(prNumber), "--repo", REPO, "--json", "files,state"]);
    const parsed = JSON.parse(viewJson);
    touchesBacklogTracker = (parsed.files || []).some((f) => f.path.startsWith("backlog-tracker/"));
    touchesWorkflows = (parsed.files || []).some((f) => f.path.startsWith(WORKFLOW_PATH_PREFIX));
    prState = parsed.state; // "OPEN" | "CLOSED" | "MERGED"
  } catch (err) {
    console.log(`[merge-pr] ${item.id}: couldn't read PR #${prNumber}'s file list/state (${err.message}) — will trigger the backlog-tracker deploy anyway to be safe, and still attempt the merge below`);
    touchesBacklogTracker = true;
  }

  if (prState === "OPEN" && touchesWorkflows) {
    // Never merged by the pipeline: a workflow file runs with every repo
    // secret, and the only review a mergeReady item has had is the
    // Routine's CI check. A person merges it on GitHub; the next Deploy
    // notify then finds it MERGED and records it below.
    console.log(`[merge-pr] ${item.id}: PR #${prNumber} changes ${WORKFLOW_PATH_PREFIX} — leaving the merge to a human`);
    const notes = await appendNote(
      item,
      `Not merged by the pipeline: PR #${prNumber} changes files under ${WORKFLOW_PATH_PREFIX}, which the automation never merges on its own. Review and merge it on GitHub, then click Notify Claude — Deploy again to record it as live. mergeReady has been cleared.`
    );
    await patchItem(item.id, { mergeReady: false, updatedAt: new Date().toISOString(), notes });
    return;
  }

  if (prState === "CLOSED") {
    // Closed WITHOUT merging is a genuinely different problem from either
    // "still open" or "already merged" — retrying a merge on it would
    // fail forever exactly like the already-merged case, but silently
    // advancing to published-live here would be actively wrong (nothing
    // was actually merged). Leave a clear note instead of looping.
    console.log(`[merge-pr] ${item.id}: PR #${prNumber} is CLOSED (not merged) — leaving mergeReady set for a human to check, not retrying`);
    const notes = await appendNote(
      item,
      `PR #${prNumber} was closed without merging. mergeReady is left as-is (not cleared) so this doesn't silently disappear, but the automation won't keep retrying a merge that will never succeed — a human needs to look at why it was closed and either reopen/re-point mergePrNumber, or move this item back manually.`
    );
    await patchItem(item.id, { updatedAt: new Date().toISOString(), notes });
    return;
  }

  if (prState !== "MERGED") {
    try {
      run("gh", ["pr", "merge", String(prNumber), "--merge", "--repo", REPO]);
    } catch (err) {
      // Same treatment processApplyPatch's own failures already get: note
      // it on the card immediately, count the attempt, and stop retrying
      // (clearing mergeReady) after MAX_PATCH_ATTEMPTS rather than leaving
      // this card "Waiting for Notify Claude — Deploy" forever with the
      // reason visible only in the Actions log.
      try {
        await recordAttemptFailure(item, err, { attemptsField: "mergeAttempts", readyField: "mergeReady", verb: "merge the PR for" });
      } catch (noteErr) {
        console.error(`[merge-pr] ${item.id}: couldn't record the failure on the item either: ${noteErr.message}`);
      }
      return;
    }
  } else {
    console.log(`[merge-pr] ${item.id}: PR #${prNumber} is already MERGED — skipping the merge attempt, proceeding straight to the success path`);
  }

  // The actual merge commit this PR landed as — recorded on the card so
  // "which build do I check this in" has a real, per-ticket answer instead
  // of only the shared testVersion several cards can carry at once (see
  // cardHTML's own deployBadge comment). Only resolvable AFTER the merge
  // (gh pr view's mergeCommit is null on a still-open PR), so this is a
  // fresh lookup, not the state captured further up.
  let mergeCommit = null;
  try {
    const mergedJson = run("gh", ["pr", "view", String(prNumber), "--repo", REPO, "--json", "mergeCommit"]);
    const parsedMerged = JSON.parse(mergedJson);
    mergeCommit = parsedMerged.mergeCommit && parsedMerged.mergeCommit.oid ? parsedMerged.mergeCommit.oid : null;
  } catch (err) {
    console.log(`[merge-pr] ${item.id}: couldn't read PR #${prNumber}'s merge commit (${err.message}) — leaving mergeCommit unset`);
  }

  // A merge performed with this workflow's own GITHUB_TOKEN does NOT
  // trigger other workflows' `on: push` — GitHub deliberately suppresses
  // that to prevent infinite loops (see deploy-backlog-tracker.yml's own
  // `on: push` for backlog-tracker/**). Without this, every PR merged by
  // this pipeline lands on main but Cloud Functions/Hosting/Firestore
  // rules silently never redeploy, even though the board shows
  // "published-live". `gh workflow run` (an explicit API dispatch, not a
  // push event) is exempt from that suppression, so trigger the deploy
  // directly whenever the merge actually touched backlog-tracker/.
  //
  // deployRunUrl/deployConclusion below are this dispatch's own outcome,
  // recorded on the card (see cardHTML's deployBadge) so confirming a
  // batch of cards is genuinely live stops meaning "fetch the deployed
  // app.js and compare its hash against main by hand" — the gap that
  // required exactly that, by hand, the night this was written.
  // deployConclusion starts "pending" whether or not the run was found
  // yet; main()'s own reconcileDeployStatuses() sweep picks it up and
  // fills in the real conclusion once the run actually finishes, since
  // this job doesn't wait around for that itself.
  let deployRunUrl = null;
  let deployConclusion = "not-applicable";
  if (touchesBacklogTracker) {
    const dispatchedAt = new Date().toISOString();
    try {
      run("gh", ["workflow", "run", "deploy-backlog-tracker.yml", "--repo", REPO, "--ref", "main"]);
      console.log(`[merge-pr] ${item.id}: triggered deploy-backlog-tracker.yml`);
    } catch (err) {
      console.log(`[merge-pr] ${item.id}: failed to trigger deploy-backlog-tracker.yml (${err.message}) — merge still succeeded, but the live site may be stale until the next deploy`);
    }
    const deployRun = findDispatchedDeployRun(dispatchedAt);
    deployRunUrl = deployRun ? deployRun.url : null;
    deployConclusion = "pending";
  }

  const notes = await appendNote(
    item,
    prState === "MERGED"
      ? `PR #${prNumber} was already merged (not by this script) — confirming that here and moving to published-live rather than treating it as unmerged work still to do.`
      : `Merged PR #${prNumber} to main from the automated backlog pipeline.`
  );
  await patchItem(item.id, {
    status: "published-live",
    mergeReady: false,
    mergeAttempts: 0,
    updatedAt: new Date().toISOString(),
    mergedAt: new Date().toISOString(),
    prUrl: `https://github.com/${REPO}/pull/${prNumber}`,
    prNumber: Number(prNumber),
    notes,
    ...(mergeCommit ? { mergeCommit } : {}),
    ...(deployRunUrl ? { deployRunUrl } : {}),
    deployConclusion,
  });
  await dropPatchFiles(item.id);
  console.log(`[merge-pr] ${item.id}: merged PR #${prNumber}, moved to published-live${mergeCommit ? ` (${mergeCommit.slice(0, 7)})` : ""}`);
}

// How long processDeployTrain waits for a train PR's checks inside one run
// before giving up and letting the next scheduled run pick it up. The job
// polls every 2 minutes anyway, so there is nothing to gain by holding a
// runner open longer than this — trainReady stays set and the wait simply
// continues on the next tick.
const TRAIN_CI_POLLS = 10;
const TRAIN_CI_POLL_MS = 15000;

// ── A train waiting on CI starts its own next run (4 Oct 2026) ──────────────
// A deploy run polls the train PR's checks for TRAIN_CI_POLLS x
// TRAIN_CI_POLL_MS (2.5 min); e2e-quick takes ~8, so almost every deploy ends
// "checks still running — will retry on the next run". That next run was the
// */2 schedule, which GitHub throttled to one run every 75-90 minutes that
// night (02:29, 03:44, 05:15): PR #311 sat green and mergeable for 20+
// minutes, #308 likewise. Now the run that leaves a train waiting dispatches
// the following run itself (workflow_dispatch is allowed from GITHUB_TOKEN;
// the concurrency group queues it behind this one), so a train merges within
// a couple of minutes of going green. Bounded: after FOLLOW_UP_MAX_WAIT_MS of
// waiting it stops re-dispatching and the schedule remains the safety net.
const FOLLOW_UP_MAX_WAIT_MS = 45 * 60 * 1000;
const followUpReasons = [];
function followUpDue(waitingSinceMs, nowMs = Date.now()) {
  return !waitingSinceMs || nowMs - waitingSinceMs < FOLLOW_UP_MAX_WAIT_MS;
}
function dispatchFollowUpRun() {
  if (!followUpReasons.length) return false;
  try {
    run("gh", ["workflow", "run", "backlog-automation.yml", "--repo", REPO, "--ref", "main"]);
    console.log(`[follow-up] dispatched the next automation run now (${followUpReasons.join("; ")}) rather than waiting for the schedule`);
    return true;
  } catch (err) {
    console.log(`[follow-up] couldn't dispatch the next run (${scrubSecrets(err.message)}) — the schedule will pick it up`);
    return false;
  } finally {
    followUpReasons.length = 0;
  }
}

// Collapses `gh pr view --json statusCheckRollup` into one word. The rollup
// mixes two shapes — CheckRun (status + conclusion) and StatusContext
// (state) — so both are handled; an empty rollup is "none" (this repo runs
// no pull_request-triggered workflows today, so that is the normal case)
// and is treated as nothing to wait for, not as a failure.
// Checks a train PR must have PASSED before it merges (bPcnbXZNC4vFnhft8AMz,
// Rob 2 Oct 2026: e2e-quick genuinely blocks; no bot bypass). Before this,
// an empty rollup ("none") read as "not pending" and the train merged ~2 s
// after the PR opened, before any check had even registered — PR #293's
// e2e-quick then failed with 0 jobs because its PR was already merged.
const REQUIRED_TRAIN_CHECKS = ["e2e-quick"];

// rollupState() over everything reported, plus: every required check must be
// present and successful. A required check not reported yet is "pending"
// (keep waiting; the caller leaves trainReady set so the next scheduled run
// resumes) — never "success".
// A check GitHub itself never ran to completion — cancelled, timed out, or
// never given a runner ("The job was not acquired by Runner of type hosted
// even after multiple attempts", PR #327, 5 Oct 2026) — says nothing about
// the train's code. It used to read as "failure", so an approved train was
// parked as red and waited for someone to click Deploy to Main again. It now
// reads as "infra": processDeployTrain re-runs the check and keeps waiting.
// A real failure anywhere still wins.
const INFRA_CONCLUSIONS = new Set(["CANCELLED", "TIMED_OUT", "STARTUP_FAILURE", "STALE"]);
function isInfraCheck(c) {
  if (c.status && String(c.status).toUpperCase() !== "COMPLETED") return false;
  return INFRA_CONCLUSIONS.has(String(c.conclusion || c.state || "").toUpperCase());
}
function trainChecksState(rollup, required = REQUIRED_TRAIN_CHECKS) {
  const listAll = Array.isArray(rollup) ? rollup : [];
  const infra = listAll.filter(isInfraCheck);
  const list = listAll.filter((c) => !isInfraCheck(c));
  const all = rollupState(list);
  if (all === "failure") return "failure";
  if (infra.length) return "infra";
  for (const name of required) {
    const mine = list.filter((c) => (c.name || c.context) === name);
    if (!mine.length) return "pending";
    const verdict = rollupState(mine);
    if (verdict !== "success") return verdict;
  }
  return all === "none" ? "success" : all;
}

// GitHub holds a workflow run on a bot-opened PR as `action_required` until
// someone approves it, and a held run reports no check at all — so the
// required e2e-quick would never appear and the train would wait forever
// (PR #295, 2 Oct 2026; the same hold is why every earlier train PR's
// e2e-quick "failed with 0 jobs" once the PR had already merged). This
// workflow has `actions: write`, so it approves the held runs on its own
// train PR's head commit: the train's content is already on the
// integration branch, built and tested there by the push-triggered run.
// Never throws; a failure just leaves the check pending and is logged.
function approveHeldRuns(headSha) {
  if (!headSha) return 0;
  let approved = 0;
  try {
    const ids = JSON.parse(run("gh", ["api", `repos/${REPO}/actions/runs?head_sha=${headSha}&status=action_required&per_page=20`, "-q", "[.workflow_runs[].id]"]) || "[]");
    for (const id of ids) {
      try { run("gh", ["api", "-X", "POST", `repos/${REPO}/actions/runs/${id}/approve`]); approved++; }
      catch (err) { console.log(`[deploy-train] couldn't approve held run ${id}: ${scrubSecrets(err.message)}`); }
    }
  } catch (err) {
    console.log(`[deploy-train] couldn't list held runs for ${String(headSha).slice(0, 7)}: ${scrubSecrets(err.message)}`);
  }
  if (approved) console.log(`[deploy-train] approved ${approved} held workflow run(s) on ${String(headSha).slice(0, 7)}`);
  return approved;
}

// How many times one train PR head may have its GitHub-side check failures
// re-run before the train is parked as red after all.
const TRAIN_CI_INFRA_RERUNS = 2;

// Re-runs the workflow runs behind the "infra" checks in a rollup. A check
// run's detailsUrl is .../actions/runs/<runId>/job/<jobId>. Never throws.
function rerunInfraChecks(rollup) {
  const ids = new Set();
  for (const c of (Array.isArray(rollup) ? rollup : []).filter(isInfraCheck)) {
    const m = String(c.detailsUrl || c.targetUrl || "").match(/\/actions\/runs\/(\d+)/);
    if (m) ids.add(m[1]);
  }
  let rerun = 0;
  for (const id of ids) {
    try { run("gh", ["api", "-X", "POST", `repos/${REPO}/actions/runs/${id}/rerun`]); rerun++; }
    catch (err) { console.log(`[deploy-train] couldn't re-run workflow run ${id}: ${scrubSecrets(err.message)}`); }
  }
  return rerun;
}

function rollupState(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return "none";
  let pending = false;
  for (const check of rollup) {
    if (check.status && String(check.status).toUpperCase() !== "COMPLETED") { pending = true; continue; }
    const verdict = String(check.conclusion || check.state || "").toUpperCase();
    if (!verdict) { pending = true; continue; }
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(verdict)) continue;
    return "failure";
  }
  return pending ? "pending" : "success";
}

function viewTrainPr(prNumber) {
  const json = run("gh", ["pr", "view", String(prNumber), "--repo", REPO,
    "--json", "number,state,url,mergeable,statusCheckRollup,files,headRefOid"]);
  return JSON.parse(json);
}

// A merge made with this workflow's own GITHUB_TOKEN never fires another
// workflow's `on: push`, so the push-triggered docs sync (dsp-board.yml)
// only ever ran for human-merged PRs — PR #284 changed the DSP project's
// REQUIREMENTS.md and README.md and nothing synced. This does it here, from
// projects/{id}.repoFolder, and records the outcome on projects/{id}.docsSync
// (see docs-sync-lib.js) so a refusal shows on the board. Never throws: the
// merge has already happened and must still finish bookkeeping.
async function syncDocsAfterMerge(project, mergeCommit) {
  try {
    let ref = mergeCommit;
    try { run("git", ["fetch", "origin", "main", "--quiet"]); } catch { /* use what we have */ }
    if (!ref) ref = run("git", ["rev-parse", "origin/main"]);
    const result = await syncProjectDocs(project, ref, {
      readFile: (p) => { try { return execFileSync("git", ["show", `${ref}:${p}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } },
      lastCommitFor: (p) => { try { return run("git", ["log", "-1", "--format=%H", ref, "--", p]) || null; } catch { return null; } },
      getProject: () => getProject(project.id),
      patchProject: (fields) => patchProject(project.id, fields),
      putDoc: (kind, fields) => putProjectDoc(project.id, kind, fields),
      getDoc: (kind) => getProjectDoc(project.id, kind),
      listProjectDocs: () => listProjectDocsFor(project.id),
      putProjectDocContent: (docId, fields) => patchProjectDocFields(docId, fields),
      getProjectDocContent: (docId) => getProjectDocById(docId),
      now: () => new Date(),
    });
    if (result.skipped) console.log(`[docs-sync] ${project.id}: skipped — ${result.skipped}`);
    else if (result.ok) console.log(`[docs-sync] ${project.id}: Requirements/README synced at ${ref.slice(0, 7)}, verified byte for byte`);
    else console.log(`[docs-sync] ${project.id}: ${scrubSecrets(result.error)} — recorded on the project as docsSync.error`);
  } catch (err) {
    console.log(`[docs-sync] ${project.id}: unexpected failure (${scrubSecrets(err.message)})`);
  }
}

// Post-merge bookkeeping, shared by processDeployTrain (the pipeline merged
// it) and reconcileMergedTrains (a person merged it — the workflow-file
// case). Flips every ticket on the train to live, triggers the Firebase
// deploy when the merge touched backlog-tracker/, and resets the branch back
// to main so the next train starts from a clean base.
async function finishTrain(project, deployBranch, prNumber, trainItems, { touchesBacklogTracker, mergeNote }) {
  let mergeCommit = null;
  try {
    const parsed = JSON.parse(run("gh", ["pr", "view", String(prNumber), "--repo", REPO, "--json", "mergeCommit"]));
    mergeCommit = parsed.mergeCommit && parsed.mergeCommit.oid ? parsed.mergeCommit.oid : null;
  } catch (err) {
    console.log(`[deploy-train] couldn't read PR #${prNumber}'s merge commit (${err.message}) — leaving mergeCommit unset`);
  }

  // A merge made with this workflow's own GITHUB_TOKEN does NOT trigger
  // other workflows' `on: push` (GitHub's anti-recursion protection), so the
  // Firebase deploy would silently never run. `gh workflow run` is an
  // explicit API dispatch and is exempt — same mechanism processMergePr has
  // always used for a per-ticket PR.
  let deployRunUrl = null;
  let deployConclusion = "not-applicable";
  if (touchesBacklogTracker) {
    const dispatchedAt = new Date().toISOString();
    try {
      run("gh", ["workflow", "run", "deploy-backlog-tracker.yml", "--repo", REPO, "--ref", "main"]);
      console.log(`[deploy-train] triggered deploy-backlog-tracker.yml for PR #${prNumber}`);
    } catch (err) {
      console.log(`[deploy-train] failed to trigger deploy-backlog-tracker.yml (${err.message}) — the merge still succeeded, but the live site may be stale until the next deploy`);
    }
    const deployRun = findDispatchedDeployRun(dispatchedAt);
    deployRunUrl = deployRun ? deployRun.url : null;
    deployConclusion = "pending";
  }

  // Same rule for a checked-in build (see GENERATED_BUILDS): the train's
  // source is on main now, and "live" means the bundle GitHub Pages serves
  // was built from it. Merging main into the train just before this may
  // itself have moved the source, so this is not redundant with the
  // rebuild the train got when its tickets landed.
  const prFiles = prFilePaths(prNumber);
  const rebuilds = dispatchRebuilds("main", prFiles, "deploy-train");
  // And a hosted service whose source this train changed (HOSTED_DEPLOYS):
  // its deploy workflow's own push trigger never sees this merge either.
  const hostedDeploys = dispatchHostedDeploys(prFiles, "deploy-train");
  const hostedDeploysMissed = deployWorkflowsFor(prFiles).filter((w) => !hostedDeploys.includes(w));

  // Help-centre content a train edited under faq/data/ reaches Firestore
  // only through faq-content.yml's sync job, and that job's `push` trigger
  // never fires for this merge (made with the workflow's own GITHUB_TOKEN —
  // the same suppression the deploy dispatch above exists for). Until this
  // dispatch existed a content ticket's edit sat in the repo until the next
  // hourly export overwrote it with Firestore's older copy: on 25 Sep 2026
  // n0s1LO8ZnbMaf5HwQELP's Roles table shipped in PR #213 at 06:52 and was
  // gone from main by the 07:31 export. faq-sync.js never deletes, and
  // never recreates an id the console has deleted (faqDeletedArticles
  // tombstones), so this is safe to fire on every such merge.
  let faqSynced = false;
  if (prFiles.some((p) => p.startsWith("faq/data/"))) {
    try {
      run("gh", ["workflow", "run", "faq-content.yml", "--repo", REPO, "--ref", "main", "-f", "direction=sync"]);
      faqSynced = true;
      console.log(`[deploy-train] triggered faq-content.yml (sync) — PR #${prNumber} changed help-centre content under faq/data/`);
    } catch (err) {
      console.log(`[deploy-train] failed to trigger faq-content.yml sync (${scrubSecrets(err.message)}) — the repo's faq/data edits will not reach Firestore until it is run by hand (Actions → FAQ content → sync)`);
    }
  }

  const mergedAt = new Date().toISOString();
  for (const item of trainItems) {
    const notes = await appendNote(
      item,
      `Shipped in the deployment train PR #${prNumber}, merged to main with ${trainItems.length === 1 ? "no other ticket" : `${trainItems.length - 1} other ticket(s)`} from \`${deployBranch}\`.` +
        (item.carriedByCommit
          ? ` This card had no commit of its own: its change rode on ${item.carriedByItem ? `ticket ${item.carriedByItem}'s` : "a sibling's"} commit ${String(item.carriedByCommit).slice(0, 7)}, which is part of this merge — so it is live now, and not before.`
          : "") +
        (mergeNote ? ` Note: merging main into ${deployBranch} for this deploy ${mergeNote}.` : "") +
        (faqSynced ? ` This train changed help-centre content under faq/data/; the repo → Firestore sync (faq-content.yml) was dispatched so the console shows it before the next hourly export.` : "") +
        (rebuilds.length
          ? ` The hosted prototype on GitHub Pages is a built bundle, being rebuilt from main now (${rebuilds.join(", ")}) — allow a few minutes before checking the live site, and confirm with its build-info.json: "commit" is the source commit the bundle was built from, so it should be this train's own last commit (${trainItems.map((i) => (i.deployCommit ? i.deployCommit.slice(0, 7) : null)).filter(Boolean).join(", ") || "one of this train's commits"}) or later — not the merge commit itself, which comes after.`
          : "") +
        (hostedDeploys.length
          ? ` This train changed a hosted service's source, so its deploy was dispatched too (${hostedDeploys.join(", ")}) — the hosted API the prototype talks to is only live once that run is green (Actions tab); until then the client and the API can disagree.`
          : "") +
        (hostedDeploysMissed.length
          ? ` WARNING: this train changed a hosted service's source but its deploy could NOT be dispatched (${hostedDeploysMissed.join(", ")}) — run that workflow by hand on main (Actions → Run workflow) before testing the live site, or the client will be ahead of the API it talks to.`
          : "")
    );
    await patchItem(item.id, {
      status: "published-live",
      updatedAt: mergedAt,
      mergedAt,
      prUrl: `https://github.com/${REPO}/pull/${prNumber}`,
      prNumber: Number(prNumber),
      notes,
      ...(mergeCommit ? { mergeCommit } : {}),
      ...(deployRunUrl ? { deployRunUrl } : {}),
      deployConclusion,
    });
    await dropPatchFiles(item.id);
  }

  // Reset the train. The branch's own commits are now on main, so resetting
  // to main loses nothing and gives the next train a clean base — which is
  // also what makes "one version bump per deploy" work. force-with-lease, so
  // a commit pushed onto the branch since our fetch aborts the reset rather
  // than being silently destroyed.
  let resetOk = true;
  try {
    run("git", ["fetch", "origin", "main", deployBranch, "--quiet"]);
    try { run("git", ["reset", "--hard", "--quiet"]); } catch { /* nothing staged */ }
    try { run("git", ["clean", "-fdq"]); } catch { /* nothing to clean */ }
    run("git", ["checkout", "-B", deployBranch, "origin/main", "--quiet"]);
    run("git", ["push", "--force-with-lease", "origin", deployBranch, "--quiet"]);
  } catch (err) {
    resetOk = false;
    console.log(`[deploy-train] couldn't reset ${deployBranch} to main (${scrubSecrets(err.message)}) — the next train will start from the old branch head`);
  }
  run("git", ["checkout", "main", "--quiet"]);

  await syncDocsAfterMerge(project, mergeCommit);

  await patchProject(project.id, {
    trainReady: false,
    trainLocked: false,
    trainStatus: "idle",
    trainTestsRed: null, trainHold: null, // describe the train that just shipped, not the next one
    trainNote: resetOk
      ? null
      : `Shipped PR #${prNumber}, but ${deployBranch} could not be reset to main automatically — reset it by hand before the next train.`,
    trainPrNumber: null,
    needsHumanMerge: false,
    updatedAt: new Date().toISOString(),
  });
  console.log(`[deploy-train] ${project.id}: PR #${prNumber} merged — ${trainItems.length} ticket(s) live, ${deployBranch} reset`);
}

// The single Deploy CTA's automation half. The Routine sets
// projects/{id}.trainReady once it has verified every ticket in the DEPLOY
// REQUEST really is on the branch and nothing on the branch is still in
// testing; this merges the whole branch to main as ONE PR.
async function processDeployTrain(project) {
  console.log(`[deploy-train] ${project.id}: ${project.name}`);
  // This Deploy to Main click is consumed here, whatever the outcome. The
  // stamp is what stops trainHandoverReason (train-lock.js) handing the
  // same request over again after it was merged or refused — without it,
  // an old click would keep re-arming the train and a newly approved
  // ticket could merge with nobody having clicked for it.
  await patchProject(project.id, { deployRequestHandledAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const deployBranch = project.deployBranch || deployBranchForName(project.name);
  const allItems = await itemsForProject(project.id);
  const onTrain = onTrainItems(allItems);

  if (!onTrain.length) {
    console.log(`[deploy-train] ${project.id}: nothing on the train — clearing trainReady`);
    await patchProject(project.id, {
      trainReady: false, trainStatus: "idle",
      // Nothing left on the branch means nothing left to gate Backlog on
      // either — without this, a Deploy to Main click on an already-empty
      // train (every approved ticket deleted/reverted between the click
      // and this run) left trainLocked stuck true forever, since a
      // successful merge was the only other place that ever cleared it.
      // See train-lock.js / "Ready for Dev CTA stays hidden after all
      // train tickets are deleted (stuck trainLocked)".
      trainLocked: false,
      trainNote: "Deploy requested, but no ticket currently has a commit on this project's integration branch — nothing to merge.",
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  const stillTesting = onTrain.filter((i) => i.status === "ready-for-testing");
  if (stillTesting.length) {
    // The board hides Deploy to Main in this state, so reaching here means
    // something raced it (a card sent back between the click and this run).
    // Merging anyway would ship untested work — refuse.
    console.log(`[deploy-train] ${project.id}: ${stillTesting.length} ticket(s) still in Ready for Testing — refusing to merge the train`);
    await patchProject(project.id, {
      trainReady: false, trainStatus: "idle",
      trainNote: `Not merged: ${stillTesting.length} ticket(s) on ${deployBranch} are still in Ready for Testing (${stillTesting.map((i) => i.id).join(", ")}). ` +
        `Merging the branch would ship them too. Approve or reject them, then click Deploy to Main again.`,
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  if (!remoteBranchExists(deployBranch)) {
    await patchProject(project.id, {
      trainReady: false, trainStatus: "idle",
      trainNote: `Not merged: the integration branch ${deployBranch} doesn't exist on origin.`,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  await patchProject(project.id, { trainStatus: "deploying", trainNote: null, updatedAt: new Date().toISOString() });

  // 0. The Deploy Routine's step 1, done here as well so the pipeline can
  //    hand a train over without it (trainHandoverReason): every ticket's
  //    commit must actually be on the branch. A card that says it is on the
  //    train while its commit isn't (reverted, never pushed, a hand-stamped
  //    typo) means merging would ship something nobody approved — refuse
  //    and name it, exactly as the Routine would have.
  checkoutTrain(deployBranch);
  const offBranch = onTrain.filter((i) => {
    try { run("git", ["merge-base", "--is-ancestor", i.deployCommit, `origin/${deployBranch}`]); return false; } catch { return true; }
  });
  if (offBranch.length) {
    discardWorkingTree();
    console.log(`[deploy-train] ${project.id}: ${offBranch.length} ticket(s) claim a commit that is not on ${deployBranch} — refusing to merge the train`);
    await patchProject(project.id, {
      trainReady: false, trainStatus: "idle",
      trainNote: `Not merged: ${offBranch.map((i) => `${i.id} (${String(i.deployCommit).slice(0, 7)})`).join(", ")} ${offBranch.length === 1 ? "claims a commit that is" : "claim commits that are"} not on ${deployBranch}. ` +
        `Either it was reverted off the train or never pushed — check the card's notes, send it back or re-stamp it, then click Deploy to Main again.`,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  // 0b. The train's own tests must have passed on what ships (see
  //     trainTestGate). Held, not refused: trainReady stays set, so the
  //     next run picks the deploy back up by itself once they are green.
  const gate = readTrainTestGate(deployBranch);
  if (gate.state !== "green") {
    discardWorkingTree();
    if (gate.state === "missing") dispatchTrainTests(deployBranch, gate.workflows.filter((w) => w.state === "missing").map((w) => TRAIN_TEST_WORKFLOWS.find((t) => t.workflow === w.workflow).prefix + "x"), "deploy-train");
    const red = gate.state === "red";
    const what = gate.workflows.map((w) => `${w.label} ${w.state === "red" ? `failed${w.url ? ` (${w.url})` : ""}` : w.state === "pending" ? "is still running" : "has not run on this commit yet — started it"}`).join("; ");
    console.log(`[deploy-train] ${project.id}: holding the deploy — train tests ${gate.state} on ${gate.head.slice(0, 7)}: ${what}`);
    if (gate.state === "pending" || gate.state === "missing") followUpReasons.push(`${project.id}: deploy waiting on the train's tests`);
    await patchProject(project.id, {
      trainStatus: "deploying",
      trainHold: red ? "tests-red" : "tests-running",
      trainNote: red
        ? `Deploy held, nothing merged: ${what}. Fix it on ${deployBranch} (or send the ticket that broke it back with Failed testing) — the approved deploy carries on by itself once the tests pass.`
        : `Deploy to Main is waiting for the train's tests before opening the PR: ${what}. It carries on by itself when they pass.`,
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  if (project.trainHold) await patchProject(project.id, { trainHold: null, updatedAt: new Date().toISOString() });

  // 1. Bring main in. This used to be the only remaining conflict path, and
  //    still is for anything other than faq/data/index.json — it needs
  //    someone to have pushed to main, in this project's files, outside the
  //    pipeline, and a conflict there is deliberately never resolved
  //    automatically. A conflict confined to index.json alone IS resolved
  //    automatically (see tryAutoResolveFaqIndexConflict) because that file
  //    is fully derivable from faq/data/articles/*.json — see that
  //    function's own comment for why this specific file is safe to do this
  //    for and no other.
  checkoutTrain(deployBranch);
  let mergeNote = null;
  try {
    run("git", ["-c", "user.name=backlog-automation", "-c", "user.email=backlog-automation@users.noreply.github.com",
      "merge", "origin/main", "--no-edit", "--quiet"]);
  } catch (err) {
    const conflicted = conflictedPaths();
    let resolution = tryAutoResolveFaqIndexConflict(conflicted);
    // A second derived-file case: a build output both sides rebuilt (see
    // tryAutoResolveGeneratedOutputConflict). Tried only if the first
    // resolver declined without touching anything, i.e. the conflict was
    // never about index.json.
    if (!resolution.resolved && !conflicted.includes("faq/data/index.json")) {
      resolution = tryAutoResolveGeneratedOutputConflict(conflicted);
    }
    if (!resolution.resolved) {
      try { run("git", ["merge", "--abort"]); } catch { /* nothing in progress */ }
      discardWorkingTree();
      console.log(`[deploy-train] ${project.id}: merging main into ${deployBranch} ${resolution.detail}`);
      await patchProject(project.id, {
        trainReady: false,
        trainStatus: "conflict",
        trainNote: `Merging main into ${deployBranch} ${resolution.detail}, so nothing was merged and no card was moved. ` +
          `Resolve it by merging main into ${deployBranch} by hand, then click Deploy to Main again.\n\n${scrubSecrets(err.message)}`,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    run("git", ["-c", "user.name=backlog-automation", "-c", "user.email=backlog-automation@users.noreply.github.com",
      "commit", "--no-edit", "--quiet"]);
    console.log(`[deploy-train] ${project.id}: merging main into ${deployBranch} ${resolution.detail}`);
    mergeNote = resolution.detail;
  }

  // 2. One version bump for the whole train, computed from main — so the
  //    number always lands exactly one patch ahead of what is actually live,
  //    however long the branch has been open. Individual patchFiles no
  //    longer touch version.js at all (that per-PR bump was what made any
  //    two open PRs conflict on the same line).
  const liveVersion = readAppVersionFromRef("origin/main");
  const nextVersion = liveVersion ? bumpPatchVersion(liveVersion) : null;
  if (nextVersion) {
    const versionPath = path.join(process.cwd(), "backlog-tracker/public/js/version.js");
    const current = fs.readFileSync(versionPath, "utf8");
    const updated = current.replace(/APP_VERSION\s*=\s*"[^"]+"/, `APP_VERSION = "${nextVersion}"`);
    if (updated !== current) {
      fs.writeFileSync(versionPath, updated);
      run("git", ["add", "-A"]);
      if (stagedChangedPaths().length) commitOnTrain(`Bump version to ${nextVersion} for deployment`);
    }
  } else {
    console.log(`[deploy-train] ${project.id}: couldn't read a bumpable APP_VERSION off main — deploying without a version bump`);
  }
  pushTrain(deployBranch);

  // 3. One PR for the whole train. Reused if an earlier run already opened
  //    it (this job can be interrupted between opening and merging).
  let prNumber = Number(project.trainPrNumber) || null;
  if (prNumber) {
    const existing = viewPr(prNumber);
    if (!existing || existing.state !== "OPEN") prNumber = null;
  }
  if (!prNumber) {
    const own = findPrForBranch(deployBranch);
    if (own && own.state === "OPEN") prNumber = Number(own.number);
  }
  if (!prNumber) {
    const body = `Deployment train for **${project.name}** — ${onTrain.length} ticket(s) built on top of each other on \`${deployBranch}\` and tested together.\n\n` +
      onTrain.map((i) => `- ${i.title || i.desc || i.id}\n  Backlog item: ${i.id}`).join("\n") +
      `\n\nOpened by the backlog automation. Merging this ships every ticket listed above.`;
    const prUrl = run("gh", ["pr", "create", "--base", "main", "--head", deployBranch,
      "--title", `Deploy ${project.name} — ${onTrain.length} ticket${onTrain.length === 1 ? "" : "s"}`,
      "--body", body]);
    prNumber = Number((String(prUrl).match(/\/pull\/(\d+)/) || [])[1]) || null;
    if (!prNumber) throw new Error(`couldn't parse a PR number out of ${prUrl}`);
    console.log(`[deploy-train] ${project.id}: opened ${String(prUrl).trim()}`);
  }
  await patchProject(project.id, { trainPrNumber: prNumber, updatedAt: new Date().toISOString() });
  // Every card on the train gets the PR badge, same as a per-ticket PR used
  // to give it — "which PR is this card" stays answerable from the board.
  for (const item of onTrain) {
    if (Number(item.prNumber) === prNumber) continue;
    await patchItem(item.id, {
      prUrl: `https://github.com/${REPO}/pull/${prNumber}`,
      prNumber,
      updatedAt: new Date().toISOString(),
    });
  }

  // 4. Wait for CI, then merge. `--merge`, never `--squash`: the per-ticket
  //    commits ARE the history now, and squashing them would lose the
  //    `Backlog item: <id>` trail every other part of this pipeline reads.
  let pr = null;
  for (let poll = 0; poll < TRAIN_CI_POLLS; poll++) {
    pr = viewTrainPr(prNumber);
    if (pr.state === "MERGED") break;
    approveHeldRuns(pr.headRefOid);
    let checks = trainChecksState(pr.statusCheckRollup);
    if (checks === "infra") {
      const sha = pr.headRefOid || "";
      const reruns = project.trainCiRerunSha === sha ? (Number(project.trainCiReruns) || 0) : 0;
      if (reruns < TRAIN_CI_INFRA_RERUNS) {
        const n = rerunInfraChecks(pr.statusCheckRollup);
        console.log(`[deploy-train] ${project.id}: PR #${prNumber} has check(s) GitHub never finished running — re-ran ${n} workflow run(s) (attempt ${reruns + 1}/${TRAIN_CI_INFRA_RERUNS}); trainReady stays set`);
        followUpReasons.push(`${project.id}: PR #${prNumber} checks re-run after a GitHub-side cancellation`);
        await patchProject(project.id, {
          trainStatus: "deploying",
          trainNote: `GitHub cancelled or never started a check on PR #${prNumber} (not a test failure) — re-running it (attempt ${reruns + 1} of ${TRAIN_CI_INFRA_RERUNS}). It merges by itself once the checks pass.`,
          trainCiRerunSha: sha,
          trainCiReruns: reruns + 1,
          trainCiWaitingPr: Number(prNumber),
          trainCiWaitingSince: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return;
      }
      checks = "failure";
    }
    if (checks === "failure") {
      const red = (pr.statusCheckRollup || []).filter((c) => !["SUCCESS", "NEUTRAL", "SKIPPED", ""].includes(String(c.conclusion || c.state || "").toUpperCase()) && String(c.status || "COMPLETED").toUpperCase() === "COMPLETED");
      await patchProject(project.id, {
        trainReady: false, trainStatus: "conflict",
        // resumeRedTrains() picks the deploy back up by itself once this PR
        // is green again (a re-run, or a fix pushed to the train) — the
        // approval already given stands; nobody has to click again.
        trainCiRedPr: Number(prNumber),
        trainCiRedSha: pr.headRefOid || "",
        trainNote: `Not merged: CI is red on the train PR #${prNumber}${red.length ? ` (${red.map((c) => `${c.name || c.context}${c.detailsUrl || c.targetUrl ? ` ${c.detailsUrl || c.targetUrl}` : ""}`).join(", ")})` : ""}. Fix it (or send the ticket that broke it back with Failed testing) — the deploy resumes by itself once the PR is green.`,
        updatedAt: new Date().toISOString(),
      });
      console.log(`[deploy-train] ${project.id}: CI red on PR #${prNumber} — not merging`);
      return;
    }
    if (String(pr.mergeable).toUpperCase() === "CONFLICTING") {
      await patchProject(project.id, {
        trainReady: false, trainStatus: "conflict",
        trainCiRedPr: null, trainCiRedSha: null, // a merge conflict needs a person, not a green check
        trainNote: `Not merged: GitHub reports PR #${prNumber} as conflicting with main. Merge main into ${deployBranch} by hand, resolve it, then click Deploy to Main again.`,
        updatedAt: new Date().toISOString(),
      });
      console.log(`[deploy-train] ${project.id}: PR #${prNumber} is CONFLICTING — not merging`);
      return;
    }
    if (checks !== "pending") break;
    if (poll < TRAIN_CI_POLLS - 1) sleepSync(TRAIN_CI_POLL_MS);
  }
  // An already-MERGED PR is never waiting on anything — a check still
  // running on it must not send this back round the loop and leave the
  // train's cards un-flipped.
  if (pr && pr.state !== "MERGED" && trainChecksState(pr.statusCheckRollup) === "pending") {
    // Leave trainReady set: the next scheduled run picks the wait back up
    // rather than needing another click.
    console.log(`[deploy-train] ${project.id}: PR #${prNumber}'s checks are still running — will retry on the next run`);
    // The wait is per PR, so a new train's PR starts its own clock.
    const samePr = Number(project.trainCiWaitingPr) === Number(prNumber);
    const waitingSince = (samePr && Date.parse(project.trainCiWaitingSince || "")) || Date.now();
    if (followUpDue(waitingSince)) followUpReasons.push(`${project.id}: PR #${prNumber} waiting on CI`);
    await patchProject(project.id, {
      trainStatus: "deploying",
      trainNote: `Waiting on CI for PR #${prNumber} (${REQUIRED_TRAIN_CHECKS.join(", ")} must pass before it merges). It merges by itself within a few minutes of going green.`,
      trainCiWaitingPr: Number(prNumber),
      trainCiWaitingSince: new Date(waitingSince).toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  const touchesBacklogTracker = !pr || !Array.isArray(pr.files)
    ? true // couldn't read the file list — dispatch the deploy anyway, to be safe
    : pr.files.some((f) => f.path.startsWith("backlog-tracker/"));

  if (pr && pr.state !== "MERGED") {
    if (project.needsHumanMerge || (Array.isArray(pr.files) && pr.files.some((f) => f.path.startsWith(WORKFLOW_PATH_PREFIX)))) {
      // A workflow file runs with every repo secret and the only review this
      // train has had is its own CI — a person merges it on GitHub, and
      // reconcileMergedTrains records it as live on a later run.
      console.log(`[deploy-train] ${project.id}: PR #${prNumber} changes ${WORKFLOW_PATH_PREFIX} — leaving the merge to a human`);
      await patchProject(project.id, {
        trainReady: false,
        trainStatus: "awaiting-human-merge",
        trainNote: `PR #${prNumber} changes files under ${WORKFLOW_PATH_PREFIX}, which the automation never merges on its own. ` +
          `Review and merge it on GitHub — the board records every ticket on the train as live on its own once it sees the merge.`,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    run("gh", ["pr", "merge", String(prNumber), "--merge", "--repo", REPO]);
    console.log(`[deploy-train] ${project.id}: merged PR #${prNumber}`);
  } else {
    console.log(`[deploy-train] ${project.id}: PR #${prNumber} was already merged — recording it`);
  }

  await finishTrain(project, deployBranch, prNumber, onTrain, { touchesBacklogTracker, mergeNote });
}

// The train's equivalent of reconcileHumanMergedPrs: a train PR the pipeline
// deliberately refused to merge (it touches .github/workflows/) gets merged
// by a person, and nothing would otherwise notice. Every run checks each
// project that is waiting on such a merge and finishes the bookkeeping the
// moment GitHub says the PR is MERGED — no second click, no Routine fire.
async function reconcileMergedTrains() {
  const waiting = await runQuery({
    from: [{ collectionId: "projects" }],
    select: selectFields(["trainPrNumber"]),
    where: { fieldFilter: { field: { fieldPath: "trainStatus" }, op: "EQUAL", value: { stringValue: "awaiting-human-merge" } } },
  });
  for (const waitingProject of waiting) {
    let project = waitingProject;
    const prNumber = Number(project.trainPrNumber) || null;
    if (!prNumber) continue;
    let pr = null;
    try {
      pr = JSON.parse(run("gh", ["pr", "view", String(prNumber), "--repo", REPO, "--json", "state,files,headRefOid"]));
    } catch (err) {
      console.log(`[deploy-train] ${project.id}: couldn't read PR #${prNumber} state (${err.message}) — skipping this run`);
      continue;
    }
    // Keep the PR mergeable while it waits for its person: a commit that
    // lands after the hand-over (a late ticket, a prototype rebuild) gets its
    // checks HELD by GitHub, and nothing else approves them in this state —
    // PR #342 (8 Oct 2026) sat with no CI on its head until someone noticed.
    if (pr.state === "OPEN") { approveHeldRuns(pr.headRefOid); continue; }
    if (pr.state !== "MERGED") continue;
    project = await getProject(project.id);
    const deployBranch = project.deployBranch || deployBranchForName(project.name);
    const onTrain = onTrainItems(await itemsForProject(project.id));
    if (!onTrain.length) {
      await patchProject(project.id, { trainStatus: "idle", trainReady: false, trainLocked: false, trainPrNumber: null, trainTestsRed: null, trainHold: null, updatedAt: new Date().toISOString() });
      continue;
    }
    console.log(`[deploy-train] ${project.id}: PR #${prNumber} was merged outside the pipeline — recording ${onTrain.length} ticket(s) as live`);
    const touchesBacklogTracker = !Array.isArray(pr.files) || pr.files.some((f) => f.path.startsWith("backlog-tracker/"));
    await finishTrain(project, deployBranch, prNumber, onTrain, { touchesBacklogTracker });
  }
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

// Point 3 of "Ready for Dev CTA stays hidden after all train tickets are
// deleted (stuck trainLocked)": once reconcileLockedTrains (below) has
// decided a project's train is empty with nothing merged, this decides
// whether the integration branch itself still holds anything worth
// preserving before it's reset back to main for the next train — the same
// reset finishTrain does after a real merge, just reached without one.
//
// A card sent back through "Failed testing" already had its own commits
// taken off the branch by processRevertFromTrain, so on its own that never
// leaves anything orphaned (though it can leave revert commits ahead of
// main that net to zero content change but are still real history). What
// this actually protects against is a card DELETED outright while its
// commit was still live on the branch — deleteDoc() has no idea a train
// exists, so that commit would otherwise just vanish the next time this
// branch gets reset with nothing to say it ever happened. Either way: if
// the branch is ahead of main at all, tag its current tip as
// archive/<branch>-<date> and push the tag BEFORE resetting, so the work
// stays recoverable (`git checkout archive/...`) even though no ticket on
// the board points at it any more.
function archiveAndResetOrphanedBranch(deployBranch) {
  if (!remoteBranchExists(deployBranch)) return { ok: true, tag: null };
  run("git", ["fetch", "origin", "main", deployBranch, "--quiet"]);

  let ahead = [];
  try {
    const out = run("git", ["rev-list", `origin/main..origin/${deployBranch}`]);
    ahead = out ? out.split("\n").filter(Boolean) : [];
  } catch (err) {
    return { ok: false, error: err.message, tag: null };
  }

  let tag = null;
  if (ahead.length) {
    const base = `archive/${deployBranch}-${dateStamp()}`;
    tag = base;
    // Same-day reset of the same project's train more than once (unlikely,
    // but not impossible) must not silently overwrite an earlier archive.
    for (let n = 2; ; n += 1) {
      try {
        run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]);
        tag = `${base}-${n}`;
      } catch {
        break; // rev-parse failed to resolve it -> this tag name is free
      }
    }
    try {
      run("git", ["tag", tag, `origin/${deployBranch}`]);
      run("git", ["push", "origin", tag, "--quiet"]);
    } catch (err) {
      return { ok: false, error: err.message, tag: null };
    }
  }

  // Same reset finishTrain does post-merge: force-with-lease so a commit
  // pushed onto the branch since our fetch aborts the reset instead of
  // being silently destroyed.
  try {
    try { run("git", ["reset", "--hard", "--quiet"]); } catch { /* nothing staged */ }
    try { run("git", ["clean", "-fdq"]); } catch { /* nothing to clean */ }
    run("git", ["checkout", "-B", deployBranch, "origin/main", "--quiet"]);
    run("git", ["push", "--force-with-lease", "origin", deployBranch, "--quiet"]);
    run("git", ["checkout", "main", "--quiet"]);
  } catch (err) {
    // Whatever step failed, leave the working tree back on a clean main —
    // same defensive convention processRevertFromTrain's own catch blocks
    // use — so whatever this run does next never inherits a checkout stuck
    // mid-reset on deployBranch.
    try { discardWorkingTree(); } catch { /* best-effort only */ }
    return { ok: false, error: err.message, tag };
  }
  return { ok: true, tag };
}

// The safety net for functions/index.js's onBacklogItemTrainLockRecompute
// (see that file), and the only place that can also do the git side of
// point 3 above — the Cloud Function has no git credential. Covers:
//   - a race where the Cloud Function's write landed before this run
//     started and somehow didn't clear the lock (defensive; not expected
//     in practice)
//   - a project whose train emptied through some path that never touches
//     backlogItems at all (there isn't one today, but this is the sweep
//     that would catch it if one appears)
// trainLockShouldClear (train-lock.js) is the exact same predicate the
// Cloud Function uses, so "empty" means the same thing in both places.
async function reconcileLockedTrains() {
  const locked = await runQuery({
    from: [{ collectionId: "projects" }],
    select: selectFields(["trainLocked", "trainStatus", "deployBranch", "name"]),
    where: { fieldFilter: { field: { fieldPath: "trainLocked" }, op: "EQUAL", value: { booleanValue: true } } },
  });
  for (const project of locked) {
    // Mid-deploy / awaiting a human merge are their own lifecycles (handled
    // above by processDeployTrain / reconcileMergedTrains) — never race
    // those by unlocking underneath them.
    if (project.trainStatus === "deploying" || project.trainStatus === "awaiting-human-merge") continue;

    const items = await itemsForProject(project.id, TRAIN_LOCK_ITEM_FIELDS);
    if (!trainLockShouldClear(project, items)) continue;

    const deployBranch = project.deployBranch || deployBranchForName(project.name);
    let archiveResult;
    try {
      archiveResult = archiveAndResetOrphanedBranch(deployBranch);
    } catch (err) {
      archiveResult = { ok: false, error: err.message, tag: null };
    }

    console.log(`[deploy-train] ${project.id}: train emptied with nothing merged (every approved/testing ticket was deleted or reverted) — clearing trainLocked` +
      (archiveResult.tag ? `, archived orphaned work as ${archiveResult.tag}` : ""));
    await patchProject(project.id, {
      trainLocked: false,
      trainReady: false,
      // Whatever trainStatus/trainNote said before — including a stale
      // "conflict" left over from before the tickets were removed — stops
      // applying: there is nothing left on the train for it to describe.
      trainStatus: "idle",
      trainTestsRed: null,
      trainHold: null,
      trainNote: archiveResult.ok
        ? null
        : `Train emptied and unlocked, but ${deployBranch} could not be reset to main automatically: ${scrubSecrets(archiveResult.error)}. Reset it by hand.`,
      updatedAt: new Date().toISOString(),
    });
  }
}

// How many parents the commit at the tip of `ref` has — 2+ means a real
// merge commit (`git revert` needs `-m 1`, "keep mainline's side"), exactly
// 1 means a plain commit (e.g. a squash-merged PR), which `-m` would refuse
// outright ("mainline was specified but commit is not a merge"). Every PR
// this pipeline merges uses `gh pr merge --merge` (see processMergePr),
// which always produces a real merge commit — but a mergeCommit set by some
// other path (a human merging by hand with a different strategy) might not,
// so this checks rather than assuming.
function parentCount(sha) {
  const parents = run("git", ["rev-list", "--parents", "-n", "1", sha]).split(" ").slice(1);
  return parents.length;
}

// Reverting a live deployment (hfEmgPWmgrv5pxxcv8vE): a Deployed/Main Branch
// (Live) card's own Revert action (public/js/app.js) writes revertReady on
// top of the mergeCommit processMergePr already recorded for it. This
// deliberately does the least new thing possible for something this
// high-stakes: it only ever opens a PR (`git revert` on a fresh branch,
// same shape as any other patch-ready item's PR) and hands the card back to
// Ready for Testing — a human still has to test the revert branch, approve
// it, and click Deploy to Main to actually merge it, exactly like any other
// card's own fix. No new merge path, no auto-approval, nothing that skips
// the review this pipeline already requires for everything else; the only
// genuinely new capability is producing the revert commit itself.
async function processRevertPr(item) {
  console.log(`[revert] ${item.id}: ${item.title || item.desc}`);
  if (!item.mergeCommit) {
    console.log(`[revert] ${item.id}: no mergeCommit recorded on this card — nothing to revert`);
    const notes = await appendNote(
      item,
      "Revert requested, but this card has no mergeCommit recorded (either it predates that field, or noDeploymentRequired — there was never a real merge to undo). revertReady has been cleared; nothing was done."
    );
    await patchItem(item.id, { revertReady: false, updatedAt: new Date().toISOString(), notes });
    return;
  }

  const branch = sanitizeRevertBranchName(item.title, item.id);

  // Same reconciliation as processApplyPatch's own branch check: an
  // interrupted earlier attempt at this exact revert can leave a pushed
  // branch/PR behind without the card having recorded it yet. The branch
  // name embeds the item id, so an OPEN match here can only be this
  // revert's own PR.
  const existing = findPrForBranch(branch);
  if (existing && existing.state === "OPEN") {
    console.log(`[revert] ${item.id}: branch ${branch} already has open PR #${existing.number} — attaching instead of reverting again`);
    const notes = await appendNote(item, `Revert PR #${existing.number} (${existing.url}) was already open for this card's own revert branch — attaching to it rather than reverting a second time.`);
    await patchItem(item.id, {
      status: "ready-for-testing",
      revertReady: false,
      revertAttempts: 0,
      updatedAt: new Date().toISOString(),
      notes,
      prUrl: existing.url,
      prNumber: Number(existing.number),
    });
    return;
  }

  run("git", ["fetch", "origin", "main", "--quiet"]);
  run("git", ["checkout", "-B", "main", "origin/main", "--quiet"]);
  run("git", ["checkout", "-B", branch, "--quiet"]);

  const mainline = parentCount(item.mergeCommit) >= 2 ? ["-m", "1"] : [];
  try {
    run("git", ["-c", "user.name=backlog-automation", "-c", "user.email=backlog-automation@users.noreply.github.com",
      "revert", "--no-edit", ...mainline, item.mergeCommit]);
  } catch (err) {
    // A real merge conflict — same class of "needs a human with push
    // access" outcome as a `dirty` mergeable_state in the Deploy flow
    // (see ROUTINE_INSTRUCTIONS.md). Abort cleanly rather than leaving a
    // half-reverted working tree for the next run to trip over.
    try { run("git", ["revert", "--abort"]); } catch { /* nothing in progress */ }
    discardWorkingTree();
    console.log(`[revert] ${item.id}: git revert conflicted (${err.message}) — needs a human to resolve`);
    const notes = await appendNote(
      item,
      `Could not revert automatically: \`git revert\` of ${item.mergeCommit} conflicted (most likely because something later already changed the same lines). ` +
      `revertReady has been cleared. A human with a real git credential needs to run the revert by hand, resolve the conflict, and open the PR themselves — this pipeline can't resolve a conflict on its own.\n\nDetails:\n${scrubSecrets(err.message)}`
    );
    await patchItem(item.id, { revertReady: false, updatedAt: new Date().toISOString(), notes });
    return;
  }

  // Same guardrail as a normal patch: a revert of a change that itself
  // touched .github/workflows/ needs the workflow-push App token (and the
  // same on:-trigger-unchanged check), never the run's own GITHUB_TOKEN.
  let changedPaths = [];
  try {
    changedPaths = run("git", ["diff", "--name-only", "HEAD~1", "HEAD"]).split("\n").filter(Boolean);
  } catch { /* leave empty — the push below will fail loudly if something's actually wrong */ }
  const workflowPaths = changedPaths.filter((p) => p.startsWith(WORKFLOW_PATH_PREFIX));
  if (workflowPaths.length) {
    const problems = WORKFLOW_PUSH_TOKEN
      ? (() => { run("git", ["fetch", "origin", "main", "--quiet"]); return workflowChangeProblems(changedPaths.map((p) => ({ path: p, content: fs.readFileSync(path.join(process.cwd(), p), "utf8") }))); })()
      : ["no WORKFLOW_PUSH_TOKEN configured"];
    if (problems.length) {
      discardWorkingTree();
      console.log(`[revert] ${item.id}: refusing — revert touches ${workflowPaths.join(", ")}: ${problems.join("; ")}`);
      const notes = await appendNote(
        item,
        `Could not push this revert: it touches ${workflowPaths.join(", ")}, and ${problems.join("; ")}. revertReady has been cleared — a human needs to run \`git revert -m 1 ${item.mergeCommit}\` (or plain \`git revert\` if it wasn't a merge commit) and push/PR it by hand.`
      );
      await patchItem(item.id, { revertReady: false, updatedAt: new Date().toISOString(), notes });
      return;
    }
    pushWithWorkflowToken(branch);
  } else {
    run("git", ["push", "-u", "origin", branch, "--force", "--quiet"]);
  }

  const prTitle = `Revert: ${item.title || item.desc || item.id}`;
  const originalPr = item.prNumber ? ` (originally shipped in PR #${item.prNumber})` : "";
  const prBody = `Reverts commit ${item.mergeCommit}${originalPr}, requested via this card's own Revert action.\n\n` +
    `This undoes a change already live on main — test the revert branch before approving it, same as any other Ready for Testing card. Merging it (via the normal Approved for Deployment → Deploy to Main flow, never automatically) is what actually takes the original change back out of production.\n\n` +
    `Backlog item: ${item.id}`;
  const prUrl = run("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", prTitle, "--body", prBody]);
  const prNumber = Number((String(prUrl).match(/\/pull\/(\d+)/) || [])[1]) || null;

  const notes = await appendNote(
    item,
    `Opened ${prUrl} to revert ${item.mergeCommit}${originalPr} from the Revert action. This card's prUrl/prNumber now point at the revert PR (its earlier merged PR${item.prNumber ? ` #${item.prNumber}` : ""} is still on GitHub for history, just no longer what this card is tracking). Moved back to Ready for Testing — nothing merges until a human tests and approves the revert branch and clicks Deploy to Main, exactly like any other card.` +
    (workflowPaths.length ? ` This PR changes ${workflowPaths.join(", ")}, so it was pushed with the workflow-push App token and will NOT be merged by the pipeline — a person has to review and merge it on GitHub.` : "")
  );
  const testVersion = readAppVersion();
  await patchItem(item.id, {
    status: "ready-for-testing",
    revertReady: false,
    revertAttempts: 0,
    updatedAt: new Date().toISOString(),
    notes,
    prUrl: String(prUrl).trim(),
    previewUrl: guessPreviewUrl(changedPaths.map((p) => ({ path: p, content: "" })), branch, String(prUrl).trim()),
    ...(prNumber ? { prNumber } : {}),
    ...(testVersion ? { testVersion } : {}),
    ...(workflowPaths.length ? { requiresHumanMerge: true } : {}),
  });
  console.log(`[revert] ${item.id}: opened ${prUrl}, moved to ready-for-testing`);
  run("git", ["checkout", "main", "--quiet"]);
}

// Sweeps every card still showing deployConclusion:"pending" (set by
// processMergePr the moment it dispatches deploy-backlog-tracker.yml,
// before that run has necessarily finished — this job doesn't wait around
// for it) and fills in the real conclusion once GitHub has one. Runs at
// the top of every scheduled tick, so a card's deploy status catches up
// within a couple of minutes of the run actually finishing even though
// nothing pushes that update proactively.
//
// A card whose deploy FAILED is re-checked too, for a week after its merge:
// the fix for a transient deploy failure is re-running that same run, and
// `gh run view` reports the latest attempt's conclusion, so the card turns
// green on the next tick instead of saying "Deploy failure" forever
// (10 Oct 2026, PR #359 — run 38087481082 failed on a Google blip and
// passed on re-run).
const DEPLOY_FAILURE_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

// What to do about a deploy run that finished "failure". main is cumulative,
// so a NEWER deploy of main that succeeded has shipped this merge too — the
// card takes that run. A newer run still going means wait for it. Only when
// the failed run is still the newest is it re-run, once (`--failed`, its
// first re-attempt): re-running an older run over a newer deploy would put
// older code live. Its second failure is reported as a real one. `cache`
// (runId -> verdict) keeps the cards of one train, which share a run, from
// re-running it once each. `gh` is injectable for the tests.
function healFailedDeploy(runId, cache, gh = (args) => run("gh", args)) {
  if (cache.has(runId)) return cache.get(runId);
  let verdict = { action: "report" };
  try {
    const failed = JSON.parse(gh(["run", "view", runId, "--repo", REPO, "--json", "createdAt,attempt"]));
    const runs = JSON.parse(gh([
      "run", "list", "--repo", REPO, "--workflow", "deploy-backlog-tracker.yml",
      "--branch", "main", "--limit", "20", "--json", "databaseId,url,createdAt,status,conclusion",
    ]));
    const newer = runs.filter((r) => String(r.databaseId) !== String(runId) && r.createdAt > failed.createdAt);
    const newerSuccess = newer.find((r) => r.status === "completed" && r.conclusion === "success");
    if (newerSuccess) verdict = { action: "adopt", run: newerSuccess };
    else if (newer.some((r) => r.status !== "completed")) verdict = { action: "wait" };
    else if (!newer.length && Number(failed.attempt || 1) < 2) {
      gh(["run", "rerun", String(runId), "--repo", REPO, "--failed"]);
      verdict = { action: "rerun" };
    }
  } catch (err) {
    console.log(`[deploy-status] couldn't decide about failed deploy run ${runId} (${scrubSecrets(err.message)}) — reporting it as failed`);
  }
  cache.set(runId, verdict);
  return verdict;
}

async function reconcileDeployStatuses() {
  const byConclusion = (value) => runQuery({
    from: [{ collectionId: "backlogItems" }],
    select: selectFields(["deployRunUrl", "deployConclusion", "mergedAt", "updatedAt"]),
    where: { fieldFilter: { field: { fieldPath: "deployConclusion" }, op: "EQUAL", value: { stringValue: value } } },
  });
  const failedSince = Date.now() - DEPLOY_FAILURE_RECHECK_MS;
  const pending = [
    ...(await byConclusion("pending")),
    ...(await byConclusion("failure")).filter((i) => i.deployRunUrl && Date.parse(i.mergedAt || i.updatedAt || 0) >= failedSince),
  ];
  if (!pending.length) return;
  console.log(`[deploy-status] ${pending.length} item(s) with a pending or failed deploy to check`);
  const healCache = new Map();
  for (const item of pending) {
    try {
      let match = null;
      const runId = item.deployRunUrl ? (String(item.deployRunUrl).match(/\/runs\/(\d+)/) || [])[1] : null;
      if (runId) {
        const json = run("gh", ["run", "view", runId, "--repo", REPO, "--json", "status,conclusion,url"]);
        match = JSON.parse(json);
      } else {
        // processMergePr dispatched the deploy but hadn't found the run
        // yet by the time it wrote the card — look again, broadly, using
        // the merge time as the "dispatched no earlier than" bound.
        match = findDispatchedDeployRun(item.mergedAt || item.updatedAt || new Date(0).toISOString());
      }
      if (!match || match.status !== "completed") continue; // still running (or genuinely not found yet) — leave "pending", try again next tick
      let conclusion = match.conclusion || "unknown";
      let url = match.url || item.deployRunUrl || null;
      const matchRunId = runId || (String(match.url || "").match(/\/runs\/(\d+)/) || [])[1];
      if (conclusion === "failure" && matchRunId) {
        const verdict = healFailedDeploy(matchRunId, healCache);
        if (verdict.action === "rerun") {
          console.log(`[deploy-status] ${item.id}: deploy run ${matchRunId} failed — re-running its failed job once`);
          if (item.deployConclusion !== "pending") await patchItem(item.id, { deployConclusion: "pending", updatedAt: new Date().toISOString() });
          continue;
        }
        if (verdict.action === "wait") continue;
        if (verdict.action === "adopt") {
          conclusion = "success";
          url = verdict.run.url;
          console.log(`[deploy-status] ${item.id}: run ${matchRunId} failed, but a newer deploy of main succeeded and carries this merge — ${url}`);
        }
      }
      if (conclusion === item.deployConclusion && url === item.deployRunUrl) continue; // nothing changed
      await patchItem(item.id, {
        deployConclusion: conclusion,
        ...(url ? { deployRunUrl: url } : {}),
        updatedAt: new Date().toISOString(),
      });
      console.log(`[deploy-status] ${item.id}: deploy run finished — ${conclusion}`);
    } catch (err) {
      console.log(`[deploy-status] ${item.id}: couldn't refresh deploy status (${err.message}) — will retry next run`);
    }
  }
}

// Pipeline health strip (YeCj7sNpHXFUZQhmAmEb — see public/js/app.js's
// renderHealthStrip): writes this run's own outcome into the single
// systemStatus/pipeline doc so the board can show whether this job is
// actually still running, not just whether someone happened to click
// Notify Claude recently. Best-effort on purpose — a failure here must
// never be why the real work above (which already succeeded or failed on
// its own terms by the time this runs) gets reported wrong, so it only logs.
async function recordPipelineHealth(conclusion) {
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
  const fields = {
    backlogAutomation: {
      at: new Date().toISOString(),
      conclusion,
      runUrl,
      dispatched: process.env.GITHUB_EVENT_NAME === "repository_dispatch",
    },
    // Both booleans, not the secrets themselves — see backlog-tracker/README.md
    // "The GH_DISPATCH_TOKEN secret" / "The workflow-push GitHub App".
    dispatchTokenPresent: process.env.GH_DISPATCH_TOKEN_PRESENT === "true",
    workflowAppConfigured: !!WORKFLOW_PUSH_TOKEN,
    updatedAt: new Date().toISOString(),
  };
  try {
    const fieldPaths = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
    const res = await fetch(`${FIRESTORE_BASE}/systemStatus/pipeline?${fieldPaths}`, {
      method: "PATCH",
      headers: await firestoreHeaders(),
      body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, tv(v)])) }),
    });
    if (!res.ok) console.log(`[health] couldn't record pipeline status: ${res.status} ${await res.text()}`);
  } catch (err) {
    console.log(`[health] couldn't record pipeline status: ${err.message}`);
  }
}

// A PR the pipeline refused to merge itself (it touches .github/workflows/
// — see processMergePr's requiresHumanMerge guard) gets merged by a person
// on GitHub. Until this existed, nothing noticed: the card sat at Approved
// for Deployment until someone clicked Deploy to Main a second time purely
// to have the Routine re-discover an already-merged PR (15 Sep 2026, PRs
// #136 and #139). Now every run looks at ready-to-publish cards that carry
// a PR number and, if GitHub says that PR is MERGED, sets mergeReady so the
// normal processMergePr success path (already-merged branch, deploy
// trigger, status flip, note) runs in this same pass — no Routine fire, no
// human click, and no code path duplicated.
async function reconcileHumanMergedPrs() {
  const waiting = await runQuery({
    from: [{ collectionId: "backlogItems" }],
    select: selectFields(["mergeReady", "mergePrNumber", "prNumber", "prUrl"]),
    where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "ready-to-publish" } } },
  });
  const picked = [];
  for (const item of waiting) {
    if (item.mergeReady) continue; // already queued for this run
    const prNumber = item.mergePrNumber || item.prNumber || (item.prUrl ? (String(item.prUrl).match(/\/pull\/(\d+)/) || [])[1] : null);
    if (!prNumber) continue;
    try {
      const parsed = JSON.parse(run("gh", ["pr", "view", String(prNumber), "--repo", REPO, "--json", "state"]));
      if (parsed.state !== "MERGED") continue;
    } catch (err) {
      console.log(`[human-merge] ${item.id}: couldn't read PR #${prNumber} state (${err.message}) — skipping this run`);
      continue;
    }
    console.log(`[human-merge] ${item.id}: PR #${prNumber} was merged outside the pipeline — recording it as live`);
    await patchItem(item.id, { mergeReady: true, mergePrNumber: Number(prNumber), updatedAt: new Date().toISOString() });
    // The query above carried only the fields it checks; processMergePr
    // needs the whole card.
    const full = (await getItem(item.id)) || item;
    picked.push({ ...full, mergeReady: true, mergePrNumber: Number(prNumber) });
  }
  return picked;
}

// The safety net for functions/index.js's onDeployRoutineSettled — same
// predicate, trainHandoverReason (train-lock.js): a Deploy to Main click
// whose Routine run reported back without setting trainReady, never
// reported back (25 minutes), or was never fired (5 minutes) is handed to
// processDeployTrain in this same run, which re-verifies the train before
// merging. The trigger covers the moment a report lands; only a sweep can
// notice time passing with nothing written.
//
// Every project is read, not only trainLocked ones. The board's approve
// click latches trainLocked, but a ticket approved any other way (a runner,
// a direct write) leaves it unset — and on 28 Sep 2026 that stranded the
// Backlog Tracker & FAQs train: its Deploy Routine ran, wrote nothing, and
// this sweep never looked at the project. trainHandoverReason already
// decides from the Deploy to Main click itself (deployNotifyRequestedAt),
// so the lock was never the right filter. Projects are few; the select
// keeps each row to the fields the predicate reads.
async function reconcileDeployRequests() {
  let projects = [];
  try {
    projects = await runQuery({
      from: [{ collectionId: "projects" }],
      select: { fields: ["trainReady", "trainStatus", "deployNotifyRequestedAt", "deployRequestHandledAt", "deployRoutine"].map((fieldPath) => ({ fieldPath })) },
    });
  } catch (err) {
    console.log(`[deploy-train] couldn't list projects for the hand-over sweep (${err.message}) — skipping this run`);
    return;
  }
  const now = Date.now();
  for (const project of projects) {
    const reason = trainHandoverReason(project, now);
    if (!reason) continue;
    console.log(`[deploy-train] ${project.id}: handing the train to the pipeline — ${reason}`);
    await patchProject(project.id, {
      trainReady: true,
      trainNote: `Deploy to Main is going ahead without the Routine's hand-over: ${reason}. The pipeline re-checks that every ticket's commit is on the branch and nothing is still in testing before it merges.`,
      updatedAt: new Date().toISOString(),
    });
  }
}

// ── A train parked on red CI resumes by itself once it's green (5 Oct 2026) ─
// A train stopped for red CI used to stay stopped until someone clicked
// Deploy to Main a second time, even after the cause was gone: a test fixed
// on the train (PR #323, 5 Oct), or a check GitHub cancelled and a re-run
// passed (PR #327, the same day). The person already approved this train;
// the PR going green is the only thing that was missing. So each run
// re-arms trainReady for such a project, and processDeployTrain re-verifies
// everything (nothing left in testing, every commit still on the branch)
// before it merges — exactly as for a click.
async function resumeRedTrains() {
  const parked = await runQuery({
    from: [{ collectionId: "projects" }],
    where: { fieldFilter: { field: { fieldPath: "trainStatus" }, op: "EQUAL", value: { stringValue: "conflict" } } },
  });
  for (const project of parked) {
    const prNumber = Number(project.trainCiRedPr) || null;
    if (!prNumber || project.trainReady === true) continue;
    let pr;
    try { pr = viewTrainPr(prNumber); }
    catch (err) { console.log(`[resume-train] ${project.id}: couldn't read PR #${prNumber} (${scrubSecrets(err.message)}) — trying again next run`); continue; }
    if (pr.state === "CLOSED") {
      await patchProject(project.id, { trainCiRedPr: null, trainCiRedSha: null, updatedAt: new Date().toISOString() });
      continue;
    }
    const checks = pr.state === "MERGED" ? "success" : trainChecksState(pr.statusCheckRollup);
    if (checks === "failure") continue; // still red on the same evidence
    console.log(`[resume-train] ${project.id}: PR #${prNumber} is no longer red (${checks}) — resuming the approved deploy`);
    await patchProject(project.id, {
      trainReady: true,
      trainStatus: "deploying",
      trainCiRedPr: null,
      trainCiRedSha: null,
      trainNote: `PR #${prNumber} is no longer red — resuming the deploy that was already approved. It merges by itself once every required check passes.`,
      updatedAt: new Date().toISOString(),
    });
  }
}

async function main() {
  await reconcileDeployStatuses();
  await resumeRedTrains();
  await reconcileMergedTrains();
  await reconcileLockedTrains();
  await reconcileDeployRequests();
  const humanMerged = await reconcileHumanMergedPrs();

  const patchReadyItems = await runQuery({
    from: [{ collectionId: "backlogItems" }],
    where: { fieldFilter: { field: { fieldPath: "patchReady" }, op: "EQUAL", value: { booleanValue: true } } },
  });
  const mergeReadyQueried = await runQuery({
    from: [{ collectionId: "backlogItems" }],
    where: { fieldFilter: { field: { fieldPath: "mergeReady" }, op: "EQUAL", value: { booleanValue: true } } },
  });
  // Items reconcileHumanMergedPrs just flagged may not be visible to the
  // query above yet (Firestore read-after-write across REST calls is not
  // guaranteed) — merge the two lists by id so they are processed now.
  const seen = new Set(mergeReadyQueried.map((i) => i.id));
  const mergeReadyItems = mergeReadyQueried.concat(humanMerged.filter((i) => !seen.has(i.id)));
  const revertReadyItems = await runQuery({
    from: [{ collectionId: "backlogItems" }],
    where: { fieldFilter: { field: { fieldPath: "revertReady" }, op: "EQUAL", value: { booleanValue: true } } },
  });
  // Written by app.js's failTesting(): a rejected ticket has to come off the
  // integration branch, or it would ship in the next train regardless of the
  // card sitting back in Backlog (see processRevertFromTrain).
  const trainRevertItems = await runQuery({
    from: [{ collectionId: "backlogItems" }],
    where: { fieldFilter: { field: { fieldPath: "revertRequested" }, op: "EQUAL", value: { booleanValue: true } } },
  });
  // The single Deploy CTA: the Routine sets trainReady on the PROJECT, not
  // on each item — one branch, one PR, one merge (see processDeployTrain).
  const trainReadyProjects = await runQuery({
    from: [{ collectionId: "projects" }],
    where: { fieldFilter: { field: { fieldPath: "trainReady" }, op: "EQUAL", value: { booleanValue: true } } },
  });

  console.log(`Found ${patchReadyItems.length} patch-ready item(s), ${trainRevertItems.length} train-revert item(s), ${trainReadyProjects.length} ready train(s), ${mergeReadyItems.length} legacy merge-ready item(s), and ${revertReadyItems.length} revert-ready item(s)`);

  for (const item of patchReadyItems) {
    try {
      await processApplyPatch(item);
    } catch (err) {
      console.error(`[apply-patch] ${item.id} failed: ${err.stack || err.message}`);
      // The log alone was the bug: a failure here left the item patchReady
      // and greyed out on the board with no explanation anywhere a person
      // looks. Put the reason on the card, and stop retrying eventually.
      try {
        await recordAttemptFailure(item, err);
      } catch (noteErr) {
        console.error(`[apply-patch] ${item.id}: couldn't record the failure on the item either: ${noteErr.message}`);
      }
    }
  }
  // Whatever just landed in Ready for Testing gets presented to a person —
  // one fire per project for this run (see noteReadyForTesting).
  // Tickets waiting on what just landed start now (see "Parallel builds").
  try {
    await releaseDependents(readyForTestingLanded);
  } catch (err) {
    console.error(`[parallel] releasing dependants failed: ${err.message}`);
  }
  await flushBuildRequests();
  await requestReadyForTestingNotify();
  for (const item of mergeReadyItems) {
    try {
      await processMergePr(item);
    } catch (err) {
      console.error(`[merge-pr] ${item.id} failed: ${err.stack || err.message}`);
      // Mirrors the patch-ready loop above: an uncaught exception here
      // (processMergePr's own `gh pr merge` failure already records itself
      // and returns cleanly — this is for anything else, e.g. the `gh pr
      // view` call or a Firestore write throwing) must not leave the card
      // silently stuck at Approved for Deployment either.
      try {
        await recordAttemptFailure(item, err, { attemptsField: "mergeAttempts", readyField: "mergeReady", verb: "merge the PR for" });
      } catch (noteErr) {
        console.error(`[merge-pr] ${item.id}: couldn't record the failure on the item either: ${noteErr.message}`);
      }
    }
  }
  for (const item of revertReadyItems) {
    try {
      await processRevertPr(item);
    } catch (err) {
      console.error(`[revert] ${item.id} failed: ${err.stack || err.message}`);
      try {
        await recordAttemptFailure(item, err, { attemptsField: "revertAttempts", readyField: "revertReady", verb: "revert" });
      } catch (noteErr) {
        console.error(`[revert] ${item.id}: couldn't record the failure on the item either: ${noteErr.message}`);
      }
    }
  }

  for (const item of trainRevertItems) {
    try {
      await processRevertFromTrain(item);
    } catch (err) {
      console.error(`[train-revert] ${item.id} failed: ${err.stack || err.message}`);
      try {
        // clearReadyOnGiveUp: false — clearing revertRequested would leave a
        // rejected ticket's commits live on the train with the board no
        // longer showing it, and the next Deploy would ship exactly the
        // change someone rejected. Better to retry quietly forever than to
        // silently accept that.
        await recordAttemptFailure(item, err, {
          attemptsField: "trainRevertAttempts", readyField: "revertRequested",
          verb: "take off the integration branch", clearReadyOnGiveUp: false,
        });
      } catch (noteErr) {
        console.error(`[train-revert] ${item.id}: couldn't record the failure on the item either: ${noteErr.message}`);
      }
    }
  }
  for (const project of trainReadyProjects) {
    try {
      await processDeployTrain(project);
    } catch (err) {
      console.error(`[deploy-train] ${project.id} failed: ${err.stack || err.message}`);
      // A project has no notes array to record onto, so the failure goes on
      // the project's own trainNote — which is what the board reads — and
      // trainReady is cleared so a permanent failure can't retry every two
      // minutes with nothing visible anywhere.
      try {
        await patchProject(project.id, {
          trainReady: false,
          trainStatus: "conflict",
          trainNote: `The deploy run failed and nothing was merged: ${scrubSecrets(err.message || String(err))}`,
          updatedAt: new Date().toISOString(),
        });
      } catch (noteErr) {
        console.error(`[deploy-train] ${project.id}: couldn't record the failure on the project either: ${noteErr.message}`);
      }
    }
  }

  // Per-item failures above are already caught and recorded on their own
  // cards, so reaching here means this run itself completed rather than
  // dying outright (a Firestore auth failure, a bad query, etc.) — that
  // distinction is exactly what the health strip's "automation" segment is
  // for. See the top-level catch below for the "run itself died" case.
  await sweepShippedPatchFiles();
  try {
    await ejectRedCulprits();
  } catch (err) {
    console.log(`[train-eject] failed: ${err.message}`);
  }
  // Rebuilds queued by this run's reverts (rebuildAfterRevert) — the earlier
  // flush ran before the reverts did.
  await flushBuildRequests();
  try {
    await reportTrainTestResults();
  } catch (err) {
    // Reporting only — never fail the run over it.
    console.log(`[train-tests] failed: ${err.message}`);
  }
  // A train left waiting on CI starts the next run itself (see followUpDue).
  dispatchFollowUpRun();

  await recordPipelineHealth("success");
}

// Guarded so this file can be `require()`d (e.g. from a test that only
// wants tryAutoResolveFaqIndexConflict or archiveAndResetOrphanedBranch
// against a disposable local repo) without immediately running the real
// thing against live Firestore and origin — `node
// scripts/run-backlog-automation.js`, the only way the workflow ever
// invokes this, still runs it exactly as before.
if (require.main === module) {
  main().catch(async (err) => {
    console.error(err.stack || err.message);
    await recordPipelineHealth("failure");
    process.exit(1);
  });
}

// Exported for backlog-tracker/test/faq-index.test.js and
// test/train-lock-branch-archive.test.js, which drive these against a
// disposable local git repo rather than requiring this whole automation
// run (main(), above, has real Firestore/GitHub side effects the moment
// this module loads if not guarded — see the require.main check).
module.exports = {
  conflictedPaths, tryAutoResolveFaqIndexConflict, archiveAndResetOrphanedBranch, dateStamp, nearestPageFor, isBundlerTemplate,
  // test/train-carried.test.js — a card whose content a sibling's commit
  // delivered follows that train instead of being marked live on approval
  onTrainItems, backlogItemIdFromMessage, carryingCommitOnTrain, noDiffPatchFields, carriedCardsOn, isPipelinePreviewUrl,
  // test/generated-builds.test.js
  isGeneratedOutput, rebuildWorkflowsFor, tryAutoResolveGeneratedOutputConflict, deployWorkflowsFor,
  // test/patch-paths.test.js
  normalisePatchPaths, projectFolderOf, patchFilesLookFolderRelative,
  // test/patch-offload.test.js — patchFiles read from the card or its sub-document
  patchFilesFor, dropPatchFiles,
  // test/preview-url-pin.test.js
  guessPreviewUrl, isAutoGeneratedPreviewUrl, repointPreviewUrlRef,
  // test/ready-for-testing-trigger.test.js
  readyForTestingNotifyFields, batchStillBuilding, tv,
  // test/train-sync.test.js — the train is brought up to date with main
  // before a ticket lands, and the patch's edits are carried across
  syncTrainWithMain, rebasePatchFilesOnto,
  // test/docs-sync.test.js
  syncDocsAfterMerge,
  // test/train-checks.test.js — a train merges only once e2e-quick passed
  trainChecksState, rollupState, REQUIRED_TRAIN_CHECKS, approveHeldRuns,
  // test/train-resume.test.js — GitHub-side cancellations re-run; red trains resume when green
  isInfraCheck, rerunInfraChecks, resumeRedTrains, TRAIN_CI_INFRA_RERUNS,
  // test/train-tests.test.js — console tests run on each train push
  trainTestFailureTargets, touchesConsoleTests, trainTestsFor, testedHeadOf, nextTrainTestsRed, trainTestGate, newestRealRun, pickRedCulprit,
  // test/parallel-builds.test.js — patches built in parallel
  patchBaseFor, dependenciesLanded, buildRequestFields, migrationNumberClashes,
  // test/train-follow-up.test.js — a train waiting on CI starts its own next run
  followUpDue, FOLLOW_UP_MAX_WAIT_MS,
  // test/deploy-heal.test.js — a transient deploy failure heals itself
  healFailedDeploy,
};
