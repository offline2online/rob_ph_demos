// Code Mode through the real MCP server (functions/code-mode + mcp-server.js)
// with the Firebase SDKs stubbed (test/mcp-stubs.js) and a REAL sandbox:
// run_script, describe_script_tools, get_insight, list_insights over
// JSON-RPC, as a viewer, an editor and an admin, against seeded fixtures.
//   node code-mode.test.js
// Needs isolated-vm, which test/package.json installs.
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { install, makeReq, makeRes } = require("./mcp-stubs");

const env = install();
const mcp = require("../functions/mcp-server.js");
const kanban = require("../functions/kanban.js");
const codeMode = require("../functions/code-mode");
codeMode.sandbox.setIsolatedVmPath(require.resolve("isolated-vm"));
const handler = env.captured.requestHandler;
const TOOLS = mcp.__test.TOOLS;
const toolByName = (n) => TOOLS.find((t) => t.name === n);

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.message}`); }
}
async function call(opts) { const req = makeReq(opts); const res = makeRes(); await handler(req, res); return res; }

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ADA = "ada@ph.example", SAM = "sam@ph.example", KIT = "kit@ph.example";
function signIn(email) {
  const token = `idtoken-${email}`;
  env.authState.idTokens.set(token, { uid: `uid-${email}`, email, email_verified: true });
  env.authState.users.set(email, { uid: `uid-${email}`, email, customClaims: {} });
  return token;
}
function member(email, role, displayName) {
  env.store.col("consoleUsers").set(email, { email, role, displayName });
  env.store.col("memberDirectory").set(email, { email, displayName, photoUrl: "", disabled: false });
}
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
async function rpc(token, method, params) {
  kanban.clearCaches();
  return call({ method: "POST", path: "/mcp", body: { jsonrpc: "2.0", id: 1, method, params: params || {} }, headers: { Authorization: `Bearer ${token}` } });
}
async function tool(token, name, args) {
  const res = await rpc(token, "tools/call", { name, arguments: args || {} });
  const r = res.body && res.body.result;
  const text = r && r.content && r.content[0] && r.content[0].text;
  let json = null; try { json = JSON.parse(text); } catch { /* plain text */ }
  return { status: res.statusCode, isError: !!(r && r.isError), text, json, raw: res.body };
}
const script = (token, code, extra) => tool(token, "run_script", Object.assign({ code }, extra || {}));
const insight = (token, name, params) => tool(token, "get_insight", Object.assign({ name }, params ? { params } : {}));

// ── Fixtures ─────────────────────────────────────────────────────────────
const NOW = Date.now(), DAY = 86400000;
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms), _ts: true });
const ago = (days) => ts(NOW - days * DAY);
const P_DSP = "p-dsp", P_BT = "p-bt", P_OLD = "p-old";
function seed() {
  const col = (n) => env.store.col(n);
  member(ADA, "admin", "Ada Admin");
  member(SAM, "editor", "Sam Sample");
  member(KIT, "viewer", "Kit Viewer");

  col("projects").set(P_DSP, { name: "Display Types & DSP Integration", description: "Display types, elements, playlists and DSP connections.", deployBranch: "deploy/dsp-integration", createdAt: ago(200), artifactUrl: "https://claude.ai/artifact/dsp" });
  col("projects").set(P_BT, { name: "Backlog Tracker & FAQs", description: "The console itself.", deployBranch: "deploy/backlog-tracker", createdAt: ago(300) });
  col("projects").set(P_OLD, { name: "Old Pricing Prototype", archived: true, createdAt: ago(900) });

  const item = (id, projectId, title, status, updatedDays, extra) => col("backlogItems").set(id, Object.assign({
    projectId, title, desc: `${title} — description`, type: "feature", category: "HQ Admin", status,
    createdAt: ago(updatedDays + 20), updatedAt: ago(updatedDays), notes: [],
  }, extra || {}));
  item("i1", P_DSP, "Playlist editor drag handles", "backlog", 30, { blocked: { reason: "waiting-on-decision", note: "Which drag library?", setBy: SAM, setAt: ago(12) } });
  item("i2", P_DSP, "DSP partner rate limits", "backlog", 2, { type: "bug", createdAt: ago(2) });
  item("i3", P_DSP, "Slot booking window", "ready-for-testing", 5, { deployCommit: "abc1234", deployBranch: "deploy/dsp-integration", notes: [{ author: SAM, text: "Ready to test on the preview link.", at: ago(5) }, { author: ADA, text: "Looks right, one copy nit.", at: ago(1) }] });
  item("i4", P_DSP, "Exchange settings switch", "ready-to-publish", 3, { deployCommit: "def5678", deployBranch: "deploy/dsp-integration" });
  item("i5", P_DSP, "Campaign status table", "published-live", 1, { testVersion: "1.42.0", prNumber: 501, mergeCommit: "fff0001", deployConclusion: "success", deployRuns: [{ workflow: "dsp-prototype.yml", dispatchedAt: ago(1), conclusion: "success" }] });
  item("i6", P_DSP, "Advertiser inventory list", "published-live", 40, { testVersion: "1.30.0", deployRuns: [{ workflow: "dsp-prototype.yml", dispatchedAt: ago(40), conclusion: "success" }] });
  item("i7", P_BT, "FAQ editor autosave", "backlog", 60);
  item("i8", P_BT, "Archive page sort", "ready-for-testing", 9);
  item("i9", P_BT, "Retired ticket", "archived", 100, { archivedAt: ago(100) });

  col("concepts").set("c-voice", {
    name: "Voice Concierge", description: "A spoken front door to the console.", type: "Platform", status: "active",
    readmeMd: "# Voice Concierge\n\nTalk to the board.", requirementsMd: "",
    createdByEmail: SAM, createdAt: ago(20), updatedAt: ago(2),
    comments: [
      { author: SAM, text: "First sketch is up.", at: ago(19) },
      { author: ADA, text: "Decided: we go with push-to-talk for v1, no wake word.", at: ago(6) },
      { author: KIT, text: "Could it read release status aloud?", at: ago(2) },
    ],
    artifactUrl: "https://claude.ai/artifact/voice",
  });
  col("concepts").set("c-kiosk", { name: "Kiosk Mode", description: "Promoted already.", status: "promoted", promotedProjectId: P_DSP, promotedAt: ago(50), createdAt: ago(90), updatedAt: ago(50), comments: [] });
  col("concepts").set("c-voice2", { name: "Voice Search", description: "Search by voice.", status: "active", createdAt: ago(70), updatedAt: ago(65), comments: [] });
  col("interfaces").set("if-1", { name: "Voice ↔ DSP status feed", endpoints: [{ type: "concept", id: "c-voice" }, { type: "project", id: P_DSP }], projectIds: ["c-voice", P_DSP], contentMd: "Status feed contract." });

  const lead = (id, name, stage, updatedDays, extra) => col("leads").set(id, Object.assign({ company: { name }, stage, assignee: SAM, createdAt: ago(updatedDays + 30), updatedAt: ago(updatedDays), contacts: [], history: [] }, extra || {}));
  lead("l1", "Northwind Grocers", "lead", 1);
  lead("l2", "Contoso Pharmacy", "demo", 20);
  lead("l3", "Fabrikam Fuel", "hot-lead", 45, { assignee: "" });
  lead("l4", "Tailspin Toys", "closed-won", 90);
  lead("l5", "Adventure Outdoors", "post-demo", 3);
  lead("l6", "Test Co", "lead", 1, { test: true });

  col("kanbanSettings").set("main", { tester: ADA, currentRelease: "r412", releaseDates: { r412: new Date(NOW + 10 * DAY).toISOString().slice(0, 10) } });
  col("releases").set("r412", { name: "PH 4.12", version: "4.12", status: "draft", order: 2 });
  col("releases").set("r411", { name: "PH 4.11", version: "4.11", status: "live", order: 1 });

  col("faqCategories").set("cat1", { name: "Getting started", order: 1 });
  col("faqArticles").set("a1", { title: "How do I create a campaign?", slug: "create-a-campaign", summary: "Create a campaign from HQ Admin.", bodyMd: "Open HQ Admin, then Campaigns.", status: "published", categoryId: "cat1", keywords: ["campaign"] });
}

(async () => {
  console.log("\nCode Mode — MCP tools\n");
  seed();
  const ada = await connect(ADA), sam = await connect(SAM), kit = await connect(KIT);

  // Staff Kanban tickets, made the way a person would (as an editor).
  const mk = async (args) => { const r = await tool(sam, "kanban_create_task", args); assert.ok(!r.isError, r.text); return r.json.key || (r.json.task && r.json.task.key); };
  const k1 = await mk({ title: "Wire the exchange settings API", release: "r412", project: P_DSP, assignee: SAM, estimate: "4h" });
  const k2 = await mk({ title: "Slot booking regression", type: "bug", release: "r412", project: P_DSP, assignee: SAM });
  const k3 = await mk({ title: "FAQ export retries", release: "r412", project: P_BT });
  const k4 = await mk({ title: "Unreleased idea", project: P_BT });
  assert.ok(k1 && k2 && k3 && k4, "kanban fixtures were created");
  const moved = await tool(sam, "kanban_move_task", { key: k1, status: "in-progress" });
  assert.ok(!moved.isError, moved.text);
  const WRITE_TOOLS = TOOLS.filter((t) => t.scope === "board.write").map((t) => t.name);

  // ── Registration ───────────────────────────────────────────────────────
  await test("tools/list offers the four tools as read-only", async () => {
    const list = (await rpc(kit, "tools/list")).body.result.tools;
    for (const n of ["run_script", "describe_script_tools", "get_insight", "list_insights"]) {
      const t = list.find((x) => x.name === n);
      assert.ok(t, `${n} is listed`);
      assert.strictEqual(t.annotations.readOnlyHint, true);
      assert.ok(!/Unavailable/.test(t.description), `${n} is available to a viewer`);
    }
  });

  await test("the allow-list holds only plain read tools, and no write or admin tool", async () => {
    assert.ok(codeMode.SCRIPT_TOOL_NAMES.length >= 12);
    for (const n of codeMode.SCRIPT_TOOL_NAMES) {
      const t = toolByName(n);
      assert.ok(t, `${n} exists`);
      assert.strictEqual(t.scope, "board.read", `${n} is a read tool`);
      assert.ok(!t.destructive, `${n} is not destructive`);
      assert.ok(!WRITE_TOOLS.includes(n));
    }
    for (const n of ["run_script", "get_insight", "describe_script_tools", "list_insights"]) assert.ok(!codeMode.SCRIPT_TOOL_NAMES.includes(n), "a script cannot start a script");
  });

  await test("describe_script_tools prints a signature for every allow-listed tool, and every argument is real", async () => {
    const r = await tool(kit, "describe_script_tools");
    assert.ok(!r.isError);
    for (const t of codeMode.SCRIPT_TOOLS) {
      assert.ok(r.text.includes(`  ${t.name}(args`), `${t.name} is described`);
      const real = Object.keys(toolByName(t.name).inputSchema.properties || {});
      const named = [...t.args.matchAll(/(?:^\{|;)\s*(\w+)\??:/g)].map((m) => m[1]);
      for (const a of named) assert.ok(real.includes(a), `${t.name}: signature names "${a}", which the tool does not take (${real.join(", ")})`);
      const required = toolByName(t.name).inputSchema.required || [];
      for (const req of required) assert.ok(new RegExp(`(?:^\\{|;)\\s*${req}:`).test(t.args), `${t.name}: ${req} is required and must be shown as required`);
    }
    for (const w of WRITE_TOOLS) assert.ok(!r.text.includes(`  ${w}(`), `${w} is not described`);
    assert.match(r.text, /50 tool calls/);
    assert.match(r.text, /20 KB returned value/);
    // 31 tools since PH Agent Context added documents, critiques, search, topic context, Support threads and run history (21 before, under 12,000).
    assert.ok(r.text.length < 18500, `the description is compact (${r.text.length} chars)`);
  });

  // ── run_script ─────────────────────────────────────────────────────────
  await test("run_script: one call, an aggregated answer, and the documented shape", async () => {
    const r = await script(kit, `
      const { projects } = await tools.list_projects({});
      const out = {};
      for (const p of projects) {
        const page = await tools.list_backlog_items({ projectId: p.id, limit: 100 });
        out[p.name] = { tickets: page.matched, bugs: page.items.filter((i) => i.type === "bug").length };
      }
      return out;`);
    assert.ok(!r.isError, r.text);
    assert.deepStrictEqual(Object.keys(r.json).sort(), ["durationMs", "result", "toolCalls"]);
    assert.deepStrictEqual(r.json.result, {
      "Backlog Tracker & FAQs": { tickets: 2, bugs: 0 },
      "Display Types & DSP Integration": { tickets: 6, bugs: 1 },
    });
    assert.deepStrictEqual(r.json.toolCalls.map((c) => c.name), ["list_projects", "list_backlog_items", "list_backlog_items"]);
    for (const c of r.json.toolCalls) assert.deepStrictEqual(Object.keys(c).sort(), ["durationMs", "name"]);
    assert.ok(!r.text.includes("description"), "raw tool output (ticket descriptions) did not come back");
  });

  await test("run_script reaches every allow-listed domain: concepts, leads, Kanban, releases, health, FAQ", async () => {
    const r = await script(kit, `
      const [c, l, people, tasks, report, health, faq, cats] = await Promise.all([
        tools.list_concepts({}), tools.list_leads({}), tools.kanban_list_people({}), tools.kanban_list_tasks({ release: "r412" }),
        tools.kanban_release_report({}), tools.get_pipeline_health({}), tools.search_faq({ query: "campaign" }), tools.list_faq_categories({}),
      ]);
      const one = await tools.get_concept({ conceptId: c.concepts[0].id });
      const lead = await tools.get_lead({ leadId: l.leads[0].id });
      const task = await tools.kanban_get_task({ key: tasks.tasks[0].key });
      const found = await tools.kanban_search_tickets({ query: "exchange" });
      const art = await tools.get_faq_article({ articleId: faq.results[0].id });
      const ticket = await tools.get_backlog_item({ itemId: "i3" });
      return { concepts: c.concepts.length, leads: l.total, releases: people.releases.length, tasks: tasks.matched, outstanding: report.outstanding,
        trains: Array.isArray(health.trains), faq: faq.matched, cats: cats.matched, concept: one.name, lead: lead.name, task: task.key === tasks.tasks[0].key, found: found.matched, article: art.slug, notes: ticket.notes.length };`);
    assert.ok(!r.isError, r.text);
    assert.deepStrictEqual(r.json.result, { concepts: 3, leads: 5, releases: 2, tasks: 3, outstanding: 3, trains: true, faq: 1, cats: 1, concept: "Kiosk Mode", lead: "Northwind Grocers", task: true, found: 1, article: "create-a-campaign", notes: 2 });
    assert.strictEqual(r.json.toolCalls.length, 14);
  });

  await test("run_script: timeoutMs is honoured, and a bad one is refused", async () => {
    const r = await script(kit, "while (true) {}", { timeoutMs: 300 });
    assert.ok(r.isError);
    assert.strictEqual(r.json.error.kind, "timeout");
    assert.ok((await script(kit, "return 1;", { timeoutMs: "soon" })).isError);
    assert.ok((await script(kit, 42)).isError);
  });

  await test("run_script: a structured error names the failing line", async () => {
    const r = await script(kit, "const p = await tools.list_projects({});\nconst n = p.projects.length;\nreturn p.nothing.here;");
    assert.ok(r.isError);
    assert.strictEqual(r.json.error.kind, "script");
    assert.strictEqual(r.json.error.name, "TypeError");
    assert.strictEqual(r.json.error.line, 3);
    assert.deepStrictEqual(r.json.toolCalls.map((c) => c.name), ["list_projects"]);
    assert.ok(typeof r.json.durationMs === "number");
    const syn = await script(kit, "const a = 1;\nreturn a +;\n");
    assert.strictEqual(syn.json.error.kind, "syntax");
    assert.strictEqual(syn.json.error.line, 2);
  });

  await test("run_script: over 20 KB of source is rejected without running", async () => {
    const r = await script(kit, "await tools.list_projects({}); return 1; //" + "x".repeat(21 * 1024));
    assert.ok(r.isError);
    assert.strictEqual(r.json.error.kind, "source-size");
    assert.strictEqual(r.json.toolCalls.length, 0);
  });

  await test("run_script: the tool-call cap and the result-size cap are errors, not truncations", async () => {
    const many = await script(kit, "for (let i = 0; i < 60; i++) await tools.list_faq_categories({}); return 'done';", { timeoutMs: 30000 });
    assert.ok(many.isError);
    assert.match(many.json.error.message, /at most 50 tool calls/);
    assert.strictEqual(many.json.toolCalls.length, 50);
    const big = await script(kit, "const r = await tools.list_backlog_items({ limit: 100 }); return Array(40).fill(r);");
    assert.ok(big.isError);
    assert.strictEqual(big.json.error.kind, "result-size");
    assert.ok(!big.text.includes("Playlist editor"), "nothing of the oversized value came back");
  });

  await test("errors never carry a server stack trace, path or credential", async () => {
    const victim = toolByName("list_faq_categories");
    const realRun = victim.run;
    process.env.CODE_MODE_FAKE_SECRET = "sk-live-do-not-leak";
    victim.run = async () => { const e = new Error(`connect ECONNREFUSED 10.0.0.5 key=${process.env.CODE_MODE_FAKE_SECRET}`); throw e; };
    try {
      const a = await script(kit, "return await tools.list_faq_categories({});");
      const b = await script(kit, "try { await tools.list_faq_categories({}); } catch (e) { return { message: e.message, stack: String(e.stack), keys: Object.keys(e) }; }");
      const c = await script(kit, "return typeof process === 'undefined' ? null : process.env;");
      const d = await script(kit, "await tools.get_backlog_item({ itemId: 'nope' });");
      assert.strictEqual(a.json.error.message, "list_faq_categories failed on the server.");
      assert.strictEqual(b.json.result.message, "list_faq_categories failed on the server.");
      assert.strictEqual(c.json.result, null);
      assert.strictEqual(d.json.error.message, "No ticket with id nope.");
      for (const r of [a, b, c, d]) {
        for (const leak of ["sk-live", "ECONNREFUSED", "10.0.0.5", "mcp-server.js", "node_modules", "sandbox-worker", "/functions/", __dirname.split(path.sep)[1]]) {
          assert.ok(!r.text.includes(leak), `"${leak}" leaked: ${r.text.slice(0, 300)}`);
        }
      }
      assert.ok(env.logs.some((l) => JSON.stringify(l).includes("ECONNREFUSED")), "the detail went to the server log instead");
    } finally { victim.run = realRun; delete process.env.CODE_MODE_FAKE_SECRET; }
  });

  // ── Identity and role ──────────────────────────────────────────────────
  await test("a script has no write tool, no admin tool and no un-listed read tool — as a viewer or as an admin", async () => {
    const probe = `return { names: Object.keys(tools).sort(), write: ${JSON.stringify(WRITE_TOOLS)}.filter((n) => n in tools), other: ["whoami", "get_project_docs", "get_routine_setup_instructions", "kanban_my_work", "run_script", "get_insight"].filter((n) => n in tools) };`;
    for (const token of [kit, ada]) {
      const r = await script(token, probe);
      assert.deepStrictEqual(r.json.result.names, codeMode.SCRIPT_TOOL_NAMES.slice().sort());
      assert.deepStrictEqual(r.json.result.write, []);
      assert.deepStrictEqual(r.json.result.other, []);
    }
  });

  await test("a viewer's script cannot write: every attempt fails and the board is unchanged", async () => {
    const before = JSON.stringify([...env.store.col("backlogItems")]) + JSON.stringify([...env.store.col("kanbanTasks")]) + JSON.stringify([...env.store.col("leads")]);
    const r = await script(kit, `
      const tried = [];
      for (const [name, args] of [["create_backlog_item", { projectId: "${P_DSP}", desc: "from a script" }], ["update_backlog_item", { itemId: "i1", title: "hacked" }], ["kanban_create_task", { title: "x" }], ["update_lead_stage", { leadId: "l1", stage: "demo" }], ["approve_deploy_to_main", { projectId: "${P_DSP}" }], ["delete_lead", { leadId: "l1" }]]) {
        try { await tools[name](args); tried.push(name + ": ran"); } catch (e) { tried.push(name + ": " + e.constructor.name); }
      }
      return tried;`);
    assert.ok(!r.isError, r.text);
    for (const line of r.json.result) assert.match(line, /: TypeError$/, line);
    const after = JSON.stringify([...env.store.col("backlogItems")]) + JSON.stringify([...env.store.col("kanbanTasks")]) + JSON.stringify([...env.store.col("leads")]);
    assert.strictEqual(after, before);
    assert.strictEqual(r.json.toolCalls.length, 0);
  });

  await test("each proxied call runs as the caller: same session, same answer as calling the tool directly", async () => {
    const seen = [];
    const spied = toolByName("kanban_list_tasks");
    const realRun = spied.run;
    spied.run = (args, session) => { seen.push(session); return realRun(args, session); };
    try {
      for (const [token, email, role, mine] of [[sam, SAM, "editor", 2], [kit, KIT, "viewer", 0]]) {
        seen.length = 0;
        const viaScript = await script(token, "const r = await tools.kanban_list_tasks({ assignee: 'me', release: 'r412' }); return { matched: r.matched, keys: r.tasks.map((t) => t.key) };");
        const direct = await tool(token, "kanban_list_tasks", { assignee: "me", release: "r412" });
        assert.strictEqual(viaScript.json.result.matched, mine, `${email}'s own tickets`);
        assert.deepStrictEqual(viaScript.json.result.keys, direct.json.tasks.map((t) => t.key));
        assert.strictEqual(seen.length, 2);
        assert.strictEqual(seen[0].email, email);
        assert.strictEqual(seen[0].role, role);
        assert.deepStrictEqual(seen[0], seen[1], "the script's call got the very session a direct call gets");
        if (role === "viewer") assert.ok(!seen[0].scopes.includes("board.write"));
      }
    } finally { spied.run = realRun; }
  });

  await test("a script reads nothing the caller's own tool calls would not return", async () => {
    // Whatever a tool refuses the caller directly, it refuses the caller's script identically.
    const realRun = toolByName("get_lead").run;
    toolByName("get_lead").run = async (args, session) => (session.role === "viewer"
      ? { content: [{ type: "text", text: "Leads are not visible to viewers." }], isError: true } : realRun(args, session));
    try {
      const code = "try { const l = await tools.get_lead({ leadId: 'l1' }); return { name: l.name }; } catch (e) { return { refused: e.message }; }";
      assert.deepStrictEqual((await script(kit, code)).json.result, { refused: "Leads are not visible to viewers." });
      assert.deepStrictEqual((await script(sam, code)).json.result, { name: "Northwind Grocers" });
      assert.ok((await tool(kit, "get_lead", { leadId: "l1" })).isError);
    } finally { toolByName("get_lead").run = realRun; }
  });

  await test("someone removed from the team, or with no token, cannot run a script or an insight", async () => {
    const anon = await call({ method: "POST", path: "/mcp", body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_script", arguments: { code: "return 1;" } } } });
    assert.strictEqual(anon.statusCode, 401);
    member("gone@ph.example", "editor", "Gone");
    const gone = await connect("gone@ph.example");
    assert.strictEqual((await script(gone, "return (await tools.list_leads({})).total;")).json.result, 5);
    env.store.col("consoleUsers").set("gone@ph.example", { email: "gone@ph.example", role: "editor", disabled: true });
    const runs = env.store.col("scriptRuns").size;
    for (const r of [await script(gone, "return (await tools.list_leads({})).total;"), await insight(gone, "leads_summary")]) {
      assert.notStrictEqual(r.status, 200);
      assert.ok(!r.text || !r.text.includes("Northwind"));
    }
    assert.strictEqual(env.store.col("scriptRuns").size, runs, "nothing ran");
  });

  await test("staff names, skills and prospects are readable from a script", async () => {
    env.store.col("skills").set("sk1", { name: "PH Designer", slug: "ph-designer", summary: "The design system.", version: "3", files: [{ path: "SKILL.md", content: "# PH Designer" }], misses: [{ text: "Wrong icon set", at: ago(3) }], updatedAt: ago(4) });
    env.store.col("prospects").set("pr1", { name: "Globex Retail", country: "United Kingdom", industry: "Grocery", storeCount: 420 });
    env.store.col("prospects").set("pr2", { name: "Initech Stores", country: "Australia", industry: "Grocery", storeCount: 35 });
    const r = await script(kit, `
      const [names, skills, prospects] = await Promise.all([tools.kanban_get_staff_names({}), tools.list_skills({}), tools.list_prospects({})]);
      const skill = await tools.get_skill({ slug: "ph-designer" });
      const misses = await tools.list_skill_misses({ skillId: skill.id });
      return { staff: names.staff.map((x) => x.name).filter((n) => n !== 'Gone').sort(), skills: skills.skills.map((x) => x.slug), files: skill.files.map((f) => f.path), misses: misses.matched,
        prospects: prospects.total, byCountry: prospects.prospects.map((p) => p.country).sort() };`);
    assert.ok(!r.isError, r.text);
    assert.deepStrictEqual(r.json.result, { staff: ["Ada", "Kit", "Sam"], skills: ["ph-designer"], files: ["SKILL.md"], misses: 1, prospects: 2, byCountry: ["Australia", "United Kingdom"] });
  });

  await test("a tool with a role requirement is in a script only for callers who hold that role", async () => {
    const t = toolByName("list_leads");
    t.role = "admin";
    try {
      const probe = "return { has: 'list_leads' in tools, n: Object.keys(tools).length };";
      const full = codeMode.SCRIPT_TOOL_NAMES.length;
      assert.deepStrictEqual((await script(ada, probe)).json.result, { has: true, n: full });
      assert.deepStrictEqual((await script(sam, probe)).json.result, { has: false, n: full - 1 });
      assert.deepStrictEqual((await script(kit, probe)).json.result, { has: false, n: full - 1 });
      assert.strictEqual((await script(ada, "return (await tools.list_leads({})).total;")).json.result, 5);
      // The description each caller sees is the set their own script gets.
      assert.ok((await tool(ada, "describe_script_tools")).text.includes("  list_leads(args"));
      assert.ok(!(await tool(sam, "describe_script_tools")).text.includes("  list_leads(args"));
      // An insight that needs the tool fails for them the same way the tool itself would.
      const viaInsight = await insight(sam, "leads_summary");
      assert.ok(viaInsight.isError);
      assert.ok(!viaInsight.text.includes("Northwind"));
      assert.ok((await tool(sam, "list_leads")).isError, "and the direct call is refused too");
      assert.ok(!(await insight(ada, "leads_summary")).isError);
    } finally { delete t.role; }
    // A write tool can never be exposed, whatever the role: the allow-list refuses to load it.
    const w = toolByName("list_leads");
    w.scope = "board.write";
    try {
      const r = await script(ada, "return 'list_leads' in tools;");
      assert.strictEqual(r.json.result, false);
    } finally { w.scope = "board.read"; }
  });

  await test("every MCP tool is held to the caller's role: a viewer runs no write tool, an editor no admin tool", async () => {
    const snapshot = () => JSON.stringify([...env.store.data].filter(([name]) => !/^mcp|^scriptRuns$/.test(name)).map(([name, docs]) => [name, [...docs]]));
    const before = snapshot();
    const writeTools = TOOLS.filter((t) => t.scope === "board.write");
    const roleTools = TOOLS.filter((t) => t.role);
    assert.ok(writeTools.length > 40 && roleTools.length >= 7);
    for (const t of TOOLS) assert.ok(t.scope === "board.read" || t.scope === "board.write", `${t.name} declares a scope`);
    // Viewer: every write tool is refused before it runs.
    for (const t of writeTools) {
      const r = await tool(kit, t.name, {});
      assert.ok(r.isError, `${t.name} ran for a viewer`);
      assert.match(r.text, /read-only access/, `${t.name}: ${r.text}`);
    }
    // Editor: every tool that names a higher role is refused before it runs.
    for (const t of roleTools) {
      const r = await tool(sam, t.name, {});
      assert.ok(r.isError, `${t.name} ran for an editor`);
      assert.match(r.text, new RegExp(`requires the ${t.role} role`), `${t.name}: ${r.text}`);
    }
    assert.strictEqual(snapshot(), before, "nothing was written");
    // What a viewer is shown matches what a viewer can do.
    const listed = (await rpc(kit, "tools/list")).body.result.tools;
    for (const t of writeTools) assert.match(listed.find((x) => x.name === t.name).description, /Unavailable: this connection is read-only/);
    // And a script is the same set, narrowed to reads: nothing a role lacks appears in it.
    for (const [token, email] of [[kit, KIT], [sam, SAM], [ada, ADA]]) {
      const names = (await script(token, "return Object.keys(tools);")).json.result;
      for (const n of names) {
        const direct = await rpc(token, "tools/call", { name: n, arguments: {} });
        const text = direct.body.result.content[0].text;
        assert.ok(!/read-only access|requires the \w+ role/.test(text), `${email}'s script has ${n}, which ${email} may not call`);
      }
    }
  });

  // ── Audit ──────────────────────────────────────────────────────────────
  await test("every run_script and get_insight execution is logged: who, when, hash, source, tools, duration, outcome", async () => {
    const col = env.store.col("scriptRuns");
    const before = col.size;
    const code = "const p = await tools.list_projects({}); return p.projects.length;";
    await script(sam, code);
    await script(sam, "return nope;");
    await insight(kit, "leads_summary", { stalledDays: 10 });
    const rows = [...col.values()].slice(before);
    assert.strictEqual(rows.length, 3);
    const [ok, bad, ins] = rows;
    assert.strictEqual(ok.email, SAM);
    assert.strictEqual(ok.kind, "run_script");
    assert.strictEqual(ok.scriptSource, code);
    assert.strictEqual(ok.scriptHash, crypto.createHash("sha256").update(code).digest("hex"));
    assert.deepStrictEqual(ok.toolsCalled.map((c) => c.name), ["list_projects"]);
    assert.ok(typeof ok.durationMs === "number" && ok.at);
    assert.strictEqual(ok.outcome, "ok");
    assert.strictEqual(bad.outcome, "error");
    assert.strictEqual(bad.errorKind, "script");
    assert.match(bad.errorMessage, /nope is not defined/);
    assert.strictEqual(ins.email, KIT);
    assert.strictEqual(ins.kind, "get_insight");
    assert.strictEqual(ins.insight, "leads_summary");
    assert.strictEqual(ins.insightVersion, 1);
    assert.deepStrictEqual(ins.params, { stalledDays: 10 });
    assert.ok(ins.scriptSource.includes("leads_summary") && ins.toolsCalled.length >= 1);
  });

  await test("firestore.rules: scriptRuns can be read by members and written by no client", async () => {
    const rules = fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8");
    const m = /match \/scriptRuns\/\{[^}]+\} \{([\s\S]*?)\n {4}\}/.exec(rules);
    assert.ok(m, "there is a scriptRuns rule");
    assert.match(m[1], /allow read: if isMember\(\);/);
    assert.match(m[1], /allow write: if false;/);
  });

  // ── Insight library ────────────────────────────────────────────────────
  await test("list_insights: every insight with a one-line description and its parameters", async () => {
    const r = await tool(kit, "list_insights");
    assert.deepStrictEqual(r.json.insights.map((i) => i.name), ["pipeline_status", "what_changed", "project_status", "concept_status", "leads_summary", "release_status", "topic_context"]);
    for (const i of r.json.insights) {
      assert.ok(i.description && !i.description.includes("\n") && i.version >= 1);
      for (const p of i.params) assert.ok(p.name && p.type && p.description && typeof p.required === "boolean");
    }
    assert.ok(r.json.insights.find((i) => i.name === "project_status").params[0].required);
  });

  await test("each insight file is a self-contained script (uses only tools, params, lib)", async () => {
    const dir = path.join(__dirname, "../functions/code-mode/insights");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js") && !f.startsWith("_")).map((f) => f.replace(/\.js$/, "")).sort();
    assert.deepStrictEqual(files, codeMode.INSIGHT_NAMES.slice().sort(), "every file is registered and every name has a file");
    for (const def of codeMode.INSIGHTS.values()) {
      const src = codeMode.insightSource(def);
      assert.ok(!/\brequire\(|\bprocess\.|\bmodule\./.test(src), `${def.name} reaches outside the sandbox`);
    }
  });

  await test("insight: pipeline_status", async () => {
    const r = await insight(kit, "pipeline_status");
    assert.ok(!r.isError, r.text);
    const j = r.json;
    assert.strictEqual(j.scope, "All projects");
    assert.deepStrictEqual(j.byStage, { "Backlog": 3, "Ready for Testing": 2, "Approved for Deployment": 1, "Deployed (Live)": 2 });
    assert.strictEqual(j.blocked.count, 1);
    assert.strictEqual(j.blocked.items[0].id, "i1");
    assert.strictEqual(j.blocked.items[0].blockedDays, 12);
    assert.strictEqual(j.awaitingApproval.readyForTesting.count, 2);
    assert.strictEqual(j.awaitingApproval.readyForTesting.items[0].id, "i8", "longest-waiting first");
    assert.strictEqual(j.awaitingApproval.approvedAwaitingDeploy, 1);
    assert.strictEqual(j.oldestPerStage.Backlog.id, "i7");
    assert.strictEqual(j.oldestPerStage["Deployed (Live)"].id, "i6");
    const one = await insight(kit, "pipeline_status", { projectId: "backlog tracker" });
    assert.strictEqual(one.json.scope, "Backlog Tracker & FAQs");
    assert.deepStrictEqual(one.json.byStage, { "Backlog": 1, "Ready for Testing": 1, "Approved for Deployment": 0, "Deployed (Live)": 0 });
  });

  await test("insight: what_changed (default 7 days, and a named span)", async () => {
    const r = await insight(kit, "what_changed");
    assert.ok(!r.isError, r.text);
    const j = r.json;
    assert.strictEqual(j.ticketsChanged, 4);
    assert.deepStrictEqual(j.totals, { created: 1, deployed: 1, commented: 1, moved: 1 });
    assert.strictEqual(j.byProject.length, 1);
    const dsp = j.byProject[0];
    assert.strictEqual(dsp.project, "Display Types & DSP Integration");
    assert.strictEqual(dsp.created.items[0].id, "i2");
    assert.strictEqual(dsp.deployed.items[0].id, "i5");
    assert.strictEqual(dsp.deployed.items[0].deploy, "success");
    assert.strictEqual(dsp.commented.items[0].id, "i3");
    assert.strictEqual(dsp.commented.items[0].newComments, 2);
    assert.strictEqual(dsp.commented.items[0].by, ADA);
    assert.strictEqual(dsp.moved.items[0].id, "i4");
    assert.strictEqual(dsp.moved.items[0].nowIn, "Approved for Deployment");
    assert.strictEqual(j.concepts.changed, 1);
    assert.strictEqual(j.concepts.items[0].name, "Voice Concierge");
    assert.strictEqual(j.concepts.items[0].newComments, 2);
    const wide = await insight(kit, "what_changed", { since: "10d" });
    assert.strictEqual(wide.json.ticketsChanged, 5);
    assert.ok(wide.json.byProject.some((g) => g.project === "Backlog Tracker & FAQs"));
    const scoped = await insight(kit, "what_changed", { since: "10d", projectId: P_BT });
    assert.strictEqual(scoped.json.ticketsChanged, 1);
    assert.ok((await insight(kit, "what_changed", { since: "last tuesday-ish" })).isError);
  });

  await test("insight: project_status", async () => {
    const r = await insight(kit, "project_status", { projectId: "display types & dsp integration" });
    assert.ok(!r.isError, r.text);
    const j = r.json;
    assert.strictEqual(j.project.id, P_DSP);
    assert.deepStrictEqual(j.byStage, { "Backlog": 2, "Ready for Testing": 1, "Approved for Deployment": 1, "Deployed (Live)": 2 });
    assert.strictEqual(j.openTickets, 4);
    assert.strictEqual(j.blockers.count, 1);
    assert.strictEqual(j.blockers.items[0].reason, "waiting-on-decision");
    assert.strictEqual(j.release.deployBranch, "deploy/dsp-integration");
    assert.strictEqual(j.lastDeployment.ticket.id, "i5");
    assert.strictEqual(j.lastDeployment.version, "1.42.0");
    assert.strictEqual(j.lastDeployment.pr, 501);
    assert.strictEqual(j.lastDeployment.deploy, "success");
    assert.strictEqual(j.kanban.open, 2);
    assert.deepStrictEqual(j.kanban.releases, ["r412"]);
    assert.deepStrictEqual(j.kanban.tasks.map((t) => t.key).sort(), [k1, k2].sort());
    assert.ok((await insight(kit, "project_status")).isError, "projectId is required");
  });

  await test("insight: concept_status", async () => {
    const r = await insight(kit, "concept_status", { conceptId: "VOICE CONCIERGE" });
    assert.ok(!r.isError, r.text);
    const j = r.json;
    assert.strictEqual(j.concept.id, "c-voice");
    assert.strictEqual(j.description, "A spoken front door to the console.");
    assert.strictEqual(j.readme.present, true);
    assert.strictEqual(j.requirements.present, false);
    assert.strictEqual(j.discussion.comments, 3);
    assert.strictEqual(j.discussion.latestDecisions.length, 1);
    assert.match(j.discussion.latestDecisions[0].text, /push-to-talk/);
    assert.strictEqual(j.discussion.latestComments[0].by, KIT);
    assert.deepStrictEqual(j.interfaces, [{ id: "if-1", name: "Voice ↔ DSP status feed", with: ["Display Types & DSP Integration"] }]);
    assert.strictEqual(j.artifactUrl, "https://claude.ai/artifact/voice");
    assert.strictEqual(j.promotedTo, null);
    const promoted = await insight(kit, "concept_status", { conceptId: "kiosk" });
    assert.deepStrictEqual({ id: promoted.json.promotedTo.projectId, name: promoted.json.promotedTo.name }, { id: P_DSP, name: "Display Types & DSP Integration" });
  });

  await test("insight: leads_summary (default 14 days, and a threshold)", async () => {
    const r = await insight(kit, "leads_summary");
    assert.ok(!r.isError, r.text);
    const j = r.json;
    assert.strictEqual(j.total, 5, "the test lead is left out");
    assert.deepStrictEqual(j.byStage, { "Retail / company": { "Lead": 1, "Hot Lead": 1, "Demo": 1, "Post-demo": 1, "Closed Won": 1 } });
    assert.strictEqual(j.open, 4);
    assert.strictEqual(j.unassignedOpen, 1);
    assert.deepStrictEqual(j.recentlyUpdated.leads.map((l) => l.id), ["l1", "l5"]);
    assert.strictEqual(j.stalled.olderThanDays, 14);
    assert.deepStrictEqual(j.stalled.leads.map((l) => l.id), ["l3", "l2"], "stalled, oldest first; a closed lead never stalls");
    assert.strictEqual(j.stalled.leads[0].lastUpdatedDaysAgo, 45);
    const strict = await insight(kit, "leads_summary", { stalledDays: 30 });
    assert.deepStrictEqual(strict.json.stalled.leads.map((l) => l.id), ["l3"]);
  });

  await test("insight: release_status (current by default; by name, version or id)", async () => {
    const r = await insight(kit, "release_status");
    assert.ok(!r.isError, r.text);
    const j = r.json;
    assert.strictEqual(j.release.id, "r412");
    assert.strictEqual(j.release.current, true);
    assert.strictEqual(j.tickets, 3);
    assert.deepStrictEqual(j.byStage, { "In Progress": 1, "Backlog": 2 });
    assert.deepStrictEqual(j.projects, { "Display Types & DSP Integration": { tickets: 2, outstanding: 2 }, "Backlog Tracker & FAQs": { tickets: 1, outstanding: 1 } });
    assert.strictEqual(j.outstanding.count, 3);
    assert.strictEqual(j.outstanding.tickets.length, 3);
    for (const ref of ["PH 4.12", "ph 4.12", "4.12", "release 4.12", "r412", "current"]) {
      const again = await insight(kit, "release_status", { releaseId: ref });
      assert.strictEqual(again.json.release && again.json.release.id, "r412", `"${ref}" → r412 (${again.text.slice(0, 120)})`);
    }
    assert.strictEqual((await insight(kit, "release_status", { releaseId: "4.11" })).json.tickets, 0);
  });

  await test("names resolve case-insensitively; an ambiguous or unknown name says what there is", async () => {
    for (const ref of [P_DSP, "Display Types & DSP Integration", "display types", "DSP INTEGRATION", "dsp"]) {
      const r = await insight(kit, "project_status", { projectId: ref });
      assert.strictEqual(r.json.project && r.json.project.id, P_DSP, `"${ref}" → the DSP project (${r.text.slice(0, 120)})`);
    }
    const amb = await insight(kit, "concept_status", { conceptId: "voice" });
    assert.ok(amb.isError);
    assert.match(amb.json.error.message, /matches more than one concept: Voice Concierge, Voice Search/);
    assert.strictEqual(amb.json.error.line, undefined, "an insight's own line numbers are not the caller's business");
    const none = await insight(kit, "project_status", { projectId: "Loyalty" });
    assert.match(none.json.error.message, /No project called "Loyalty"/);
    assert.match(none.json.error.message, /Backlog Tracker & FAQs/);
  });

  await test("get_insight refuses an unknown insight, an unknown parameter and a wrong type", async () => {
    assert.match((await insight(kit, "everything")).text, /No insight called "everything"/);
    assert.match((await insight(kit, "leads_summary", { stage: "demo" })).text, /no parameter "stage"/);
    assert.match((await insight(kit, "leads_summary", { stalledDays: "many" })).text, /must be a number/);
    assert.match((await tool(kit, "get_insight", { name: "leads_summary", params: "x" })).text, /params must be an object/);
  });

  await test("every insight's answer is compact (well under the 20 KB cap)", async () => {
    const all = [["pipeline_status"], ["what_changed", { since: "30d" }], ["project_status", { projectId: P_DSP }], ["concept_status", { conceptId: "c-voice" }], ["leads_summary"], ["release_status"]];
    for (const [name, params] of all) {
      const r = await insight(ada, name, params);
      assert.ok(!r.isError, `${name}: ${r.text}`);
      assert.strictEqual(r.json.insight, name);
      assert.ok(JSON.stringify(r.json).length < 6000, `${name} is ${JSON.stringify(r.json).length} bytes`);
    }
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
