// "Rebuilding test link…": the automation writes previewState on a card whose
// link opens a checked-in build, and keeps it honest from build-info.json
// (lmdwsP5ElY5Oh12N9Fex).
//
// A card pinned to the ticket's own commit shows the PREVIOUS bundle until
// dsp-prototype.yml rebuilds. Testers failed tickets on it (k1ZIa7lksk9gQjTVrLgN,
// OtNAsifjp3ZUtDEsdzu0). The bundle names the source commit it was built from;
// the card is current when the ticket's commit is an ancestor of that.
//
// Drives the REAL functions with a fake `gh` on PATH, an in-memory Firestore
// behind a stubbed fetch, and a disposable git repo with a bare origin.
// Run with:  node test/preview-build-state.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "preview-build-"));
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(path.join(tmp, "sa.json"), JSON.stringify({ client_email: "t@example.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(tmp, "sa.json");

const ghLog = path.join(tmp, "gh.log");
fs.writeFileSync(path.join(tmp, "gh"), `#!/bin/sh\necho "$@" >> "${ghLog}"\n`, { mode: 0o755 });
process.env.PATH = `${tmp}:${process.env.PATH}`;

const auto = require("../scripts/run-backlog-automation.js");
const { previewLinkFields, refreshPreviewBuildStates, noDiffPatchFields, rebuildNote, repointTrainPreviewUrls, dispatchFollowUpRun, followUpReasons, PREVIEW_REBUILD_STALE_MS } = auto;

// ── disposable repo: bare origin + a working clone (the cwd the sweep runs in)
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const origin = path.join(tmp, "origin.git");
const work = path.join(tmp, "work");
fs.mkdirSync(origin);
git(origin, "init", "--bare", "-q", "-b", "main");
git(tmp, "clone", "-q", origin, work);
git(work, "config", "user.email", "t@example.com");
git(work, "config", "user.name", "t");
const BRANCH = "deploy/dsp-integration";
const BUILD_INFO = "dsp-integration/prototype/build-info.json";
let seq = 0;
function commit(files, msg) {
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, p)), { recursive: true });
    fs.writeFileSync(path.join(work, p), c);
  }
  git(work, "add", "-A");
  git(work, "commit", "-q", "--allow-empty", "-m", `${msg} #${++seq}`);
  return git(work, "rev-parse", "HEAD");
}
const info = (c) => JSON.stringify({ commit: c, branch: BRANCH });
const A0 = commit({ "dsp-integration/apps/admin/x.ts": "1", [BUILD_INFO]: info("none") }, "base");
git(work, "checkout", "-q", "-b", BRANCH);
// The bundle at A0 was built from A0's own parent-less state.
const T = commit({ "dsp-integration/apps/admin/x.ts": "2" }, "ticket");                       // the ticket's commit; bundle still says "none"
const R = commit({ [BUILD_INFO]: info(T) }, "rebuild from ticket");                           // rebuild of T
const D = commit({ "dsp-integration/apps/admin/y.ts": "3" }, "another ticket");               // a descendant
const Q = commit({ [BUILD_INFO]: info(A0) }, "stale rebuild rebased onto the newer tip");     // build-info predates T
git(work, "push", "-q", "origin", BRANCH);
git(work, "checkout", "-q", "main");
process.chdir(work);

// ── in-memory Firestore
let items = {};
const writes = [];
function dec(v) {
  if (!v || "nullValue" in v) return null;
  for (const k of ["stringValue", "booleanValue", "doubleValue", "timestampValue"]) if (k in v) return v[k];
  if ("integerValue" in v) return Number(v.integerValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
  return null;
}
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return { integerValue: String(v) };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
  return { stringValue: String(v) };
}
global.fetch = async (url, opts = {}) => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  url = String(url);
  if (url.startsWith("https://oauth2.googleapis.com/token")) return ok({ access_token: "t", expires_in: 3600 });
  if (url.endsWith(":runQuery")) {
    const f = JSON.parse(opts.body).structuredQuery.where.fieldFilter;
    const field = f.field.fieldPath, want = dec(f.value);
    const match = (it) => (f.op === "IN" ? want.includes(it[field]) : it[field] === want);
    return ok(Object.entries(items).filter(([, it]) => match(it))
      .map(([id, it]) => ({ document: { name: `x/backlogItems/${id}`, fields: Object.fromEntries(Object.entries(it).map(([k, v]) => [k, enc(v)])) } })));
  }
  if (url.endsWith(":commit")) {
    const w = JSON.parse(opts.body).writes[0];
    const name = (w.update || w.transform).document || w.update.name;
    const id = name.split("/").pop();
    if (w.update) Object.assign(items[id], Object.fromEntries(Object.entries(w.update.fields).map(([k, v]) => [k, dec(v)])));
    const t = (w.updateTransforms || w.transform.fieldTransforms)[0];
    items[id].notes = (items[id].notes || []).concat(t.appendMissingElements.values.map(dec));
    writes.push({ id, via: "commit", fields: w.update ? Object.keys(w.update.fields) : [], notes: t.appendMissingElements.values.length });
    return ok({});
  }
  const m = url.match(/\/backlogItems\/([^?/]+)\?/);
  if (m && opts.method === "PATCH") {
    const fields = Object.fromEntries(Object.entries(JSON.parse(opts.body).fields).map(([k, v]) => [k, dec(v)]));
    Object.assign(items[m[1]], fields);
    writes.push({ id: m[1], via: "patch", fields: Object.keys(fields) });
    return ok({});
  }
  throw new Error(`unexpected fetch ${url}`);
};

const REPO_URL = "https://rawcdn.githack.com/offline2online/rob_ph_demos";
const link = (ref, p = "dsp-integration/prototype/index.html") => `${REPO_URL}/${ref}/${p}`;
const NOW = Date.parse("2026-10-19T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const ghCalls = () => (fs.existsSync(ghLog) ? fs.readFileSync(ghLog, "utf8").trim().split("\n").filter(Boolean) : []);
const card = (extra) => ({
  status: "ready-for-testing", deployBranch: BRANCH, deployCommit: T, previewUrl: link(T), previewSha: T,
  previewState: "rebuilding", previewStateAt: iso(NOW - 60e3), previewBuildWorkflow: "dsp-prototype.yml", ...extra,
});

let passed = 0; const failures = [];
async function test(name, fn) {
  items = {}; writes.length = 0; followUpReasons.length = 0; try { fs.unlinkSync(ghLog); } catch {}
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.stack || err}`); }
}

(async () => {
  await test("a DSP source patch is 'rebuilding' on dsp-prototype.yml, pinned to the commit", () => {
    const f = previewLinkFields(["dsp-integration/apps/admin/x.ts"], link(T), T, "2026-10-19T12:00:00.000Z");
    assert.strictEqual(f.previewState, "rebuilding");
    assert.strictEqual(f.previewBuildWorkflow, "dsp-prototype.yml");
    assert.strictEqual(f.previewStateAt, "2026-10-19T12:00:00.000Z");
    assert.strictEqual(f.previewSha, T);
    assert.strictEqual(f.previewUpdatedAt, "2026-10-19T12:00:00.000Z");
    assert.strictEqual(f.previewBuiltFrom, null);
  });

  await test("a console patch, a DSP docs-only patch and a person's own link are null", () => {
    const bt = previewLinkFields(["backlog-tracker/public/js/app.js"], link(T, "backlog-tracker/public/index.html"), T);
    assert.strictEqual(bt.previewState, null);
    assert.strictEqual(bt.previewBuildWorkflow, null);
    const docs = previewLinkFields(["dsp-integration/docs/dsp-integration/REQUIREMENTS.md"], link(T), T);
    assert.strictEqual(docs.previewState, null);
    const own = previewLinkFields(["dsp-integration/apps/admin/x.ts"], "https://example.com/my-own-link", T);
    assert.strictEqual(own.previewState, null);
    assert.strictEqual(own.previewSha, null, "no pin recorded for a link the pipeline didn't make");
    // A source change whose link is NOT under the build's output (a back-end ticket's tree link).
    const tree = previewLinkFields(["dsp-integration/apps/api/a.ts"], `https://github.com/offline2online/rob_ph_demos/tree/${BRANCH}`, T);
    assert.strictEqual(tree.previewState, null);
  });

  await test("the carried (no-diff) path carries the fields; the main path is never 'rebuilding'", () => {
    const pf = previewLinkFields(["dsp-integration/apps/admin/x.ts"], link(T), T);
    const out = noDiffPatchFields({ id: "c1" }, { sha: T, itemId: "other" }, { deployBranch: BRANCH, previewUrl: link(T), previewFields: pf });
    assert.strictEqual(out.kind, "carried");
    assert.strictEqual(out.fields.previewState, "rebuilding");
    assert.strictEqual(out.fields.previewSha, T);
    const main = noDiffPatchFields({ id: "c2" }, null, { deployBranch: BRANCH, mainPreviewUrl: link("main"), mainPreviewFields: { ...previewLinkFields([], link("main"), "main"), previewState: null } });
    assert.strictEqual(main.kind, "already-on-main");
    assert.strictEqual(main.fields.previewState, null);
  });

  await test("link at the ticket's own commit (older bundle) stays rebuilding with no write; a follow-up is requested", async () => {
    items.a = card({});
    const r = await refreshPreviewBuildStates(NOW);
    assert.strictEqual(writes.length, 0);
    assert.strictEqual(items.a.previewState, "rebuilding");
    assert.strictEqual(r.anyRebuilding, true);
    assert.strictEqual(dispatchFollowUpRun(), true);
    assert.ok(ghCalls().some((c) => c.startsWith("workflow run backlog-automation.yml")), ghCalls().join("\n"));
  });

  await test("link at a rebuild of the ticket's commit, or at a descendant, is ready with previewBuiltFrom / previewSha", async () => {
    items.a = card({ previewUrl: link(R) });
    items.b = card({ previewUrl: link(D), deployCommit: T });
    await refreshPreviewBuildStates(NOW);
    for (const [id, ref] of [["a", R], ["b", D]]) {
      assert.strictEqual(items[id].previewState, "ready", id);
      assert.strictEqual(items[id].previewBuiltFrom, T, id);
      assert.strictEqual(items[id].previewSha, ref, id);
    }
    assert.strictEqual(dispatchFollowUpRun(), false, "nothing is rebuilding: no follow-up run");
    assert.ok(!ghCalls().some((c) => c.startsWith("workflow run backlog-automation.yml")));
  });

  await test("a rebuild rebased onto a newer tip whose build-info predates the ticket stays rebuilding", async () => {
    items.a = card({ previewUrl: link(Q) });
    await refreshPreviewBuildStates(NOW);
    assert.strictEqual(items.a.previewState, "rebuilding");
    assert.strictEqual(writes.length, 0);
  });

  await test("21 minutes rebuilding: stale with exactly one note naming the workflow; no repeat; a later including build turns it ready", async () => {
    items.a = card({ previewStateAt: iso(NOW - 21 * 60e3), notes: [] });
    await refreshPreviewBuildStates(NOW);
    assert.strictEqual(items.a.previewState, "stale");
    assert.strictEqual(items.a.notes.length, 1);
    assert.match(items.a.notes[0].text, /actions\/workflows\/dsp-prototype\.yml/);
    await refreshPreviewBuildStates(NOW + 60e3);
    assert.strictEqual(items.a.notes.length, 1, "no repeat notes");
    assert.strictEqual(items.a.previewState, "stale");
    items.a.previewUrl = link(R); // a later build includes it
    await refreshPreviewBuildStates(NOW + 120e3);
    assert.strictEqual(items.a.previewState, "ready");
    assert.strictEqual(items.a.notes.length, 1);
    assert.ok(PREVIEW_REBUILD_STALE_MS === 20 * 60 * 1000);
  });

  await test("a ready card whose link moved to a bundle without it goes back to rebuilding", async () => {
    items.a = card({ previewState: "ready", previewStateAt: iso(NOW - 600e3), previewSha: R, previewBuiltFrom: T, previewUrl: link(Q) });
    await refreshPreviewBuildStates(NOW);
    assert.strictEqual(items.a.previewState, "rebuilding");
    assert.strictEqual(items.a.previewStateAt, iso(NOW));
  });

  await test("a ready card whose link hasn't moved is skipped without a write", async () => {
    items.a = card({ previewState: "ready", previewStateAt: iso(NOW - 600e3), previewUpdatedAt: iso(NOW - 700e3), previewSha: R, previewBuiltFrom: T, previewUrl: link(R) });
    await refreshPreviewBuildStates(NOW);
    assert.strictEqual(writes.length, 0);
  });

  await test("a card back in Backlog, or whose link stopped opening a build, is nulled", async () => {
    items.a = card({ status: "backlog" });
    items.b = card({ previewUrl: "https://example.com/own" });
    await refreshPreviewBuildStates(NOW);
    for (const id of ["a", "b"]) {
      assert.strictEqual(items[id].previewState, null, id);
      assert.strictEqual(items[id].previewBuildWorkflow, null, id);
    }
  });

  await test("an unknown ref or an unreadable build-info changes nothing", async () => {
    items.a = card({ previewUrl: link("0".repeat(40)) });
    items.b = card({ previewUrl: link(A0) }); // A0 has a build-info whose commit "none" isn't a commit
    await refreshPreviewBuildStates(NOW);
    assert.strictEqual(writes.length, 0);
    assert.strictEqual(items.a.previewState, "rebuilding");
    assert.strictEqual(items.b.previewState, "rebuilding");
  });

  await test("repointTrainPreviewUrls writes previewSha / previewUpdatedAt and no note", async () => {
    items.s = { projectId: "p", status: "ready-for-testing", deployBranch: BRANCH, previewUrl: link(T), notes: [] };
    await repointTrainPreviewUrls("p", BRANCH, D, "someone-else");
    assert.strictEqual(items.s.previewUrl, link(D));
    assert.strictEqual(items.s.previewSha, D);
    assert.ok(items.s.previewUpdatedAt);
    assert.deepStrictEqual(items.s.notes, []);
    assert.ok(writes.every((w) => w.via === "patch" && !w.fields.includes("notes")));
  });

  await test("rebuildNote points at the card's state line and no longer promises a note", () => {
    const text = rebuildNote(["dsp-prototype.yml"], T);
    assert.match(text, /Rebuilding test link/);
    assert.doesNotMatch(text, /a note here says so/);
    assert.strictEqual(rebuildNote([], T), "");
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
