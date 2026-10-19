// Tests the REAL public/js/follow-up.js — plain ESM, no Firebase, no DOM.
// Run with:  node test/follow-up.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FAILED_TESTING_CHOICES, DEFAULT_FAILED_TESTING_CHOICE, sendBackFields, followUpWrites } from "../public/js/follow-up.js";
import { parseIntake, missingSections } from "../public/js/ticket-intake.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const at = new Date("2026-10-19T10:00:00Z");

// The default is today's behaviour.
assert.equal(DEFAULT_FAILED_TESTING_CHOICE, FAILED_TESTING_CHOICES.SEND_BACK);

// Send back: exactly the write failTestingNow used to build inline.
const sb = sendBackFields({ category: "Other", text: "broken", at });
assert.equal(sb.status, "backlog");
assert.equal(sb.revertRequested, true);
assert.deepEqual(sb.lastFailureReason, { category: "Other", text: "broken", action: "failed-testing", at });
assert.deepEqual(sb.note, { author: "viewer", text: "Failed testing [Other]: broken", at });

// Follow-up.
const original = { id: "orig123", projectId: "p1", title: "Rename the booking page", category: "HQ Admin", status: "ready-for-testing", deployBranch: "deploy/x" };
const text = "Please can you also show approve and reject on hover";
const r = followUpWrites({ original, text, title: "Show approve and reject on hover", author: "a@b.com", at, newId: "new456" });
assert.equal(r.error, undefined);
const n = r.newItem;
assert.equal(n.status, "backlog");
assert.equal(n.projectId, "p1");
assert.equal(n.category, "HQ Admin");
assert.equal(n.followUpOf, "orig123");
assert.equal(n.type, "feature");
const parsed = parseIntake(n.desc).sections;
assert.equal(parsed.outcome, text);
assert.match(parsed.deps, /orig123/);
assert.match(parsed.deps, /Rename the booking page/);
assert.match(parsed.spec, /orig123/);
const missing = missingSections(n.desc).map((s) => s.key);
assert.ok(!missing.includes("deps") && !missing.includes("spec"));
assert.deepEqual(missing, ["test"]);

// Nothing pipeline-shaped, nothing that reverts.
const pipeline = ["patchFiles", "patchBranch", "patchReady", "mergeReady", "deployCommit", "deployCommits", "carriedByCommit", "carriedByItem",
  "mergeCommit", "mergedAt", "prNumber", "prUrl", "deployBranch", "testVersion", "reviewStatus", "reviewReason", "reviewedAt", "reviewedCommit",
  "patchBaseSha", "autoRebuilds", "patchPartCount", "revertRequested", "lastFailureReason", "previewUrl"];
for (const k of pipeline) assert.ok(!(k in n), `new item must not carry ${k}`);
assert.equal(n.notes.length, 1);
assert.equal(n.notes[0].author, "a@b.com");
assert.match(n.notes[0].text, /Follow-up of "Rename the booking page" \(orig123\)/);
assert.match(r.originalNote.text, /new456/);
assert.equal(r.originalNote.author, "a@b.com");
assert.deepEqual(Object.keys(r).sort(), ["newId", "newItem", "originalNote"]);

// Category falls back.
assert.equal(followUpWrites({ original: { ...original, category: undefined }, text, title: "t", at, newId: "x" }).newItem.category, "Uncategorised");

// Rules caps.
const big = followUpWrites({ original, text: "x".repeat(9000), title: "y".repeat(500), at, newId: "n" });
assert.ok(big.newItem.desc.length <= 10000);
assert.ok(big.newItem.title.length <= 200);
const huge = followUpWrites({ original, text: "x".repeat(20000), title: "t", at, newId: "n" });
assert.ok(huge.newItem.desc.length <= 10000);
assert.match(parseIntake(huge.newItem.desc).sections.spec, /orig123/);

// Errors, no writes.
for (const bad of [
  followUpWrites({ original, text: "   ", title: "t", at, newId: "n" }),
  followUpWrites({ original: { ...original, projectId: "" }, text, title: "t", at, newId: "n" }),
]) {
  assert.ok(bad.error);
  assert.equal(bad.newItem, undefined);
  assert.equal(bad.originalNote, undefined);
}

// app.js uses the module and no longer builds the note inline.
const app = fs.readFileSync(path.join(here, "..", "public", "js", "app.js"), "utf8");
assert.match(app, /import\s*\{[^}]*\bsendBackFields\b[^}]*\bfollowUpWrites\b[^}]*\}\s*from\s*"\.\/follow-up\.js"/);
assert.ok(!app.includes("Failed testing ["), "app.js must not build the send-back note inline");
console.log("follow-up.test.mjs: ok");
