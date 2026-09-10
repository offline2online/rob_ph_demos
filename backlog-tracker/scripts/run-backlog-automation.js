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

function pickPreviewUrl(branch, patchFiles, prUrl) {
  // Best-effort "Test this ->" target for a Ready for Testing card, so a
  // reviewer never has to fall back to the manual "Set test link" prompt
  // for a normal static-file fix. Prefer the first changed/created HTML
  // page outside functions/ (githack can only ever serve a raw static
  // file, never run a Cloud Function), rawcdn.githack.com'd against the
  // branch we just pushed; fall back to the PR URL when nothing in the
  // patch is a plain static page (e.g. a functions-only or JS/CSS-only
  // change) rather than leaving the card untested.
  const htmlFile = (patchFiles || []).find(
    (f) => f && typeof f.path === "string" && f.content != null && /\.html?$/i.test(f.path) && !f.path.split("/").includes("functions")
  );
  if (htmlFile) return `https://rawcdn.githack.com/${REPO}/${branch}/${htmlFile.path}`;
  return prUrl || null;
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

async function processApplyPatch(item) {
  console.log(`[apply-patch] ${item.id}: ${item.title || item.desc}`);
  if (!Array.isArray(item.patchFiles) || item.patchFiles.length === 0) {
    console.log(`[apply-patch] ${item.id}: no patchFiles present, leaving patchReady set for a human to check`);
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
    console.log(`[apply-patch] ${item.id}: patchFiles produced no actual diff against main, skipping`);
    run("git", ["checkout", "main", "--quiet"]);
    return;
  }

  const commitMessage = item.patchCommitMessage || `Fix: ${item.title || item.desc || item.id}`;
  run("git", ["-c", "user.name=backlog-automation", "-c", "user.email=backlog-automation@users.noreply.github.com", "commit", "-m", commitMessage, "--quiet"]);
  run("git", ["push", "-u", "origin", branch, "--quiet"]);

  const prTitle = item.patchPrTitle || commitMessage;
  const prBody = (item.patchPrBody || "Implemented by the Notify Claude backlog pipeline.") +
    `\n\nBacklog item: ${item.id}`;
  const prUrl = run("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", prTitle, "--body", prBody]);

  const previewUrl = pickPreviewUrl(branch, item.patchFiles, prUrl);
  const notes = await appendNote(item, `Opened ${prUrl} from the automated backlog pipeline.`);
  await patchItem(item.id, {
    status: "ready-for-testing",
    patchReady: false,
    previewUrl,
    updatedAt: new Date().toISOString(),
    notes,
  });
  console.log(`[apply-patch] ${item.id}: opened ${prUrl}, moved to ready-for-testing, previewUrl=${previewUrl}`);

  run("git", ["checkout", "main", "--quiet"]);
}

async function processMergePr(item) {
  console.log(`[merge-pr] ${item.id}: ${item.title || item.desc}`);
  const prNumber = item.mergePrNumber;
  if (!prNumber) {
    console.log(`[merge-pr] ${item.id}: no mergePrNumber set, skipping`);
    return;
  }
  try {
    run("gh", ["pr", "merge", String(prNumber), "--merge", "--repo", REPO]);
  } catch (err) {
    console.log(`[merge-pr] ${item.id}: gh pr merge #${prNumber} failed (will retry on next scheduled run): ${err.message}`);
    return;
  }

  const notes = await appendNote(item, `Merged PR #${prNumber} to main from the automated backlog pipeline.`);
  await patchItem(item.id, {
    status: "published-live",
    mergeReady: false,
    updatedAt: new Date().toISOString(),
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
