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
const path = require("path");

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

async function itemsForProject(projectId) {
  return runQuery({
    from: [{ collectionId: "backlogItems" }],
    where: { fieldFilter: { field: { fieldPath: "projectId" }, op: "EQUAL", value: { stringValue: projectId } } },
  });
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

// Builds a rawcdn.githack.com preview link for the branch a PR was just
// opened from, so a Ready for Testing card is testable the moment it
// arrives instead of sitting with no way to look at it until someone sets
// previewUrl by hand (AfOWSFNfos2BZRpDeph1). rawcdn.githack.com
// specifically, not raw.githack.com — the latter proxies through jsDelivr's
// CDN cache (up to ~7 days), so a link set right after one push can keep
// showing that first commit even after later pushes update the file, with
// no visible error; rawcdn.githack.com is githack's own always-uncached
// host, meant for exactly this "testing an in-progress branch" case (see
// app.js's own testLinkHTML comment, which this mirrors).
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
// link to the integration branch itself (trainTreeUrl), since a ticket has
// no PR of its own until the whole train's deploy PR opens.
function guessPreviewUrl(patchFiles, branch, fallbackUrl) {
  const changed = (patchFiles || [])
    .filter((f) => f && typeof f.path === "string" && f.content !== null && f.content !== undefined)
    .map((f) => f.path)
    .filter((p) => !p.includes("/functions/"));

  // A changed page is the best answer: it IS the thing to look at.
  const htmlPaths = changed.filter((p) => p.endsWith(".html"));
  if (htmlPaths.length) {
    const page = htmlPaths.sort((a, b) => a.length - b.length)[0];
    return `https://rawcdn.githack.com/${REPO}/${branch}/${page}`;
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
    return `https://rawcdn.githack.com/${REPO}/${branch}/${page}`;
  }

  return fallbackUrl;
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
    if (fs.existsSync(path.join(process.cwd(), candidate))) return candidate;
    dir = path.dirname(dir);
  }
  return null;
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

async function processApplyPatch(item) {
  console.log(`[apply-patch] ${item.id}: ${item.title || item.desc}`);
  if (!Array.isArray(item.patchFiles) || item.patchFiles.length === 0) {
    console.log(`[apply-patch] ${item.id}: no patchFiles present, leaving patchReady set for a human to check`);
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
  const deployBranch = await ensureDeployBranch(project);

  // Build onto the head of the integration branch, retrying once if someone
  // else pushed the train between our checkout and our push. checkoutTrain()
  // re-fetches and hard-resets, so the retry genuinely re-applies this
  // item's full-file patchFiles on top of the newer head rather than
  // replaying a stale commit.
  let sha = null;
  let changedPaths = [];
  let testVersion = null;
  let attempt = 0;
  for (;;) {
    checkoutTrain(deployBranch);
    applyPatchFiles(item.patchFiles);
    // Read while the patched files are still on disk, so testVersion
    // reflects the branch this item will actually be tested on.
    testVersion = readAppVersion();
    run("git", ["add", "-A"]);
    changedPaths = stagedChangedPaths();

    if (!changedPaths.length) {
      // Same "stuck forever with no record of why" class of bug the old
      // per-ticket path already had to fix: patchFiles that produce no diff
      // used to just log and return, leaving patchReady set to retry every
      // scheduled run forever. On a train there are two genuinely different
      // reasons for no diff, and they need different outcomes.
      run("git", ["checkout", "main", "--quiet"]);
      const alreadyOnTrain = Array.isArray(item.deployCommits) && item.deployCommits.length > 0;
      if (alreadyOnTrain) {
        // A re-patch whose new content matches what this item already put on
        // the branch — its work IS on the train, so it goes back to testing
        // with its existing commits intact, NOT flagged noDeploymentRequired.
        const notes = await appendNote(
          item,
          `Re-patched, but the new patchFiles are identical to what this item already has on ${deployBranch} — nothing new was committed. ` +
          `Moved back to Ready for Testing against the same train commits (${item.deployCommits.join(", ")}).`
        );
        await patchItem(item.id, {
          status: "ready-for-testing",
          patchReady: false,
          patchAttempts: 0,
          updatedAt: new Date().toISOString(),
          notes,
          ...(testVersion ? { testVersion } : {}),
        });
        console.log(`[apply-patch] ${item.id}: no new diff against ${deployBranch} — already on the train, back to ready-for-testing`);
        return;
      }
      // Never been on the train and produces no diff: the content is already
      // there (a sibling's shared-file patch in the same batch, or it was
      // already on main). There is nothing for a deploy to carry, so flag it
      // as needing none — otherwise it reaches Approved for Deployment and
      // blocks the train's Deploy gate on a ticket with no commit to ship.
      const notes = await appendNote(
        item,
        `No commit made: patchFiles produced no diff against the project's integration branch ${deployBranch} — this content is already there, ` +
        `most likely delivered by a sibling item's shared-file patch in the same batch (see "Group multi-item fixes into one deployment"). ` +
        `Moved to Ready for Testing directly since the fix is genuinely present; flagged as needing no deployment of its own.`
      );
      await patchItem(item.id, {
        status: "ready-for-testing",
        patchReady: false,
        patchAttempts: 0,
        noDeploymentRequired: true,
        deployBranch,
        updatedAt: new Date().toISOString(),
        notes,
        ...(testVersion ? { testVersion } : {}),
      });
      console.log(`[apply-patch] ${item.id}: patchFiles produced no diff against ${deployBranch} — advancing without a commit`);
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

  // A train carrying a workflow-file change can't be merged by the pipeline
  // (see processDeployTrain): flag the project so the Deploy step leaves the
  // PR open for a person instead of attempting a merge that would be refused.
  if (workflowPaths.length && !project.needsHumanMerge) {
    await patchProject(projectId, { needsHumanMerge: true, updatedAt: new Date().toISOString() });
  }

  const deployCommits = (Array.isArray(item.deployCommits) ? item.deployCommits.slice() : []).concat([sha]);
  // A previewUrl already pointing at this train is a real choice (possibly a
  // human's) and is kept; anything else — including a stale link to a
  // pre-train `claude/...` branch — is regenerated against the train.
  const previewUrl = (item.previewUrl && String(item.previewUrl).includes(`/${deployBranch}/`))
    ? item.previewUrl
    : guessPreviewUrl(item.patchFiles, deployBranch, trainTreeUrl(deployBranch));

  const notes = await appendNote(
    item,
    `Committed to the project's integration branch \`${deployBranch}\` as ${sha.slice(0, 7)} (${changedPaths.join(", ")}). ` +
    `It is built on top of every ticket already on that branch, so the test link shows this change in the combination it will ship in. ` +
    `Nothing merges to main until every ticket on the train is approved and someone clicks Deploy to Main.` +
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
    previewUrl,
    // A re-patch answers whatever Failed testing said, so a revert request
    // (and any block it was stuck behind) from that round is spent.
    revertRequested: false,
    revertBlockedBy: [],
    ...(testVersion ? { testVersion } : {}),
    ...(workflowPaths.length ? { requiresHumanMerge: true } : {}),
  });
  console.log(`[apply-patch] ${item.id}: committed ${sha.slice(0, 7)} on ${deployBranch}, moved to ready-for-testing${testVersion ? ` (testVersion ${testVersion})` : ""}`);

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

  // Newest first — reverting an older commit before a newer one that builds
  // on it is the guaranteed way to manufacture a conflict.
  const ordered = commits.slice().reverse();
  const reverted = [];
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
  run("git", ["checkout", "main", "--quiet"]);
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
  console.log(`[merge-pr] ${item.id}: merged PR #${prNumber}, moved to published-live${mergeCommit ? ` (${mergeCommit.slice(0, 7)})` : ""}`);
}

// How long processDeployTrain waits for a train PR's checks inside one run
// before giving up and letting the next scheduled run pick it up. The job
// polls every 2 minutes anyway, so there is nothing to gain by holding a
// runner open longer than this — trainReady stays set and the wait simply
// continues on the next tick.
const TRAIN_CI_POLLS = 10;
const TRAIN_CI_POLL_MS = 15000;

// Collapses `gh pr view --json statusCheckRollup` into one word. The rollup
// mixes two shapes — CheckRun (status + conclusion) and StatusContext
// (state) — so both are handled; an empty rollup is "none" (this repo runs
// no pull_request-triggered workflows today, so that is the normal case)
// and is treated as nothing to wait for, not as a failure.
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
    "--json", "number,state,url,mergeable,statusCheckRollup,files"]);
  return JSON.parse(json);
}

// Post-merge bookkeeping, shared by processDeployTrain (the pipeline merged
// it) and reconcileMergedTrains (a person merged it — the workflow-file
// case). Flips every ticket on the train to live, triggers the Firebase
// deploy when the merge touched backlog-tracker/, and resets the branch back
// to main so the next train starts from a clean base.
async function finishTrain(project, deployBranch, prNumber, trainItems, { touchesBacklogTracker }) {
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

  const mergedAt = new Date().toISOString();
  for (const item of trainItems) {
    const notes = await appendNote(
      item,
      `Shipped in the deployment train PR #${prNumber}, merged to main with ${trainItems.length === 1 ? "no other ticket" : `${trainItems.length - 1} other ticket(s)`} from \`${deployBranch}\`.`
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

  await patchProject(project.id, {
    trainReady: false,
    trainLocked: false,
    trainStatus: "idle",
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
  const deployBranch = project.deployBranch || deployBranchForName(project.name);
  const allItems = await itemsForProject(project.id);
  const onTrain = onTrainItems(allItems);

  if (!onTrain.length) {
    console.log(`[deploy-train] ${project.id}: nothing on the train — clearing trainReady`);
    await patchProject(project.id, {
      trainReady: false, trainStatus: "idle",
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

  // 1. Bring main in. This is the only remaining conflict path — it needs
  //    someone to have pushed to main, in this project's files, outside the
  //    pipeline — and it is deliberately never resolved automatically.
  checkoutTrain(deployBranch);
  try {
    run("git", ["-c", "user.name=backlog-automation", "-c", "user.email=backlog-automation@users.noreply.github.com",
      "merge", "origin/main", "--no-edit", "--quiet"]);
  } catch (err) {
    try { run("git", ["merge", "--abort"]); } catch { /* nothing in progress */ }
    discardWorkingTree();
    console.log(`[deploy-train] ${project.id}: merging main into ${deployBranch} conflicted`);
    await patchProject(project.id, {
      trainReady: false,
      trainStatus: "conflict",
      trainNote: `Merging main into ${deployBranch} conflicted, so nothing was merged and no card was moved. ` +
        `Something changed the same lines straight on main. Resolve it by merging main into ${deployBranch} by hand, then click Deploy to Main again.\n\n${scrubSecrets(err.message)}`,
      updatedAt: new Date().toISOString(),
    });
    return;
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
    const checks = rollupState(pr.statusCheckRollup);
    if (checks === "failure") {
      await patchProject(project.id, {
        trainReady: false, trainStatus: "conflict",
        trainNote: `Not merged: CI is red on the train PR #${prNumber}. Fix it (or send the ticket that broke it back with Failed testing), then click Deploy to Main again.`,
        updatedAt: new Date().toISOString(),
      });
      console.log(`[deploy-train] ${project.id}: CI red on PR #${prNumber} — not merging`);
      return;
    }
    if (String(pr.mergeable).toUpperCase() === "CONFLICTING") {
      await patchProject(project.id, {
        trainReady: false, trainStatus: "conflict",
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
  if (pr && pr.state !== "MERGED" && rollupState(pr.statusCheckRollup) === "pending") {
    // Leave trainReady set: the next scheduled run picks the wait back up
    // rather than needing another click.
    console.log(`[deploy-train] ${project.id}: PR #${prNumber}'s checks are still running — will retry on the next run`);
    await patchProject(project.id, {
      trainStatus: "deploying",
      trainNote: `Waiting on CI for PR #${prNumber}.`,
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

  await finishTrain(project, deployBranch, prNumber, onTrain, { touchesBacklogTracker });
}

// The train's equivalent of reconcileHumanMergedPrs: a train PR the pipeline
// deliberately refused to merge (it touches .github/workflows/) gets merged
// by a person, and nothing would otherwise notice. Every run checks each
// project that is waiting on such a merge and finishes the bookkeeping the
// moment GitHub says the PR is MERGED — no second click, no Routine fire.
async function reconcileMergedTrains() {
  const waiting = await runQuery({
    from: [{ collectionId: "projects" }],
    where: { fieldFilter: { field: { fieldPath: "trainStatus" }, op: "EQUAL", value: { stringValue: "awaiting-human-merge" } } },
  });
  for (const project of waiting) {
    const prNumber = Number(project.trainPrNumber) || null;
    if (!prNumber) continue;
    let pr = null;
    try {
      pr = JSON.parse(run("gh", ["pr", "view", String(prNumber), "--repo", REPO, "--json", "state,files"]));
    } catch (err) {
      console.log(`[deploy-train] ${project.id}: couldn't read PR #${prNumber} state (${err.message}) — skipping this run`);
      continue;
    }
    if (pr.state !== "MERGED") continue;
    const deployBranch = project.deployBranch || deployBranchForName(project.name);
    const onTrain = onTrainItems(await itemsForProject(project.id));
    if (!onTrain.length) {
      await patchProject(project.id, { trainStatus: "idle", trainReady: false, trainLocked: false, trainPrNumber: null, updatedAt: new Date().toISOString() });
      continue;
    }
    console.log(`[deploy-train] ${project.id}: PR #${prNumber} was merged outside the pipeline — recording ${onTrain.length} ticket(s) as live`);
    const touchesBacklogTracker = !Array.isArray(pr.files) || pr.files.some((f) => f.path.startsWith("backlog-tracker/"));
    await finishTrain(project, deployBranch, prNumber, onTrain, { touchesBacklogTracker });
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
async function reconcileDeployStatuses() {
  const pending = await runQuery({
    from: [{ collectionId: "backlogItems" }],
    where: { fieldFilter: { field: { fieldPath: "deployConclusion" }, op: "EQUAL", value: { stringValue: "pending" } } },
  });
  if (!pending.length) return;
  console.log(`[deploy-status] ${pending.length} item(s) with a pending deploy to check`);
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
      await patchItem(item.id, {
        deployConclusion: match.conclusion || "unknown",
        ...(match.url ? { deployRunUrl: match.url } : {}),
        updatedAt: new Date().toISOString(),
      });
      console.log(`[deploy-status] ${item.id}: deploy run finished — ${match.conclusion || "unknown"}`);
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
    picked.push({ ...item, mergeReady: true, mergePrNumber: Number(prNumber) });
  }
  return picked;
}

async function main() {
  await reconcileDeployStatuses();
  await reconcileMergedTrains();
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
  await recordPipelineHealth("success");
}

main().catch(async (err) => {
  console.error(err.stack || err.message);
  await recordPipelineHealth("failure");
  process.exit(1);
});
