// The model suggested at intake (ticket CCPnRjXOH4YMsfy3C49r, "Flow 8/9").
// public/js/model-suggest.js is the source, functions/model-suggest.js its
// generated CommonJS copy (scripts/gen-model-suggest-cjs.sh). Each rule fires
// on a sample ticket and names its reason; a plain copy change is Standard; a
// person's explicit choice is kept; the browser and Node give the same
// answer; and the two files cannot drift.
//
// Run with:  node test/model-suggest.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const cjs = require("../functions/model-suggest.js");

let passed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.stack || err}`); }
}

const keys = (s) => s.reasons.map((r) => r.key);
const longDesc = (n) => `## Outcome\nBuild the thing.\n${Array.from({ length: n }, (_, i) => `${i + 1}. Step ${i + 1}: ${"words ".repeat(90)}`).join("\n")}\n\n## Test steps\n1. Open it.\n2. Check it.\n3. Again.\n4. Again.\n5. Again.\n6. Again.`;
const PROJECTS = [
  { id: "bt", repoFolder: null, ownedPaths: ["backlog-tracker/", "faq/"] },
  { id: "dsp", repoFolder: "dsp-integration", ownedPaths: null },
  { id: "kanban", ownedPaths: ["backlog-tracker/public/js/kanban/"] },
];
const SAMPLES = [
  { name: "security rules", item: { desc: "Let viewers read the new collection in firestore.rules" }, want: ["security"] },
  { name: "auth gate", item: { desc: "The sign-in wall in auth-gate.js should reload once" }, want: ["security"] },
  { name: "MCP OAuth", item: { desc: "Rotate refresh tokens in the MCP OAuth server" }, want: ["security"] },
  { name: "consoleUsers", item: { desc: "Add a column to consoleUsers for the role" }, want: ["security"] },
  { name: "secrets", item: { desc: "Read BOARD_API_KEY from Secret Manager" }, want: ["security"] },
  { name: "release pipeline", item: { desc: "processApplyPatch in scripts/run-backlog-automation.js should retry" }, want: ["pipeline"] },
  { name: "train lock", item: { desc: "functions/train-lock.js counts a carried card" }, want: ["pipeline"] },
  { name: "workflows", item: { desc: "Add a step to .github/workflows/deploy-backlog-tracker.yml" }, want: ["pipeline"] },
  { name: "backfill", item: { desc: "Backfill testRound on every archived card" }, want: ["migration"] },
  { name: "data migration", item: { desc: "A data migration moves the project docs into a subcollection" }, want: ["migration"] },
  { name: "interface contract", item: { desc: "Change the attribute envelope in shared/interface-contract.md" }, want: ["contract"] },
  { name: "two projects' files", item: { desc: "Touch dsp-integration/apps/api/src/x.ts and faq/js/faq.js together" }, want: ["multiProject"] },
  { name: "effort Large", item: { desc: "Rework the dashboard filters", effort: "large" }, want: ["large"] },
  { name: "long with many build items", item: { desc: longDesc(6) }, want: ["long"] },
];

(async () => {
  const esm = await import("../public/js/model-suggest.js");

  for (const s of SAMPLES) {
    await test(`rule: ${s.name} → Advanced, with its reason`, async () => {
      const r = cjs.suggestModel(s.item, { projects: PROJECTS });
      assert.strictEqual(r.model, "advanced");
      assert.deepStrictEqual(keys(r), s.want);
      assert.ok(r.reasons.every((x) => typeof x.text === "string" && x.text.length > 5), "each reason is said in words");
      assert.strictEqual(r.version, cjs.MODEL_SUGGEST_VERSION);
    });
  }

  await test("a plain copy change is Standard, with no reasons", async () => {
    const r = cjs.suggestModel({ title: "Fix the heading", desc: "## Outcome\nChange the heading on the help centre front page to say Welcome back." }, { projects: PROJECTS });
    assert.deepStrictEqual(r, { model: "standard", reasons: [], version: cjs.MODEL_SUGGEST_VERSION });
  });

  await test("near misses stay Standard: design tokens, one project's files, a short numbered list", async () => {
    assert.strictEqual(cjs.suggestModel({ desc: "Use the design tokens for the chip colours" }).model, "standard");
    assert.strictEqual(cjs.suggestModel({ desc: "Change faq/js/faq.js and faq/css/faq.css" }, { projects: PROJECTS }).model, "standard");
    assert.strictEqual(cjs.suggestModel({ desc: longDesc(4) }).model, "standard", "four build items is not five");
    assert.strictEqual(cjs.suggestModel({ desc: "1. a\n2. b\n3. c\n4. d\n5. e" }).model, "standard", "five items in a short ticket");
  });

  await test("ownedPaths decides the projects, and a sub-folder owned by another project counts", async () => {
    assert.deepStrictEqual(cjs.projectsTouched("Change backlog-tracker/public/js/kanban/board.js", PROJECTS).sort(), ["bt", "kanban"]);
    assert.deepStrictEqual(keys(cjs.suggestModel({ desc: "Change backlog-tracker/public/js/kanban/board.js" }, { projects: PROJECTS })), ["multiProject"]);
  });

  await test("no choice made: model takes the suggestion (modelAuto); a person's choice is kept", async () => {
    const adv = cjs.suggestModel({ desc: "Edit firestore.rules" });
    assert.deepStrictEqual(cjs.autoModelFields({ desc: "Edit firestore.rules" }, adv),
      { modelSuggested: { model: "advanced", reasons: [{ key: "security", text: "touches security rules" }], version: cjs.MODEL_SUGGEST_VERSION }, model: "advanced", modelAuto: true });
    const kept = cjs.autoModelFields({ desc: "Edit firestore.rules", model: "standard", modelAuto: false }, adv);
    assert.ok(!("model" in kept) && !("modelAuto" in kept), "explicit Standard is never overridden");
    assert.ok(kept.modelSuggested, "the suggestion is still recorded");
    const legacy = cjs.autoModelFields({ desc: "Edit firestore.rules", model: "standard" }, adv);
    assert.ok(!("model" in legacy), "a model set before this existed counts as chosen");
    const escalated = cjs.autoModelFields({ desc: "copy", model: "advanced", modelAuto: false, modelEscalatedAt: "2026-11-16T00:00:00Z" }, cjs.suggestModel({ desc: "copy" }));
    assert.ok(!("model" in escalated), "an escalation is not lowered by a later suggestion");
    const auto = { desc: "copy", model: "advanced", modelAuto: true, modelSuggested: adv };
    assert.deepStrictEqual(cjs.autoModelFields(auto, cjs.suggestModel(auto)).model, "standard", "an auto model follows a new description");
    const settled = { desc: "Edit firestore.rules", ...cjs.autoModelFields({ desc: "Edit firestore.rules" }, adv) };
    assert.deepStrictEqual(cjs.autoModelFields(settled, cjs.suggestModel(settled)), {}, "idempotent on its own output");
  });

  // ── Version 2 (6Nia0yWu8yAL3STGh96R, 18 Nov 2026) ──────────────────────
  // Two finished Standard builds were refused that day: the build session's
  // own Dependencies line re-marked each ticket Advanced at hand-over.
  await test("v2: Test steps and Dependencies are not scored; the Outcome and Spec reference are", async () => {
    assert.ok(cjs.MODEL_SUGGEST_VERSION >= 2);
    const handedBack = "## Outcome\nAidan signs his emails with a new line.\n\n## Test steps\n1. Rotate the session token and check the signature.\n\n## Dependencies\nUses the model key Aidan already uses. No new secret or index.\n\n## Spec reference\nbacklog-tracker/REQUIREMENTS.md → Support Inbox";
    assert.deepStrictEqual(cjs.suggestModel({ desc: handedBack }), { model: "standard", reasons: [], version: cjs.MODEL_SUGGEST_VERSION });
    const existingSecret = "## Outcome\nA Test lab tab.\n\n## Dependencies\n- The `ANTHROPIC_API_KEY` function secret (already set for the Support Inbox).\n\n## Spec reference\nNone yet";
    assert.strictEqual(cjs.suggestModel({ desc: existingSecret }).model, "standard", "a secret the ticket only needs is not a change to one");
    assert.deepStrictEqual(keys(cjs.suggestModel({ desc: "## Outcome\nCopy.\n\n## Dependencies\nNone.\n\n## Spec reference\nbacklog-tracker/firestore.rules → supportEvalCases" })), ["security"], "the Spec reference still counts");
    assert.deepStrictEqual(keys(cjs.suggestModel({ desc: "## Outcome\nLet viewers read it in firestore.rules\n\n## Test steps\n1. Open it." })), ["security"], "the Outcome still counts");
    assert.deepStrictEqual(keys(cjs.suggestModel({ title: "Rotate refresh tokens", desc: "## Outcome\nx" })), ["security"], "the title still counts");
  });

  await test("v2: a negated keyword does not count; an un-negated one in the same text still does", async () => {
    for (const d of ["No new secret or index.", "Does not change auth-gate.js", "Done without touching firestore.rules", "This never needs a data migration"]) {
      assert.strictEqual(cjs.suggestModel({ desc: d }).model, "standard", d);
    }
    assert.deepStrictEqual(keys(cjs.suggestModel({ desc: "No new UI. Rotate refresh tokens." })), ["security"], "the negator belongs to another sentence");
    assert.deepStrictEqual(keys(cjs.suggestModel({ desc: "No new secret, but firestore.rules gains a rule" })), ["security"], "a second, plain mention counts");
    assert.deepStrictEqual(keys(cjs.suggestModel({ desc: "The console no longer stores refresh tokens in the page" })), ["security"], "'no longer' is not a negation of the keyword");
  });

  await test("buildInFlight: a handed-back patch, or a started attempt with no report since, holds the model", async () => {
    const fire = { status: "started", buildAttemptId: "a1", at: "2026-11-18T10:00:00Z" };
    assert.strictEqual(cjs.buildInFlight({ patchReady: true }), true);
    assert.strictEqual(cjs.buildInFlight({ buildAttemptId: "a1", lastFire: fire }), true, "started, no report");
    assert.strictEqual(cjs.buildInFlight({ buildAttemptId: "a1", lastFire: fire, buildSession: { status: "done", reportedAt: "2026-11-18T09:00:00Z" } }), true, "a report from an earlier attempt does not count");
    assert.strictEqual(cjs.buildInFlight({ buildAttemptId: "a1", lastFire: fire, buildSession: { status: "done", reportedAt: { toMillis: () => Date.parse("2026-11-18T11:00:00Z") } } }), false, "reported since the fire");
    assert.strictEqual(cjs.buildInFlight({ buildAttemptId: "a2", lastFire: fire }), false, "the fire is not the current attempt");
    assert.strictEqual(cjs.buildInFlight({ buildAttemptId: "a1", lastFire: { ...fire, status: "failed" } }), false, "the fire never started a session");
    assert.strictEqual(cjs.buildInFlight({}), false);

    // The 18 Nov hand-over: fired Standard, the description completed with
    // a security word in the same PATCH as patchReady. The suggestion is
    // recorded; the model is not raised under the build.
    const card = { model: "standard", modelAuto: true, patchReady: true, desc: "## Outcome\nEdit firestore.rules" };
    const f = cjs.autoModelFields(card, cjs.suggestModel(card));
    assert.strictEqual(f.modelSuggested.model, "advanced");
    assert.ok(!("model" in f) && !("modelAuto" in f), "model left as fired");
    const after = { ...card, ...f, patchReady: false };
    assert.strictEqual(cjs.autoModelFields(after, cjs.suggestModel(after)).model, "advanced", "it follows once nothing holds it");
  });

  await test("the chip and the hint", async () => {
    assert.strictEqual(cjs.modelChipText({ model: "standard" }), "");
    assert.strictEqual(cjs.modelChipText({ model: "advanced" }), "Advanced · Opus");
    assert.strictEqual(cjs.modelChipText({ model: "advanced", modelAuto: true, modelSuggested: { reasons: [{ key: "security", text: "touches security rules" }] } }), "Advanced · Opus (auto: touches security rules)");
    assert.strictEqual(cjs.modelChipText({ model: "advanced", modelEscalatedAt: "x" }), "Advanced · Opus (raised after 2 failed rounds)");
    assert.strictEqual(cjs.suggestionHint(cjs.suggestModel({ desc: "copy" })), "Suggested: Standard");
    assert.strictEqual(cjs.suggestionHint(cjs.suggestModel({ desc: "Edit firestore.rules and backfill" })), "Suggested: Advanced — touches security rules, migrates or backfills data");
  });

  await test("review guard: an Advanced ticket reviewed on a non-Opus is not reviewed", async () => {
    const base = { model: "advanced", reviewStatus: "passed", deployCommit: "abc", reviewedCommit: "abc" };
    assert.strictEqual(cjs.reviewNeedsOpus({ ...base, reviewedByModel: "claude-sonnet-5-5" }), true);
    assert.strictEqual(cjs.reviewedForCommit({ ...base, reviewedByModel: "claude-sonnet-5-5" }), false);
    assert.strictEqual(cjs.reviewedForCommit({ ...base, reviewedByModel: "claude-opus-5-5" }), true);
    assert.strictEqual(cjs.reviewedForCommit({ ...base }), true, "no recorded model is not refused (older reviews)");
    assert.strictEqual(cjs.reviewNeedsOpus({ ...base, model: "standard", reviewedByModel: "claude-haiku-5-5" }), false, "Standard tickets take any model");
    assert.strictEqual(cjs.reviewedForCommit({ ...base, reviewedCommit: "old" }), false, "a review of an older commit");
  });

  await test("automatic review: Advanced tickets and security/pipeline-scored ones only", async () => {
    assert.strictEqual(cjs.needsAutoReview({ model: "advanced" }), true);
    assert.strictEqual(cjs.needsAutoReview({ model: "standard", modelSuggested: { reasons: [{ key: "pipeline" }] } }), true, "scored for the pipeline even if a person chose Standard");
    assert.strictEqual(cjs.needsAutoReview({ model: "standard", modelSuggested: { reasons: [{ key: "long" }] } }), false);
    assert.strictEqual(cjs.needsAutoReview({}), false);
  });

  await test("rendered UI: by area or by what the description says", async () => {
    assert.strictEqual(cjs.rendersUI({ category: "PH Website", desc: "x" }), true);
    assert.strictEqual(cjs.rendersUI({ category: "Backend / Infrastructure", desc: "Move the button on the Docs page" }), true);
    assert.strictEqual(cjs.rendersUI({ category: "Backend / Infrastructure", desc: "Retry the sweep once more" }), false);
  });

  await test("builds by model: the last 30 days, grouped, with rounds and rebuilds", async () => {
    const now = Date.parse("2026-11-16T00:00:00Z");
    const day = 86400000;
    const rows = cjs.buildsByModel([
      { builtByModel: "claude-sonnet-5-5", testRound: 3, sendBackCount: 2, autoRebuilds: 1, statusEnteredAt: new Date(now - day) },
      { builtByModel: "claude-sonnet-5-5", testRound: 1, statusEnteredAt: new Date(now - 2 * day) },
      { builtByModel: "claude-opus-5-5", model: "advanced", testRound: 1, updatedAt: { toMillis: () => now - 3 * day } },
      { builtByModel: "claude-opus-5-5", testRound: 4, statusEnteredAt: new Date(now - 40 * day) },
      { testRound: 2, statusEnteredAt: new Date(now - day) },
    ], now, 30);
    assert.deepStrictEqual(rows, [
      { model: "claude-sonnet-5-5", tickets: 2, rounds: 4, rebuilds: 3, advanced: 0, roundsPerTicket: 2 },
      { model: "claude-opus-5-5", tickets: 1, rounds: 1, rebuilds: 0, advanced: 1, roundsPerTicket: 1 },
    ]);
  });

  await test("same result in Node and in the browser module", async () => {
    const all = [...SAMPLES.map((s) => s.item), { desc: "copy change" }, { desc: "Use the design tokens" }];
    for (const item of all) assert.deepStrictEqual(esm.suggestModel(item, { projects: PROJECTS }), cjs.suggestModel(item, { projects: PROJECTS }));
    const card = { model: "advanced", modelAuto: true, modelSuggested: cjs.suggestModel({ desc: "Edit firestore.rules" }) };
    assert.strictEqual(esm.modelChipText(card), cjs.modelChipText(card));
    assert.deepStrictEqual(Object.keys(esm).sort(), Object.keys(cjs).sort(), "the CommonJS copy exports everything the module does");
  });

  await test("functions/model-suggest.js is the generated copy of public/js/model-suggest.js (run scripts/gen-model-suggest-cjs.sh)", async () => {
    const a = fs.readFileSync(path.join(__dirname, "../public/js/model-suggest.js"), "utf8").replace(/^export /gm, "").trimEnd();
    const b = fs.readFileSync(path.join(__dirname, "../functions/model-suggest.js"), "utf8")
      .split("\n").slice(2).join("\n").replace(/\nmodule\.exports = .*\n?$/, "").trimEnd();
    assert.strictEqual(b, a);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
