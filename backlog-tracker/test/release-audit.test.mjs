// The release audit: the pure pieces on both sides of the deployables
// (public/js/release-audit.js in the console, functions/release-audit.js in the
// cloud function), plus guards that the per-ticket FAQ flow is gone.
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const require = createRequire(import.meta.url);
const client = await import(pathToFileURL(path.join(root, "public/js/release-audit.js")).href);
const fn = require(path.join(root, "functions/release-audit.js"));

const art = (id, title, extra = {}) => ({ id, title, ...extra });
const rev = (o) => ({ title: "t", bodyMd: "b", reviewStatus: "awaiting-review", ...o });

// classification: only this release's proposals, grouped update/new/retire
const rows = client.classifyAudit([
  art("a1", "Zeta", { pendingRevision: rev({ sourceReleaseId: "R1", reason: "renamed" }) }),
  art("a2", "Alpha", { pendingRevision: rev({ sourceReleaseId: "R1" }) }),
  art("a3", "Brand new", { pendingRevision: rev({ sourceReleaseId: "R1", isNew: true, reviewStatus: "approved" }) }),
  art("a4", "Old", { retireProposal: { reason: "gone", sourceReleaseId: "R1", reviewStatus: "awaiting-review" } }),
  art("a5", "Other release", { pendingRevision: rev({ sourceReleaseId: "R2" }) }),
  art("a6", "Per-ticket legacy", { pendingRevision: rev({ sourceItemIds: ["x"] }) }),
  art("a7", "Rejected retire", { retireProposal: { reason: "x", sourceReleaseId: "R1", reviewStatus: "rejected" } }),
], "R1");
assert.deepStrictEqual(rows.map((r) => `${r.kind}:${r.article.id}:${r.state}`),
  ["update:a2:awaiting-review", "update:a1:awaiting-review", "new:a3:approved", "retire:a4:awaiting-review"]);
assert.deepStrictEqual(client.auditCounts(rows), { update: 2, new: 1, retire: 1, awaiting: 3 });
assert.deepStrictEqual(client.classifyAudit([], "R1"), []);

// log: ordered by time, tolerant of timestamps
const log = client.sortedLog({ log: [{ at: "2026-11-02T10:00:00Z", type: "approved" }, { at: { toMillis: () => Date.parse("2026-11-02T09:00:00Z") }, type: "audit-started" }] });
assert.deepStrictEqual(log.map((e) => e.type), ["audit-started", "approved"]);
assert.strictEqual(client.sortedLog(null).length, 0);

// the client's log entry has the same shape as the function's
const c = client.reviewLogEntry({ type: "approved", by: "a@b.c", articleId: "a1", title: "T", at: "2026-11-02T00:00:00Z" });
const f = fn.auditLogEntry({ type: "approved", by: "a@b.c", articleId: "a1", title: "T", at: "2026-11-02T00:00:00Z" });
assert.deepStrictEqual(c, f);
for (const type of Object.keys(client.AUDIT_LOG_LABELS)) assert.ok(fn.LOG_TYPES.has(type), `function knows log type ${type}`);
assert.throws(() => fn.auditLogEntry({ type: "nonsense" }));

// fire text: the marker the instructions key off, plus the release and projects
const text = fn.buildAuditRequestText({ releaseId: "R1", release: { name: "Spring", version: "5.2" }, projects: [{ id: "p1", name: "DSP", programId: "g1" }], requestedByEmail: "rob@x.com" });
assert.ok(text.startsWith('=== RELEASE AUDIT REQUEST for "Spring (5.2)" (releaseId: R1)'));
assert.ok(text.includes("projectId: p1, programId: g1") && text.includes("rob@x.com"));
assert.ok(fn.buildAuditRequestText({ releaseId: "R", release: {}, projects: [] }).includes("none assigned"));

// the per-ticket FAQ flow is gone
const index = fs.readFileSync(path.join(root, "functions/index.js"), "utf8");
assert.ok(!/exports\.onBacklogItemPublishedLive/.test(index), "no FAQ promotion/flagging when a ticket merges");
assert.ok(!/faqAutoFlagOnLive/.test(index.replace(/\/\/.*$/gm, "")), "no per-project auto-flag");
assert.ok(!index.includes("FAQ impact review"), "the deploy fire no longer mentions the FAQ impact review");
assert.ok(/exports\.onReleaseMarkedLive[\s\S]*releaseAudits/.test(index), "marking a release live opens an audit");
const instr = fs.readFileSync(path.join(root, "ROUTINE_INSTRUCTIONS.md"), "utf8");
assert.ok(!/^3b\. \*\*FAQ impact review/m.test(instr), "the Deploy flow has no FAQ step");
assert.ok(instr.includes("=== RELEASE AUDIT REQUEST"), "the instructions describe the release audit fire");

// the release status people see
const app = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8");
assert.ok(app.includes('live: "Live on AWS Marketplace"'));
console.log("release-audit tests passed");
