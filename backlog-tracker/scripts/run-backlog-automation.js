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
// with no AI involved at all, on a schedule — turns that into a real
// branch, commit, and PR using the runner's own credentials. It also
// handles the mirror case (`mergeReady: true`) for the Deploy-notify flow,
// merging an already-reviewed PR once the Routine has confirmed it's green.
//
// Idempotent and safe to run on a schedule: an item only gets processed
// while its own patchReady/mergeReady flag is still true, and both flags
// are cleared as part of the same write that records success.

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

function sanitizeBranchName(name, itemId) {
  const slug = String(name || "backlog-fix")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "backlog-fix";
  return `claude/${slug}-${itemId.slice(0, 6).toLowerCase()}`;
}

// The backlog-tracker APP_VERSION a Ready for Testing item gets stamped
// with (see the item's own testVersion field, set just below in
// processApplyPatch) — read straight off disk *after* applyPatchFiles has
// run, so this reflects whatever version.js will actually end up on `main`
// once this PR merges (including a version bump this same patchFiles
// carries, per ROUTINE_INSTRUCTIONS.md's "always bump the version" rule),
// not a value read before the patch was applied.
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

// ── The approval gate ──────────────────────────────────────────────────
// This script runs twice per trigger, as two jobs in backlog-automation.yml:
//
//   AUTOMATION_MODE=standard (default)
//     The ordinary job. Holds the run's own GITHUB_TOKEN, which cannot push
//     workflow files, so it processes every item that does NOT touch
//     .github/workflows/ and defers the ones that do — leaving their
//     patchReady set and reporting has_workflow_patches=true as a step
//     output so the gated job below knows to run.
//
//   AUTOMATION_MODE=workflow
//     The gated job. Runs only when the standard job deferred something,
//     and only after a human approves it in the Actions UI (the job declares
//     `environment: workflow-changes`, whose required reviewer is what makes
//     the pause happen). It holds a GitHub App installation token with
//     `workflows: write`, and processes ONLY the deferred items.
//
// Why a gate rather than simply giving the job a workflow-capable token:
// patchFiles is the one field on a backlog item with real authority over
// this repo, and firestore.rules does not validate it at all. Anything that
// can write a backlog item can therefore propose arbitrary workflow YAML,
// and BOARD_API_KEY — which authenticates as an allowlisted editor — is
// handed to Routine-fired sessions that read content we do not fully
// control. An unattended workflow-scoped credential would turn that into
// self-modifying CI. A human approving each workflow-touching batch is what
// makes the capability safe to have at all; do not remove the environment
// from the job in backlog-automation.yml.
const MODE = process.env.AUTOMATION_MODE === "workflow" ? "workflow" : "standard";

function itemTouchesWorkflows(item) {
  return workflowPathsIn(item.patchFiles).length > 0;
}

// Appends a step output for the workflow to branch on. GITHUB_OUTPUT is set
// by the runner; absent when running by hand, where this is simply a no-op.
function setStepOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  fs.appendFileSync(file, `${name}=${value}\n`);
}

// Marks an item as waiting on the gated job. Deliberately leaves patchReady
// TRUE — the item is not failed and not finished, it is queued, and the
// gated job selects on exactly that flag. awaitingApproval only exists to
// keep the explanatory note from being written once every two minutes for
// as long as the approval sits unclicked.
async function deferToApprovalGate(item) {
  const paths = workflowPathsIn(item.patchFiles);
  console.log(`[apply-patch] ${item.id}: deferring — touches ${paths.length} workflow file(s), needs approval`);
  setStepOutput("has_workflow_patches", "true");

  if (item.awaitingApproval) return;

  const notes = await appendNote(
    item,
    `Held for approval: this item's patchFiles include ${paths.length} file(s) under ${WORKFLOW_PATH_PREFIX} ` +
    `(${paths.join(", ")}). The ordinary automation job pushes with its run's own GITHUB_TOKEN, which GitHub ` +
    `refuses to let touch a workflow file, so this item is handled by the gated "Apply workflow-file patches" ` +
    `job instead — it uses a GitHub App token with workflows: write and waits for a human to approve the run ` +
    `in the Actions tab.\n\nNothing is wrong with this card and nothing has been retried or discarded: the ` +
    `work packaged on it is untouched and it will land as soon as the run is approved.`
  );
  await patchItem(item.id, { awaitingApproval: true, updatedAt: new Date().toISOString(), notes });
}

// Whether the PR behind a merge-ready item carries workflow-file changes.
// The same GITHUB_TOKEN restriction applies to a MERGE that brings workflow
// changes onto main, not only to a direct push — so a merge-ready item whose
// PR touches .github/workflows/ has to go through the gated job too. Any
// failure to determine this is treated as "yes, gate it": the gated path is
// always safe to take, it only costs an approval click, whereas guessing
// "no" puts the merge back on the credential that cannot perform it.
function prTouchesWorkflows(prNumber) {
  try {
    const json = run("gh", ["pr", "view", String(prNumber), "--repo", REPO, "--json", "files"]);
    const files = JSON.parse(json).files || [];
    return files.some((f) => String(f.path || "").startsWith(WORKFLOW_PATH_PREFIX));
  } catch (err) {
    console.error(`[merge-pr] couldn't read changed files for PR #${prNumber}, gating it to be safe: ${err.message}`);
    return true;
  }
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
// Generalized over the patch-apply path (attemptsField: "patchAttempts",
// readyField: "patchReady", the default) and the merge path (attemptsField:
// "mergeAttempts", readyField: "mergeReady") — same shape of bug either
// way: a transient failure (a network blip, a GitHub 5xx) genuinely does
// succeed on a later run, but retrying it forever with nothing recorded on
// the card is how a permanent failure hides for hours with no visible
// reason. The merge path used to just console.error a failed `gh pr merge`
// and leave the card at Approved for Deployment showing "Waiting for
// Notify Claude — Deploy" forever (yLzaj00wwFI5qxjOGbRe) — this gives it
// the exact same note-then-give-up treatment the patch path already had.
async function recordAttemptFailure(item, err, { attemptsField = "patchAttempts", readyField = "patchReady", verb = "open a PR for" } = {}) {
  const attempts = (Number(item[attemptsField]) || 0) + 1;
  const reason = err instanceof Error ? (err.message || String(err)) : String(err);
  const giveUp = attempts >= MAX_PATCH_ATTEMPTS;
  const fields = { [attemptsField]: attempts, updatedAt: new Date().toISOString() };

  if (attempts === 1 || giveUp) {
    const text = giveUp
      ? `Gave up after ${attempts} failed attempts to ${verb} this item. ${readyField} has been cleared so the job stops retrying; the work packaged on the card is untouched. Last error:\n\n${reason}`
      : `Attempt ${attempts} to ${verb} this item failed; it will be retried on the next run (up to ${MAX_PATCH_ATTEMPTS}). Error:\n\n${reason}`;
    fields.notes = await appendNote(item, text);
  }
  if (giveUp) fields[readyField] = false;

  await patchItem(item.id, fields);
  console.error(`[${readyField}] ${item.id}: attempt ${attempts}/${MAX_PATCH_ATTEMPTS} failed${giveUp ? ` — giving up, ${readyField} cleared` : ""}: ${reason}`);
}

// findExistingPrForItem: finds an OPEN PR whose body carries this item's
// "Backlog item: <id>" marker. Originally a duplicate guard (PR #61 was
// opened from a half-finished item and closed as a duplicate of #62); now
// it feeds resolveReusablePr, which attaches the item to that PR instead
// of refusing to proceed. Deliberately OPEN-only (see dWJtVKC310qgMevZ3XPl,
// 2026-09-11: a re-patch after PR #84 had merged found #84 via the marker
// and refused to open the follow-up PR): a MERGED or CLOSED PR is finished
// or dead work and must never block a fresh round on the same item.
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
// "Set test link" flow already documents.
function guessPreviewUrl(patchFiles, branch, prUrl) {
  const htmlPaths = (patchFiles || [])
    .filter((f) => f && typeof f.path === "string" && f.content !== null && f.content !== undefined)
    .map((f) => f.path)
    .filter((p) => p.endsWith(".html") && !p.includes("/functions/"));
  if (!htmlPaths.length) return prUrl;
  const path = htmlPaths.sort((a, b) => a.length - b.length)[0];
  return `https://rawcdn.githack.com/${REPO}/${branch}/${path}`;
}

// Finds a PR by exact head branch, in ANY state — deliberately different
// from findExistingPrForItem's OPEN-only, body-text search just below.
// That one is a broad duplicate guard across the whole repo; this one asks
// a narrower, reconciliation-specific question: "does THIS item's own
// branch (which nothing else could ever share, since the name embeds the
// item id) already have a PR, left over from an earlier run of this same
// job that didn't finish?" Because the branch is item-scoped, a CLOSED
// match here is a genuine "a human already looked at and rejected this
// round of work" signal, not the "different round of work, ignore it"
// case findExistingPrForItem's own comment documents for the body-text
// search.
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

function findExistingPrForItem(itemId) {
  let json;
  try {
    json = run("gh", [
      "pr", "list", "--repo", REPO, "--state", "open",
      "--search", `"Backlog item: ${itemId}" in:body`,
      "--json", "number,state,url,headRefName",
    ]);
  } catch (err) {
    console.log(`[apply-patch] ${itemId}: couldn't check for an existing PR (${err.message}) — proceeding without the duplicate check`);
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

// Picks the OPEN PR a patch-ready item should land on, if one exists —
// the item's own recorded PR first, then a PR on the item's own branch,
// then any open PR whose body carries this item's marker (a multi-item
// batch opened from a sibling's branch). Returns null when there is no
// open PR, in which case a fresh branch + PR is the right outcome.
//
// This replaced a hard stop. Before, an open PR referencing the item made
// the job clear patchReady, leave the card in Backlog and ask a human to
// "close it manually before setting patchReady again" — which is exactly
// the wrong answer in the two cases that actually produce it: (1) a batch
// of items packaged together (same patchBranch, one combined diff, one PR
// listing every item — PR #131 carried three): the first item's run opens
// the PR, and every sibling then bounced off it; (2) a re-patch of an item
// whose PR is still open (tested, sent back, fixed again): the follow-up
// fix had nowhere to go. In both cases the PR IS this item's PR, so the
// item should be attached to it (adding the new work as a commit where
// there is any) and move on to Ready for Testing, not backwards.
function resolveReusablePr(item, branch) {
  const recorded = Number(item.prNumber) || (String(item.prUrl || "").match(/\/pull\/(\d+)/) || [])[1];
  if (recorded) {
    const pr = viewPr(recorded);
    if (pr && pr.state === "OPEN") return { ...pr, source: "recorded" };
  }
  const own = findPrForBranch(branch);
  if (own && own.state === "OPEN") {
    const pr = viewPr(own.number) || { ...own, headRefName: branch };
    return { ...pr, source: "own-branch" };
  }
  const batch = findExistingPrForItem(item.id);
  if (batch) return { ...batch, source: batch.headRefName === branch ? "own-branch" : "batch" };
  return null;
}

// Restores a clean checkout of main after patchFiles were written on some
// other branch and are not going to be committed there.
function discardWorkingTree() {
  try { run("git", ["reset", "--hard", "--quiet"]); } catch { /* nothing staged */ }
  try { run("git", ["clean", "-fdq"]); } catch { /* nothing to clean */ }
  run("git", ["checkout", "main", "--quiet"]);
}

// Lands a patch-ready item on an already-open PR (see resolveReusablePr).
// The item's own PR (recorded on the card, or on its own branch) gets the
// new patchFiles committed on top of the PR branch — that is the re-patch
// case, and the branch is what the Routine's follow-up fix was meant to
// update. A batch sibling's PR is only ever attached, never rewritten: the
// PR was opened with the combined content for every item it lists, so the
// sibling's own patchFiles are normally identical to what is already on
// the branch (no diff). Where they do differ, the sibling's copy is by
// definition a partial view of a shared file (see "Group multi-item fixes
// into one deployment" in ROUTINE_INSTRUCTIONS.md) and committing it would
// undo the other items' changes — so the branch is left as-is and the
// difference is called out on the card for whoever tests it.
async function attachToExistingPr(item, pr) {
  const head = pr.headRefName;
  console.log(`[apply-patch] ${item.id}: attaching to open PR #${pr.number} (${pr.source}, branch ${head})`);
  run("git", ["fetch", "origin", head, "--quiet"]);
  run("git", ["checkout", "-B", head, `origin/${head}`, "--quiet"]);

  applyPatchFiles(item.patchFiles);
  // Read while the patched files are still on disk (the batch case below
  // discards them), so testVersion reflects the branch this PR will merge.
  const testVersion = readAppVersion();
  run("git", ["add", "-A"]);
  let changedPaths = [];
  try {
    const out = run("git", ["diff", "--cached", "--name-only"]);
    changedPaths = out ? out.split("\n").filter(Boolean) : [];
  } catch { /* treat as no changes */ }

  let noteText;
  if (!changedPaths.length) {
    noteText = `Attached to the already-open PR #${pr.number} (${pr.url}): this item's patchFiles are already on its branch (${head}), so nothing new was committed. Moving to Ready for Testing with that PR.`;
  } else if (pr.source === "batch") {
    // Not ours to rewrite — see the comment above.
    noteText = `Attached to the already-open PR #${pr.number} (${pr.url}), which was opened for a batch that includes this item. ` +
      `This item's own patchFiles differ from what is on that branch (${head}) in: ${changedPaths.join(", ")} — the PR's combined version has been kept and this copy was NOT committed, ` +
      `so it can't undo the other items' changes to the same files. Test against the PR; if this item's fix is genuinely missing there, re-patch it on top of the PR branch.`;
    discardWorkingTree();
    changedPaths = [];
  } else {
    const commitMessage = item.patchCommitMessage || `Fix: ${item.title || item.desc || item.id}`;
    run("git", ["-c", "user.name=backlog-automation", "-c", "user.email=backlog-automation@users.noreply.github.com", "commit", "-m", commitMessage, "--quiet"]);
    run("git", ["push", "origin", head, "--quiet"]);
    noteText = `Updated the already-open PR #${pr.number} (${pr.url}) with a new commit on its branch (${head}) carrying this round's patchFiles (${changedPaths.join(", ")}). Moving to Ready for Testing with that PR.`;
  }

  const notes = await appendNote(item, noteText);
  const previewUrl = item.previewUrl || guessPreviewUrl(item.patchFiles, head, pr.url);
  await patchItem(item.id, {
    status: "ready-for-testing",
    patchReady: false,
    patchAttempts: 0,
    awaitingApproval: false,
    updatedAt: new Date().toISOString(),
    notes,
    prUrl: pr.url,
    prNumber: Number(pr.number),
    previewUrl,
    ...(testVersion ? { testVersion } : {}),
  });
  console.log(`[apply-patch] ${item.id}: attached to PR #${pr.number}${changedPaths.length ? ` (+1 commit)` : ""}, moved to ready-for-testing`);
  run("git", ["checkout", "main", "--quiet"]);
}

async function processApplyPatch(item) {
  console.log(`[apply-patch] ${item.id}: ${item.title || item.desc}`);
  if (!Array.isArray(item.patchFiles) || item.patchFiles.length === 0) {
    console.log(`[apply-patch] ${item.id}: no patchFiles present, leaving patchReady set for a human to check`);
    return;
  }

  // Which job is allowed to handle this item. main() partitions the queue
  // before calling here, so reaching the wrong branch of this means the two
  // are out of step — fail loudly rather than attempt a push that GitHub
  // will reject, which is what used to leave a card retrying invisibly.
  const workflowPaths = workflowPathsIn(item.patchFiles);
  if (workflowPaths.length && MODE !== "workflow") {
    throw new Error(
      `Item touches ${workflowPaths.length} workflow file(s) (${workflowPaths.join(", ")}) but this is the ` +
      `${MODE} job, whose GITHUB_TOKEN cannot push them. It should have been deferred to the gated job.`
    );
  }
  if (!workflowPaths.length && MODE === "workflow") {
    throw new Error(`Item touches no workflow files but reached the gated job, which exists only for those.`);
  }

  const branch = sanitizeBranchName(item.patchBranch, item.id);

  // Reconcile against this item's own branch FIRST, before the broader
  // body-text duplicate guard below. A run of this job that gets cancelled
  // mid-item (backlog-automation.yml's own concurrency group queues
  // instead of killing an in-progress run, but a burst of triggers can
  // still queue several runs back to back — see its comment) can leave
  // real GitHub state — a pushed branch, sometimes even an already-opened
  // PR — with the item's own Firestore doc never updated to say so, since
  // the write that would have recorded it never got to run. Before this
  // check existed, the item just sat patchReady:true and the next run's
  // fresh `git push` to this same deterministic branch name failed
  // outright (non-fast-forward against the stale push), retried every ~2
  // minutes until MAX_PATCH_ATTEMPTS gave up — a permanent failure with no
  // record of the real cause. Checking by exact branch name (unlike the
  // body-text search below, this branch can never belong to any other
  // item) finds exactly that leftover state and reconciles instead of
  // trying, and failing, to redo it.
  // An OPEN PR for this item — its own (recorded on the card, or on its
  // own branch, including one left by an interrupted earlier run that
  // never got to record it) or a batch sibling's — is where this work
  // lands. See resolveReusablePr/attachToExistingPr: the item is attached
  // to that PR (with a new commit where it is the item's own PR and the
  // patchFiles add anything) and moves to Ready for Testing. An open PR is
  // never a reason to bounce the card back to Backlog any more.
  const reusablePr = resolveReusablePr(item, branch);
  if (reusablePr) {
    await attachToExistingPr(item, reusablePr);
    return;
  }

  // No open PR. A MERGED or CLOSED PR on the item's own branch is finished
  // or rejected work from an earlier round, not this one — patchReady was
  // set again deliberately, so this round gets a fresh branch push (the
  // --force below recreates the branch from main) and its own new PR. The
  // one exception is handled further down: if the patchFiles turn out to
  // already be on main (the merged case, or a sibling's PR having landed
  // them), there is no diff and the item advances without a PR.
  const priorPr = findPrForBranch(branch);
  if (priorPr && priorPr.state !== "OPEN") {
    console.log(`[apply-patch] ${item.id}: branch ${branch} previously carried ${priorPr.state} PR #${priorPr.number} — starting a fresh round on the same branch name`);
  }

  run("git", ["fetch", "origin", "main", "--quiet"]);
  run("git", ["checkout", "-B", "main", "origin/main", "--quiet"]);
  run("git", ["checkout", "-B", branch, "--quiet"]);

  applyPatchFiles(item.patchFiles);

  run("git", ["add", "-A"]);
  let hasChanges = true;
  try {
    run("git", ["diff", "--cached", "--quiet"]);
    hasChanges = false;
  } catch {
    hasChanges = true;
  }
  if (!hasChanges) {
    // Same class of "stuck forever, no record of why" bug as the
    // old existing-PR guard (since replaced by attachToExistingPr) — this branch used to
    // just log and return, leaving patchReady/status untouched, so an
    // item whose patchFiles turn out to already be on main (the expected
    // outcome for one half of a multi-item "shared, full combined
    // content" batch — see "Group multi-item fixes into one deployment"
    // in ROUTINE_INSTRUCTIONS.md — once its sibling's PR merges first)
    // would silently retry every scheduled run forever with nothing to
    // show for it. The content genuinely IS on main at this point (that's
    // what "no diff" means), so treat it the same as a successful patch
    // that just didn't need its own PR: advance to ready-for-testing with
    // a note explaining why, so a human still gets a chance to test it
    // and the item doesn't rot in Backlog indefinitely.
    console.log(`[apply-patch] ${item.id}: patchFiles produced no actual diff against main — already present, advancing without a new PR`);
    run("git", ["checkout", "main", "--quiet"]);
    const notes = await appendNote(
      item,
      `No PR opened: patchFiles produced no diff against main — this content is already there, most likely delivered by a sibling item's shared-file patch in the same batch (see "Group multi-item fixes into one deployment"). Moved to Ready for Testing directly since the fix is genuinely live; check this item's notes/deployment group for which PR actually carried it.`
    );
    const testVersion = readAppVersion();
    // Nothing was pushed for this item and nothing will be, so flag it as
    // needing no deployment. Otherwise it reaches Approved for Deployment
    // and waits on a Deploy to Main that has no PR to merge — a dead end
    // whoever tests it has to escape by moving the card backwards.
    await patchItem(item.id, {
      status: "ready-for-testing",
      patchReady: false,
      patchAttempts: 0,
      awaitingApproval: false,
      noDeploymentRequired: true,
      updatedAt: new Date().toISOString(),
      notes,
      ...(testVersion ? { testVersion } : {}),
    });
    return;
  }

  const commitMessage = item.patchCommitMessage || `Fix: ${item.title || item.desc || item.id}`;
  run("git", ["-c", "user.name=backlog-automation", "-c", "user.email=backlog-automation@users.noreply.github.com", "commit", "-m", commitMessage, "--quiet"]);
  // --force, deliberately: branch is this item's own deterministic name
  // (sanitizeBranchName embeds the item id), pushed only ever by this
  // script for this one item, and resolveReusablePr above already ruled
  // out an OPEN PR on it. The cases a plain push would otherwise fail on —
  // this exact branch already sitting on origin with different history,
  // left by an earlier run cancelled after pushing but before opening its
  // PR, or by an earlier round whose PR has since merged or been closed —
  // are exactly what this needs to recover from automatically rather than
  // failing non-fast-forward and retrying into MAX_PATCH_ATTEMPTS.
  run("git", ["push", "-u", "origin", branch, "--force", "--quiet"]);

  const prTitle = item.patchPrTitle || commitMessage;
  const prBody = (item.patchPrBody || "Implemented by the Notify Claude backlog pipeline.") +
    `\n\nBacklog item: ${item.id}`;
  const prUrl = run("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", prTitle, "--body", prBody]);

  const notes = await appendNote(
    item,
    `Opened ${prUrl} from the automated backlog pipeline.` +
    (priorPr && priorPr.state !== "OPEN"
      ? ` This is a new round of work: the item's earlier PR #${priorPr.number} (${priorPr.url}) was ${priorPr.state === "MERGED" ? "already merged" : "closed without merging"}, so the fresh patchFiles got their own PR.`
      : "")
  );
  const testVersion = readAppVersion();
  // Record the PR on the item itself, not only in the note text above:
  // the board renders these as a link on the card (see app.js's prBadge),
  // so "which PR is this card" stops being a question you answer by
  // reading notes or searching GitHub.
  const prNumber = Number((String(prUrl).match(/\/pull\/(\d+)/) || [])[1]) || null;
  // Only auto-set previewUrl when the item doesn't already have one — a
  // human may have already set a link by hand (e.g. re-patching an item
  // that was already in Ready for Testing once), and that manual choice
  // shouldn't be silently clobbered by a guess.
  const previewUrl = item.previewUrl || guessPreviewUrl(item.patchFiles, branch, String(prUrl).trim());
  await patchItem(item.id, {
    status: "ready-for-testing",
    patchReady: false,
    patchAttempts: 0,
    awaitingApproval: false,
    updatedAt: new Date().toISOString(),
    notes,
    prUrl: String(prUrl).trim(),
    previewUrl,
    ...(prNumber ? { prNumber } : {}),
    ...(testVersion ? { testVersion } : {}),
  });
  console.log(`[apply-patch] ${item.id}: opened ${prUrl}, moved to ready-for-testing${testVersion ? ` (testVersion ${testVersion})` : ""}`);

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
  // bug as findExistingPrForItem/the no-diff branch above (see their own
  // comments, both fixed 2026-09-11): an item can legitimately reach here
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
  let prState = null;
  try {
    const viewJson = run("gh", ["pr", "view", String(prNumber), "--repo", REPO, "--json", "files,state"]);
    const parsed = JSON.parse(viewJson);
    touchesBacklogTracker = (parsed.files || []).some((f) => f.path.startsWith("backlog-tracker/"));
    prState = parsed.state; // "OPEN" | "CLOSED" | "MERGED"
  } catch (err) {
    console.log(`[merge-pr] ${item.id}: couldn't read PR #${prNumber}'s file list/state (${err.message}) — will trigger the backlog-tracker deploy anyway to be safe, and still attempt the merge below`);
    touchesBacklogTracker = true;
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

async function main() {
  await reconcileDeployStatuses();

  const patchReadyItems = await runQuery({
    from: [{ collectionId: "backlogItems" }],
    where: { fieldFilter: { field: { fieldPath: "patchReady" }, op: "EQUAL", value: { booleanValue: true } } },
  });
  const mergeReadyItems = await runQuery({
    from: [{ collectionId: "backlogItems" }],
    where: { fieldFilter: { field: { fieldPath: "mergeReady" }, op: "EQUAL", value: { booleanValue: true } } },
  });

  console.log(`Found ${patchReadyItems.length} patch-ready item(s) and ${mergeReadyItems.length} merge-ready item(s)`);

  // Split both queues by which job is allowed to handle them. The standard
  // job takes everything that does not touch .github/workflows/ and defers
  // the rest; the gated job takes exactly the deferred ones and nothing
  // else. Always write has_workflow_patches, including "false" — an output
  // the workflow reads must exist on every run, or the gated job's `if:`
  // silently evaluates against an empty string on the runs that matter.
  const patchNeedsGate = patchReadyItems.filter(itemTouchesWorkflows);
  const patchPlain = patchReadyItems.filter((i) => !itemTouchesWorkflows(i));

  // Merge-ready items are classified by their PR's changed files, so this
  // costs one `gh pr view` per item; only done in the standard job, and
  // only for items that actually have a PR recorded.
  const mergeNeedsGate = [];
  const mergePlain = [];
  for (const item of mergeReadyItems) {
    const prNumber = item.mergePrNumber;
    if (prNumber && prTouchesWorkflows(prNumber)) mergeNeedsGate.push(item);
    else mergePlain.push(item);
  }

  const gatedCount = patchNeedsGate.length + mergeNeedsGate.length;
  setStepOutput("has_workflow_patches", gatedCount > 0 ? "true" : "false");
  console.log(`[${MODE}] ${gatedCount} item(s) need the approval gate; ${patchPlain.length + mergePlain.length} can proceed normally`);

  if (MODE === "standard") {
    for (const item of patchNeedsGate) {
      try {
        await deferToApprovalGate(item);
      } catch (err) {
        console.error(`[apply-patch] ${item.id}: couldn't record the deferral: ${err.message}`);
      }
    }
    for (const item of mergeNeedsGate) {
      console.log(`[merge-pr] ${item.id}: deferring — its PR touches workflow files, needs approval`);
    }
  }

  // In the gated job these two lists ARE the deferred items; in the
  // standard job they are everything else. Same loops either way.
  const patchQueue = MODE === "workflow" ? patchNeedsGate : patchPlain;
  const mergeQueue = MODE === "workflow" ? mergeNeedsGate : mergePlain;

  for (const item of patchQueue) {
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
  for (const item of mergeQueue) {
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
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
