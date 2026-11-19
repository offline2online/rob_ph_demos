// Model, skills and tools chosen per ticket (ticket CCPnRjXOH4YMsfy3C49r,
// "Flow 8/9", 14 Nov 2026 board flow review) — everything after the
// classifier (test/model-suggest.test.js):
//
//   - escalation after two counted send-backs or two refused patches, once
//   - the review guard and the automatic review of the tickets that need one
//   - skills per project and per area, ph-designer for every UI ticket
//   - required tools in the fire text, tools-unavailable not retried on the
//     same Routine, and a project's own Routine binding used for its fires
//     and never returned by any read path
//   - the intake trigger that stores modelSuggested
//   - the build guard judged against the model the attempt was fired with,
//     the model held while a build is in flight, and Advanced tickets fired
//     on the Advanced (Opus) Routine when one is bound (6Nia0yWu8yAL3STGh96R)
//
// Drives the REAL functions/index.js handlers under stubbed Firebase SDKs
// (same harness as notify-fanout.test.js) and the automation's pure helpers.
// No emulator, credentials or network.
//
// Run with:  node test/model-flow.test.js
"use strict";
const assert = require("assert");
const Module = require("module");
process.env.FIRE_SPACING_MS = "0";

const { modelEscalation, ESCALATE_AFTER, modelGuardRefusal, requiredModelForBuild } = require("../functions/model-requirement");
const skillBindings = require("../functions/skill-bindings");
const auto = require("../scripts/run-backlog-automation.js");

const DELETE = { __delete: true };
function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === DELETE) delete out[k];
    else if (v && typeof v === "object" && v.constructor === Object && out[k] && typeof out[k] === "object" && out[k].constructor === Object) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}
function makeFakeDb(seed) {
  const state = JSON.parse(JSON.stringify(seed));
  const reads = [];
  function docRef(collection, id) {
    return {
      id,
      async get() {
        reads.push(`${collection}/${id}`);
        const raw = state[collection] && state[collection][id];
        return { exists: raw !== undefined, id, data: () => raw };
      },
      async set(data, opts) {
        state[collection] = state[collection] || {};
        state[collection][id] = opts && opts.merge ? deepMerge(state[collection][id] || {}, data) : data;
      },
      async update(data) {
        state[collection][id] = deepMerge(state[collection][id] || {}, data);
      },
    };
  }
  function query(name, filters) {
    return {
      where: (f, op, v) => query(name, filters.concat([[f, op, v]])),
      async get() {
        reads.push(`${name}?`);
        const docs = Object.entries(state[name] || {})
          .filter(([, d]) => filters.every(([f, op, v]) => op === "==" && d[f] === v))
          .map(([id, d]) => ({ id, data: () => d }));
        return { docs, forEach: (fn) => docs.forEach(fn), empty: !docs.length };
      },
    };
  }
  return {
    collection: (name) => ({ doc: (id) => docRef(name, id), where: (f, op, v) => query(name, [[f, op, v]]), get: () => query(name, []).get() }),
    __state: state, __reads: reads,
  };
}
function loadIndex(db, secrets) {
  const stubs = {
    "firebase-functions/v2/firestore": { onDocumentUpdated: (o, h) => h, onDocumentWritten: (o, h) => h },
    "firebase-functions/params": { defineSecret: (name) => ({ value: () => secrets[name] || "" }) },
    "firebase-functions/logger": { info() {}, warn() {}, error() {}, debug() {} },
    "firebase-admin/app": { initializeApp: () => ({}) },
    "firebase-admin/firestore": {
      getFirestore: () => db,
      FieldValue: { serverTimestamp: () => ({}), arrayUnion: (...items) => ({ items }), delete: () => DELETE },
    },
    "firebase-admin/auth": { getAuth: () => ({}) },
    "firebase-functions/v2/https": { onRequest: (o, h) => h },
    "google-auth-library": { GoogleAuth: class {} },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    for (const p of ["../functions/index.js", "../functions/mcp-server.js"]) delete require.cache[require.resolve(p)];
    return require("../functions/index.js");
  } finally {
    Module._load = originalLoad;
  }
}

let passed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err && err.stack || err}`); }
}
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const PID = "proj1";
const SHARED = { CLAUDE_ROUTINE_FIRE_URL: "https://api.anthropic.com/v1/shared/fire", CLAUDE_ROUTINE_TOKEN: "shared-tok" };
function fireStub() {
  const calls = [];
  let n = 0;
  const fn = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization, text: JSON.parse(opts.body).text });
    n++;
    return { ok: true, json: async () => ({ claude_code_session_id: `session_${n}` }) };
  };
  fn.calls = calls;
  return fn;
}
async function withFetch(stub, fn) {
  const real = global.fetch; global.fetch = stub;
  try { return await fn(); } finally { global.fetch = real; }
}

(async () => {
  // ── Escalation ──────────────────────────────────────────────────────────
  await test("escalation: a Standard ticket sent back twice is raised to Advanced once, with the note", async () => {
    assert.strictEqual(ESCALATE_AFTER, 2);
    assert.strictEqual(modelEscalation({ countedSendBacks: 1 }), null, "one send-back is not enough");
    const at = new Date("2026-11-16T10:00:00Z");
    const e = modelEscalation({ countedSendBacks: 2 }, { now: at });
    assert.deepStrictEqual(e.fields, { model: "advanced", modelAuto: false, modelEscalatedAt: at });
    assert.match(e.note, /^Raised to Advanced after 2 failed rounds/);
    assert.strictEqual(modelEscalation({ countedSendBacks: 3, modelEscalatedAt: at }), null, "once only");
    assert.strictEqual(modelEscalation({ countedSendBacks: 3, model: "advanced" }), null, "already Advanced");
    assert.strictEqual(modelEscalation({ countedSendBacks: 3, model: "standard", modelEscalatedAt: at }), null, "a person who set it back to Standard after an escalation keeps Standard");
    assert.ok(modelEscalation({ autoRebuilds: 2 }), "a patch refused twice escalates too");
  });

  await test("escalation: selfHealPlan raises the model on the second refused patch, before the rebuild fires", async () => {
    const first = auto.selfHealPlan({ autoRebuilds: 0 }, {}, "why");
    assert.deepStrictEqual(first.fields, { autoRebuilds: 1 }, "the first refusal only rebuilds");
    const second = auto.selfHealPlan({ autoRebuilds: 1 }, {}, "why");
    assert.strictEqual(second.action, "rebuild");
    assert.strictEqual(second.fields.model, "advanced");
    assert.strictEqual(second.fields.modelAuto, false);
    assert.ok(second.fields.modelEscalatedAt instanceof Date);
    assert.match(second.sentence, /Raised to Advanced after 2 failed rounds/);
    const adv = auto.selfHealPlan({ autoRebuilds: 1, model: "advanced" }, {}, "why");
    assert.deepStrictEqual(adv.fields, { autoRebuilds: 2 }, "an Advanced ticket has nothing to raise");
  });

  // ── Review guard and the automatic review ───────────────────────────────
  await test("automatic review: requested once per landed commit, only for the tickets in scope", async () => {
    const adv = { model: "advanced" };
    const r = auto.autoReviewFields(adv, "sha1");
    assert.strictEqual(r.autoReview.commit, "sha1");
    assert.deepStrictEqual(auto.autoReviewFields({ ...adv, autoReview: { commit: "sha1" } }, "sha1"), {}, "once per commit");
    assert.strictEqual(auto.autoReviewFields({ ...adv, autoReview: { commit: "sha1" } }, "sha2").autoReview.commit, "sha2", "a new commit is reviewed again");
    assert.deepStrictEqual(auto.autoReviewFields({ model: "standard", modelSuggested: { reasons: [{ key: "long" }] } }, "sha1"), {}, "Standard tickets keep the manual button");
    assert.ok(auto.autoReviewFields({ modelSuggested: { reasons: [{ key: "security" }] } }, "sha1").autoReview, "scored for security");
    const at = new Date("2026-11-16T10:00:00Z");
    assert.deepStrictEqual(auto.autoReviewRequestFields(["a", "b"], at), { reviewRequestedAt: at, reviewRequestedByEmail: null, reviewScope: { itemIds: ["a", "b"], requestedAt: at } });
  });

  await test("automatic review: the Ready for Testing hand-off waits for it, and a non-Opus review of an Advanced ticket does not count", async () => {
    const card = { status: "ready-for-testing", deployCommit: "sha1", model: "advanced", autoReview: { commit: "sha1" }, trainTest: { sha: "sha1", state: "passed" } };
    assert.deepStrictEqual(auto.handOffWaitingOn(card), ["review"]);
    assert.deepStrictEqual(auto.handOffWaitingOn({ ...card, reviewStatus: "passed", reviewedCommit: "sha1", reviewedByModel: "claude-opus-5-5" }), [], "reviewed on Opus: presented");
    assert.deepStrictEqual(auto.handOffWaitingOn({ ...card, reviewStatus: "passed", reviewedCommit: "sha1", reviewedByModel: "claude-sonnet-5-5" }), ["review"], "review guard");
    assert.deepStrictEqual(auto.handOffWaitingOn({ ...card, autoReview: { commit: "old" } }), [], "a request for an older commit is not this one");
    assert.deepStrictEqual(auto.handOffWaitingOn({ ...card, autoReview: null }), [], "no automatic review, nothing to wait for");
  });

  await test("Review Batch: an automatic request reviews only the tickets in its scope; a person's press reviews the batch", async () => {
    const at = 1_763_300_000_000;
    const seed = {
      backlogItems: {
        adv: { projectId: PID, status: "ready-for-testing", deployCommit: "s1", model: "advanced", title: "Adv", type: "feature" },
        std: { projectId: PID, status: "ready-for-testing", deployCommit: "s2", title: "Std", type: "feature" },
        weak: { projectId: PID, status: "ready-for-testing", deployCommit: "s3", model: "advanced", title: "Weak review", type: "feature", reviewStatus: "passed", reviewedCommit: "s3", reviewedByModel: "claude-sonnet-5-5" },
      },
      projects: { [PID]: { name: "Demo" } },
    };
    let db = makeFakeDb(seed);
    let mod = loadIndex(db, SHARED);
    let stub = fireStub();
    const after = { name: "Demo", reviewRequestedAt: ts(at), reviewScope: { itemIds: ["adv"], requestedAt: ts(at) } };
    await withFetch(stub, () => mod.notifyOnProjectReviewBatch({ params: { projectId: PID }, data: { before: { data: () => ({ name: "Demo" }) }, after: { data: () => after } } }));
    assert.strictEqual(stub.calls.length, 1);
    assert.ok(stub.calls[0].text.includes("[id: adv]") && !stub.calls[0].text.includes("[id: std]"), "scoped to adv");
    assert.ok(stub.calls[0].text.includes("requested automatically"));

    db = makeFakeDb(seed);
    mod = loadIndex(db, SHARED);
    stub = fireStub();
    const press = { name: "Demo", reviewRequestedAt: ts(at + 5000), reviewScope: { itemIds: ["adv"], requestedAt: ts(at) } };
    await withFetch(stub, () => mod.notifyOnProjectReviewBatch({ params: { projectId: PID }, data: { before: { data: () => ({ name: "Demo", reviewRequestedAt: ts(at) }) }, after: { data: () => press } } }));
    const text = stub.calls[0].text;
    assert.ok(text.includes("[id: adv]") && text.includes("[id: std]"), "a person's press is the whole batch");
    assert.ok(text.includes("[id: weak]"), "an Advanced ticket reviewed on a non-Opus is reviewed again");
    assert.ok(!text.includes("requested automatically"));
  });

  // ── Skills ──────────────────────────────────────────────────────────────
  await test("skills: global plus project plus area, each with its reason; old shape still works", async () => {
    const bindings = { build: ["ph-build-agent"], deploy: ["ph-security"], byProject: { [PID]: { build: ["ph-docs"], deploy: ["ph-scale"] } }, byArea: { "PH Website": ["ph-wordpress"] } };
    const item = { category: "PH Website", desc: "Change the hero copy" };
    assert.deepStrictEqual(skillBindings.skillsFor(bindings, "build", { projectId: PID, projectName: "Demo", item }), [
      { slug: "ph-build-agent", reason: "bound to every build" },
      { slug: "ph-docs", reason: "bound to \"Demo\"" },
      { slug: "ph-wordpress", reason: "bound to PH Website tickets" },
      { slug: "ph-designer", reason: "this ticket changes rendered UI" },
    ]);
    assert.deepStrictEqual(skillBindings.skillsFor(bindings, "deploy", { projectId: PID }).map((x) => x.slug), ["ph-security", "ph-scale"]);
    assert.deepStrictEqual(skillBindings.skillsFor({ build: ["a", "b"], deploy: [] }, "build", { item: { category: "Backend / Infrastructure", desc: "retry the sweep" } }).map((x) => x.slug), ["a", "b"], "old shape");
    assert.deepStrictEqual(skillBindings.skillsFor({}, "build", {}), []);
  });

  await test("skills: ph-designer is always there for a UI ticket, even when bound elsewhere, and never twice", async () => {
    const list = skillBindings.skillsFor({ build: ["ph-designer"] }, "build", { item: { category: "HQ Admin", desc: "x" } });
    assert.deepStrictEqual(list, [{ slug: "ph-designer", reason: "bound to every build; this ticket changes rendered UI" }]);
    assert.deepStrictEqual(skillBindings.skillsFor({}, "build", { item: { category: "HQ Admin", desc: "x" } }).map((x) => x.slug), ["ph-designer"]);
    assert.deepStrictEqual(skillBindings.skillsFor({}, "deploy", { item: { category: "HQ Admin", desc: "x" } }), [], "only the build phase");
  });

  await test("skills: set_phase_skill_bindings' list edits keep the rest of the doc", async () => {
    const cur = { build: ["a"], byProject: { [PID]: ["x"] } };
    const next = skillBindings.nextBindingList(cur, { phase: "deploy", projectId: PID }, ["y"], []);
    assert.deepStrictEqual(next, ["y"]);
    assert.deepStrictEqual(skillBindings.bindingWrite(cur, { phase: "deploy", projectId: PID }, next), { byProject: { [PID]: { build: ["x"], deploy: ["y"] } } }, "a plain-array entry keeps its build list");
    assert.deepStrictEqual(skillBindings.nextBindingList(cur, { phase: "build" }, ["b"], ["a"]), ["b"]);
    assert.deepStrictEqual(skillBindings.bindingWrite(cur, { phase: "build" }, ["b"]), { build: ["b"] });
    assert.deepStrictEqual(skillBindings.bindingWrite({}, { phase: "build", area: "PH Website" }, ["w"]), { byArea: { "PH Website": { build: ["w"] } } });
  });

  // ── Required tools and the project's own Routine ────────────────────────
  await test("required tools: the fire text makes checking them the first step; nothing when none are set", async () => {
    const mod = loadIndex(makeFakeDb({}), SHARED);
    const text = mod.__test.requiredToolsBlock("t1", ["wordpress-mcp", "wordpress-mcp", "bad<script>"]);
    assert.ok(text.includes("check you can reach: wordpress-mcp."), text);
    assert.ok(text.includes('blocked {reason: "tools-unavailable"') && text.includes("missing:") && text.includes("PATCH backlogItems/t1"));
    assert.strictEqual(mod.__test.requiredToolsBlock("t1", []), "");
    assert.strictEqual(mod.__test.requiredToolsBlock("t1", null), "");
  });

  await test("a build click: project Routine used when set, skills listed per ticket with reasons and recorded on the card, required tools in the text", async () => {
    const db = makeFakeDb({
      backlogItems: {
        ui: { projectId: PID, status: "backlog", type: "feature", title: "UI ticket", desc: "Move the button on the Docs page", category: "HQ Admin" },
        be: { projectId: PID, status: "backlog", type: "feature", title: "Back-end ticket", desc: "Retry the sweep once more", category: "Backend / Infrastructure" },
      },
      projects: { [PID]: { name: "Demo" } },
      projectRoutineBindings: { [PID]: { fireUrl: "https://api.anthropic.com/v1/project/fire", token: "project-tok" } },
      settings: { phaseSkillBindings: { build: ["ph-build-agent"], byArea: { "HQ Admin": { build: ["ph-hq"] } } } },
    });
    const mod = loadIndex(db, SHARED);
    const stub = fireStub();
    const after = { name: "Demo", notifyRequestedAt: ts(Date.now()), requiredConnectors: ["wordpress-mcp"] };
    await withFetch(stub, () => mod.notifyOnProjectReadyForReview({ params: { projectId: PID }, data: { before: { data: () => ({ name: "Demo" }) }, after: { data: () => after } } }));
    assert.strictEqual(stub.calls.length, 2);
    assert.ok(stub.calls.every((c) => c.url === "https://api.anthropic.com/v1/project/fire" && c.auth === "Bearer project-tok"), "the project's own Routine");
    const ui = stub.calls.find((c) => c.text.includes("(ticket ui)")).text;
    const be = stub.calls.find((c) => c.text.includes("(ticket be)")).text;
    assert.ok(ui.includes("- ph-build-agent: bound to every build") && ui.includes("- ph-hq: bound to HQ Admin tickets") && ui.includes("- ph-designer: this ticket changes rendered UI"), ui.slice(0, 900));
    assert.ok(be.includes("- ph-build-agent: bound to every build") && !be.includes("ph-designer") && !be.includes("ph-hq"));
    assert.ok(ui.includes("REQUIRED TOOLS") && ui.includes("check you can reach: wordpress-mcp"));
    assert.ok(ui.indexOf("=== SKILLS BOUND TO THE BUILD PHASE ===") < ui.indexOf("Project: \"Demo\""), "the skills come before the ticket");
    assert.deepStrictEqual(db.__state.backlogItems.ui.lastFire.skills, ["ph-build-agent", "ph-hq", "ph-designer"], "the card records the skills it was sent");
    assert.strictEqual(db.__state.backlogItems.ui.lastFire.firedVia, "project");
    assert.strictEqual(db.__state.projects[PID].notifyRoutine.firedVia, "project");
  });

  await test("the project binding: never in the fire text, never on a card or the project, refused off api.anthropic.com", async () => {
    const db = makeFakeDb({
      backlogItems: { a: { projectId: PID, status: "backlog", type: "feature", title: "A", desc: "copy" } },
      projects: { [PID]: { name: "Demo" } },
      projectRoutineBindings: { [PID]: { fireUrl: "https://api.anthropic.com/v1/project/fire", token: "project-tok-SECRET" } },
    });
    const mod = loadIndex(db, SHARED);
    const stub = fireStub();
    await withFetch(stub, () => mod.notifyOnProjectReadyForReview({ params: { projectId: PID }, data: { before: { data: () => ({ name: "Demo" }) }, after: { data: () => ({ name: "Demo", notifyRequestedAt: ts(Date.now()) }) } } }));
    assert.ok(!stub.calls[0].text.includes("project-tok-SECRET") && !stub.calls[0].text.includes("/v1/project/fire"));
    const visible = JSON.stringify({ items: db.__state.backlogItems, projects: db.__state.projects });
    assert.ok(!visible.includes("project-tok-SECRET") && !visible.includes("/v1/project/fire"), "no read path carries it");
    const evil = makeFakeDb({ projectRoutineBindings: { [PID]: { fireUrl: "https://evil.example/fire", token: "t" } } });
    assert.strictEqual(await loadIndex(evil, SHARED).__test.projectRoutineCredentials(evil, PID), null);
    const none = makeFakeDb({});
    const c = await loadIndex(none, SHARED).__test.resolveProjectRoutineCredentials(none, PID, null, "u", "t");
    assert.deepStrictEqual(c, { fireUrl: "u", token: "t", via: "shared" }, "no binding: the usual credentials");
  });

  await test("tools-unavailable: not retried on the same Routine; once when the project gets its own Routine after the flag", async () => {
    const setAt = "2026-11-16T09:00:00.000Z";
    const card = { status: "backlog", blocked: { reason: "tools-unavailable", missing: ["wordpress-mcp"], setAt } };
    assert.strictEqual(auto.toolsRetryPlan(card, {}), null, "same Routine: not retried");
    assert.strictEqual(auto.toolsRetryPlan(card, { routineBoundAt: "2026-11-16T08:00:00.000Z" }), null, "a binding older than the flag is the same Routine");
    const plan = auto.toolsRetryPlan(card, { routineBoundAt: "2026-11-16T10:00:00.000Z" });
    assert.deepStrictEqual(plan.fields, { toolsRetries: 1 });
    assert.strictEqual(auto.toolsRetryPlan({ ...card, toolsRetries: 1 }, { routineBoundAt: "2026-11-16T10:00:00.000Z" }), null, "only once");
    assert.strictEqual(auto.autoAnswerPlan(card), null, "never answered as a question");
  });

  // ── The intake trigger ──────────────────────────────────────────────────
  await test("intake trigger: a new ticket naming firestore.rules gets Advanced with its reason; an explicit Standard sticks", async () => {
    const db = makeFakeDb({ backlogItems: { n: { projectId: PID, status: "backlog", desc: "Let viewers read it in firestore.rules" } }, projects: { [PID]: { name: "Demo" } } });
    const mod = loadIndex(db, SHARED);
    const ref = db.collection("backlogItems").doc("n");
    const ev = (before, after) => ({ params: { itemId: "n" }, data: { before: before ? { data: () => before } : undefined, after: { data: () => after, ref } } });
    const created = db.__state.backlogItems.n;
    const upd = await mod.__test.runModelSuggest(ev(null, created), db);
    assert.strictEqual(upd.model, "advanced");
    assert.strictEqual(upd.modelAuto, true);
    assert.deepStrictEqual(upd.modelSuggested.reasons.map((r) => r.text), ["touches security rules"]);
    const now = { ...db.__state.backlogItems.n };
    assert.strictEqual(await mod.__test.runModelSuggest(ev(created, now), db), null, "idempotent on its own write");
    const chosen = { ...now, model: "standard", modelAuto: false };
    const r = await mod.__test.runModelSuggest(ev(now, chosen), db);
    assert.strictEqual(r, null, "a person's Standard is kept");
    assert.strictEqual(db.__state.backlogItems.n.model, "advanced", "nothing rewrote it (the stub state is the trigger's own writes)");
    const notBacklog = { ...created, status: "ready-for-testing" };
    assert.strictEqual(mod.__test.modelSuggestNeeded(null, notBacklog), false, "only Backlog tickets");
  });

  // ── Advanced means Opus, judged by what was fired (6Nia0yWu8yAL3STGh96R) ─
  await test("guard: a model the classifier raised after the fire does not refuse the build it was fired as", async () => {
    const fired = (model) => ({ status: "started", buildAttemptId: "a1", model, at: "2026-11-18T10:00:00Z" });
    // SYkk20srKT7pIKM1HS8Z, 18 Nov 2026: fired Standard, re-marked Advanced by
    // its own hand-over wording, patch refused. Now it lands.
    const raised = { model: "advanced", modelAuto: true, buildAttemptId: "a1", patchAttemptId: "a1", lastFire: fired("standard"), builtByModel: "claude-fable-5-2" };
    assert.strictEqual(requiredModelForBuild(raised), "standard");
    assert.strictEqual(modelGuardRefusal(raised), null);
    // Fired Advanced: refused on a non-Opus, whatever the classifier did since.
    const lowered = { ...raised, model: "standard", lastFire: fired("advanced") };
    assert.ok(modelGuardRefusal(lowered), "fired Advanced, built on a lesser model");
    assert.strictEqual(modelGuardRefusal({ ...lowered, builtByModel: "claude-opus-5-5" }), null, "built on Opus");
    // A person's choice is binding as it stands.
    assert.ok(modelGuardRefusal({ ...raised, modelAuto: false }), "a person chose Advanced");
    assert.ok(modelGuardRefusal({ ...raised, modelAuto: undefined }), "a model set before modelAuto existed counts as chosen");
    // No record of the fire for this attempt: the card's model, as before.
    assert.ok(modelGuardRefusal({ ...raised, lastFire: { ...fired("standard"), buildAttemptId: "older" } }), "another attempt's fire");
    assert.ok(modelGuardRefusal({ ...raised, lastFire: { status: "started", buildAttemptId: "a1" } }), "a fire from before lastFire.model existed");
    assert.strictEqual(modelGuardRefusal({ model: "standard", builtByModel: "claude-haiku-5-5" }), null);
  });

  await test("intake trigger: the hand-over write does not raise the model; it follows once the build is no longer in flight", async () => {
    const fire = { status: "started", buildAttemptId: "a1", model: "standard", at: ts(1_763_400_000_000) };
    const building = { projectId: PID, status: "backlog", desc: "## Outcome\nA new signature line", model: "standard", modelAuto: true, modelSuggested: { model: "standard", reasons: [], version: 2 }, buildAttemptId: "a1", lastFire: fire };
    const db = makeFakeDb({ backlogItems: { h: building }, projects: { [PID]: { name: "Demo" } } });
    const mod = loadIndex(db, SHARED);
    const ref = db.collection("backlogItems").doc("h");
    const ev = (before, after) => ({ params: { itemId: "h" }, data: { before: { data: () => before }, after: { data: () => after, ref } } });
    const handOver = { ...building, desc: "## Outcome\nA new signature line, stored beside Aidan's secret settings", patchReady: true };
    const upd = await mod.__test.runModelSuggest(ev(building, handOver), db);
    assert.strictEqual(upd.modelSuggested.model, "advanced", "the suggestion is recorded");
    assert.ok(!("model" in upd), "the model the build was fired with is kept");
    assert.strictEqual(db.__state.backlogItems.h.model, "standard");
    const held = { ...handOver, ...upd };
    assert.strictEqual(mod.__test.modelSuggestNeeded(handOver, { ...held, buildSession: { status: "done" } }), false, "still in flight while patchReady");
    const refused = { ...held, patchReady: false, buildSession: { status: "done", reportedAt: ts(1_763_400_600_000) } };
    assert.strictEqual(mod.__test.modelSuggestNeeded(held, refused), true, "nothing holds it now");
    const follow = await mod.__test.runModelSuggest(ev(held, refused), db);
    assert.strictEqual(follow.model, "advanced", "the next build is fired on the suggestion");
  });

  const opusSeed = (extra = {}) => ({
    backlogItems: {
      adv: { projectId: PID, status: "backlog", type: "feature", title: "Adv", desc: "copy", model: "advanced", modelAuto: false },
      std: { projectId: PID, status: "backlog", type: "feature", title: "Std", desc: "copy" },
    },
    projects: { [PID]: { name: "Demo" } },
    modelRoutineBindings: { advanced: { fireUrl: "https://api.anthropic.com/v1/opus/fire", token: "opus-tok-SECRET" } },
    ...extra,
  });
  const clickOn = async (db) => {
    const mod = loadIndex(db, SHARED);
    const stub = fireStub();
    await withFetch(stub, () => mod.notifyOnProjectReadyForReview({ params: { projectId: PID }, data: { before: { data: () => ({ name: "Demo" }) }, after: { data: () => ({ name: "Demo", notifyRequestedAt: ts(Date.now()) }) } } }));
    return stub;
  };

  await test("a mixed click: the Advanced ticket fires on the Opus Routine, the Standard one on the shared Routine, both in the same click", async () => {
    const db = makeFakeDb(opusSeed());
    const stub = await clickOn(db);
    assert.strictEqual(stub.calls.length, 2);
    const adv = stub.calls.find((c) => c.text.includes("(ticket adv)"));
    const std = stub.calls.find((c) => c.text.includes("(ticket std)"));
    assert.strictEqual(adv.url, "https://api.anthropic.com/v1/opus/fire");
    assert.strictEqual(adv.auth, "Bearer opus-tok-SECRET");
    assert.strictEqual(std.url, SHARED.CLAUDE_ROUTINE_FIRE_URL);
    assert.ok(adv.text.includes("=== MODEL REQUIREMENT: ADVANCED (Claude Opus) ==="), "the requirement still travels in the text");
    assert.ok(std.text.includes("Model requirement: Standard"));
    const cards = db.__state.backlogItems;
    assert.strictEqual(cards.adv.lastFire.firedVia, "advanced");
    assert.strictEqual(cards.adv.lastFire.model, "advanced", "the card records the requirement it was fired with");
    assert.strictEqual(cards.std.lastFire.firedVia, "shared");
    assert.strictEqual(cards.std.lastFire.model, "standard");
    assert.strictEqual(db.__state.projects[PID].notifyRoutine.firedVia, "shared+advanced");
    const visible = JSON.stringify({ items: cards, projects: db.__state.projects, texts: stub.calls.map((c) => c.text) });
    assert.ok(!visible.includes("opus-tok-SECRET") && !visible.includes("/v1/opus/fire"), "the binding is never in a fire text, a card or the project");
  });

  await test("no Opus Routine: both tickets on the shared Routine, the Advanced one with the delegation block, as before", async () => {
    const seed = opusSeed();
    delete seed.modelRoutineBindings;
    const db = makeFakeDb(seed);
    const stub = await clickOn(db);
    assert.ok(stub.calls.every((c) => c.url === SHARED.CLAUDE_ROUTINE_FIRE_URL));
    assert.ok(stub.calls.find((c) => c.text.includes("(ticket adv)")).text.includes('the Agent tool with model "opus"'));
    assert.strictEqual(db.__state.backlogItems.adv.lastFire.firedVia, "shared");
    assert.strictEqual(db.__state.projects[PID].notifyRoutine.firedVia, "shared");
  });

  await test("the Opus Routine replaces only the shared Routine: a project's own Routine keeps its tickets; a binding off api.anthropic.com is refused", async () => {
    const db = makeFakeDb(opusSeed({ projectRoutineBindings: { [PID]: { fireUrl: "https://api.anthropic.com/v1/project/fire", token: "project-tok" } } }));
    const stub = await clickOn(db);
    assert.ok(stub.calls.every((c) => c.url === "https://api.anthropic.com/v1/project/fire"), "the project's Routine has the tools it needs");
    const evil = makeFakeDb({ modelRoutineBindings: { advanced: { fireUrl: "https://evil.example/fire", token: "t" } } });
    assert.strictEqual(await loadIndex(evil, SHARED).__test.advancedRoutineCredentials(evil), null);
    const mod = loadIndex(makeFakeDb({}), SHARED);
    const usual = { fireUrl: "u", token: "t", via: "shared" };
    const adv = { fireUrl: "o", token: "p", via: "advanced" };
    assert.strictEqual(mod.__test.advancedRoutineFor({ model: "advanced" }, usual, adv), adv);
    assert.strictEqual(mod.__test.advancedRoutineFor({ model: "standard" }, usual, adv), usual);
    assert.strictEqual(mod.__test.advancedRoutineFor({ model: "advanced" }, { ...usual, via: "member" }, adv).via, "member", "a member's own Routine is kept");
    assert.strictEqual(mod.__test.advancedRoutineFor({ model: "advanced" }, usual, null), usual);
    assert.strictEqual(mod.__test.advancedRoutineFor({ model: "advanced" }, null, adv), null, "no shared Routine: not sent, as before");
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
