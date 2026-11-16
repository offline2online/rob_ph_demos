// Contract-change review flags (ZmEWDC40NYOiojehfPjk, 16 Nov 2026): when a
// ticket's build changes an interface contract, every open ticket that builds
// after it is flagged "Needs review: upstream contract changed" (never
// edited), its next build fire carries the change, and its own landing clears
// the flag. Pure helpers, the REAL contractChangeOf against a disposable git
// repo, and the REAL flagContractDependents against an in-memory Firestore.
// No network or credentials.
//
// Run with:  node test/contract-review.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const cr = require("../functions/contract-review");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contract-review-"));
const keyFile = path.join(dir, "sa.json");
const { privateKey } = require("crypto").generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(keyFile, JSON.stringify({ client_email: "t@t", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFile;

// In-memory Firestore REST, the shape run-backlog-automation.js speaks.
const docs = new Map();
const DOC = (id) => `projects/backlog-tracker-e4ed2/databases/(default)/documents/backlogItems/${id}`;
global.fetch = async (url, o = {}) => {
  const reply = (status, body = {}) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (url.includes("oauth2")) return reply(200, { access_token: "t", expires_in: 3600 });
  if (url.endsWith(":runQuery")) {
    const q = JSON.parse(o.body).structuredQuery;
    const f = q.where && q.where.fieldFilter;
    const rows = [...docs].filter(([, fields]) => {
      if (!f || f.op !== "ARRAY_CONTAINS") return true;
      const arr = fields[f.field.fieldPath];
      return !!(arr && arr.arrayValue && (arr.arrayValue.values || []).some((v) => v.stringValue === f.value.stringValue));
    });
    return reply(200, rows.map(([name, fields]) => ({ document: { name, fields } })));
  }
  if (url.endsWith(":commit")) {
    for (const w of JSON.parse(o.body).writes) {
      const name = w.update ? w.update.name : w.transform.document;
      const d = docs.get(name);
      if (!d) return reply(404, {});
      if (w.update) for (const k of w.updateMask.fieldPaths) d[k] = w.update.fields[k];
      for (const ft of (w.updateTransforms || w.transform.fieldTransforms || [])) {
        const have = (d[ft.fieldPath] && d[ft.fieldPath].arrayValue.values) || [];
        d[ft.fieldPath] = { arrayValue: { values: ft.removeAllFromArray ? have : [...have, ...ft.appendMissingElements.values] } };
      }
    }
    return reply(200, { writeResults: [{}] });
  }
  if ((o.method || "GET") === "PATCH") {
    const d = docs.get(DOC(url.split("/backlogItems/")[1].split("?")[0]));
    for (const [k, v] of Object.entries(JSON.parse(o.body).fields)) d[k] = v;
    return reply(200);
  }
  return reply(200);
};
const auto = require("../scripts/run-backlog-automation.js");
const card = (id) => ({ id, ...auto.fdoc(docs.get(DOC(id))) });
function reset(cards) {
  docs.clear();
  for (const c of cards) {
    const { id, ...rest } = c;
    docs.set(DOC(id), Object.fromEntries(Object.entries({ projectId: "P1", ...rest }).map(([k, v]) => [k, auto.tv(v)])));
  }
}

// A disposable repo with a contract, its manifest and an unrelated file.
const repo = path.join(dir, "repo");
fs.mkdirSync(path.join(repo, "shared"), { recursive: true });
fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
git("init", "-q", "-b", "main");
git("config", "user.email", "t@ph.example"); git("config", "user.name", "t");
const CONTRACT_V1 = "# Interface contract\n\n## Attribute envelope\n\nkey: string\nvalue: string\n\n## Deadline model\n\n50ms budget\n";
fs.writeFileSync(path.join(repo, "shared/interface-contract.md"), CONTRACT_V1);
fs.writeFileSync(path.join(repo, "shared/board-interfaces.json"), JSON.stringify({ interfaces: [{ id: "I1", path: "shared/interface-contract.md" }, { id: "I2", path: "docs/partner-api.md" }] }));
fs.writeFileSync(path.join(repo, "docs/partner-api.md"), "# Partner API\n\n## Bids\n\nprice\n");
fs.writeFileSync(path.join(repo, "app.js"), "console.log(1);\n");
git("add", "-A"); git("commit", "-q", "-m", "base");
const commit = (msg) => { git("add", "-A"); git("commit", "-q", "-m", msg); return git("rev-parse", "HEAD"); };

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.stack}`); }
}

(async () => {
  await test("contractPathsFrom: the two shared files plus every file the manifest lists; a bad manifest leaves the base", () => {
    assert.deepStrictEqual(cr.contractPathsFrom(JSON.stringify({ interfaces: [{ path: "./shared/x.md" }, { path: "../etc/passwd" }, { path: 3 }] })),
      ["shared/interface-contract.md", "shared/board-interfaces.json", "shared/x.md"]);
    assert.deepStrictEqual(cr.contractPathsFrom("not json"), cr.BASE_CONTRACT_PATHS.slice());
    assert.deepStrictEqual(cr.contractFilesIn(["app.js", "shared/x.md"], ["shared/interface-contract.md", "shared/x.md"]), ["shared/x.md"]);
  });

  await test("sectionsTouched: names the Markdown headings the hunks fall under, once each, ignoring code fences", () => {
    const text = "# T\n\n## A\n\nx\n\n```\n# not a heading\n```\n\n## B\n\ny\n";
    assert.deepStrictEqual(cr.parseHunks("@@ -5 +5,2 @@\n@@ -13,0 +14 @@ ctx"), [{ oldStart: 5, oldCount: 1, newStart: 5, newCount: 2 }, { oldStart: 13, oldCount: 0, newStart: 14, newCount: 1 }]);
    assert.deepStrictEqual(cr.sectionsTouched(text, [{ newStart: 5, newCount: 1 }, { newStart: 8, newCount: 1 }, { newStart: 13, newCount: 1 }]), ["A", "B"]);
  });

  await test("summary, record, notes and the fire block say what changed and that nothing else was edited", () => {
    const summary = cr.summariseContractChange([{ path: "shared/interface-contract.md", added: 2, removed: 1, sections: ["Attribute envelope"] }]);
    assert.strictEqual(summary, "shared/interface-contract.md (+2 −1; sections: Attribute envelope)");
    const rec = cr.contractReviewRecord({ upstream: { id: "up", title: "Back end" }, commit: "a".repeat(40), files: [{ path: "shared/interface-contract.md" }], summary, now: new Date("2026-11-16T05:00:00Z") });
    assert.deepStrictEqual(rec, { status: "needs-review", upstreamItemId: "up", upstreamTitle: "Back end", commit: "a".repeat(40), files: ["shared/interface-contract.md"], summary, flaggedAt: "2026-11-16T05:00:00.000Z" });
    assert.match(cr.dependentNote(rec), /^Needs review: upstream contract changed\. "Back end".*aaaaaaa.*This ticket was not edited/);
    assert.match(cr.upstreamNote([{ id: "d1", title: "Front end" }], summary), /Flagged 1 dependent ticket for review: "Front end"/);
    const block = cr.contractReviewBlock({ contractReview: rec });
    assert.match(block, /=== UPSTREAM CONTRACT CHANGED: REVIEW THIS TICKET ===/);
    assert.match(block, /Do not edit the upstream ticket or any other ticket/);
    assert.strictEqual(cr.contractReviewBlock({}), "");
    assert.strictEqual(cr.contractReviewBlock({ contractReview: { ...rec, status: "reviewed" } }), "");
    assert.ok(cr.summariseContractChange([{ path: "x".repeat(2000) }]).length <= 600);
  });

  await test("dependentsToFlag: open tickets naming the upstream, never itself, never shipped or archived", () => {
    const list = [
      { id: "a", status: "backlog", dependsOnItemIds: ["up"] },
      { id: "b", status: "ready-for-testing", dependsOnItemIds: ["up", "z"] },
      { id: "c", status: "published-live", dependsOnItemIds: ["up"] },
      { id: "d", status: "archived", dependsOnItemIds: ["up"] },
      { id: "e", status: "backlog", dependsOnItemIds: ["z"] },
      { id: "up", status: "backlog", dependsOnItemIds: ["up"] },
    ];
    assert.deepStrictEqual(cr.dependentsToFlag(list, "up").map((w) => w.id), ["a", "b"]);
  });

  await test("contractChangeOf (real git): a change to an unrelated file is not a contract change", () => {
    fs.writeFileSync(path.join(repo, "app.js"), "console.log(2);\n");
    assert.strictEqual(auto.contractChangeOf(commit("app only"), { cwd: repo }), null);
  });

  await test("contractChangeOf (real git): the contract file, with line counts and the sections it touched", () => {
    fs.writeFileSync(path.join(repo, "shared/interface-contract.md"), CONTRACT_V1.replace("value: string\n", "value: string\nttlMs: number\n"));
    const c = auto.contractChangeOf(commit("contract"), { cwd: repo });
    assert.deepStrictEqual(c.files, [{ path: "shared/interface-contract.md", added: 1, removed: 0, sections: ["Attribute envelope"] }]);
    assert.strictEqual(c.summary, "shared/interface-contract.md (+1 −0; sections: Attribute envelope)");
  });

  await test("contractChangeOf (real git): a file the manifest lists counts too", () => {
    fs.writeFileSync(path.join(repo, "docs/partner-api.md"), "# Partner API\n\n## Bids\n\nprice\ncurrency\n");
    const c = auto.contractChangeOf(commit("partner api"), { cwd: repo });
    assert.deepStrictEqual(c.files.map((f) => [f.path, f.sections]), [["docs/partner-api.md", ["Bids"]]]);
  });

  await test("flagContractDependents: flags and notes open dependents, notes the upstream, edits nothing else", async () => {
    reset([
      { id: "up", title: "Back end", status: "ready-for-testing", notes: [] },
      { id: "dep", title: "Front end", desc: "Original desc", status: "backlog", dependsOnItemIds: ["up"], ownerEmail: "b@ph.example" },
      { id: "shipped", title: "Old", status: "published-live", dependsOnItemIds: ["up"] },
      { id: "other", title: "Unrelated", status: "backlog", dependsOnItemIds: ["x"] },
    ]);
    const change = { files: [{ path: "shared/interface-contract.md", added: 1, removed: 0, sections: ["Attribute envelope"] }], summary: "shared/interface-contract.md (+1 −0; sections: Attribute envelope)" };
    const flagged = await auto.flagContractDependents(card("up"), "b".repeat(40), change);
    assert.deepStrictEqual(flagged.map((w) => w.id), ["dep"]);
    const d = card("dep");
    assert.strictEqual(d.contractReview.status, "needs-review");
    assert.strictEqual(d.contractReview.upstreamItemId, "up");
    assert.strictEqual(d.contractReview.commit, "b".repeat(40));
    assert.deepStrictEqual(d.contractReview.files, ["shared/interface-contract.md"]);
    assert.match(d.notes[0].text, /^Needs review: upstream contract changed/);
    assert.strictEqual(d.desc, "Original desc", "the dependent's own work is untouched");
    assert.strictEqual(d.ownerEmail, "b@ph.example");
    assert.strictEqual(d.status, "backlog");
    assert.strictEqual(card("shipped").contractReview, undefined);
    assert.strictEqual(card("other").contractReview, undefined);
    assert.match(card("up").notes[0].text, /Flagged 1 dependent ticket for review: "Front end"/);
    assert.deepStrictEqual(await auto.flagContractDependents(card("up"), "b".repeat(40), null), [], "no change, no flag");
  });

  console.log(failed ? `\n${failed} failed` : "\nall passed");
  if (failed) process.exit(1);
})();
