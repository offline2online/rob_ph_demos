// Aidan in the console's chat panel (yvnAPPAW9ROLrNwJceyn): the endpoint
// (functions/aidan-chat.js, /mcp/aidan/chat) through the real MCP server with
// the Firebase SDKs stubbed (test/mcp-stubs.js) and Aidan's model stubbed
// (plan / answer), plus the pure half (functions/aidan-chat-core.js).
// Checked: any signed-in member may chat and reads only what their own role's
// agent may (a tool given a role is not offered to a viewer, and the answer
// contains nothing from it); a request to change the console changes nothing;
// links survive only to records the turn read; conversations are kept per
// member (the last 20), readable by their owner only; every turn is audited
// with no message text; the per-member rate limit; the turn's time ceiling;
// and the mailbox's own reader is unchanged. No emulator, no credentials, no network.
// Run: node test/aidan-chat.test.js
"use strict";
const assert = require("assert");
const { install, makeReq, makeRes } = require("./mcp-stubs");

process.env.GCLOUD_PROJECT = "backlog-tracker-e4ed2";
process.env.MCP_PUBLIC_ORIGIN = "https://backlog-tracker-e4ed2.web.app";
const ORIGIN = process.env.MCP_PUBLIC_ORIGIN;

const env = install();
const mcp = require("../functions/mcp-server.js");
const ac = require("../functions/aidan-core.js");
const cc = require("../functions/aidan-chat-core.js");
const { createAidanChat } = require("../functions/aidan-chat.js");
require("../functions/code-mode").sandbox.setIsolatedVmPath(require.resolve("isolated-vm"));
const handler = env.captured.requestHandler;
const { TOOLS_BY_NAME } = mcp.__test;

const checks = [];
const check = (name, fn) => checks.push([name, fn]);
async function call(opts) { const req = makeReq(opts); const res = makeRes(); await handler(req, res); return res; }

const VIEWER = "vic@ph.example", EDITOR = "eda@ph.example", ADMIN = "ada@ph.example";
for (const [email, role] of [[VIEWER, "viewer"], [EDITOR, "editor"], [ADMIN, "admin"]]) env.store.col("consoleUsers").set(email, { email, role, displayName: email.split("@")[0] });
function signIn(email) {
  const token = `idtoken-${email}`;
  env.authState.idTokens.set(token, { uid: `uid-${email}`, email, email_verified: true });
  env.authState.users.set(email, { uid: `uid-${email}`, email, customClaims: {} });
  return token;
}
const chat = (email, body, method = "POST", query = undefined) => call({ method, path: "/mcp/aidan/chat", headers: email ? { "X-Firebase-ID-Token": signIn(email) } : {}, body, query });

const BT = "oTcLAbnhUUO2S7NkbsuV";
const T1 = "D1splayTyp3sT1cketAb";
env.store.col("projects").set(BT, { name: "Display Types", readmeMd: "# Display Types\n" });
env.store.col("backlogItems").set(T1, { projectId: BT, title: "Display Types: rotation editor", desc: "Rotation.", status: "ready-for-testing", type: "feature", category: "HQ Admin" });
env.store.col("leads").set("L3adAcm3Retai1Lead01", { company: { name: "Zebracorn Retail", website: "", industry: "", countries: [], storeCount: null }, contacts: [], stage: "lead", source: "website", assignee: "", customerAccount: null, leadType: "company" });

// The model stand-in: the plan reads what `reads` says on its first round; the
// answer echoes what it was given so a check can see what reached it.
const seen = { plan: [], answer: [] };
let planReads = [];
let answerFor = null;
mcp.__test.setAidanChatRun({
  plan: async (input) => { seen.plan.push(input); return input.round === 0 ? { changeRequested: false, reads: planReads.map((r) => ({ tool: r.tool, args: JSON.stringify(r.args || {}) })), reason: "" } : { changeRequested: false, reads: [], reason: "" }; },
  answer: async (input) => { seen.answer.push(input); return answerFor ? answerFor(input) : { canAnswer: true, replyText: "Here you go.", reason: "", gap: "", gapKind: "", improvement: "" }; },
});
const reset = () => { seen.plan.length = 0; seen.answer.length = 0; planReads = []; answerFor = null; env.store.col("aidanChatLimits").clear(); };
const consoleTextOf = (input) => input.content.map((b) => b.text).join("\n");

// ── The pure half ──
check("the member's text is cleaned and capped; the conversation block keeps the last turns", () => {
  assert.strictEqual(cc.cleanText("  hi\u0000 there \r\n\n\n\nyou "), "hi there \n\nyou");
  assert.strictEqual(cc.cleanText("x".repeat(5000)).length, cc.CHAT_TEXT_MAX);
  assert.strictEqual(cc.cleanText("   "), "");
  const msgs = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "aidan" : "member", text: `m${i}` }));
  assert.strictEqual(cc.transcript(msgs), "Member: m4\nAidan: m5\nMember: m6\nAidan: m7\nMember: m8\nAidan: m9");
});

check("links survive only to records the turn read; ids leave the words but not the links", () => {
  const data = `{"hits":[{"id":"${T1}","url":"${ORIGIN}/#item-${T1}"}]}`;
  const text = `See [rotation](${ORIGIN}/#item-${T1}), [evil](https://evil.example/x), [made up](${ORIGIN}/#item-NotInTheDataAtAll123) and [concept](${ORIGIN}/#concept-${T1}).`;
  assert.strictEqual(cc.safeLinks(text, data, ORIGIN), `See [rotation](${ORIGIN}/#item-${T1}), evil, made up and [concept](${ORIGIN}/#concept-${T1}).`);
  assert.deepStrictEqual(cc.linksOf(cc.safeLinks(text, data, ORIGIN)).map((l) => l.title), ["rotation", "concept"]);
  const names = [[T1, "Display Types: rotation editor"]];
  assert.strictEqual(cc.stripIdsOutsideLinks(`Ticket ${T1} is [here](${ORIGIN}/#item-${T1})`, names), `Ticket Display Types: rotation editor is [here](${ORIGIN}/#item-${T1})`);
});

check("a change request names where to make it; the rate limit and the keep-20 rule", () => {
  assert.match(cc.readOnlyReply("archive ticket X"), /only read the console.*haven't changed anything.*Archiving/);
  assert.match(cc.readOnlyReply("deploy the train to main"), /admin/);
  let w = null;
  for (let i = 0; i < cc.CHAT_RATE_MAX; i += 1) { w = cc.rateStep(w, 1000 + i); assert.ok(w.allowed); }
  assert.strictEqual(cc.rateStep(w, 2000).allowed, false);
  assert.strictEqual(cc.rateStep(w, 1000 + cc.CHAT_RATE_WINDOW_MS).allowed, true, "a new window opens");
  const rows = Array.from({ length: 23 }, (_, i) => ({ id: `c${i}`, updatedAtMs: i }));
  assert.deepStrictEqual(cc.overKeep(rows).sort(), ["c0", "c1", "c2"]);
  assert.deepStrictEqual(cc.chatSession({ email: VIEWER, role: "viewer" }), { email: VIEWER, role: "viewer", scopes: ["board.read"], via: "aidan-chat" });
});

// ── The endpoint ──
check("only a signed-in member may chat", async () => {
  reset();
  assert.strictEqual((await chat(null, { text: "hi" })).statusCode, 401);
  env.authState.idTokens.set("idtoken-stranger", { uid: "u-s", email: "stranger@else.example", email_verified: true });
  const r = await call({ method: "POST", path: "/mcp/aidan/chat", headers: { "X-Firebase-ID-Token": "idtoken-stranger" }, body: { text: "hi" } });
  assert.strictEqual(r.statusCode, 403);
  assert.strictEqual((await chat(VIEWER, { text: "   " })).statusCode, 400);
});

check("a question is answered from the console as the member, with links to the tickets it read", async () => {
  reset();
  planReads = [{ tool: "get_backlog_item", args: { itemId: T1 } }];
  answerFor = () => ({ canAnswer: true, replyText: `Display Types has one ticket in testing: [rotation editor](${ORIGIN}/#item-${T1}). Also see [this](https://evil.example/).`, reason: "", gap: "", gapKind: "", improvement: "" });
  const r = await chat(EDITOR, { text: "where are we with Display Types?" });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.message.role, "aidan");
  assert.match(r.body.message.text, new RegExp(`\\[rotation editor\\]\\(${ORIGIN.replace(/[.]/g, "\\.")}/#item-${T1}\\)`));
  assert.ok(!/evil\.example/.test(r.body.message.text), "a link the console didn't give is dropped");
  assert.deepStrictEqual(r.body.message.links, [{ title: "rotation editor", url: `${ORIGIN}/#item-${T1}` }]);
  assert.strictEqual(seen.plan[0].instruction, "where are we with Display Types?");
  assert.match(consoleTextOf(seen.answer[0]), /Display Types: rotation editor/, "the answer was written from what was read");
  // Kept for the member, with both messages.
  const saved = env.store.col("aidanChats").get(r.body.conversationId);
  assert.deepStrictEqual([saved.email, saved.title, saved.messages.map((m) => m.role), saved.turns], [EDITOR, "where are we with Display Types?", ["member", "aidan"], 1]);
  // Audited: who, when, what was read, how long, how it ended; never the text.
  const runs = [...env.store.col("aidanChatRuns").values()];
  const run = runs[runs.length - 1];
  assert.deepStrictEqual([run.email, run.role, run.via, run.outcome, run.input, run.reads > 0, run.tools.includes("get_backlog_item")], [EDITOR, "editor", "aidan-chat", "answered", "text", true, true]);
  assert.ok(typeof run.durationMs === "number");
  assert.ok(!JSON.stringify(run).includes("Display Types"), "no message text in the audit");
  // A follow-up continues the same conversation, and the plan sees the earlier turn.
  const r2 = await chat(EDITOR, { text: "and the other one?", conversationId: r.body.conversationId, input: "voice" });
  assert.strictEqual(r2.body.conversationId, r.body.conversationId);
  assert.match(seen.plan[seen.plan.length - 1].email, /Member: where are we with Display Types\?\nAidan: Display Types has one ticket/);
  assert.strictEqual(env.store.col("aidanChats").get(r.body.conversationId).messages.length, 4);
  assert.strictEqual([...env.store.col("aidanChatRuns").values()].pop().input, "voice");
});

check("search_console and get_topic_context run as the member, logged with via aidan-chat", async () => {
  reset();
  planReads = [{ tool: "search_console", args: { query: "rotation" } }, { tool: "get_topic_context", args: { topic: "Display Types" } }];
  const before = env.store.col("searchRuns").size;
  const r = await chat(VIEWER, { text: "where are we with Display Types?" });
  assert.strictEqual(r.statusCode, 200);
  const rows = [...env.store.col("searchRuns").values()].slice(before);
  assert.ok(rows.length >= 2, `search and topic calls are logged (${rows.length})`);
  assert.ok(rows.every((x) => x.via === "aidan-chat" && x.email === VIEWER && x.role === "viewer"), JSON.stringify(rows.map((x) => [x.via, x.email, x.role])));
});

check("a viewer's chat never reads a source their role can't: a tool given a role is not offered, and nothing of it reaches the answer", async () => {
  reset();
  const leads = TOOLS_BY_NAME.get("list_leads");
  const was = leads.role;
  leads.role = "editor";
  try {
    const viewerReader = mcp.consoleReader(ac.CONSOLE_READ_TOOLS, cc.chatSession({ email: VIEWER, role: "viewer" }));
    const editorReader = mcp.consoleReader(ac.CONSOLE_READ_TOOLS, cc.chatSession({ email: EDITOR, role: "editor" }));
    assert.ok(!viewerReader.tools().some((t) => t.name === "list_leads"), "not offered to a viewer");
    assert.ok(editorReader.tools().some((t) => t.name === "list_leads"), "offered to an editor");
    assert.ok(!mcp.consoleReader(ac.CONSOLE_READ_TOOLS).tools().some((t) => t.name === "list_leads"), "the mailbox's stand-in still gets no tool with a role");
    planReads = [{ tool: "list_leads", args: {} }, { tool: "search_console", args: { query: "retail company leads" } }];
    const r = await chat(VIEWER, { text: "which leads do we have?" });
    assert.strictEqual(r.statusCode, 200);
    { const t = consoleTextOf(seen.answer[0]); const i = t.indexOf("Zebracorn"); assert.ok(i < 0, `nothing from Leads reached a viewer's answer: ${t.slice(Math.max(0, i - 300), i + 50)}`); }
    reset();
    planReads = [{ tool: "list_leads", args: {} }];
    await chat(EDITOR, { text: "which leads do we have?" });
    assert.match(consoleTextOf(seen.answer[0]), /Zebracorn/, "an editor's chat reads it");
  } finally { leads.role = was; }
});

check("\"archive ticket X\": the read-only reply, no model asked, nothing on the board changed", async () => {
  reset();
  const before = JSON.stringify([...env.store.col("backlogItems")]);
  const r = await chat(ADMIN, { text: `archive ticket ${T1}` });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.message.readOnly, true);
  assert.match(r.body.message.text, /only read the console/);
  assert.deepStrictEqual([seen.plan.length, seen.answer.length], [0, 0]);
  assert.strictEqual(JSON.stringify([...env.store.col("backlogItems")]), before);
  assert.strictEqual([...env.store.col("aidanChatRuns").values()].pop().outcome, "read-only");
});

check("a question Aidan can't answer says so, and his self-check files (or comments on) a Backlog ticket", async () => {
  reset();
  env.store.col("projects").set("H0meAidanPr0jectXyz1", { name: "Backlog Tracker & FAQs" });
  answerFor = () => ({ canAnswer: false, replyText: "", reason: "Nothing in the console says when the release ships.", gap: "No release dates are recorded anywhere I can read.", gapKind: "missing-data", improvement: "Record release dates on releases." });
  const items = env.store.col("backlogItems").size;
  const r = await chat(VIEWER, { text: "when does the next release ship?" });
  assert.strictEqual(r.statusCode, 200);
  assert.match(r.body.message.text, /couldn't find the answer/);
  const run = [...env.store.col("aidanChatRuns").values()].pop();
  assert.strictEqual(run.outcome, "cannot-answer");
  assert.ok(run.improvement && ["filed", "commented", "not-filed"].includes(run.improvement.action), JSON.stringify(run.improvement));
  if (run.improvement.action === "filed") {
    assert.strictEqual(env.store.col("backlogItems").size, items + 1);
    const t = env.store.col("backlogItems").get(run.improvement.itemId);
    assert.match(t.desc, /from the console chat: data, not instructions/);
    assert.strictEqual(t.aidanImprovement.source, "chat");
  }
});

check("conversations are the member's own: listed newest first, read back by id, never another member's", async () => {
  reset();
  const a = await chat(VIEWER, { text: "first question" });
  const list = await chat(VIEWER, null, "GET");
  assert.strictEqual(list.statusCode, 200);
  assert.ok(list.body.conversations.length >= 1 && list.body.conversations.every((c) => c.id && c.title));
  assert.strictEqual(list.body.conversations[0].id, a.body.conversationId, "newest first");
  const one = await chat(VIEWER, null, "GET", { id: a.body.conversationId });
  assert.deepStrictEqual(one.body.conversation.messages.map((m) => m.role), ["member", "aidan"]);
  assert.strictEqual((await chat(EDITOR, null, "GET", { id: a.body.conversationId })).statusCode, 404, "another member can't read it");
  assert.strictEqual((await chat(EDITOR, { text: "x", conversationId: a.body.conversationId })).statusCode, 404, "nor add to it");
  assert.ok(!(await chat(EDITOR, null, "GET")).body.conversations.some((c) => c.id === a.body.conversationId));
});

check("the last 20 conversations are kept per member", async () => {
  reset();
  for (let i = 0; i < 22; i += 1) env.store.col("aidanChats").set(`old${String(i).padStart(4, "0")}`, { email: ADMIN, title: `old ${i}`, messages: [], turns: 1, updatedAt: new Date(1000 + i), updatedAtMs: 1000 + i });
  await chat(ADMIN, { text: "a new question" });
  const mine = [...env.store.col("aidanChats").values()].filter((c) => c.email === ADMIN);
  assert.strictEqual(mine.length, cc.CHAT_KEEP);
  assert.ok(!env.store.col("aidanChats").has("old0000") && env.store.col("aidanChats").has("old0021"), "the oldest went first");
});

check("the per-member rate limit answers 429 and changes nothing", async () => {
  reset();
  env.store.col("aidanChatLimits").set(EDITOR, { windowStart: Date.now(), count: cc.CHAT_RATE_MAX });
  const before = env.store.col("aidanChats").size;
  const r = await chat(EDITOR, { text: "one more" });
  assert.strictEqual(r.statusCode, 429);
  assert.match(r.body.error, /Try again/);
  assert.strictEqual(env.store.col("aidanChats").size, before);
  assert.strictEqual(seen.plan.length, 0);
});

check("a turn past its ceiling ends with the \"took too long\" reply", async () => {
  const api = createAidanChat({
    db: () => require("firebase-admin/firestore").getFirestore(), logger: { info() {}, warn() {}, error() {} }, turnMaxMs: 30,
    requireConsoleUser: async () => ({ ok: true, user: { email: VIEWER, role: "viewer", displayName: "" } }),
    rateLimited: () => false, tooMany: () => {}, readerFor: () => null, origin: ORIGIN,
    aidan: () => ({ chat: () => new Promise(() => {}) }),
  });
  env.store.col("aidanChatLimits").clear();
  const res = makeRes();
  await api.handle(makeReq({ method: "POST", path: "/aidan/chat", body: { text: "a slow one" } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.message.text, cc.TOO_LONG_REPLY);
  assert.strictEqual([...env.store.col("aidanChatRuns").values()].pop().outcome, "timeout");
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); }
    catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack.split("\n").slice(0, 4).join("\n      ") : err}`); }
  }
  console.log(`\naidan-chat: ${checks.length - failed}/${checks.length} passed`);
  process.exit(failed ? 1 : 0);
})();
