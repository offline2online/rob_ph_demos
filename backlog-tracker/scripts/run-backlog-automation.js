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

async function runQuery(structuredQuery) {
  const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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

// Guards against the same item producing a second, duplicate GitHub PR —
// this has happened for real: a Routine-fired session debugging its own
// PATCH-payload code against a live production item left patchReady:true
// mid-debug with placeholder data, this job picked it up and opened a PR
// from that, and the item was later re-finished and re-submitted properly,
// producing a second PR for the same item (see PR #61, closed as a
// duplicate of #62). Fired sessions have no GitHub credential, so nothing
// in the pipeline could ever clean up a stray PR like that on its own —
// the fix is to never open a second one in the first place.
//
// Deliberately OPEN-only, not "all" (state used to be "all" — see
// dWJtVKC310qgMevZ3XPl, 2026-09-11: that item's PR #84 merged, the item
// was legitimately re-patched afterward with a genuinely new, separate
// fix, and this check found the already-merged #84 via its still-matching
// "Backlog item: <id>" body marker and silently refused to open a second
// PR for the new work — leaving the item stuck in Backlog with
// patchReady reset to false and no path forward, since a merged-then-
// re-patched item never produces "no actual diff" (which is the only
// other branch that would have surfaced the problem). A MERGED or CLOSED
// PR represents finished/dead work, not an in-flight duplicate — it
// should never block a fresh patch for a new round of work on the same
// item. Restricting this to state=open keeps the original guard intact
// (two genuinely open PRs for the same item is still exactly the bug
// this was built to prevent) while letting a legitimate follow-up fix
// get its own PR.
function findExistingPrForItem(itemId) {
  let json;
  try {
    json = run("gh", [
      "pr", "list", "--repo", REPO, "--state", "open",
      "--search", `"Backlog item: ${itemId}" in:body`,
      "--json", "number,state,url",
    ]);
  } catch (err) {
    console.log(`[apply-patch] ${itemId}: couldn't check for an existing PR (${err.message}) — proceeding without the duplicate check`);
    return null;
  }
  const prs = JSON.parse(json);
  return prs.length ? prs[0] : null;
}

async function processApplyPatch(item) {
  console.log(`[apply-patch] ${item.id}: ${item.title || item.desc}`);
  if (!Array.isArray(item.patchFiles) || item.patchFiles.length === 0) {
    console.log(`[apply-patch] ${item.id}: no patchFiles present, leaving patchReady set for a human to check`);
    return;
  }

  const existingPr = findExistingPrForItem(item.id);
  if (existingPr) {
    console.log(`[apply-patch] ${item.id}: PR #${existingPr.number} (${existingPr.state}) already references this item — not opening a duplicate`);
    const notes = await appendNote(
      item,
      `Skipped opening a new PR: #${existingPr.number} (${existingPr.url}, ${existingPr.state}) already exists for this item. ` +
      `If that PR is stale or wrong, close it manually before setting patchReady again.`
    );
    await patchItem(item.id, { patchReady: false, updatedAt: new Date().toISOString(), notes });
    return;
  }

  run("git", ["fetch", "origin", "main", "--quiet"]);
  run("git", ["checkout", "-B", "main", "origin/main", "--quiet"]);

  const branch = sanitizeBranchName(item.patchBranch, item.id);
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
    // existingPr guard above (see its own comment) — this branch used to
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
      noDeploymentRequired: true,
      updatedAt: new Date().toISOString(),
      notes,
      ...(testVersion ? { testVersion } : {}),
    });
    return;
  }

  const commitMessage = item.patchCommitMessage || `Fix: ${item.title || item.desc || item.id}`;
  run("git", ["-c", "user.name=backlog-automation", "-c", "user.email=backlog-automation@users.noreply.github.com", "commit", "-m", commitMessage, "--quiet"]);
  run("git", ["push", "-u", "origin", branch, "--quiet"]);

  const prTitle = item.patchPrTitle || commitMessage;
  const prBody = (item.patchPrBody || "Implemented by the Notify Claude backlog pipeline.") +
    `\n\nBacklog item: ${item.id}`;
  const prUrl = run("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", prTitle, "--body", prBody]);

  const notes = await appendNote(item, `Opened ${prUrl} from the automated backlog pipeline.`);
  const testVersion = readAppVersion();
  // Record the PR on the item itself, not only in the note text above:
  // the board renders these as a link on the card (see app.js's prBadge),
  // so "which PR is this card" stops being a question you answer by
  // reading notes or searching GitHub.
  const prNumber = Number((String(prUrl).match(/\/pull\/(\d+)/) || [])[1]) || null;
  await patchItem(item.id, {
    status: "ready-for-testing",
    patchReady: false,
    updatedAt: new Date().toISOString(),
    notes,
    prUrl: String(prUrl).trim(),
    ...(prNumber ? { prNumber } : {}),
    ...(testVersion ? { testVersion } : {}),
  });
  console.log(`[apply-patch] ${item.id}: opened ${prUrl}, moved to ready-for-testing${testVersion ? ` (testVersion ${testVersion})` : ""}`);

  run("git", ["checkout", "main", "--quiet"]);
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
      console.log(`[merge-pr] ${item.id}: gh pr merge #${prNumber} failed (will retry on next scheduled run): ${err.message}`);
      return;
    }
  } else {
    console.log(`[merge-pr] ${item.id}: PR #${prNumber} is already MERGED — skipping the merge attempt, proceeding straight to the success path`);
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
  if (touchesBacklogTracker) {
    try {
      run("gh", ["workflow", "run", "deploy-backlog-tracker.yml", "--repo", REPO, "--ref", "main"]);
      console.log(`[merge-pr] ${item.id}: triggered deploy-backlog-tracker.yml`);
    } catch (err) {
      console.log(`[merge-pr] ${item.id}: failed to trigger deploy-backlog-tracker.yml (${err.message}) — merge still succeeded, but the live site may be stale until the next deploy`);
    }
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
    updatedAt: new Date().toISOString(),
    mergedAt: new Date().toISOString(),
    prUrl: `https://github.com/${REPO}/pull/${prNumber}`,
    prNumber: Number(prNumber),
    notes,
  });
  console.log(`[merge-pr] ${item.id}: merged PR #${prNumber}, moved to published-live`);
}

async function main() {
  const patchReadyItems = await runQuery({
    from: [{ collectionId: "backlogItems" }],
    where: { fieldFilter: { field: { fieldPath: "patchReady" }, op: "EQUAL", value: { booleanValue: true } } },
  });
  const mergeReadyItems = await runQuery({
    from: [{ collectionId: "backlogItems" }],
    where: { fieldFilter: { field: { fieldPath: "mergeReady" }, op: "EQUAL", value: { booleanValue: true } } },
  });

  console.log(`Found ${patchReadyItems.length} patch-ready item(s) and ${mergeReadyItems.length} merge-ready item(s)`);

  for (const item of patchReadyItems) {
    try {
      await processApplyPatch(item);
    } catch (err) {
      console.error(`[apply-patch] ${item.id} failed: ${err.stack || err.message}`);
    }
  }
  for (const item of mergeReadyItems) {
    try {
      await processMergePr(item);
    } catch (err) {
      console.error(`[merge-pr] ${item.id} failed: ${err.stack || err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
