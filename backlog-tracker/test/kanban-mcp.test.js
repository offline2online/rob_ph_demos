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
const core = require("../functions/kanban-core");

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
// Every ticket against its board card (kanbanCards): what the board reads must be what the ticket says.
function cardDrift() {
  const tasks = env.store.col("kanbanTasks"), cards = env.store.col("kanbanCards");
  const out = [];
  for (const [k, t] of tasks) {
    const c = cards.get(k);
    if (!c) { out.push(`${k}: no card`); continue; }
    const want = core.cardOf(Object.assign({ key: k }, t));
    for (const f of core.CARD_FIELDS) if (JSON.stringify(c[f]) !== JSON.stringify(want[f])) out.push(`${k}.${f}: card ${JSON.stringify(c[f])}, ticket ${JSON.stringify(want[f])}`);
    if ((c.closedAt != null) !== (t.closedAt != null)) out.push(`${k}.closedAt: card ${c.closedAt ? "has" : "lacks"} it, ticket ${t.closedAt ? "has" : "lacks"} it`);
    for (const f of Object.keys(c)) if (!core.CARD_FIELDS.includes(f) && !["closedAt", "updatedAt", "updatedBy"].includes(f)) out.push(`${k}.${f}: not a card field`);
  }
  for (const k of cards.keys()) if (!tasks.has(k)) out.push(`${k}: card without a ticket`);
  return out;
}
async function tool(token, name, args) {
  const r0 = await tool1(token, name, args);
  // A tool that changes a ticket must change its card with it.
  const drift = cardDrift();
  if (drift.length) throw new Error(`${name} left a card out of step: ${drift.join("; ")}`);
  return r0;
}
async function tool1(token, name, args) {
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

  await test("the twelve kanban_* tools are registered, reads as board.read", async () => {
    const t = mcp.__test.TOOLS.filter((x) => x.name.startsWith("kanban_"));
    assert.deepStrictEqual(t.map((x) => x.name).sort(), ["kanban_assign_task", "kanban_attach_file", "kanban_comment", "kanban_create_task", "kanban_flag_task", "kanban_get_task", "kanban_list_people", "kanban_list_tasks", "kanban_move_task", "kanban_release_report", "kanban_search_tickets", "kanban_update_task"]);
    for (const x of t) assert.strictEqual(x.scope, /^kanban_(list|get|search|release)/.test(x.name) ? "board.read" : "board.write", x.name);
  });

  await test("every kanban_* tool description carries KANBAN_SCOPE, and the backlog side says its half", async () => {
    const t = mcp.__test.TOOLS.filter((x) => x.name.startsWith("kanban_"));
    assert.ok(t.length >= 11);
    for (const x of t) assert.ok(x.description.includes(kanban.KANBAN_SCOPE), `${x.name} lacks the scope sentence`);
    assert.match(kanban.KANBAN_SCOPE, /^Staff Kanban is for staff tasks only: /);
    const b = mcp.__test.TOOLS.find((x) => x.name === "create_backlog_item");
    assert.match(b.description, /agent work/); assert.match(b.description, /kanban_create_task/);
    const init = await call({ method: "POST", path: "/mcp", body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }, headers: { Authorization: `Bearer ${sam}` } });
    const ins = init.body.result.instructions;
    assert.match(ins, /Staff Kanban is for staff tasks only/); assert.match(ins, /create_backlog_item/); assert.match(ins, /still create and assign staff tasks/);
  });

  await test("kanban_create_task: PH-1 in Backlog, no release unless given, attributed, logged", async () => {
    const r = await tool(sam, "kanban_create_task", { title: "Offer expiry sweep ignores the store's time zone", description: "Stores outside London expire an hour early.\n\nAround DST.", type: "bug", assignee: HUY, estimate: "1d 4h", priority: "high", labels: ["Menu Boards"] });
    assert.ok(!r.isError, r.text);
    assert.deepStrictEqual(r.json, { created: true, key: "PH-1", status: "backlog" });
    const t = task("PH-1");
    assert.strictEqual(t.status, "backlog"); assert.strictEqual(t.open, true); assert.strictEqual(t.resolution, null);
    assert.strictEqual(t.release, ""); assert.strictEqual(t.reporter, SAM); assert.strictEqual(t.createdBy, SAM); assert.strictEqual(t.updatedBy, SAM);
    assert.strictEqual(t.estimate, 12); assert.deepStrictEqual(t.labels, ["menu-boards"]);
    assert.strictEqual(t.description, "<p>Stores outside London expire an hour early.</p><p>Around DST.</p>");
    assert.ok(t.searchTokens.includes("ph-1") && t.searchTokens.includes("sweep") && t.searchTokens.includes("swe") && t.searchTokens.includes("london"));
    assert.strictEqual(env.store.col("kanbanCounters").get("main").nextNumber, 2);
    assert.deepStrictEqual(activity("PH-1"), ["created this ticket over MCP"]);
  });

  await test("keys come from the counter and are never reused", async () => {
    const r = await tool(sam, "kanban_create_task", { title: "Second", release: "r412" });
    assert.strictEqual(r.json.key, "PH-2");
    env.store.col("kanbanTasks").delete("PH-2"); env.store.col("kanbanCards").delete("PH-2");
    const r3 = await tool(sam, "kanban_create_task", { title: "Third", release: "r412" });
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

  await test("TC-47: with no tester or current release stored, the defaults apply", async () => {
    const saved = env.store.col("kanbanSettings").get("main");
    const savedRel = env.store.col("releases").get("r412");
    env.store.col("kanbanSettings").set("main", { releaseDates: {}, firstNames: { [HUY]: "Huy" } });
    env.store.col("releases").set("r409", { name: "PH 4.9", version: "4.9", status: "draft", order: 5 });
    env.store.col("releases").set("r412", { name: "PH 4.12", version: "4.12", status: "draft", order: 1 });
    try {
      const people = await tool(kit, "kanban_list_people", {});
      assert.strictEqual(people.json.tester, ROB); assert.strictEqual(people.json.currentRelease, "r409");
      assert.strictEqual((await tool(kit, "kanban_release_report", {})).json.release, "r409");
      await tool(sam, "kanban_move_task", { key: "PH-1", status: "in-progress" });
      const r = await tool(sam, "kanban_move_task", { key: "PH-1", status: "ready-for-testing" });
      assert.strictEqual(r.json.assignee, ROB); assert.match(r.json.note, /reassigned to Rob for testing/);
      assert.strictEqual(task("PH-1").previousAssignee, HUY);
      assert.match((await tool(sam, "kanban_move_task", { key: "PH-1", status: "in-progress" })).json.note, /returned to Huy/);
    } finally {
      env.store.col("kanbanSettings").set("main", saved);
      env.store.col("releases").delete("r409");
      env.store.col("releases").set("r412", savedRel);
    }
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
    assert.ok(!(await tool(sam, "kanban_update_task", { key: "PH-1", release: "r412" })).isError); // PH-1 was created with no release
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
    // The bootstrap admin has no consoleUsers row but is a member all the
    // same; its alias (rob@personalisationhub.com) is not a member of its own.
    const ids = [...env.store.col("consoleUsers").keys()];
    for (const b of ["rob@offline2online.com"]) if (!ids.includes(b)) ids.push(b);
    assert.strictEqual(env.store.col("memberDirectory").size, ids.length);
    assert.ok(env.store.col("memberDirectory").has("rob@offline2online.com"));
    assert.ok(!env.store.col("memberDirectory").has("rob@personalisationhub.com"));
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
    const edited = { ...task(key), status: "in-progress", resolution: null, open: true, priority: "highest", labels: ["from-the-board"], updatedBy: HUY };
    env.store.col("kanbanTasks").set(key, edited);
    env.store.col("kanbanCards").set(key, { ...core.cardOf(edited), updatedBy: HUY }); // (the page writes both in one batch)
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
  await test("a ticket with no release can be given one later", async () => {
    const r = await tool(sam, "kanban_create_task", { title: "Create a one-pager" });
    assert.ok(!r.isError, r.text);
    assert.strictEqual(task(r.json.key).release, "");
    const u = await tool(sam, "kanban_update_task", { key: r.json.key, release: "r412" });
    assert.ok(!u.isError, u.text);
    assert.strictEqual(task(r.json.key).release, "r412");
  });

  // ── aliases (core.PERSON_ALIASES) ─────────────────────────────────────
  await test("an alias is never a person of its own: not listed, and folds into its owner", async () => {
    const ALIAS = "rob@personalisationhub.com";
    env.store.col("memberDirectory").set(ALIAS, { email: ALIAS, displayName: "", photoUrl: "", disabled: false });
    const ppl = await tool(sam, "kanban_list_people");
    const emails = ppl.json.people.map((p) => p.email);
    assert.ok(emails.includes(ROB) && !emails.includes(ALIAS), emails.join(", "));
    assert.strictEqual(ppl.json.people.find((p) => p.email === ROB).name.includes("@"), false, "named, not shown as an address");
    // assigning, reporting and mentioning by the alias all land on the owner
    const made = await tool(sam, "kanban_create_task", { title: "Alias assignee", assignee: ALIAS, reporter: ALIAS });
    assert.ok(!made.isError, made.text);
    assert.strictEqual(task(made.json.key).assignee, ROB);
    assert.strictEqual(task(made.json.key).reporter, ROB);
    const a = await tool(sam, "kanban_assign_task", { key: made.json.key, assignee: ALIAS });
    assert.ok(!a.isError, a.text);
    assert.strictEqual(task(made.json.key).assignee, ROB);
    const c = await tool(sam, "kanban_comment", { key: made.json.key, text: "over to you", mention: [ALIAS] });
    assert.deepStrictEqual(c.json.notified, [ROB]);
    const mine = await tool(sam, "kanban_list_tasks", { assignee: ALIAS });
    assert.ok(mine.json.tasks.some((t) => t.key === made.json.key));
  });
  await test("an agent signed in as the alias works as its owner: \"me\" and authorship", async () => {
    const ALIAS = "rob@personalisationhub.com";
    const alias = await connect(ALIAS);
    const who = await tool(alias, "kanban_create_task", { title: "Note to self", assignee: "me" });
    assert.ok(!who.isError, who.text);
    const t = task(who.json.key);
    assert.strictEqual(t.assignee, ROB);
    assert.strictEqual(t.createdBy, ROB);
    const mine = await tool(alias, "kanban_list_tasks", { assignee: "me" });
    assert.ok(mine.json.tasks.some((x) => x.key === who.json.key));
  });
  await test("the directory never keeps an entry for an alias", async () => {
    const ALIAS = "rob@personalisationhub.com";
    env.store.col("consoleUsers").set(ALIAS, { email: ALIAS, role: "admin" });
    await kanban.syncWholeDirectory();
    assert.strictEqual(env.store.col("memberDirectory").get(ALIAS), undefined);
    env.store.col("memberDirectory").set(ALIAS, { email: ALIAS });
    await kanban.syncMemberDirectoryWrite({ params: { userEmail: ALIAS }, data: { before: null, after: { exists: true, data: () => ({ email: ALIAS, role: "admin" }) } } });
    assert.strictEqual(env.store.col("memberDirectory").get(ALIAS), undefined);
    env.store.col("consoleUsers").delete(ALIAS);
  });
  await test("agent fill tells Claude who is speaking, from the token, and folds an alias answer", async () => {
    const c = kanban.cleanContext({ users: [{ id: ROB, first: "Rob" }, { id: "rob@personalisationhub.com", first: "rob" }, { id: HUY, first: "Huy" }], me: "rob@personalisationhub.com" });
    assert.deepStrictEqual(c.users.map((u) => u.id), [ROB, HUY]);
    assert.strictEqual(c.me, ROB);
    const d = kanban.draftFromClaude({ title: "Chase the printer", assignee: "rob@personalisationhub.com" }, c);
    assert.strictEqual(d.assignee, ROB);
    let sent = null;
    class Spy { constructor() { this.beta = { messages: { create: async (req) => { sent = req; return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ title: "Chase the printer", assignee: ROB }) }] }; } } }; } }
    const out = await kanban.claudeDraft("k", "remind me to chase the printer", kanban.cleanContext({ users: [{ id: ROB, first: "Rob" }], me: ROB }), { Anthropic: Spy });
    assert.strictEqual(out.assignee, ROB);
    assert.match(sent.messages[0].content, /"me":"rob@offline2online.com"/);
    assert.match(sent.system, /speaker/);
  });

  // ── references, links and descriptions an agent relies on ─────────────
  await test("a non-member assignee or reporter is refused; an alias folds to its owner", async () => {
    const bad = await tool(sam, "kanban_create_task", { title: "Nobody", assignee: "nobody@example.com" });
    assert.ok(bad.isError); assert.match(bad.text, /nobody@example\.com isn't a member.*kanban_list_people/);
    const rep = await tool(sam, "kanban_update_task", { key: "PH-1", reporter: "nobody@example.com" });
    assert.ok(rep.isError); assert.match(rep.text, /reporter nobody@example\.com isn't a member/);
    const as = await tool(sam, "kanban_assign_task", { key: "PH-1", assignee: "nobody@example.com" });
    assert.ok(as.isError); assert.match(as.text, /isn't a member.*kanban_list_people/);
    const ok = await tool(sam, "kanban_create_task", { title: "Alias owner", assignee: "rob@personalisationhub.com" });
    assert.ok(!ok.isError, ok.text); assert.strictEqual(task(ok.json.key).assignee, ROB);
  });
  await test("a release must exist; an id, name or version all find it", async () => {
    env.store.col("releases").set("rDSP", { name: "DSP Integration", version: "5.0", status: "draft", order: 2 });
    const bad = await tool(sam, "kanban_create_task", { title: "No such release", release: "not-a-release" });
    assert.ok(bad.isError); assert.match(bad.text, /release not-a-release isn't a release/);
    const upd = await tool(sam, "kanban_update_task", { key: "PH-1", release: "not-a-release" });
    assert.ok(upd.isError);
    for (const r of ["rDSP", "DSP Integration", "dsp integration", "5.0"]) {
      const ok = await tool(sam, "kanban_create_task", { title: `Release ${r}`, release: r });
      assert.ok(!ok.isError, ok.text); assert.strictEqual(task(ok.json.key).release, "rDSP", r);
    }
    const up = await tool(sam, "kanban_update_task", { key: "PH-1", release: "PH 4.12" });
    assert.ok(!up.isError, up.text); assert.strictEqual(task("PH-1").release, "r412");
  });
  await test("every problem in one error: bad due, bad estimate, unknown epic, non-member, unknown release", async () => {
    const r = await tool(sam, "kanban_create_task", { title: "All wrong", due: "tomorrow", estimate: "lots", epic: "PH-999999", assignee: "nobody@example.com", release: "nope" });
    assert.ok(r.isError);
    for (const re of [/due must be YYYY-MM-DD/, /estimate must be/, /PH-999999 is not an epic/, /isn't a member/, /isn't a release/]) assert.match(r.text, re);
  });
  await test("project: a ticket names a console project by id or name; unknown is refused with the other errors; '' clears it", async () => {
    env.store.col("projects").set("pStaff", { name: "Staff Kanban" });
    env.store.col("projects").set("pOther", { name: "Other Project" });
    const byName = await tool(sam, "kanban_create_task", { title: "Project by name", project: "staff kanban" });
    assert.ok(!byName.isError, byName.text); assert.strictEqual(task(byName.json.key).project, "pStaff");
    assert.strictEqual(env.store.col("kanbanCards").get(byName.json.key).project, "pStaff", "the card carries it");
    const byId = await tool(sam, "kanban_create_task", { title: "Project by id", project: "pOther" });
    assert.strictEqual(task(byId.json.key).project, "pOther");
    const bad = await tool(sam, "kanban_create_task", { title: "x", project: "nope", due: "tomorrow" });
    assert.ok(bad.isError); assert.match(bad.text, /project nope isn't a project/); assert.match(bad.text, /due must be YYYY-MM-DD/);
    assert.ok((await tool(sam, "kanban_update_task", { key: byId.json.key, project: "nope" })).isError);
    const set = await tool(sam, "kanban_update_task", { key: byId.json.key, project: "Staff Kanban" });
    assert.ok(!set.isError, set.text); assert.strictEqual(task(byId.json.key).project, "pStaff");
    const clr = await tool(sam, "kanban_update_task", { key: byId.json.key, project: "" });
    assert.ok(!clr.isError, clr.text); assert.strictEqual(task(byId.json.key).project, ""); assert.strictEqual(env.store.col("kanbanCards").get(byId.json.key).project, "");
    const l = await tool(sam, "kanban_list_tasks", { project: "pStaff" });
    assert.deepStrictEqual(l.json.tasks.map((t) => t.key), [byName.json.key]); assert.strictEqual(l.json.tasks[0].project, "pStaff");
    assert.deepStrictEqual((await tool(sam, "kanban_list_tasks", { project: "Staff Kanban" })).json.tasks.map((t) => t.key), [byName.json.key], "a name filters too");
    assert.ok((await tool(sam, "kanban_list_tasks", { project: "nope" })).isError);
    const g = await tool(sam, "kanban_get_task", { key: byName.json.key });
    assert.strictEqual(g.json.project, "pStaff"); assert.strictEqual(g.json.projectName, "Staff Kanban");
    assert.ok((await tool(sam, "kanban_list_people")).json.projects.some((x) => x.id === "pStaff" && x.name === "Staff Kanban"));
  });
  await test("kanban_list_tasks: no status covers open tickets only, as its description says", async () => {
    const desc = mcp.__test.TOOLS.find((x) => x.name === "kanban_list_tasks").description;
    assert.match(desc, /every open ticket/); assert.doesNotMatch(desc, /Without a release it covers every open ticket and the 300/);
    const made = await tool(sam, "kanban_create_task", { title: "Closed for list" });
    await tool(sam, "kanban_move_task", { key: made.json.key, status: "done", resolution: "completed" });
    const open = await tool(sam, "kanban_list_tasks", {});
    assert.ok(!open.json.tasks.some((t) => t.key === made.json.key));
    const done = await tool(sam, "kanban_list_tasks", { status: "done" });
    assert.ok(done.json.tasks.some((t) => t.key === made.json.key));
  });
  await test("TC-39 links show on both tickets with the reverse type", async () => {
    const a = (await tool(sam, "kanban_create_task", { title: "Link A" })).json.key;
    const b = (await tool(sam, "kanban_create_task", { title: "Link B" })).json.key;
    const c = (await tool(sam, "kanban_create_task", { title: "Link C", links: [{ type: "duplicates", key: a }, { type: "relates to", key: b }] })).json.key;
    await tool(sam, "kanban_update_task", { key: a, links: [{ type: "blocks", key: b }] });
    const gb = await tool(sam, "kanban_get_task", { key: b });
    assert.ok(gb.json.links.some((l) => l.type === "is blocked by" && l.key === a), JSON.stringify(gb.json.links));
    assert.ok(gb.json.links.some((l) => l.type === "relates to" && l.key === c));
    const ga = await tool(sam, "kanban_get_task", { key: a });
    assert.ok(ga.json.links.some((l) => l.type === "blocks" && l.key === b));
    assert.ok(ga.json.links.some((l) => l.type === "is duplicated by" && l.key === c));
    assert.strictEqual(task(b).links === undefined || task(b).links.length === 0, true, "stored on one ticket only");
  });
  await test("kanban_get_task returns descriptionHtml beside the text", async () => {
    const k = (await tool(sam, "kanban_create_task", { title: "Rich", description: '<h2>Heading</h2><p>See <a href="https://example.com/x">the page</a></p>' })).json.key;
    const g = await tool(sam, "kanban_get_task", { key: k });
    assert.match(g.json.descriptionHtml, /<h2>Heading<\/h2>.*href="https:\/\/example\.com\/x"/);
    assert.match(g.json.description, /Heading/); assert.doesNotMatch(g.json.description, /<h2>/);
  });
  await test("assigning to the same person, or an alias of them, logs no reassignment", async () => {
    const k = (await tool(sam, "kanban_create_task", { title: "Same owner", assignee: ROB })).json.key;
    await tool(sam, "kanban_assign_task", { key: k, assignee: "rob@personalisationhub.com" });
    await tool(sam, "kanban_update_task", { key: k, assignee: "rob@personalisationhub.com" });
    assert.ok(!activity(k).some((t) => /reassigned/.test(t)), activity(k).join(" | "));
    assert.strictEqual(task(k).assignee, ROB);
  });

  // ── board cards (kanbanCards) and the backfill ───────────────────────────
  await test("the card check can fail: a ticket changed without its card, a card without a ticket", async () => {
    assert.deepStrictEqual(cardDrift(), []);
    const t = task("PH-1");
    env.store.col("kanbanTasks").set("PH-1", { ...t, title: "Changed behind the card's back" });
    assert.match(cardDrift().join(";"), /PH-1\.title/);
    env.store.col("kanbanTasks").set("PH-1", t);
    env.store.col("kanbanCards").set("PH-99", { ...env.store.col("kanbanCards").get("PH-1"), key: "PH-99" });
    assert.match(cardDrift().join(";"), /PH-99: card without a ticket/);
    env.store.col("kanbanCards").delete("PH-99");
    env.store.col("kanbanCards").delete("PH-1");
    assert.match(cardDrift().join(";"), /PH-1: no card/);
    env.store.col("kanbanCards").set("PH-1", { ...core.cardOf(t), updatedAt: new Date(), updatedBy: SAM });
    assert.deepStrictEqual(cardDrift(), []);
  });
  await test("a card holds the 20 board fields and nothing of the description, and equals the ticket's", async () => {
    const c = env.store.col("kanbanCards").get("PH-1"), t = task("PH-1");
    assert.deepStrictEqual(Object.keys(c).sort(), [...core.CARD_FIELDS, "updatedAt", "updatedBy"].sort());
    for (const f of ["description", "descriptionText", "searchTokens", "links", "attachments", "mentions"]) assert.ok(!(f in c), f);
    assert.strictEqual(c.attachmentCount, (t.attachments || []).length);
    assert.strictEqual(c.commentCount, t.commentCount);
  });
  await test("a comment and a flag are on the card as well as on the ticket", async () => {
    const before = env.store.col("kanbanCards").get("PH-1").commentCount;
    await tool(sam, "kanban_comment", { key: "PH-1", text: "Counted on the card too." });
    assert.strictEqual(env.store.col("kanbanCards").get("PH-1").commentCount, before + 1);
    await tool(sam, "kanban_flag_task", { key: "PH-1", flagged: true });
    assert.strictEqual(env.store.col("kanbanCards").get("PH-1").flagged, true);
  });
  await test("list and release report read the cards; a text search reads the tickets", async () => {
    env.store.col("kanbanCards").set("PH-1", { ...env.store.col("kanbanCards").get("PH-1"), title: "ONLY ON THE CARD" });
    const l = await tool1(sam, "kanban_list_tasks", { assignee: HUY });
    assert.ok(l.json.tasks.some((x) => x.title === "ONLY ON THE CARD"), "the list reads cards");
    const q = await tool1(sam, "kanban_list_tasks", { search: "sweep" });
    assert.ok(q.json.tasks.some((x) => x.key === "PH-1" && x.title !== "ONLY ON THE CARD"), "a search reads tickets");
    const g = await tool1(sam, "kanban_get_task", { key: "PH-1" });
    assert.notStrictEqual(g.json.title, "ONLY ON THE CARD", "kanban_get_task reads the ticket");
    env.store.col("kanbanCards").set("PH-1", { ...core.cardOf(task("PH-1")), updatedAt: new Date(), updatedBy: SAM });
  });
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  await test("/mcp/kanban/backfill: cards from tickets, inline screenshots to Storage, idempotent, sliced", async () => {
    // Tickets the way they were before cards: no card, a description holding two pictures (one repeated).
    const old = { ...task("PH-1"), key: "PH-1", description: `<p>See</p><p><img src="${PNG}"></p><p><img src="${PNG}"><img src="data:image/jpeg;base64,/9j/4AAQSkZJRg=="></p>` };
    env.store.col("kanbanTasks").set("PH-1", old);
    env.store.col("kanbanCards").delete("PH-1");
    env.store.col("kanbanCards").set("PH-ORPHAN", { key: "PH-ORPHAN" });
    env.store.col("kanbanTasks").set("PH-200", { ...task("PH-1"), description: "<p>No pictures</p>", key: "PH-200", number: 200, title: "Closed long ago", status: "done", resolution: "completed", open: false, closedAt: { toMillis: () => 5, _ts: true } });
    env.store.col("kanbanCards").delete("PH-200");
    assert.ok(cardDrift().length >= 2);
    assert.strictEqual((await call({ method: "POST", path: "/mcp/kanban/backfill", headers: { "X-Firebase-ID-Token": signIn("nobody@example.com") } })).statusCode, 403);
    const r = await call({ method: "POST", path: "/mcp/kanban/backfill", headers: { "X-Firebase-ID-Token": signIn(KIT) }, body: {} });
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.body.done, true); assert.ok(r.body.cards >= 2); assert.strictEqual(r.body.images, 1); assert.strictEqual(r.body.orphans, 1);
    assert.deepStrictEqual(cardDrift(), []);
    const html = task("PH-1").description;
    assert.ok(!/data:image/.test(html), "no inline picture is left");
    const urls = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    assert.strictEqual(urls.length, 3);
    assert.strictEqual(urls[0], urls[1], "the same picture is stored once");
    assert.match(urls[0], /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/kanban%2FPH-1%2F.*-screenshot\.png\?alt=media&amp;token=/);
    assert.strictEqual(Object.keys(env.authState.uploads).length, 2);
    assert.ok(Object.keys(env.authState.uploads).every((p) => p.startsWith("kanban/PH-1/")));
    // again: nothing to do
    const again = await call({ method: "POST", path: "/mcp/kanban/backfill", headers: { "X-Firebase-ID-Token": signIn(KIT) }, body: {} });
    assert.deepStrictEqual([again.body.cards, again.body.images, again.body.orphans], [0, 0, 0]);
    assert.strictEqual(Object.keys(env.authState.uploads).length, 2);
    // sliced: a small slice says it isn't done and where to carry on
    const first = await kanban.backfillSlice({ size: 2 });
    assert.strictEqual(first.done, false); assert.ok(first.after);
    const rest = await kanban.backfillSlice({ after: first.after, size: 1000 });
    assert.strictEqual(rest.done, true);
  });
  await test("while the cards are behind the tickets, tools read the tickets (none disappears) and the write fills its card", async () => {
    env.store.col("kanbanCards").clear();
    assert.strictEqual(await kanban.boardCollection(), "kanbanTasks");
    const l = await tool1(sam, "kanban_list_tasks", {});
    assert.ok(l.json.tasks.length > 3, "every open ticket is listed");
    await tool1(sam, "kanban_flag_task", { key: "PH-3", flagged: false });
    assert.ok(env.store.col("kanbanCards").has("PH-3"));
    await kanban.backfillSlice({ size: 1000 });
    assert.strictEqual(await kanban.boardCollection(), "kanbanCards");
    assert.deepStrictEqual(cardDrift(), []);
  });

  // ── kanban_attach_file (PH-19) ────────────────────────────────────────
  const pngBytes = (n) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(n, 7)]);
  const attach = (token, args) => tool(token, "kanban_attach_file", Object.assign({ key: "PH-1", name: "home page.png", contentType: "image/png" }, args));
  await test("kanban_attach_file: stored under kanban/PH-n/, listed with a URL, counted on the card, logged and audited", async () => {
    env.authState.uploads = {};
    const before = (task("PH-1").attachments || []).length;
    const r = await attach(sam, { data: pngBytes(200 * 1024).toString("base64") });
    assert.ok(!r.isError, r.text);
    assert.strictEqual(r.json.attached, true);
    assert.match(r.json.path, /^kanban\/PH-1\/\d+-home-page\.png$/);
    assert.match(r.json.url, /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/kanban%2FPH-1%2F\d+-home-page\.png\?alt=media&token=/);
    assert.strictEqual(env.authState.uploads[r.json.path].contentType, "image/png");
    assert.strictEqual(env.authState.uploads[r.json.path].size, 200 * 1024 + 8);
    const t = task("PH-1");
    assert.strictEqual(t.attachments.length, before + 1);
    assert.deepStrictEqual(Object.keys(t.attachments[before]).sort(), ["contentType", "name", "path", "size", "url"]);
    assert.strictEqual(env.store.col("kanbanCards").get("PH-1").attachmentCount, before + 1);
    const g = await tool1(sam, "kanban_get_task", { key: "PH-1" });
    assert.ok(g.json.attachments.some((a) => a.name === "home page.png" && a.url === r.json.url));
    assert.ok(g.json.activity.some((a) => a.who === SAM && a.text === "attached home page.png over MCP"));
    const log = [...env.store.col("mcpAuditLog").values()].filter((a) => a.tool === "kanban_attach_file");
    assert.strictEqual(log.length, 1); assert.strictEqual(log[0].email, SAM);
  });
  await test("kanban_attach_file: inline puts the Storage URL in the description, never a data: URI", async () => {
    const r = await attach(sam, { name: "shot.png", data: pngBytes(50).toString("base64"), inline: true, caption: "Home <page>" });
    assert.ok(!r.isError, r.text);
    const d = task("PH-1").description;
    assert.ok(!/data:image/.test(d));
    assert.ok(d.includes(`src="${r.json.url.replace(/&/g, "&amp;")}"`), d);
    assert.ok(d.includes("<em>Home &lt;page&gt;</em>"));
    assert.ok(task("PH-1").descriptionText !== undefined);
    assert.strictEqual(task("PH-1").attachments.length, env.store.col("kanbanCards").get("PH-1").attachmentCount);
  });
  await test("kanban_attach_file: a pdf is a plain attachment, and cannot be inline", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n").toString("base64");
    const r = await attach(sam, { name: "spec.pdf", contentType: "application/pdf", data: pdf });
    assert.ok(!r.isError, r.text);
    const bad = await attach(sam, { name: "spec.pdf", contentType: "application/pdf", data: pdf, inline: true });
    assert.ok(bad.isError); assert.match(bad.text, /image/);
  });
  await test("kanban_attach_file: refuses 6 MB, other types, wrong bytes, bad base64 and unknown tickets, writing nothing", async () => {
    const snapshot = () => JSON.stringify([Object.keys(env.authState.uploads), task("PH-1").attachments.length, env.store.col("kanbanTasks").get("PH-1").description]);
    const was = snapshot();
    const big = await attach(sam, { data: pngBytes(6 * 1024 * 1024).toString("base64") });
    assert.ok(big.isError); assert.match(big.text, /5 MB/);
    const html = await attach(sam, { name: "x.html", contentType: "text/html", data: Buffer.from("<script>1</script>").toString("base64") });
    assert.ok(html.isError); assert.match(html.text, /png, jpeg, webp or gif/);
    const svg = await attach(sam, { name: "x.svg", contentType: "image/svg+xml", data: Buffer.from("<svg/>").toString("base64") });
    assert.ok(svg.isError);
    const lie = await attach(sam, { data: Buffer.from("<html>not a png</html>").toString("base64") });
    assert.ok(lie.isError); assert.match(lie.text, /aren't a image\/png/);
    const junk = await attach(sam, { data: "not base64!!" });
    assert.ok(junk.isError);
    const none = await attach(sam, { key: "PH-9999", data: pngBytes(10).toString("base64") });
    assert.ok(none.isError);
    assert.strictEqual(snapshot(), was);
  });
  await test("kanban_attach_file: a viewer is refused (board.write)", async () => {
    const was = Object.keys(env.authState.uploads).length;
    const r = await attach(kit, { data: pngBytes(10).toString("base64") });
    assert.ok(r.isError);
    assert.strictEqual(Object.keys(env.authState.uploads).length, was);
  });
  await test("kanban_attach_file: images over 1400 px are downscaled before they are stored", async () => {
    const orig = kanban.imageResizer.resize;
    kanban.imageResizer.resize = async (buf) => ({ buf: Buffer.concat([buf.subarray(0, 8), Buffer.alloc(100)]), resized: true });
    try {
      const r = await attach(sam, { name: "wide.png", data: pngBytes(4000).toString("base64") });
      assert.ok(!r.isError, r.text);
      assert.strictEqual(r.json.downscaled, true);
      assert.strictEqual(r.json.size, 108);
      assert.strictEqual(env.authState.uploads[r.json.path].size, 108);
    } finally { kanban.imageResizer.resize = orig; }
  });
  await test("kanban_attach_file: 60 files an hour per member, then refused; the window is per member", async () => {
    const lim = env.store.col("kanbanAttachLimits");
    member("lena@personalisationhub.com", "editor", "Lena Editor");
    const kitEditor = await connect("lena@personalisationhub.com");
    lim.set(SAM, { windowStart: Date.now() - 60000, count: 59 });
    const last = await attach(sam, { name: "last.png", data: pngBytes(5).toString("base64") });
    assert.ok(!last.isError, last.text);
    const over = await attach(sam, { data: pngBytes(5).toString("base64") });
    assert.ok(over.isError); assert.match(over.text, /60 files an hour/);
    assert.strictEqual(lim.get(SAM).count, 60);
    const other = await attach(kitEditor, { data: pngBytes(5).toString("base64") });
    assert.ok(!other.isError, "another member has their own allowance");
    lim.set(SAM, { windowStart: Date.now() - 3700000, count: 60 });
    const again = await attach(sam, { name: "again.png", data: pngBytes(5).toString("base64") });
    assert.ok(!again.isError, "a new hour starts a new allowance: " + again.text);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const [n, e] of failures) console.log(`\n--- ${n}\n${e && e.stack}`); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
