// functions/support-lab.js and support-lab-core.js — the Support Inbox's Test
// lab: Ask (the shared engine, nothing sent or filed), saving cases, "Add to
// test lab" from a ticket, and runs (claimed a few at a time, recorded with
// ids and counts only). No Firebase, no network: Firestore, sign-in and the
// model are stubbed, the routes go through createSupportMail's handler.
// Run: node test/support-lab.test.js
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { createSupportMail } = require("../functions/support-mail");
const lab = require("../functions/support-lab-core");
const evalScript = require("../scripts/support-eval");

const USERS = {
  "ed@ph.example": { email: "ed@ph.example", role: "editor" },
  "view@ph.example": { email: "view@ph.example", role: "viewer" },
};

// An in-memory Firestore: documents by path, where (equality), serialised transactions.
function fakeDb() {
  const state = {};
  const col = (path) => {
    state[path] = state[path] || {};
    const docRef = (id) => ({
      id,
      async get() { const d = state[path][id]; return { exists: d !== undefined, id, data: () => d }; },
      async set(data, opts) { state[path][id] = opts && opts.merge ? { ...(state[path][id] || {}), ...data } : { ...data }; },
      async delete() { delete state[path][id]; },
      collection: (name) => col(`${path}/${id}/${name}`),
    });
    const snap = (rows) => ({ forEach: (fn) => rows.forEach(([id, d]) => fn({ id, data: () => d })), size: rows.length, docs: rows.map(([id, d]) => ({ id, data: () => d })) });
    const q = (filters, n) => ({
      where: (f, op, v) => q([...filters, [f, v]], n),
      limit: (k) => q(filters, k),
      async get() { let rows = Object.entries(state[path]).filter(([, d]) => filters.every(([f, v]) => d[f] === v)); if (n) rows = rows.slice(0, n); return snap(rows); },
    });
    return { doc: docRef, where: (f, op, v) => q([[f, v]]), limit: (k) => q([], k), get: () => q([]).get() };
  };
  return {
    collection: col, state,
    txQueue: Promise.resolve(),
    runTransaction(fn) {
      const run = this.txQueue.then(() => fn({ get: (ref) => ref.get(), set: (ref, data, opts) => ref.set(data, opts), update: (ref, data) => ref.set(data, { merge: true }) }));
      this.txQueue = run.catch(() => {});
      return run;
    },
  };
}

// A stand-in for the engine's model: about displays → article a1; an invoice →
// about PH but no article; SEO → not about PH. `calls` counts every question.
function standIn() {
  const calls = [];
  const run = async ({ messages }) => {
    const text = messages.map((m) => m.text).join(" ").toLowerCase();
    calls.push(text);
    if (text.includes("boom")) throw new Error("model unreachable");
    if (text.includes("seo")) return { relevant: false, category: "unrelated", summary: "", selectedIds: [], answerable: false, confidence: 0, reply: "", articleIds: [] };
    if (text.includes("invoice")) return { relevant: true, category: "billing", summary: "Invoice query.", selectedIds: [], answerable: false, confidence: 0.3, reply: "We will come back to you.", articleIds: [], confidenceSteps: [] };
    return { relevant: true, category: "how-to", summary: "Wants to add a display.", selectedIds: ["a1", "a2"], answerable: true, confidence: 0.82,
      confidenceSteps: [{ articles: 1, confidence: 0.55 }, { articles: 2, confidence: 0.82 }], reply: "Open Displays and Devices, then Add display.", articleIds: ["a1"] };
  };
  return { run, calls };
}

function make({ key = "sk-test", triage = standIn(), settings = {} } = {}) {
  const db = fakeDb();
  let clock = 1760000000000;
  db.state.faqArticles = {
    a1: { categoryId: "c1", status: "published", title: "Add a display to a store", bodyMd: "<p>Open Displays and Devices.</p>" },
    a2: { categoryId: "c1", status: "published", title: "Pair a screen", bodyMd: "<p>Pair it.</p>" },
    a3: { status: "draft", title: "Unpublished" },
  };
  db.state.faqCategories = { c1: { name: "Digital Signage" } };
  db.state.prospects = {}; db.state.leads = {};
  db.state.supportSettings = { main: Object.assign({ connectedEmail: "support@ph.example", autoReply: false }, settings) };
  const fetched = [];
  const api = createSupportMail({
    db,
    verifyIdToken: async (t) => { if (!t.startsWith("tok:")) throw new Error("bad"); return { email: t.slice(4) }; },
    resolveConsoleUser: async (email) => USERS[email] || null,
    encKey: () => crypto.randomBytes(32).toString("base64"), boardKey: () => "board", anthropicKey: () => key,
    fetch: async (url) => { fetched.push(String(url)); throw new Error("no network in this test"); },
    logger: { warn() {}, error() {}, info() {} }, now: () => new Date(clock += 1000),
    baseUrl: "https://console.example", triage: triage ? triage.run : null,
  });
  return { api, db, triage, fetched, tick: (ms) => { clock += ms; } };
}

async function call(api, path, { token = "ed@ph.example", body = {}, method = "POST" } = {}) {
  const headers = { "x-firebase-id-token": token ? `tok:${token}` : "" };
  const req = { method, path: `/supportMail${path}`, body, query: {}, get: (h) => headers[h.toLowerCase()] || "" };
  const res = { statusCode: 0, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, set(k, v) { this.headers[k] = v; return this; }, json(b) { this.body = b; return this; } };
  await api.handle(req, res);
  return res;
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push([true, name]); console.log(`PASS ${name}`); }
  catch (err) { results.push([false, name]); console.log(`FAIL ${name}: ${err && err.stack ? err.stack : err}`); }
}

(async () => {
  // ── Pure rules ──
  await check("judgeCase is one rule: the eval script uses the lab's", () => {
    assert.strictEqual(evalScript.judgeCase, lab.judgeCase);
    assert.deepStrictEqual(lab.judgeCase({ relevant: true, articles: ["a1"] }, { selectedIds: ["a2"] }, { relevant: true, answerable: true, reply: "x" }).problems, ["no right article chosen"]);
    assert.deepStrictEqual(lab.judgeCase({ relevant: false, articles: [] }, { selectedIds: [] }, { relevant: false, reply: "" }).problems, []);
  });
  await check("a case is checked before it is kept: a question, what should happen, published articles only", () => {
    const known = ["a1", "a2"];
    assert.ok(lab.cleanCaseInput({ text: "", expect: "none" }, known).error.includes("question"));
    assert.ok(lab.cleanCaseInput({ text: "Q", expect: "maybe" }, known).error.includes("should happen"));
    assert.ok(lab.cleanCaseInput({ text: "Q", expect: "articles", articleIds: [] }, known).error.includes("Pick"));
    assert.ok(lab.cleanCaseInput({ text: "Q", expect: "articles", articleIds: ["a3"] }, known).error.includes("published"));
    assert.ok(lab.cleanCaseInput({ text: "Q", expect: "articles", articleIds: ["a1", "a2", "x", "y"] }, known).error.includes("at most 3"));
    const { value } = lab.cleanCaseInput({ subject: "  Display \n help ", text: "How?", expect: "none", articleIds: ["a1"], rating: "wrong", note: "n", answered: { articleIds: ["a2", "zz"], confidence: 4 } }, known);
    assert.deepStrictEqual(value, { subject: "Display help", text: "How?", expect: "none", articleIds: [], rating: "wrong", note: "n", answered: { articleIds: ["a2"], confidence: 1 } });
  });
  await check("claimNext: pending cases first in order, then a claim nobody finished in time is taken again", () => {
    let r = lab.claimNext({ pending: ["a", "b", "c", "d"], claims: [] }, 1000, 3);
    assert.deepStrictEqual([r.take, r.pending, r.claims.map((c) => c.id)], [["a", "b", "c"], ["d"], ["a", "b", "c"]]);
    r = lab.claimNext({ pending: ["d"], claims: r.claims }, 2000, 3);
    assert.deepStrictEqual(r.take, ["d"], "a fresh claim is left to the step that holds it");
    r = lab.claimNext({ pending: [], claims: r.claims }, 2000 + lab.CLAIM_STALE_MS + 1, 3);
    assert.deepStrictEqual(r.take, ["a", "b", "c"], "claims left by a closed tab are run again");
  });
  await check("caseFromTicket: the last customer email before the final answer, and that answer's articles", () => {
    const msgs = [
      { direction: "in", text: "First question" },
      { direction: "in", text: "How do I add a display?\n\nOn Mon, Ann wrote:\n> old" },
      { direction: "event", text: "x" },
      { direction: "out", text: "Hi Ann, open Displays.", auto: true, articles: [{ id: "a1", title: "T" }] },
      { direction: "in", text: "Thanks!" },
    ];
    const { value } = lab.caseFromTicket({ subject: "Displays" }, msgs, "support");
    assert.strictEqual(value.text, "How do I add a display?");
    assert.strictEqual(value.finalAnswer, "Hi Ann, open Displays.");
    assert.deepStrictEqual([value.expect, value.articleIds, value.needsReview, value.answeredBy], ["articles", ["a1"], false, "ai"]);
    const person = lab.caseFromTicket({ subject: "S" }, [{ direction: "in", text: "Q" }, { direction: "out", text: "A", sentBy: "ed@ph.example" }], "support").value;
    assert.deepStrictEqual([person.expect, person.needsReview, person.answeredBy], ["", true, "person"]);
    assert.ok(lab.caseFromTicket({}, [{ direction: "out", text: "A" }], "support").error);
  });

  // ── Ask ──
  await check("Ask: the draft, every matched article, the confidence steps and decideAction's verdict; nothing filed or sent", async () => {
    const t = make();
    const r = await call(t.api, "/v1/lab/ask", { body: { subject: "Displays", text: "How do I add a display to my store?" } });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.draft, "Hi there,\n\nThanks for your email.\n\nOpen Displays and Devices, then Add display.");
    assert.deepStrictEqual(r.body.matched.map((a) => a.id), ["a1", "a2"]);
    assert.deepStrictEqual(r.body.articles.map((a) => a.title), ["Add a display to a store"]);
    assert.deepStrictEqual(r.body.confidenceSteps, [{ articles: 1, confidence: 0.55 }, { articles: 2, confidence: 0.82 }]);
    assert.deepStrictEqual(r.body.decision, { action: "review", label: "Draft to approve", reason: "Sending by itself is switched off." });
    assert.deepStrictEqual(Object.keys(t.db.state.supportTickets || {}), [], "no ticket filed");
    assert.deepStrictEqual(t.fetched, [], "Google never called: no email sent");
    assert.deepStrictEqual(Object.keys(t.db.state.supportEvalCases || {}), [], "nothing kept until Save");
  });
  await check("Ask: with sending switched on and enough confidence the verdict is Sent by itself; the gates are decideAction's own", async () => {
    const t = make({ settings: { autoReply: true, autoReplyThreshold: 0.8 } });
    const r = await call(t.api, "/v1/lab/ask", { body: { text: "How do I add a display?" } });
    assert.strictEqual(r.body.decision.label, "Sent by itself");
    const n = await call(t.api, "/v1/lab/ask", { body: { text: "A question about my invoice" } });
    assert.deepStrictEqual([n.body.decision.label, n.body.decision.reason], ["Needs a person", "The help centre doesn't answer this."]);
    const u = await call(t.api, "/v1/lab/ask", { body: { text: "Cheap SEO links" } });
    assert.deepStrictEqual([u.body.relevant, u.body.draft, u.body.decision.reason], [false, "", "Not about Personalisation Hub: no reply drafted."]);
  });
  await check("Ask: editors only, a question is required, and no model says so", async () => {
    const t = make();
    assert.strictEqual((await call(t.api, "/v1/lab/ask", { token: "view@ph.example", body: { text: "Q" } })).statusCode, 403);
    assert.strictEqual((await call(t.api, "/v1/lab/ask", { token: "", body: { text: "Q" } })).statusCode, 401);
    assert.strictEqual((await call(t.api, "/v1/lab/ask", { body: { subject: "Only a subject" } })).statusCode, 400);
    assert.strictEqual((await call(t.api, "/v1/lab/ask", { method: "GET" })).statusCode, 405);
    const none = make({ key: "", triage: null });
    const r = await call(none.api, "/v1/lab/ask", { body: { text: "Q" } });
    assert.deepStrictEqual([r.statusCode, r.body.error], [503, "No drafting model is configured (ANTHROPIC_API_KEY)."]);
    assert.strictEqual((await call(none.api, "/v1/lab/runs")).statusCode, 503);
  });

  // ── Cases ──
  await check("Save to test set: a rated case is kept with who saved it; an edit that changes what should happen clears its last result", async () => {
    const t = make();
    const r = await call(t.api, "/v1/lab/cases", { body: { subject: "Displays", text: "How do I add a display?", expect: "articles", articleIds: ["a2"], rating: "wrong", note: "Should be pairing", answered: { articleIds: ["a1"], confidence: 0.82 } } });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    const c = t.db.state.supportEvalCases[r.body.id];
    assert.deepStrictEqual([c.source, c.rating, c.expect, c.articleIds, c.createdBy, c.needsReview, c.lastResult], ["lab", "wrong", "articles", ["a2"], "ed@ph.example", false, null]);
    c.lastResult = { passed: false };
    await call(t.api, "/v1/lab/cases", { body: { id: r.body.id, subject: "Displays", text: "How do I add a display?", expect: "articles", articleIds: ["a2"], rating: "wrong", note: "edited note" } });
    assert.deepStrictEqual(t.db.state.supportEvalCases[r.body.id].lastResult, { passed: false }, "a note alone keeps the result");
    await call(t.api, "/v1/lab/cases", { body: { id: r.body.id, subject: "Displays", text: "How do I add a display?", expect: "articles", articleIds: ["a1"] } });
    assert.strictEqual(t.db.state.supportEvalCases[r.body.id].lastResult, null);
    assert.strictEqual((await call(t.api, "/v1/lab/cases", { token: "view@ph.example", body: { text: "Q", expect: "none" } })).statusCode, 403);
    assert.strictEqual((await call(t.api, `/v1/lab/cases/${r.body.id}/delete`)).statusCode, 200);
    assert.strictEqual(t.db.state.supportEvalCases[r.body.id], undefined);
    assert.strictEqual((await call(t.api, "/v1/lab/cases", { body: { id: r.body.id, text: "Q", expect: "none" } })).statusCode, 404, "a deleted case isn't brought back by an edit");
  });
  await check("Add to test lab: a Support Inbox ticket answered by AI gets its articles expected; once per ticket", async () => {
    const t = make();
    t.db.state.supportTickets = { th1: { key: "SUP-4", subject: "Displays", inboxes: ["support"] } };
    t.db.state["supportTickets/th1/messages"] = {
      m1: { direction: "in", text: "How do I add a display?", at: 1 },
      m2: { direction: "out", text: "Hi Ann, open Displays.", auto: true, source: "ai-auto", articles: [{ id: "a1" }], at: 2 },
    };
    const r = await call(t.api, "/v1/lab/from-ticket", { body: { ticketId: "th1" } });
    assert.deepStrictEqual([r.statusCode, r.body.id, r.body.needsReview], [200, "t-th1", false]);
    const c = t.db.state.supportEvalCases["t-th1"];
    assert.deepStrictEqual([c.source, c.ticketKey, c.text, c.finalAnswer, c.expect, c.articleIds], ["support", "SUP-4", "How do I add a display?", "Hi Ann, open Displays.", "articles", ["a1"]]);
    const again = await call(t.api, "/v1/lab/from-ticket", { body: { ticketId: "th1" } });
    assert.deepStrictEqual([again.body.id, again.body.already], ["t-th1", true]);
    assert.strictEqual((await call(t.api, "/v1/lab/from-ticket", { body: { ticketId: "nope" } })).statusCode, 404);
    assert.strictEqual((await call(t.api, "/v1/lab/from-ticket", { body: { ticketId: "../x" } })).statusCode, 400);
  });
  await check("Add to test lab: an Aidan ticket a person answered waits as Needs review and is left out of runs", async () => {
    const t = make();
    t.db.state.supportTickets = { ta: { key: "SUP-9", subject: "Question", inboxes: ["aidan"], aidan: { status: "replied" } } };
    t.db.state["supportTickets/ta/messages"] = { m1: { direction: "in", text: "@Aidan, how do I pair a screen?", at: 1 }, m2: { direction: "out", text: "Like this.", source: "manual", at: 2 } };
    const r = await call(t.api, "/v1/lab/from-ticket", { body: { ticketId: "ta" } });
    assert.strictEqual(r.body.needsReview, true);
    const c = t.db.state.supportEvalCases["t-ta"];
    assert.deepStrictEqual([c.source, c.needsReview, c.expect, lab.inRun(c)], ["aidan", true, "", false]);
    assert.strictEqual((await call(t.api, "/v1/lab/runs")).statusCode, 400, "no case can run yet");
    // Saying what should happen puts it in the set.
    await call(t.api, "/v1/lab/cases", { body: { id: "t-ta", subject: c.subject, text: c.text, expect: "articles", articleIds: ["a2"] } });
    assert.strictEqual(lab.inRun(t.db.state.supportEvalCases["t-ta"]), true);
    assert.strictEqual(t.db.state.supportEvalCases["t-ta"].finalAnswer, "Like this.", "the answer that was sent is kept");
  });

  // ── Runs ──
  async function seeded() {
    const t = make();
    const save = (text, expect, articleIds = []) => call(t.api, "/v1/lab/cases", { body: { text, expect, articleIds } });
    await save("How do I add a display?", "articles", ["a1"]);       // passes
    await save("How do I pair my display screen?", "articles", ["a2"]); // chooses a1, a2: passes (a2 among those chosen)
    await save("Cheap SEO links for you", "unrelated");                 // passes
    await save("Where is my invoice?", "none");                         // passes (not answerable)
    await save("Invoice for display?", "articles", ["a1"]);             // fails: no right article chosen
    t.db.state.supportEvalCases.nr = { text: "Waiting", needsReview: true, expect: "" };
    return t;
  }
  await check("Run all cases: each case runs once in steps of three, the run records passed, failed and accuracy, and each case its last result", async () => {
    const t = await seeded();
    t.triage.calls.length = 0;
    const s = await call(t.api, "/v1/lab/runs");
    assert.strictEqual(s.statusCode, 200, JSON.stringify(s.body));
    assert.strictEqual(s.body.total, 5, "the case waiting for review is left out");
    const runId = s.body.id;
    const a = await call(t.api, `/v1/lab/runs/${runId}/step`);
    assert.deepStrictEqual([a.body.status, a.body.done, a.body.remaining], ["running", 3, 2]);
    const b = await call(t.api, `/v1/lab/runs/${runId}/step`);
    assert.deepStrictEqual([b.body.status, b.body.done, b.body.passed, b.body.failed, b.body.accuracy], ["done", 5, 4, 1, 0.8]);
    assert.strictEqual(t.triage.calls.length, 5, "each case asked once");
    const run = t.db.state.supportEvalRuns[runId];
    const failing = Object.entries(run.results).filter(([, r]) => !r.passed);
    assert.strictEqual(failing.length, 1);
    assert.deepStrictEqual(failing[0][1].problems, ["no right article chosen"], "the judge's wording");
    assert.ok(!JSON.stringify(run).includes("invoice") && !JSON.stringify(run).toLowerCase().includes("display?"), "a run holds no question text");
    const failedCase = t.db.state.supportEvalCases[failing[0][0]];
    assert.deepStrictEqual([failedCase.lastResult.runId, failedCase.lastResult.passed], [runId, false]);
    const c = await call(t.api, `/v1/lab/runs/${runId}/step`);
    assert.deepStrictEqual([c.body.status, t.triage.calls.length], ["done", 5], "a step on a finished run runs nothing");
  });
  await check("Run all cases: two tabs stepping at once never run a case twice, and a second start continues the running run", async () => {
    const t = await seeded();
    t.triage.calls.length = 0;
    const s = await call(t.api, "/v1/lab/runs");
    const again = await call(t.api, "/v1/lab/runs");
    assert.deepStrictEqual([again.body.id, again.body.resumed], [s.body.id, true]);
    await Promise.all([call(t.api, `/v1/lab/runs/${s.body.id}/step`), call(t.api, `/v1/lab/runs/${s.body.id}/step`)]);
    assert.strictEqual(t.triage.calls.length, 5);
    assert.strictEqual(t.db.state.supportEvalRuns[s.body.id].status, "done");
  });
  await check("Run all cases: a model failure is recorded as an error for that case, and the run still finishes", async () => {
    const t = make();
    await call(t.api, "/v1/lab/cases", { body: { text: "boom goes the display", expect: "none" } });
    await call(t.api, "/v1/lab/cases", { body: { text: "How do I add a display?", expect: "articles", articleIds: ["a1"] } });
    const s = await call(t.api, "/v1/lab/runs");
    const r = await call(t.api, `/v1/lab/runs/${s.body.id}/step`);
    assert.deepStrictEqual([r.body.status, r.body.passed, r.body.failed], ["done", 1, 1]);
    const err = Object.values(t.db.state.supportEvalRuns[s.body.id].results).find((x) => !x.passed);
    assert.deepStrictEqual([err.problems, err.error], [["error"], "model unreachable"]);
  });
  await check("Run all cases: a run left unfinished for an hour is stopped and a new one starts", async () => {
    const t = await seeded();
    const s = await call(t.api, "/v1/lab/runs");
    t.tick(lab.RUN_STALE_MS + 1000);
    const n = await call(t.api, "/v1/lab/runs");
    assert.notStrictEqual(n.body.id, s.body.id);
    assert.strictEqual(t.db.state.supportEvalRuns[s.body.id].status, "stopped");
    assert.strictEqual((await call(t.api, "/v1/lab/runs/none/step")).statusCode, 404);
    assert.strictEqual((await call(t.api, "/v1/lab/runs", { token: "view@ph.example" })).statusCode, 403);
  });

  const bad = results.filter((r) => !r[0]);
  console.log(`\n${results.length - bad.length}/${results.length} support-lab checks passed`);
  process.exit(bad.length ? 1 : 0);
})();
