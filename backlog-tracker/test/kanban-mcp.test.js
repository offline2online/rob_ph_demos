// Staff Kanban on the server (functions/kanban.js) through the real MCP
// server, with the Firebase SDKs stubbed (test/mcp-stubs.js): the KB-MCP-1
// tools over JSON-RPC as an editor and as a viewer, the testing hand-off,
// keys from the counter, mentions, the member directory, and the voice agent
// fill with Claude stubbed. Also checks functions/kanban-core.js is the
// generated copy of public/js/kanban/kanban-core.js.
//   node kanban-mcp.test.js
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const path = require("path");
const { install, makeReq, makeRes } = require("./mcp-stubs");

const env = install();
const mcp = require("../functions/mcp-server.js");
const kanban = require("../functions/kanban.js");
const handler = env.captured.requestHandler;

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.message}`); }
}
async function call(opts) { const req = makeReq(opts); const res = makeRes(); await handler(req, res); return res; }

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function signIn(email) {
  const token = `idtoken-${email}`;
  env.authState.idTokens.set(token, { uid: `uid-${email}`, email, email_verified: true });
  env.authState.users.set(email, { uid: `uid-${email}`, email, customClaims: {} });
  return token;
}
const SAM = "sam@personalisationhub.com", KIT = "kit@personalisationhub.com", ROB = "rob@offline2online.com", HUY = "huy.le@personalisationhub.com";
function member(email, role, displayName) {
  env.store.col("consoleUsers").set(email, { email, role, displayName });
  env.store.col("memberDirectory").set(email, { email, displayName, photoUrl: "", disabled: false });
}
// The whole OAuth dance, as a client would do it, for one member.
async function connect(email) {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const reg = await call({ method: "POST", path: "/mcp/register", body: { client_name: "Claude", redirect_uris: [REDIRECT] } });
  const clientId = reg.body.client_id;
  const done = await call({ method: "POST", path: "/mcp/authorize/complete", body: { idToken: signIn(email), clientId, redirectUri: REDIRECT, state: "s", codeChallenge: challenge, codeChallengeMethod: "S256", scope: "board.read board.write" } });
  const code = new URL(done.body.redirect).searchParams.get("code");
  const tok = await call({ method: "POST", path: "/mcp/token", body: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT } });
  return tok.body.access_token;
}
async function tool(token, name, args) {
  const res = await call({ method: "POST", path: "/mcp", body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } }, headers: { Authorization: `Bearer ${token}` } });
  const r = res.body.result;
  const text = r && r.content && r.content[0] && r.content[0].text;
  let json = null; try { json = JSON.parse(text); } catch { /* an error message */ }
  return { isError: !!(r && r.isError), text, json };
}
const task = (key) => env.store.col("kanbanTasks").get(key);
const activity = (key) => [...env.store.col(`kanbanTasks/${key}/activity`).values()].map((a) => a.text);

(async () => {
  console.log("\nStaff Kanban — server\n");
  member(SAM, "editor", "Sam Sample");
  member(KIT, "viewer", "Kit Viewer");
  member(ROB, "admin", "Rob");
  member(HUY, "editor", "Lê Quang Huy");
  env.store.col("kanbanSettings").set("main", { tester: ROB, currentRelease: "r412", releaseDates: { r412: "2026-10-28" }, firstNames: { [HUY]: "Huy" } });
  env.store.col("releases").set("r412", { name: "PH 4.12", status: "draft", order: 1 });
  const sam = await connect(SAM);
  const kit = await connect(KIT);

  await test("functions/kanban-core.js is the generated copy of the page's kanban-core.js", async () => {
    execFileSync(process.execPath, [path.join(__dirname, "kanban-core-copy.mjs")], { stdio: "pipe" });
  });

  await test("the eleven kanban_* tools are registered, reads as board.read", async () => {
    const t = mcp.__test.TOOLS.filter((x) => x.name.startsWith("kanban_"));
    assert.deepStrictEqual(t.map((x) => x.name).sort(), ["kanban_assign_task", "kanban_comment", "kanban_create_task", "kanban_flag_task", "kanban_get_task", "kanban_list_people", "kanban_list_tasks", "kanban_move_task", "kanban_release_report", "kanban_search_tickets", "kanban_update_task"]);
    for (const x of t) assert.strictEqual(x.scope, /^kanban_(list|get|search|release)/.test(x.name) ? "board.read" : "board.write", x.name);
  });

  await test("kanban_create_task: PH-1 in Backlog, the current release, attributed, logged", async () => {
    const r = await tool(sam, "kanban_create_task", { title: "Offer expiry sweep ignores the store's time zone", description: "Stores outside London expire an hour early.\n\nAround DST.", type: "bug", assignee: HUY, estimate: "1d 4h", priority: "high", labels: ["Menu Boards"] });
    assert.ok(!r.isError, r.text);
    assert.deepStrictEqual(r.json, { created: true, key: "PH-1", status: "backlog" });
    const t = task("PH-1");
    assert.strictEqual(t.status, "backlog"); assert.strictEqual(t.open, true); assert.strictEqual(t.resolution, null);
    assert.strictEqual(t.release, "r412"); assert.strictEqual(t.reporter, SAM); assert.strictEqual(t.createdBy, SAM); assert.strictEqual(t.updatedBy, SAM);
    assert.strictEqual(t.estimate, 12); assert.deepStrictEqual(t.labels, ["menu-boards"]);
    assert.strictEqual(t.description, "<p>Stores outside London expire an hour early.</p><p>Around DST.</p>");
    assert.ok(t.searchTokens.includes("ph-1") && t.searchTokens.includes("sweep") && t.searchTokens.includes("swe") && t.searchTokens.includes("london"));
    assert.strictEqual(env.store.col("kanbanCounters").get("main").nextNumber, 2);
    assert.deepStrictEqual(activity("PH-1"), ["created this ticket over MCP"]);
  });

  await test("keys come from the counter and are never reused", async () => {
    const r = await tool(sam, "kanban_create_task", { title: "Second" });
    assert.strictEqual(r.json.key, "PH-2");
    env.store.col("kanbanTasks").delete("PH-2");
    const r3 = await tool(sam, "kanban_create_task", { title: "Third" });
    assert.strictEqual(r3.json.key, "PH-3");
  });

  await test("bad input is refused, with what's wrong", async () => {
    const r = await tool(sam, "kanban_create_task", { title: "x", estimate: "soon", assignee: "not-an-email" });
    assert.ok(r.isError); assert.match(r.text, /estimate/); assert.match(r.text, /assignee must be an email/);
    const e = await tool(sam, "kanban_create_task", { title: "x", epic: "PH-1" });
    assert.ok(e.isError); assert.match(e.text, /PH-1 is not an epic/);
  });

  await test("kanban_move_task: Ready for Testing hands it to the tester, and back returns it", async () => {
    await tool(sam, "kanban_move_task", { key: "PH-1", status: "in-progress" });
    const r = await tool(sam, "kanban_move_task", { key: "ph1", status: "ready-for-testing" });
    assert.strictEqual(r.json.assignee, ROB); assert.match(r.json.note, /reassigned to Rob for testing/);
    assert.strictEqual(task("PH-1").previousAssignee, HUY);
    const back = await tool(sam, "kanban_move_task", { key: "PH-1", status: "in-progress" });
    assert.match(back.json.note, /returned to Huy/);
    assert.strictEqual(task("PH-1").assignee, HUY);
    assert.ok(activity("PH-1").includes("In Progress → Ready for Testing · reassigned to Rob for testing"));
  });

  await test("closing: completed or withdrawn, with open and closedAt kept in step", async () => {
    const r = await tool(sam, "kanban_move_task", { key: "PH-3", status: "done", resolution: "withdrawn" });
    assert.strictEqual(r.json.resolution, "withdrawn");
    const t = task("PH-3");
    assert.strictEqual(t.open, false); assert.ok(t.closedAt);
    await tool(sam, "kanban_move_task", { key: "PH-3", status: "backlog" });
    assert.strictEqual(task("PH-3").open, true); assert.ok(!("closedAt" in task("PH-3")));
  });

  await test("kanban_update_task, kanban_assign_task, kanban_flag_task", async () => {
    const u = await tool(sam, "kanban_update_task", { key: "PH-3", title: "Third, renamed", logged: "2h" });
    assert.deepStrictEqual(u.json.changed.sort(), ["logged", "title"]);
    assert.ok(task("PH-3").searchTokens.includes("renamed"));
    const a = await tool(sam, "kanban_assign_task", { key: "PH-3", assignee: HUY });
    assert.ok(!a.isError, a.text);
    assert.ok(activity("PH-3").includes("reassigned Unassigned → Huy"));
    const n = await tool(sam, "kanban_assign_task", { key: "PH-3", assignee: "stranger@example.com" });
    assert.ok(n.isError); assert.match(n.text, /isn't a member/);
    await tool(sam, "kanban_flag_task", { key: "PH-3", flagged: true });
    assert.strictEqual(task("PH-3").flagged, true);
  });

  await test("an admin with no console row is a member: listed, assignable by email and as \"me\"", async () => {
    const people = await tool(sam, "kanban_list_people", {});
    assert.ok(people.json.people.some((p) => p.email === ROB));
    const c = await tool(sam, "kanban_create_task", { title: "For me", assignee: "me" });
    assert.ok(!c.isError, c.text); assert.strictEqual(task(c.json.key).assignee, SAM);
    const a = await tool(sam, "kanban_assign_task", { key: c.json.key, assignee: ROB });
    assert.ok(!a.isError, a.text); assert.strictEqual(task(c.json.key).assignee, ROB);
    const m = await tool(sam, "kanban_assign_task", { key: c.json.key, assignee: "me" });
    assert.ok(!m.isError, m.text); assert.strictEqual(task(c.json.key).assignee, SAM);
  });

  await test("an epic: children listed, and losing its type unlinks them", async () => {
    const e = await tool(sam, "kanban_create_task", { title: "Menu Boards — scheduled local offers", type: "epic" });
    await tool(sam, "kanban_update_task", { key: "PH-1", epic: e.json.key });
    const got = await tool(sam, "kanban_get_task", { key: e.json.key });
    assert.deepStrictEqual(got.json.children.map((c) => c.key), ["PH-1"]);
    await tool(sam, "kanban_update_task", { key: e.json.key, type: "task" });
    assert.strictEqual(task("PH-1").epic, "");
  });

  await test("kanban_comment: saved, counted, and only real members are notified", async () => {
    const r = await tool(sam, "kanban_comment", { key: "PH-1", text: "Fix in review.", mention: [HUY, "nobody@example.com", SAM] });
    assert.deepStrictEqual(r.json.notified, [HUY]);
    assert.strictEqual(task("PH-1").commentCount, 1);
    const notes = [...env.store.col("kanbanNotifications").values()];
    assert.strictEqual(notes.length, 1); assert.strictEqual(notes[0].to, HUY); assert.strictEqual(notes[0].from, SAM); assert.strictEqual(notes[0].read, false);
    const got = await tool(sam, "kanban_get_task", { key: "PH-1" });
    assert.strictEqual(got.json.comments[0].text, "Fix in review.");
    assert.strictEqual(got.json.assigneeName, "Huy");
  });

  await test("kanban_list_tasks / kanban_search_tickets / kanban_release_report read the board", async () => {
    const l = await tool(kit, "kanban_list_tasks", { assignee: HUY });
    assert.deepStrictEqual(l.json.tasks.map((t) => t.key).sort(), ["PH-1", "PH-3"]);
    const s = await tool(kit, "kanban_search_tickets", { query: "sweep" });
    assert.strictEqual(s.json.results[0].key, "PH-1");
    const byNumber = await tool(kit, "kanban_search_tickets", { query: "PH-3" });
    assert.strictEqual(byNumber.json.results[0].key, "PH-3");
    const rep = await tool(kit, "kanban_release_report", {});
    assert.strictEqual(rep.json.release, "r412"); assert.strictEqual(rep.json.releaseName, "PH 4.12");
    assert.ok(rep.json.outstanding >= 2);
    const huy = rep.json.byPerson.find((p) => p.assignee === HUY);
    assert.strictEqual(huy.name, "Huy");
    const people = await tool(kit, "kanban_list_people", {});
    assert.ok(people.json.people.some((p) => p.email === HUY && p.name === "Huy"));
    assert.strictEqual(people.json.tester, ROB);
  });

  await test("a viewer reads but can't write", async () => {
    for (const [name, args] of [["kanban_create_task", { title: "x" }], ["kanban_move_task", { key: "PH-1", status: "approved" }], ["kanban_comment", { key: "PH-1", text: "x" }]]) {
      const r = await tool(kit, name, args);
      assert.ok(r.isError, `${name} should be refused`);
    }
    assert.notStrictEqual(task("PH-1").status, "approved");
  });

  await test("every write is in the audit log as the caller", async () => {
    const tools = [...env.store.col("mcpAuditLog").values()].filter((a) => String(a.tool).startsWith("kanban_"));
    assert.ok(tools.length >= 8);
    assert.ok(tools.every((a) => a.email === SAM));
  });

  // ── member directory ──────────────────────────────────────────────────
  await test("the directory follows consoleUsers: added, renamed, removed (no role copied)", async () => {
    const write = (before, after) => kanban.syncMemberDirectoryWrite({ params: { userEmail: "new@personalisationhub.com" }, data: { before: { exists: !!before, data: () => before }, after: { exists: !!after, data: () => after } } });
    await write(null, { email: "new@personalisationhub.com", role: "admin", displayName: "New Person" });
    const d = env.store.col("memberDirectory").get("new@personalisationhub.com");
    assert.strictEqual(d.displayName, "New Person"); assert.ok(!("role" in d));
    await write({ displayName: "New Person" }, { displayName: "Renamed" });
    assert.strictEqual(env.store.col("memberDirectory").get("new@personalisationhub.com").displayName, "Renamed");
    await write({ displayName: "Renamed" }, null);
    assert.ok(!env.store.col("memberDirectory").has("new@personalisationhub.com"));
  });
  await test("/mcp/kanban/directory-sync fills the directory for any member", async () => {
    env.store.col("memberDirectory").clear();
    const r = await call({ method: "POST", path: "/mcp/kanban/directory-sync", headers: { "X-Firebase-ID-Token": signIn(KIT) } });
    assert.strictEqual(r.statusCode, 200);
    // The bootstrap admins have no consoleUsers row but are members all the same.
    const ids = [...env.store.col("consoleUsers").keys()];
    for (const b of ["rob@offline2online.com", "rob@personalisationhub.com"]) if (!ids.includes(b)) ids.push(b);
    assert.strictEqual(env.store.col("memberDirectory").size, ids.length);
    assert.ok(env.store.col("memberDirectory").has("rob@offline2online.com"));
    const out = await call({ method: "POST", path: "/mcp/kanban/directory-sync", headers: { "X-Firebase-ID-Token": signIn("nobody@example.com") } });
    assert.strictEqual(out.statusCode, 403);
  });

  // ── agent fill (KB-MOD-2) ────────────────────────────────────────────────
  const ctx = { today: "2026-10-21", users: [{ id: HUY, first: "Huy", full: "Lê Quang Huy" }], epics: [{ key: "PH-4", title: "Menu Boards" }], releases: [{ id: "r412", name: "PH 4.12" }], currentRelease: "r412", sprints: [], labels: [] };
  await test("agent fill without a key answers draft: null (the page falls back to its own)", async () => {
    env.authState.secrets.ANTHROPIC_API_KEY = "unset";
    const r = await call({ method: "POST", path: "/mcp/kanban/agent-fill", headers: { "X-Firebase-ID-Token": signIn(SAM) }, body: { transcript: "the sweep is broken", context: ctx } });
    assert.strictEqual(r.statusCode, 200); assert.deepStrictEqual(r.body, { draft: null, reason: "not-configured" });
  });
  await test("agent fill is refused to a viewer and needs a transcript", async () => {
    const v = await call({ method: "POST", path: "/mcp/kanban/agent-fill", headers: { "X-Firebase-ID-Token": signIn(KIT) }, body: { transcript: "x" } });
    assert.strictEqual(v.statusCode, 403);
    const e = await call({ method: "POST", path: "/mcp/kanban/agent-fill", headers: { "X-Firebase-ID-Token": signIn(SAM) }, body: {} });
    assert.strictEqual(e.statusCode, 400);
  });
  await test("with a key: Claude's JSON comes back as a draft, unknown ids dropped", async () => {
    let sent = null;
    class FakeAnthropic {
      constructor(opts) { this.opts = opts; this.beta = { messages: { create: async (req) => { sent = req; return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ title: "Offer sweep ignores time zone", description: "Stores outside London expire early.", type: "bug", priority: "highest", assignee: HUY, release: "nope", estimateHours: 4, due: "2026-10-24", sprint: "", labels: ["Menu Boards"], epic: "PH-4", flagged: false }) }] }; } } }; }
    }
    const draft = await kanban.claudeDraft("sk-test", "the offer sweep ignores the time zone, urgent, Huy, four hours", ctx, { Anthropic: FakeAnthropic });
    assert.strictEqual(sent.model, kanban.AGENT_MODEL);
    assert.strictEqual(sent.output_config.format.type, "json_schema");
    assert.match(sent.messages[0].content, /four hours/);
    assert.deepStrictEqual(draft, { title: "Offer sweep ignores time zone", description: "Stores outside London expire early.", type: "bug", priority: "highest", assignee: HUY, release: "", sprint: "", epic: "PH-4", due: "2026-10-24", labels: ["menu-boards"], flagged: false, estimate: 4 });
  });
  await test("a refusal or unreadable answer gives no draft", async () => {
    const make = (resp) => class { constructor() { this.beta = { messages: { create: async () => resp } }; } };
    assert.strictEqual(await kanban.claudeDraft("k", "x", ctx, { Anthropic: make({ stop_reason: "refusal", content: [] }) }), null);
    assert.strictEqual(await kanban.claudeDraft("k", "x", ctx, { Anthropic: make({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }) }), null);
  });

  // TC-45d of kanban-staff-board/docs/E2E-TEST-PLAN.md: the fourth way to move a ticket (the three
  // others, mouse drag, touch drag and the Status menu, are in the browser suites). One ticket walks every
  // ordered move between the seven places (Backlog, Ready for Dev, In Progress, Ready for Testing,
  // Approved for Deployment, Completed, Withdrawn): 42 moves, each checked for what the board reads.
  await test("TC-45d kanban_move_task: all 42 moves between the seven places", async () => {
    const { allMoves, PLACES } = await import("../../kanban-staff-board/test/lib/driver.mjs");
    const label = { backlog: "Backlog", "ready-for-dev": "Ready for Dev", "in-progress": "In Progress", "ready-for-testing": "Ready for Testing", approved: "Approved for Deployment", completed: "Completed", withdrawn: "Withdrawn" };
    const made = await tool(sam, "kanban_create_task", { title: "Walks every move", assignee: HUY, estimate: "5h" });
    const key = made.json.key;
    const moves = allMoves(PLACES.map((p) => p.id));
    assert.strictEqual(moves.length, 42);
    let assignee = HUY, prev = "";
    for (const [i, [from, to]] of moves.entries()) {
      const pl = PLACES.find((p) => p.id === to);
      const before = activity(key).length;
      const r = await tool(sam, "kanban_move_task", pl.status === "done" ? { key, status: "done", resolution: pl.resolution } : { key, status: pl.status });
      const at = `move ${i + 1} ${from} → ${to}`;
      assert.ok(!r.isError && r.json.moved === true, `${at}: ${r.text}`);
      const t = task(key);
      assert.strictEqual(t.status, pl.status, at);
      assert.strictEqual(t.resolution || null, pl.resolution || null, `${at}: resolution`);
      assert.strictEqual(t.open, pl.status !== "done", `${at}: open`);
      if (pl.status === "done") assert.ok(t.closedAt, `${at}: closedAt set`); else assert.ok(!("closedAt" in t), `${at}: closedAt cleared`);
      // the testing hand-off
      if (to === "ready-for-testing" && assignee !== ROB) { prev = assignee; assignee = ROB; }
      else if (from === "ready-for-testing" && (to === "in-progress" || to === "ready-for-dev") && prev) assignee = prev;
      assert.strictEqual(t.assignee, assignee, `${at}: assignee`);
      const lines = activity(key);
      assert.strictEqual(lines.length, before + 1, `${at}: one activity line`);
      assert.ok(lines[lines.length - 1].startsWith(`${label[from]} → ${label[to]}`), `${at}: "${lines[lines.length - 1]}"`);
      assert.strictEqual(r.json.status, pl.status); assert.strictEqual(r.json.resolution || null, pl.resolution || null);
    }
    // moving to where it already is changes nothing
    const again = await tool(sam, "kanban_move_task", { key, status: "backlog" }); // the circuit ends where it began
    assert.strictEqual(again.json.moved, false);
  });

  // TC-44 (server half): what the board writes when a person moves or edits a card is what kanban_get_task
  // returns. The browser half (a ticket made over MCP appears on an open board) is in the console UI suite.
  await test("TC-44 a change made on the board is what kanban_get_task returns", async () => {
    const made = await tool(sam, "kanban_create_task", { title: "Moved by hand on the board", assignee: HUY, estimate: "2h" });
    const key = made.json.key;
    // the page's updateTask: one batch with the ticket's fields and an activity line
    env.store.col("kanbanTasks").set(key, { ...task(key), status: "in-progress", resolution: null, open: true, priority: "highest", labels: ["from-the-board"], updatedBy: HUY });
    env.store.col(`kanbanTasks/${key}/activity`).set("a-board", { who: HUY, text: "Backlog → In Progress", at: new Date() });
    env.store.col(`kanbanTasks/${key}/comments`).set("c-board", { author: HUY, text: "Started on this", html: "<p>Started on this</p>", at: new Date() });
    const got = await tool(sam, "kanban_get_task", { key });
    assert.ok(!got.isError, got.text);
    assert.strictEqual(got.json.status, "in-progress");
    assert.strictEqual(got.json.priority, "highest");
    assert.ok(got.json.activity.some((a) => a.text === "Backlog → In Progress" && a.who === HUY));
    assert.strictEqual(got.json.comments[0].text, "Started on this");
    // and the other way: a change over MCP is what the board's store would read
    await tool(sam, "kanban_move_task", { key, status: "done", resolution: "completed" });
    const t = task(key);
    assert.strictEqual(t.open, false); assert.strictEqual(t.status, "done"); assert.strictEqual(t.updatedBy, SAM);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const [n, e] of failures) console.log(`\n--- ${n}\n${e && e.stack}`); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
