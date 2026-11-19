// PH Agent Context through the real MCP server (functions/context +
// mcp-server.js) with the Firebase SDKs stubbed (test/mcp-stubs.js) and a
// REAL Code Mode sandbox: search_console and get_topic_context over JSON-RPC
// as a viewer, an editor and an admin; the index kept current by its
// triggers; the two cache tiers and their invalidation; the audit log; and
// the response times the feature promises.
//   node context.test.js
// Needs isolated-vm, which test/package.json installs.
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { install, makeReq, makeRes } = require("./mcp-stubs");

process.env.MCP_PUBLIC_ORIGIN = "https://console.example";
const env = install();
const mcp = require("../functions/mcp-server.js");
const kanban = require("../functions/kanban.js");
const codeMode = require("../functions/code-mode");
const contextLib = require("../functions/context");
codeMode.sandbox.setIsolatedVmPath(require.resolve("isolated-vm"));
const handler = env.captured.requestHandler;
const TOOLS = mcp.__test.TOOLS;
const toolByName = (n) => TOOLS.find((t) => t.name === n);
const ctx = mcp.context;
const trigger = (name) => ctx.triggers.find((t) => t.name === name);

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack.split("\n").slice(0, 16).join("\n      ") : err}`); }
}
async function call(opts) { const req = makeReq(opts); const res = makeRes(); await handler(req, res); return res; }

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ADA = "ada@ph.example", SAM = "sam@ph.example", KIT = "kit@ph.example";
function member(email, role, displayName) {
  env.store.col("consoleUsers").set(email, { email, role, displayName });
  env.store.col("memberDirectory").set(email, { email, displayName, photoUrl: "", disabled: false });
}
async function connect(email) {
  const token = `idtoken-${email}`;
  env.authState.idTokens.set(token, { uid: `uid-${email}`, email, email_verified: true });
  env.authState.users.set(email, { uid: `uid-${email}`, email, customClaims: {} });
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const reg = await call({ method: "POST", path: "/mcp/register", body: { client_name: "Claude", redirect_uris: [REDIRECT] } });
  const clientId = reg.body.client_id;
  const done = await call({ method: "POST", path: "/mcp/authorize/complete", body: { idToken: token, clientId, redirectUri: REDIRECT, state: "s", codeChallenge: challenge, codeChallengeMethod: "S256", scope: "board.read board.write" } });
  const code = new URL(done.body.redirect).searchParams.get("code");
  const tok = await call({ method: "POST", path: "/mcp/token", body: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT } });
  return tok.body.access_token;
}
async function tool(token, name, args) {
  kanban.clearCaches();
  const res = await call({ method: "POST", path: "/mcp", body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } }, headers: { Authorization: `Bearer ${token}` } });
  const r = res.body && res.body.result;
  const text = r && r.content && r.content[0] && r.content[0].text;
  let json = null; try { json = JSON.parse(text); } catch { /* plain text */ }
  return { isError: !!(r && r.isError), text, json };
}
const search = async (token, args) => { const r = await tool(token, "search_console", args); assert.ok(!r.isError, r.text); return r.json; };
const topic = async (token, args) => { const r = await tool(token, "get_topic_context", args); assert.ok(!r.isError, r.text); return r.json; };
const p95 = (list) => { const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };

// ── Fixtures ─────────────────────────────────────────────────────────────
const NOW = Date.now(), DAY = 86400000;
const ts = (msv) => ({ toMillis: () => msv, toDate: () => new Date(msv), _ts: true });
const ago = (days) => ts(NOW - days * DAY);
const col = (n) => env.store.col(n);
const P_DSP = "p-dsp", P_BT = "p-bt", P_OLD = "p-old";
const SOURCE_COLLECTIONS = ["backlogItems", "kanbanTasks", "projects", "concepts", "conceptCritiques", "faqArticles", "leads", "prospects", "supportTickets", "projectDocs", "interfaces", "skills"];
const item = (id, projectId, title, status, updatedDays, extra) => col("backlogItems").set(id, Object.assign({
  projectId, title, desc: `${title}. Described here.`, type: "feature", category: "HQ Admin", status, createdAt: ago(updatedDays + 20), updatedAt: ago(updatedDays), notes: [],
}, extra || {}));
function seed() {
  member(ADA, "admin", "Ada Admin"); member(SAM, "editor", "Sam Sample"); member(KIT, "viewer", "Kit Viewer");
  col("projects").set(P_DSP, { name: "Display Types & DSP Integration", description: "Display types, elements, playlists and the DSP connections that fill sold slots.", deployBranch: "deploy/dsp-integration", createdAt: ago(200), updatedAt: ago(3) });
  col("projects").set(P_BT, { name: "Backlog Tracker & FAQs", description: "The console itself.", createdAt: ago(300), updatedAt: ago(9) });
  col("projects").set(P_OLD, { name: "Old Pricing Prototype", archived: true, createdAt: ago(900), updatedAt: ago(700) });
  col(`projects/${P_DSP}/docs`).set("requirements", { contentMd: "# Requirements\n\n## Exchange\n\nThe exchange sells one play window per position. One live winner per window.\n\n## Partner API\n\nPartners are rate limited to 60 calls a minute.", updatedAt: ago(4) });
  col(`projects/${P_DSP}/docs`).set("readme", { contentMd: "# Display Types\n\nRun the API with npm run dev:api.", updatedAt: ago(30) });

  item("i1", P_DSP, "Playlist editor drag handles", "backlog", 30, { blocked: { reason: "waiting-on-decision", note: "Which drag library?", setBy: SAM, setAt: ago(12) } });
  item("i2", P_DSP, "DSP partner rate limits", "backlog", 2, { type: "bug", ownerEmail: SAM, notes: [{ author: SAM, text: "Decided: we go with a token bucket, 60 a minute.", at: ago(2) }] });
  item("i3", P_DSP, "Slot booking window", "ready-for-testing", 5, { deployCommit: "abc1234", notes: [{ author: ADA, text: "The zeppelin label is misspelled on the preview.", at: ago(1) }] });
  item("i4", P_DSP, "Exchange settings switch", "ready-to-publish", 3);
  item("i5", P_DSP, "Campaign status table", "published-live", 1);
  item("i6", P_BT, "FAQ editor autosave", "backlog", 60);
  item("i7", P_BT, "Retired rate limits ticket", "archived", 100, { archivedAt: ago(100) });

  col("kanbanTasks").set("PH-1", { key: "PH-1", number: 1, title: "Wire the exchange settings API", description: "<p>Connect the <b>exchange</b> settings screen.</p>", type: "task", status: "in-progress", open: true, project: P_DSP, assignee: SAM, labels: ["api"], createdAt: ago(8), updatedAt: ago(2) });
  col("kanbanTasks/PH-1/comments").set("c1", { text: "Agreed: ship behind the flag.", author: SAM, createdAt: ago(2) });
  col("kanbanTasks").set("PH-2", { key: "PH-2", number: 2, title: "Old done task", description: "", type: "task", status: "done", resolution: "completed", open: false, project: P_BT, labels: [], createdAt: ago(80), updatedAt: ago(70) });

  col("concepts").set("c-voice", { name: "Voice Concierge", description: "A spoken front door to the console.", type: "Platform", status: "active", readmeMd: "# Voice Concierge\n\nTalk to the board hands free.", requirementsMd: "VC-1 Push to talk.",
    createdByEmail: SAM, createdAt: ago(20), updatedAt: ago(2), comments: [{ author: ADA, text: "Decided: we go with push-to-talk for v1, no wake word.", at: ago(6) }] });
  col("conceptCritiques").set("cr1", { conceptId: "c-voice", role: "CFO", reviewer: "Ada", verdict: "conditional", summary: "Worth it only if it replaces a support seat.", argumentsFor: ["Faster answers"], argumentsAgainst: ["Speech costs"], assumptions: [], recommendations: [{ text: "Cap the minutes" }], status: "open", createdAt: ago(5) });
  col("interfaces").set("if-1", { name: "Voice ↔ DSP status feed", endpoints: [{ type: "concept", id: "c-voice" }, { type: "project", id: P_DSP }], projectIds: ["c-voice", P_DSP], contentMd: "The status feed contract: one line per train.", updatedAt: ago(10) });
  col("projectDocs").set("d1", { projectId: P_BT, name: "Operating guide", contentMd: "# Operating guide\n\n## Deploys\n\nDeploy to Main merges the train.", updatedAt: ago(15) });

  col("faqCategories").set("cat1", { name: "Getting started", order: 1 });
  col("faqArticles").set("a1", { title: "How do I create a campaign?", slug: "create-a-campaign", summary: "Create a campaign from HQ Admin.", bodyMd: "Open HQ Admin, then Campaigns.", status: "published", categoryId: "cat1", keywords: ["campaign"], updatedAt: ago(40),
    pendingRevision: { bodyMd: "UNPUBLISHED quokka wording." } });
  col("faqArticles").set("a2", { title: "Draft about wallabies", slug: "wallabies", summary: "Not live.", bodyMd: "Wallabies.", status: "draft", updatedAt: ago(1) });

  col("leads").set("l1", { company: { name: "Northwind Grocers", industry: "Grocery" }, stage: "demo", assignee: SAM, createdAt: ago(40), updatedAt: ago(1),
    contacts: [{ name: "Priya Privatename", email: "priya.privatename@northwind.example", jobTitle: "CIO" }], history: [{ at: "2026-11-01", by: SAM, kind: "note", text: "Wants a pilot of the DSP exchange in March." }] });
  col("leads").set("l-test", { company: { name: "Test Co" }, stage: "lead", test: true, updatedAt: ago(1) });
  col("prospects").set("x1", { name: "Northwind Grocers", country: "Australia", industry: "Grocery", insights: "Rolling out digital screens in 400 stores.", decisionMakers: "Dana Decisionmaker, CMO", contacts: [{ name: "Dana Decisionmaker" }], status: "lead", leadId: "l1", updatedAt: ago(6) });

  col("supportTickets").set("t1", { key: "SUP-1", subject: "Screens offline after the exchange update", status: "open", needsHuman: true, category: "bug", summary: "Screens went offline.", customerName: "Casey Customer", customerEmail: "casey@customer.example",
    createdAt: ago(2), updatedAt: ago(1), lastMessageAt: ago(1), aidan: { status: "needs-person", kind: "answer", instruction: "@Aidan what do we know about the exchange update?", reason: "No article covers it.", at: ago(1), finishedAt: ago(1), console: { reads: 2, tools: ["get_topic_context"], codeMode: null } } });
  col("supportTickets/t1/messages").set("m1", { direction: "in", fromName: "Casey Customer", from: "casey@customer.example", text: "Our screens went offline. Write to casey@customer.example please.", at: ago(2) });
  col("supportTickets/t1/messages").set("m2", { direction: "event", text: "Triaged as a bug", at: ago(2) });
  col("supportTickets").set("t-spam", { key: "SUP-2", subject: "You won an exchange prize", status: "spam", createdAt: ago(1), updatedAt: ago(1) });

  col("skills").set("s1", { name: "PH Designer", slug: "ph-designer", summary: "The design system.", version: "1.0", files: [{ path: "SKILL.md", content: "# PH Designer\n\nUse Material Symbols and Roboto." }], updatedAt: ago(50) });
}

(async () => {
  console.log("\nPH Agent Context — search index, topic packs and caches\n");
  seed();
  const ada = await connect(ADA), sam = await connect(SAM), kit = await connect(KIT);

  // ── The index ──────────────────────────────────────────────────────────
  await test("the backfill indexes every source once, and running it again writes nothing", async () => {
    const first = await ctx.backfill();
    for (const s of ["ticket", "kanban", "project", "concept", "critique", "faq", "lead", "prospect", "support", "document", "skill"]) assert.ok(first.report[s] && first.report[s].written >= 1, `${s} was indexed (${JSON.stringify(first.report[s])})`);
    assert.strictEqual(first.report.ticket.records, 7);
    assert.strictEqual(first.report.document.written, 4, "requirements, README, a board document and an interface");
    const again = await ctx.backfill();
    assert.strictEqual(Object.values(again.report).reduce((n, r) => n + r.written, 0), 0, "nothing changed, nothing written");
    assert.strictEqual(again.removed, 0);
    assert.ok(env.store.col("searchIndexState").get("main").backfilledAt > 0);
    assert.ok(!env.store.col("searchIndex").has("lead:l-test") && !env.store.col("searchIndex").has("support:t-spam"), "a test lead and a spam thread are not indexed");
  });

  await test("tools/list offers the new tools as read-only, with no role of their own", async () => {
    for (const n of ["search_console", "get_topic_context", "list_support_threads", "get_support_thread", "list_aidan_runs", "list_script_runs", "list_search_runs"]) {
      const t = toolByName(n);
      assert.ok(t, `${n} is registered`);
      assert.deepStrictEqual([t.scope, t.role, t.destructive === true], ["board.read", undefined, false], n);
    }
    for (const [source, def] of Object.entries(ctx.SOURCES)) assert.strictEqual(toolByName(def.access).scope, "board.read", `${source} is guarded by a real read tool (${def.access})`);
  });

  // ── search_console ─────────────────────────────────────────────────────
  await test("search_console: ranked hits across sources, each with source, id, title, snippet, score, deep link and updatedAt", async () => {
    const r = await search(kit, { query: "rate limits" });
    assert.ok(r.matched >= 2 && r.hits.length === r.returned);
    assert.deepStrictEqual([r.hits[0].source, r.hits[0].id], ["ticket", "i2"], "the ticket titled for it is first");
    for (const h of r.hits) {
      assert.ok(h.source && h.id && h.title && typeof h.snippet === "string" && h.score > 0 && /^https:\/\/console\.example\/#/.test(h.url), JSON.stringify(h));
      assert.ok(h.updatedAt === null || !Number.isNaN(Date.parse(h.updatedAt)));
    }
    assert.deepStrictEqual(r.hits.map((h) => h.score), [...r.hits.map((h) => h.score)].sort((a, b) => b - a), "best first");
    const doc = r.hits.find((h) => h.source === "document");
    assert.ok(doc && doc.section === "Partner API" && /60 calls a minute/.test(doc.snippet), "the requirements hit names its section");
    assert.strictEqual(doc.url, `https://console.example/#docs/${P_DSP}`);
    assert.strictEqual(r.hits[0].url, "https://console.example/#item-i2");
    assert.ok(!r.hits.find((h) => h.id === "i7"), "an archived ticket is hidden by default");
  });

  await test("search_console finds a word that is only in a comment, a critique, a Kanban comment, a skill file or a support message", async () => {
    assert.deepStrictEqual((await search(kit, { query: "zeppelin" })).hits.map((h) => h.id), ["i3"]);
    assert.strictEqual((await search(kit, { query: "support seat" })).hits[0].source, "critique");
    assert.strictEqual((await search(kit, { query: "ship behind the flag" })).hits[0].id, "PH-1");
    assert.strictEqual((await search(kit, { query: "Material Symbols" })).hits[0].source, "skill");
    const sup = await search(kit, { query: "screens went offline" });
    assert.strictEqual(sup.hits[0].source, "support");
    assert.strictEqual(sup.hits[0].url, "https://console.example/#support/ticket/t1");
  });

  await test("filters: source, project, status, type, owner, date range, open, archived", async () => {
    const ids = async (args) => (await search(kit, args)).hits.map((h) => h.id).sort();
    assert.deepStrictEqual(await ids({ query: "rate limits", sources: ["ticket"] }), ["i2"]);
    assert.deepStrictEqual(await ids({ query: "rate limits", sources: ["ticket"], includeArchived: true }), ["i2", "i7"]);
    assert.deepStrictEqual(await ids({ query: "rate limits", status: ["archived"] }), ["i7"], "naming the status shows archived tickets");
    assert.deepStrictEqual(await ids({ sources: ["ticket"], projectId: P_DSP, type: ["bug"] }), ["i2"], "no query: what the filters match");
    assert.deepStrictEqual(await ids({ sources: ["ticket"], owner: SAM }), ["i2"]);
    assert.deepStrictEqual(await ids({ sources: ["ticket"], projectId: P_DSP, since: "4d" }), ["i2", "i4", "i5"]);
    assert.deepStrictEqual(await ids({ sources: ["ticket"], projectId: P_DSP, until: "20d" }), ["i1"]);
    assert.deepStrictEqual(await ids({ sources: ["ticket", "kanban"], projectId: P_DSP, open: true }), ["PH-1", "i1", "i2", "i3", "i4"]);
    assert.deepStrictEqual(await ids({ sources: ["document"], projectId: P_DSP }), [`${P_DSP}~readme`, `${P_DSP}~requirements`, "interface~if-1"].sort());
    const newest = await search(kit, { sources: ["ticket"], projectId: P_DSP });
    assert.strictEqual(newest.hits[0].id, "i5", "with no query the newest is first");
    for (const [args, re] of [[{}, /Give a query, or at least one filter/], [{ query: "x", since: "soon" }, /since must be a date/], [{ query: "x", sources: ["passwords"] }, /Unknown source "passwords"/], [{ query: "the and of" }, /no words to search for/]]) {
      const bad = await tool(kit, "search_console", args);
      assert.ok(bad.isError && re.test(bad.text), bad.text);
    }
  });

  await test("personal fields stay out: no contact or decision maker is searchable, email addresses are removed, a pending revision is never indexed", async () => {
    for (const q of ["Priya Privatename", "priya.privatename", "Dana Decisionmaker", "quokka"]) {
      const r = await tool(kit, "search_console", { query: q });
      assert.ok(!r.isError && r.json.matched === 0, `"${q}" finds nothing (${r.text.slice(0, 200)})`);
    }
    const lead = await search(kit, { query: "Northwind pilot", sources: ["lead"] });
    assert.strictEqual(lead.hits[0].id, "l1", "the company and its notes are searchable");
    const stored = JSON.stringify([...env.store.col("searchIndex").values()]);
    assert.ok(!/@northwind\.example|@customer\.example|Privatename|Decisionmaker|quokka/.test(stored), "none of it is in the index at all");
    assert.ok(/\[address\]/.test(stored), "an address in a support message is replaced");
    assert.strictEqual((await search(kit, { query: "wallabies" })).matched, 0, "a draft article is hidden by default");
    assert.strictEqual((await search(kit, { query: "wallabies", includeArchived: true })).hits[0].id, "a2");
  });

  await test("a search never reads a source collection: only the index, and only what was indexed since", async () => {
    await search(kit, { query: "warm the index" }).catch(() => {});
    env.store.reads.clear();
    await search(kit, { query: "exchange settings" });
    await topic(kit, { topic: "exchange settings" });
    for (const c of SOURCE_COLLECTIONS) assert.ok(!env.store.reads.get(c), `${c} was not read (${env.store.reads.get(c)})`);
    assert.ok(!env.store.reads.get("searchIndex"), "inside the refresh window the index collection is not read either");
    // A minute later (everything indexed so far is a minute old) the refresh
    // window has passed: the next search reads only what was indexed since.
    const age = (by) => { for (const d of env.store.col("searchIndex").values()) d.indexedAt -= by; for (const e of ctx._mem.entries.values()) e.indexedAt -= by; ctx._mem.lastSeen -= by; };
    age(60000);
    ctx._expireRefresh();
    env.store.reads.clear();
    await search(kit, { query: "exchange settings again" });
    assert.strictEqual(env.store.reads.get("searchIndex") || 0, 0, "nothing was indexed since: no index document is read");
    const other = contextLib.create({ db: () => env.db, FieldValue: require("firebase-admin/firestore").FieldValue, logger: { warn() {}, error() {} }, origin: "https://console.example", embedder: null });
    const one = { projectId: P_BT, title: "Tapir toggle", desc: "A toggle.", status: "backlog", type: "feature", createdAt: ago(0), updatedAt: ago(0), notes: [] };
    await other.syncRecord("ticket", "i-tapir", one);
    ctx._expireRefresh();
    env.store.reads.clear();
    assert.deepStrictEqual((await search(kit, { query: "tapir" })).hits.map((h) => h.id), ["i-tapir"]);
    assert.strictEqual(env.store.reads.get("searchIndex"), 1, "one record was indexed since: one index document is read");
    for (const c of SOURCE_COLLECTIONS) assert.ok(!env.store.reads.get(c), `${c} was not read`);
    await other.remove("ticket", "i-tapir");
    ctx._expireRefresh();
  });

  // ── Index on write ─────────────────────────────────────────────────────
  await test("index on write: a new record is searchable, an unchanged write costs nothing, a delete removes it", async () => {
    const t = trigger("contextIndexTicket");
    const doc = { projectId: P_BT, title: "Narwhal export button", desc: "Export the board as CSV.", status: "backlog", type: "feature", createdAt: ago(0), updatedAt: ago(0), notes: [] };
    col("backlogItems").set("i-new", doc);
    assert.strictEqual((await t.run({ id: "i-new" }, null, doc)).changed, true);
    assert.deepStrictEqual((await search(kit, { query: "narwhal" })).hits.map((h) => h.id), ["i-new"]);
    // A train stamp changes nothing the index holds: dropped before any read or write.
    env.store.reads.clear();
    const stamped = Object.assign({}, doc, { deployCommit: "fff0001", prNumber: 12, updatedAtIgnored: 1 });
    assert.strictEqual((await t.run({ id: "i-new" }, doc, stamped)).changed, false);
    assert.ok(!env.store.reads.get("searchIndex") && !env.store.reads.get("backlogItems"), "no read at all");
    // A comment does change it.
    const commented = Object.assign({}, stamped, { notes: [{ author: SAM, text: "Add a pangolin column too.", at: ago(0) }] });
    col("backlogItems").set("i-new", commented);
    assert.strictEqual((await t.run({ id: "i-new" }, stamped, commented)).changed, true);
    assert.deepStrictEqual((await search(kit, { query: "pangolin" })).hits.map((h) => h.id), ["i-new"]);
    col("backlogItems").delete("i-new");
    assert.strictEqual((await t.run({ id: "i-new" }, commented, null)).changed, true);
    assert.strictEqual((await search(kit, { query: "narwhal" })).matched, 0);
    assert.strictEqual(env.store.col("searchIndex").get("ticket:i-new").deleted, true, "a tombstone, so other instances drop it too");
  });

  await test("index on write: events that arrive late, twice or out of order never index something old or bring a deleted record back", async () => {
    const t = trigger("contextIndexTicket");
    const v0 = { projectId: P_BT, title: "Lemur ordering", desc: "Order matters.", status: "backlog", type: "feature", createdAt: ago(0), updatedAt: ago(0), notes: [] };
    const v1 = Object.assign({}, v0, { status: "ready-for-testing" });
    const v2 = Object.assign({}, v0, { status: "archived" });
    // The record is already at v2 when the events come in, newest first.
    col("backlogItems").set("i-lemur", v2);
    await t.run({ id: "i-lemur" }, v1, v2);
    await t.run({ id: "i-lemur" }, null, v0);
    await t.run({ id: "i-lemur" }, v0, v1);
    await t.run({ id: "i-lemur" }, v0, v1);
    const stored = () => env.store.col("searchIndex").get("ticket:i-lemur");
    assert.deepStrictEqual([stored().status, stored().open, stored().archived], ["archived", false, true], "the entry is the record as it is now, whatever order the events came in");
    assert.ok(!(await mcp.aidanImprovements().openTickets(P_BT)).some((x) => x.id === "i-lemur"), "so it is not an open ticket");
    // Deleted, then a late update event: it stays deleted.
    col("backlogItems").delete("i-lemur");
    await t.run({ id: "i-lemur" }, v2, null);
    await t.run({ id: "i-lemur" }, v0, v1);
    assert.strictEqual(stored().deleted, true);
    assert.strictEqual((await search(kit, { query: "lemur", includeArchived: true })).matched, 0);
    // A write made from an earlier read never replaces one made from a later read.
    const at = stored().srcAt;
    assert.ok(at > 0);
    assert.deepStrictEqual(await ctx.put("ticket", "i-lemur", { title: "Lemur ordering", text: "old", status: "backlog", open: true }, { srcAt: at - 1 }), { changed: false, key: "ticket:i-lemur", skipped: "a later read is already indexed" });
    assert.strictEqual(stored().deleted, true);
  });

  await test("index on write: a comment or a message re-indexes its parent; another server instance picks the change up on its next refresh", async () => {
    col("kanbanTasks/PH-1/comments").set("c2", { text: "The ocelot build passed.", author: ADA, createdAt: ago(0) });
    assert.strictEqual((await trigger("contextIndexKanbanComment").run({ id: "PH-1", commentId: "c2" }, null, {})).changed, true);
    assert.strictEqual((await search(kit, { query: "ocelot" })).hits[0].id, "PH-1");
    assert.strictEqual((await trigger("contextIndexSupportMessage").run({ id: "t1", messageId: "m2" }, null, { direction: "event" })).changed, false, "a timeline event indexes nothing");
    // A second instance (its own memory) writes; this one sees it after the refresh window.
    const other = contextLib.create({ db: () => env.db, FieldValue: require("firebase-admin/firestore").FieldValue, logger: { warn() {}, error() {} }, origin: "https://console.example", embedder: null });
    const doc = { projectId: P_BT, title: "Capybara import", desc: "Import a CSV.", status: "backlog", type: "feature", createdAt: ago(0), updatedAt: ago(0), notes: [] };
    col("backlogItems").set("i-other", doc);
    await other.syncRecord("ticket", "i-other", doc);
    assert.strictEqual((await search(kit, { query: "capybara" })).matched, 0, "not yet: inside the refresh window");
    ctx._expireRefresh();
    assert.deepStrictEqual((await search(kit, { query: "capybara" })).hits.map((h) => h.id), ["i-other"]);
    col("backlogItems").delete("i-other");
    await other.syncRecord("ticket", "i-other");
    ctx._expireRefresh();
    assert.strictEqual((await search(kit, { query: "capybara" })).matched, 0, "and the delete too");
  });

  // ── Role scoping ───────────────────────────────────────────────────────
  await test("role scoping: a source is searched only when tools/call would let the caller call its read tool", async () => {
    const leadsTool = toolByName("list_leads");
    assert.ok((await search(kit, { query: "Northwind" })).hits.some((h) => h.source === "lead"), "today a viewer may read leads");
    leadsTool.role = "editor";   // as if leads were restricted to editors
    try {
      const refused = await tool(kit, "list_leads", {});
      assert.ok(refused.isError && /requires the editor role/.test(refused.text), "tools/call refuses the viewer");
      const asViewer = await search(kit, { query: "Northwind" });
      assert.ok(!asViewer.hits.some((h) => h.source === "lead") && !asViewer.sourcesSearched.includes("lead"), "so the search does too");
      assert.ok(asViewer.hits.some((h) => h.source === "prospect"), "a source the viewer may still read is still searched");
      assert.ok((await search(sam, { query: "Northwind" })).hits.some((h) => h.source === "lead"), "the editor still sees leads");
      // A pack built for the editor is never served to the viewer.
      ctx._hot.clear();
      const forEditor = await topic(sam, { topic: "Northwind Grocers" });
      assert.deepStrictEqual([forEditor.kind, forEditor.cache.tier, Boolean(forEditor.records.lead)], ["lead", "cold", true]);
      const forViewer = await topic(kit, { topic: "Northwind Grocers" });
      assert.ok(!forViewer.records.lead && !JSON.stringify(forViewer).includes("#leads/"), "no lead in the viewer's pack");
      assert.deepStrictEqual([forViewer.kind, forViewer.cache.hit], ["text", false], "the viewer can't even resolve the lead, and gets no cached pack");
      assert.ok(!JSON.stringify(forViewer.related).includes("Northwind"), "nor is it named as a related topic");
      assert.strictEqual((await topic(sam, { topic: "Northwind Grocers" })).cache.hit, true, "the editor's own pack is still cached");
      const refusedLead = await tool(kit, "get_topic_context", { leadId: "l1" });
      assert.ok(refusedLead.isError && /No lead matches/.test(refusedLead.text));
      const keys = [...env.store.col("topicContext").values()].filter((d) => d.topic === "Northwind Grocers" && d.pack).map((d) => `${d.role}|${d.kind}`).sort();
      assert.deepStrictEqual(keys, ["editor|lead", "viewer|text"], "one stored pack per role and reach (a stub left from when the viewer could read leads has another key and is never served)");
    } finally { delete leadsTool.role; }
    // No board.read scope, no sources at all.
    const none = await ctx.search({ email: "x@ph.example", role: "admin", scopes: [] }, { query: "rate limits" });
    assert.deepStrictEqual([none.matched, none.sourcesSearched], [0, []]);
    // Support threads have no tool of their own to borrow a rule from: the new read tool guards them.
    const supportTool = toolByName("list_support_threads");
    supportTool.role = "admin";
    try {
      assert.ok(!(await search(sam, { query: "screens offline" })).hits.some((h) => h.source === "support"));
      assert.ok((await search(ada, { query: "screens offline" })).hits.some((h) => h.source === "support"));
    } finally { delete supportTool.role; }
  });

  // ── get_topic_context ──────────────────────────────────────────────────
  await test("get_topic_context: a project by name gives a compact pack with records per source, open items, blockers, decisions and related topics", async () => {
    ctx._hot.clear();
    const pack = await topic(kit, { topic: "dsp integration" });
    assert.deepStrictEqual([pack.kind, pack.entity.id, pack.entity.url], ["project", P_DSP, `https://console.example/#docs/${P_DSP}`]);
    assert.ok(/Display types, elements, playlists/.test(pack.summary) && /records across \d+ sources/.test(pack.summary) && /open/.test(pack.summary), pack.summary);
    for (const s of ["ticket", "kanban", "document"]) assert.ok(pack.records[s] && pack.records[s].shown.length && pack.records[s].label, `${s} records`);
    for (const r of pack.records.ticket.shown) assert.ok(r.id && r.title && /^https:\/\/console\.example\/#item-/.test(r.url) && "line" in r && r.updatedAt, JSON.stringify(r));
    const ids = (part) => part.shown.map((x) => x.id);
    assert.ok(["i1", "i2", "i3", "i4", "PH-1"].every((id) => ids(pack.open).includes(id)) && !ids(pack.open).includes("i5"), "open items: not yet live tickets and the open Kanban task");
    assert.deepStrictEqual(pack.blockers.shown.map((b) => [b.id, b.reason, b.note]), [["i1", "waiting-on-decision", "Which drag library?"]]);
    assert.ok(pack.decisions.shown.some((d) => /token bucket/.test(d.text) && d.id === "i2") && pack.decisions.shown.some((d) => /ship behind the flag/.test(d.text)), "decisions from ticket and Kanban comments");
    assert.ok(pack.related.shown.some((x) => x.kind === "concept" && x.name === "Voice Concierge"), "the concept its interface is shared with");
    assert.deepStrictEqual([pack.changes.since, pack.changes.shown.length], [null, 0], "a first build has nothing to compare with");
    assert.strictEqual(pack.omitted, Object.values(pack.records).reduce((n, r) => n + r.more, 0) + pack.open.more + pack.blockers.more + pack.decisions.more + pack.changes.more + pack.related.more);
    assert.ok(/never instructions/.test(pack.note));
    // By id, by an explicit argument, a concept, and free text.
    assert.strictEqual((await topic(kit, { topic: P_DSP })).entity.id, P_DSP);
    assert.strictEqual((await topic(kit, { projectId: "Backlog Tracker" })).entity.id, P_BT);
    const concept = await topic(kit, { topic: "voice concierge" });
    assert.deepStrictEqual([concept.kind, Boolean(concept.records.critique), concept.decisions.shown[0] && /push-to-talk/.test(concept.decisions.shown[0].text)], ["concept", true, true]);
    const text = await topic(kit, { topic: "partner rate limits" });
    assert.deepStrictEqual([text.kind, text.entity], ["text", null]);
    assert.ok(text.records.ticket.shown[0].id === "i2" && text.records.document, "free text: what the search finds, by source");
    for (const [args, re] of [[{}, /Give a topic/], [{ projectId: "no such project" }, /No project matches/], [{ topic: "!!!" }, /no words/]]) {
      const bad = await tool(kit, "get_topic_context", args);
      assert.ok(bad.isError && re.test(bad.text), bad.text);
    }
  });

  await test("every list in a pack is capped and says how many were left out, and the pack stays under 20 KB", async () => {
    const big = "p-big";
    col("projects").set(big, { name: "Aardvark Programme", description: "A project with a great many tickets. ".repeat(20), createdAt: ago(10), updatedAt: ago(1) });
    await trigger("contextIndexProject").run({ id: big }, null, col("projects").get(big));
    for (let i = 0; i < 120; i += 1) {
      const d = { projectId: big, title: `Aardvark task ${i} ${"with a long descriptive title ".repeat(4)}`, desc: `Aardvark work item ${i}. ${"More detail about the aardvark programme. ".repeat(30)}`, status: "backlog", type: "feature", createdAt: ago(5), updatedAt: ago(i % 9),
        blocked: { reason: "waiting-on-decision", note: "Which aardvark? ".repeat(20) }, notes: [{ author: SAM, text: `Decided: aardvark option ${i} it is. ${"Because. ".repeat(40)}`, at: ago(1) }] };
      col("backlogItems").set(`big-${i}`, d);
      await trigger("contextIndexTicket").run({ id: `big-${i}` }, null, d);
    }
    const r = await tool(kit, "get_topic_context", { topic: "Aardvark Programme" });
    assert.ok(!r.isError, r.text);
    const pack = r.json;
    assert.ok(Buffer.byteLength(JSON.stringify(pack), "utf8") <= 20 * 1024, `${Buffer.byteLength(JSON.stringify(pack), "utf8")} bytes`);
    assert.ok(pack.records.ticket.shown.length <= 5 && pack.records.ticket.more > 0, "tickets are capped, with how many more");
    assert.ok(pack.open.more > 0 && pack.blockers.more > 0 && pack.decisions.more > 0 && pack.omitted > 100, `omitted ${pack.omitted}`);
    assert.strictEqual(pack.counts.ticket, pack.records.ticket.shown.length + pack.records.ticket.more);
    const seen = new Set(pack.records.ticket.shown.map((x) => x.id));
    assert.strictEqual(seen.size, pack.records.ticket.shown.length, "no record is listed twice");
  });

  // ── Caches ─────────────────────────────────────────────────────────────
  await test("cache: cold, then hot in this instance, then warm from Firestore for another; hits and misses are counted", async () => {
    ctx._hot.clear();
    const T = { topic: "slot booking window" };
    const cold = await topic(sam, T);
    assert.deepStrictEqual([cold.cache.tier, cold.cache.hit], ["cold", false]);
    env.store.reads.clear();
    const hot = await topic(sam, T);
    assert.deepStrictEqual([hot.cache.tier, hot.cache.hit], ["hot", true]);
    assert.ok(!env.store.reads.get("topicContext") && !env.store.reads.get("searchIndex"), "a hot hit reads nothing from Firestore");
    assert.deepStrictEqual(hot.records, cold.records);
    ctx._hot.clear();   // as another server instance would be
    const warm = await topic(sam, T);
    assert.deepStrictEqual([warm.cache.tier, warm.cache.hit], ["warm", true]);
    assert.deepStrictEqual(warm.records, cold.records);
    const doc = [...env.store.col("topicContext").values()].find((d) => d.ref === "text:slot booking window" && d.role === "editor");
    assert.ok(doc && doc.misses === 1 && doc.hits >= 1 && doc.builds === 1 && doc.lastUsedAt > 0 && doc.cited.includes("ticket:i3") && doc.stale === false, JSON.stringify({ hits: doc && doc.hits, misses: doc && doc.misses }));
    assert.ok(JSON.parse(doc.citedJson).every((c) => c.k && c.v), "each cited record with its version");
    assert.strictEqual((await topic(sam, Object.assign({ refresh: true }, T))).cache.tier, "cold", "refresh builds it from scratch");
    // The same words in another order of case and punctuation are the same topic.
    assert.strictEqual((await topic(sam, { topic: "Slot  booking, WINDOW" })).cache.hit, true);
    // A repeated search is served from the hot tier too, until the index changes.
    await search(sam, { query: "campaign status table" });
    assert.strictEqual((await search(sam, { query: "campaign status table" })).cache, "hot");
  });

  await test("invalidation: a write marks every pack that cites the record stale; the next read rebuilds only the changed source and says what changed", async () => {
    ctx._hot.clear();
    const T = { topic: "dsp integration" };
    const before = await topic(sam, Object.assign({ refresh: true }, T));
    assert.strictEqual(before.cache.tier, "cold");
    const packDoc = () => [...env.store.col("topicContext").values()].find((d) => d.ref === `project:${P_DSP}` && d.role === "editor");
    assert.deepStrictEqual([packDoc().stale, packDoc().entityKeys], [false, [`project:${P_DSP}`]]);
    // A ticket the pack cites gets a comment.
    const old = col("backlogItems").get("i4");
    const changed = Object.assign({}, old, { notes: [{ author: ADA, text: "Agreed: the switch defaults to off.", at: ago(0) }], updatedAt: ago(0) });
    col("backlogItems").set("i4", changed);
    await trigger("contextIndexTicket").run({ id: "i4" }, old, changed);
    assert.deepStrictEqual([packDoc().stale, packDoc().staleSources], [true, ["ticket"]], "marked stale by the write trigger, with the source that changed");
    const after = await topic(sam, T);
    assert.deepStrictEqual([after.cache.tier, after.cache.hit, after.cache.rebuilt], ["rebuilt", false, ["ticket"]], "only tickets were gathered again");
    assert.deepStrictEqual(after.records.document, before.records.document, "the other sources are the ones already in the pack");
    assert.deepStrictEqual(after.changes.shown.map((c) => [c.id, c.change]), [["i4", "updated"]]);
    assert.strictEqual(after.changes.since, before.builtAt);
    assert.ok(after.decisions.shown.some((d) => /defaults to off/.test(d.text)), "the new decision is in the pack");
    assert.deepStrictEqual([packDoc().stale, packDoc().staleSources], [false, []]);
    assert.strictEqual((await topic(sam, T)).cache.tier, "hot");
    // A NEW record of the project (cited by nothing) marks the project's pack stale too.
    const fresh = { projectId: P_DSP, title: "Ibis colour picker", desc: "Pick a colour.", status: "backlog", type: "feature", createdAt: ago(0), updatedAt: ago(0), notes: [] };
    col("backlogItems").set("i-ibis", fresh);
    await trigger("contextIndexTicket").run({ id: "i-ibis" }, null, fresh);
    assert.strictEqual(packDoc().stale, true);
    const withNew = await topic(sam, T);
    assert.deepStrictEqual([withNew.cache.tier, withNew.changes.shown.some((c) => c.id === "i-ibis" && c.change === "new")], ["rebuilt", true]);
    // Even with the stale mark lost (the trigger failed), the read notices the version moved.
    const old3 = col("backlogItems").get("i3");
    const changed3 = Object.assign({}, old3, { title: "Slot booking window (renamed)" });
    col("backlogItems").set("i3", changed3);
    await trigger("contextIndexTicket").run({ id: "i3" }, old3, changed3);
    const d = packDoc();
    env.store.col("topicContext").set(d.key, Object.assign({}, d, { stale: false, staleSources: [] }));
    const noticed = await topic(sam, T);
    assert.deepStrictEqual([noticed.cache.tier, noticed.changes.shown.some((c) => c.id === "i3")], ["rebuilt", true]);
    col("backlogItems").delete("i-ibis");
    await trigger("contextIndexTicket").run({ id: "i-ibis" }, fresh, null);
    assert.strictEqual((await topic(sam, T)).changes.removed, 1, "a record that went is counted as removed");
  });

  await test("prewarm: a searched topic is remembered, built by the trigger, and warm when it is asked for; a stale pack used recently is rebuilt at once", async () => {
    ctx._hot.clear();
    await search(sam, { query: "campaign status" });
    const stub = [...env.store.col("topicContext").values()].find((d) => d.ref === "text:campaign status" && d.role === "editor");
    assert.ok(stub && stub.stale === true && stub.pack === null && stub.usedBy.includes("mcp"), "a stub, waiting for the prewarm");
    const pre = trigger("contextPrewarmTopic");
    assert.deepStrictEqual(await pre.run({ id: stub.key }, null, stub), { built: true, tier: "cold" });
    const built = env.store.col("topicContext").get(stub.key);
    assert.ok(built.stale === false && built.pack && !built.misses, "built, and not counted as anyone's miss");
    assert.deepStrictEqual(await pre.run({ id: stub.key }, stub, built), { skipped: "not newly stale" }, "its own write does not start another build");
    ctx._hot.clear();
    assert.deepStrictEqual([(await topic(sam, { topic: "campaign status" })).cache.tier, (await topic(sam, { topic: "campaign status" })).cache.tier], ["warm", "hot"], "already built when it is first asked for");
    // Gone stale after a write, used recently: rebuilt by the trigger, for the role it was built for.
    const old = col("backlogItems").get("i5");
    const changed = Object.assign({}, old, { desc: "Campaign status table. Now with a quetzal column." });
    col("backlogItems").set("i5", changed);
    await trigger("contextIndexTicket").run({ id: "i5" }, old, changed);
    const stale = env.store.col("topicContext").get(stub.key);
    assert.strictEqual(stale.stale, true);
    assert.deepStrictEqual(await pre.run({ id: stub.key }, built, stale), { built: true, tier: "rebuilt" });
    ctx._hot.clear();
    const served = await topic(sam, { topic: "campaign status" });
    assert.deepStrictEqual([served.cache.tier, /quetzal/.test(JSON.stringify(served.records))], ["warm", true]);
    // A long topic is rebuilt under the key it was stored under (its ref, not its shortened name).
    const long = `campaign status ${"and the booking window ".repeat(8)}report`;
    assert.ok(long.length > 120 && long.length <= 300);
    await search(sam, { query: long });
    const longStub = [...env.store.col("topicContext").values()].find((d) => d.ref.startsWith("text:campaign status and the booking window") && d.pack === null);
    assert.ok(longStub && longStub.topic.length <= 120 && longStub.ref.length > 125);
    assert.deepStrictEqual(await pre.run({ id: longStub.key }, null, longStub), { built: true, tier: "cold" });
    assert.ok(env.store.col("topicContext").get(longStub.key).pack, "the stub itself was filled, not a second document");
    ctx._hot.clear();
    assert.strictEqual((await topic(sam, { topic: long })).cache.tier, "warm");
    // Not used for longer than the window: left for its next read.
    assert.deepStrictEqual(await pre.run({ id: stub.key }, built, Object.assign({}, stale, { lastUsedAt: Date.now() - 30 * DAY })), { skipped: "not used recently" });
    assert.deepStrictEqual(await pre.run({ id: stub.key }, built, Object.assign({}, stale, { visibility: "editor|ticket" })), { skipped: "the role's reach changed" });
  });

  // ── Audit ──────────────────────────────────────────────────────────────
  await test("audit: one row per search and context call, with the caller, a hash of the query, the sources hit, the time and the cache tier", async () => {
    const before = env.store.col("searchRuns").size;
    await search(kit, { query: "Confidential Okapi Project", sources: ["ticket"], owner: SAM });
    ctx._hot.clear();
    await topic(kit, { topic: "exchange settings" });
    await topic(kit, { topic: "exchange settings" });
    const rows = [...env.store.col("searchRuns").values()].slice(before);
    assert.deepStrictEqual(rows.map((r) => [r.kind, r.email, r.role, r.cacheTier, r.cacheHit]), [["search", KIT, "viewer", "none", false], ["topic", KIT, "viewer", rows[1].cacheTier, false], ["topic", KIT, "viewer", "hot", true]]);
    assert.ok(["cold", "rebuilt"].includes(rows[1].cacheTier));
    for (const r of rows) assert.ok(/^[0-9a-f]{32}$/.test(r.queryHash) && Number.isFinite(r.durationMs) && r.sourcesHit && r.atMs > 0 && r.via === "mcp", JSON.stringify(r));
    assert.ok(!/okapi|exchange settings/i.test(JSON.stringify(rows)), "the query text is not in the audit log");
    // A keyed hash: the same query gives the same hash, but nobody can make it from the words (or match it to a cached topic).
    assert.strictEqual(rows[1].queryHash, rows[2].queryHash);
    assert.ok(![ctx.core.queryHash("exchange settings"), ctx.core.queryHash("text:exchange settings"), ctx.core.sha("exchange settings").slice(0, 32)].includes(rows[1].queryHash) && !("packKey" in rows[1]), "not the plain hash of the words, and no pointer to the cached pack");
    assert.ok(/^[0-9a-f]{64}$/.test(env.store.col("contextSecrets").get("audit").key), "the key is kept where no client can read it");
    assert.deepStrictEqual(rows[0].filters, { sources: ["ticket"], owner: true }, "that there was an owner filter, never whose");
    const log = await tool(kit, "list_search_runs", { limit: 5 });
    assert.ok(!log.isError && log.json.runs.length === 5 && log.json.runs.some((x) => x.cacheTier === "hot" && x.kind === "topic" && x.email === KIT), log.text.slice(0, 300));
    assert.ok(log.json.summary.topic.count >= 3 && log.json.summary.topic.hitRate > 0 && Number.isFinite(log.json.summary.search.p95Ms) && Number.isFinite(log.json.summary.topic.cachedP95Ms));
  });

  // ── Code Mode ──────────────────────────────────────────────────────────
  await test("Code Mode: a script reaches search, topic context, project documents, critiques, Support threads and run history, as a viewer", async () => {
    const names = ["list_project_documents", "get_project_document", "list_concept_critiques", "search_console", "get_topic_context", "list_support_threads", "get_support_thread", "list_aidan_runs", "list_script_runs", "list_search_runs"];
    for (const n of names) assert.ok(codeMode.SCRIPT_TOOL_NAMES.includes(n), `${n} is a script tool`);
    const described = await tool(kit, "describe_script_tools");
    for (const n of names) assert.ok(described.text.includes(`  ${n}(args`), `${n} is described`);
    const r = await tool(kit, "run_script", { code: `
      const hits = await tools.search_console({ query: "rate limits", limit: 3 });
      const pack = await tools.get_topic_context({ topic: "dsp integration" });
      const found = await tools.list_project_documents({ projectId: "${P_DSP}", query: "rate limited" });
      const section = await tools.get_project_document({ projectId: "${P_DSP}", docId: found.matches[0].docId, section: found.matches[0].heading });
      const critiques = await tools.list_concept_critiques({ conceptId: "c-voice" });
      const threads = await tools.list_support_threads({ query: "offline" });
      const thread = await tools.get_support_thread({ ticketId: threads.threads[0].id });
      const aidan = await tools.list_aidan_runs({});
      const runs = await tools.list_script_runs({ limit: 5 });
      const searches = await tools.list_search_runs({ kind: "search", limit: 2 });
      return { top: hits.hits[0].id, kind: pack.kind, openItems: pack.open.shown.length + pack.open.more, section: section.content.slice(0, 60), verdicts: critiques.critiques.map((c) => c.verdict),
        thread: [thread.key, thread.customer, thread.messages.length, thread.messages[0].text], aidan: aidan.runs.map((x) => [x.key, x.status, x.kind, x.instruction]), runs: runs.returned >= 0, searches: searches.runs.length };` });
    assert.ok(!r.isError, r.text);
    const v = r.json.result;
    assert.deepStrictEqual([v.top, v.kind, v.verdicts], ["i2", "project", ["conditional"]]);
    assert.ok(v.openItems >= 5 && /Partner API/.test(v.section) && v.searches === 2);
    assert.deepStrictEqual(v.thread, ["SUP-1", "Casey Customer", 1, "Our screens went offline. Write to [address] please."], "the thread without its timeline events and without addresses");
    assert.deepStrictEqual(v.aidan, [["SUP-1", "needs-person", "answer", "@Aidan what do we know about the exchange update?"]]);
    assert.deepStrictEqual(r.json.toolCalls.map((c) => c.name), ["search_console", "get_topic_context", "list_project_documents", "get_project_document", "list_concept_critiques", "list_support_threads", "get_support_thread", "list_aidan_runs", "list_script_runs", "list_search_runs"]);
    const spam = await tool(kit, "get_support_thread", { ticketId: "t-spam" });
    assert.ok(spam.isError && /No support thread/.test(spam.text), "a spam thread is not offered");
    const runs = await tool(kit, "list_script_runs", { kind: "run_script", includeSource: true, limit: 1 });
    assert.ok(runs.json.runs[0].email === KIT && /tools\.search_console/.test(runs.json.runs[0].scriptSource) && runs.json.runs[0].toolCallCount === 10);
  });

  await test("the topic_context insight returns the same pack get_topic_context does, inside the sandbox's 20 KB", async () => {
    const direct = await topic(kit, { topic: "Aardvark Programme" });
    const r = await tool(kit, "get_insight", { name: "topic_context", params: { topic: "Aardvark Programme" } });
    assert.ok(!r.isError, r.text);
    assert.deepStrictEqual([r.json.kind, r.json.records, r.json.cache.hit], ["project", direct.records, true]);
    const missing = await tool(kit, "get_insight", { name: "topic_context", params: {} });
    assert.ok(missing.isError && /needs topic/.test(missing.text));
    const scoped = toolByName("list_leads");
    scoped.role = "editor";
    try {
      const asViewer = await tool(kit, "run_script", { code: "const r = await tools.search_console({ query: \"Northwind\" }); return r.hits.map((h) => h.source);" });
      assert.ok(!asViewer.isError && !asViewer.json.result.includes("lead"), "a script sees what its caller sees");
    } finally { delete scoped.role; }
  });

  // ── Aidan's open tickets ───────────────────────────────────────────────
  await test("open tickets of one project come from an indexed query on the index, not from reading every ticket of the project", async () => {
    const imp = mcp.aidanImprovements();
    col("backlogItems").set("i-gap", { projectId: P_BT, title: "Aidan: answer release questions", desc: "x", status: "backlog", type: "feature", aidanImprovementKey: "k1", aidanImprovement: { category: "missing-data", gap: "No release data." }, createdAt: ago(1), updatedAt: ago(1), notes: [] });
    await trigger("contextIndexTicket").run({ id: "i-gap" }, null, col("backlogItems").get("i-gap"));
    env.store.reads.clear();
    const open = await imp.openTickets(P_BT);
    assert.deepStrictEqual(open.map((t) => t.id).sort(), ["i-gap", "i6"], "Backlog, Ready for Testing and Approved; not the archived one");
    assert.ok(!env.store.reads.get("backlogItems"), "no ticket document was read");
    const gap = open.find((t) => t.id === "i-gap");
    assert.deepStrictEqual([gap.aidanImprovementKey, gap.aidanImprovement, gap.status], ["k1", { category: "missing-data", gap: "No release data." }, "backlog"]);
    // Before the backfill has run, the index can't be trusted to be complete: the old read is used.
    const fresh = contextLib.create({ db: () => ({ collection: (n) => (n === "searchIndexState" ? { doc: () => ({ get: async () => ({ exists: false }) }) } : env.db.collection(n)) }), FieldValue: {}, logger: { warn() {} }, origin: "x", embedder: null });
    assert.strictEqual(await fresh.openTickets(P_BT), null);
  });

  // ── Semantic vectors ───────────────────────────────────────────────────
  await test("semantic vectors: stored per chunk when the embedder answers, used by the search, and skipped without failing when it doesn't", async () => {
    const FieldValue = require("firebase-admin/firestore").FieldValue;
    const store2 = new Map();
    const fakeDb = () => env.db;   // same stub store, its own collection names below
    // A toy embedder: one direction for "refund" language, another for everything else.
    const vec = (text) => { const v = new Array(256).fill(0); v[/refund|money back|reimburse/i.test(text) ? 0 : 1] = 1; return v; };
    let fail = false, calls = 0;
    const embedder = { name: "toy", available: () => true, embed: async (texts) => { calls += 1; return fail ? null : texts.map(vec); } };
    const sem = contextLib.create({ db: fakeDb, FieldValue, logger: { warn() {}, error() {} }, origin: "https://console.example", embedder, getTool: (n) => toolByName(n), atLeast: () => true });
    void store2;
    const d = { title: "How do I get reimbursed?", slug: "reimbursed", summary: "Ask finance.", bodyMd: "Finance pays you.", status: "published", updatedAt: ago(1) };
    col("faqArticles").set("a-sem", d);
    await sem.syncRecord("faq", "a-sem", d);
    const session = { email: SAM, role: "editor", scopes: ["board.read"] };
    // While most of what is ranked has no semantic vector, none is used: the two kinds of score don't mix.
    assert.strictEqual((await sem.search(session, { query: "money back", sources: ["faq"] })).matched, 0);
    for (const id of ["a1", "a2"]) await sem.syncRecord("faq", id, col("faqArticles").get(id), { reembed: true });
    const stored = env.store.col("searchIndex").get("faq:a-sem");
    assert.ok(stored.embedder === "toy" && stored.chunks[0].v.length === 256, "the vector is stored with the chunk");
    const hit = await sem.search(session, { query: "money back", sources: ["faq"] });
    assert.deepStrictEqual(hit.hits.map((h) => h.id), ["a-sem"], "no word in common: found by meaning");
    fail = true;
    const keyword = await sem.search(session, { query: "reimbursed finance", sources: ["faq"] });
    assert.strictEqual(keyword.hits[0].id, "a-sem", "the embedder is down: keyword and local vectors still answer");
    const d2 = Object.assign({}, d, { summary: "Ask the finance team." });
    await sem.syncRecord("faq", "a-sem", d2);
    assert.strictEqual(env.store.col("searchIndex").get("faq:a-sem").embedder, null, "indexed without a semantic vector rather than not indexed");
    assert.ok(calls >= 3);
    // Back up: the changed chunk gets a vector again, and an unchanged chunk is never sent twice.
    fail = false;
    const before = calls;
    await sem.syncRecord("faq", "a-sem", d2, { reembed: true });
    assert.deepStrictEqual([env.store.col("searchIndex").get("faq:a-sem").embedder, calls - before], ["toy", 1], "re-embedded once it is reachable");
    await sem.syncRecord("faq", "a-sem", Object.assign({}, d2, { status: "draft" }));
    assert.deepStrictEqual([env.store.col("searchIndex").get("faq:a-sem").embedder, calls - before], ["toy", 1], "a status change keeps the vectors it has and asks for none");
    col("faqArticles").delete("a-sem");
    await sem.syncRecord("faq", "a-sem");
    ctx._expireRefresh();
  });

  // ── Response times ─────────────────────────────────────────────────────
  await test("response times over an index of 3,000 records: cached topic p95 < 300 ms, warm search p95 < 800 ms, a cold pack < 5 s", async () => {
    const words = ["playlist", "campaign", "exchange", "booking", "inventory", "advertiser", "screen", "template", "pricing", "offer", "store", "queue", "appointment", "signage", "audience", "segment"];
    for (let i = 0; i < 3000; i += 1) {
      const w = (k) => words[(i * 7 + k * 3) % words.length];
      const d = { projectId: i % 2 ? P_DSP : P_BT, title: `${w(0)} ${w(1)} improvement ${i}`, desc: `${w(2)} ${w(3)} ${w(4)}. `.repeat(12), status: i % 5 === 0 ? "published-live" : "backlog", type: "feature", createdAt: ago(100), updatedAt: ago(i % 90), notes: [] };
      col("backlogItems").set(`perf-${i}`, d);
      await ctx.syncRecord("ticket", `perf-${i}`, d);
    }
    assert.ok(ctx._mem.entries.size >= 3000);
    const timed = async (fn) => { const t0 = process.hrtime.bigint(); const out = await fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, out]; };
    // A cold pack, through the whole server (auth, tool, audit, store).
    const [coldMs, cold] = await timed(() => topic(kit, { topic: "playlist campaign exchange", refresh: true }));
    assert.strictEqual(cold.cache.tier, "cold");
    assert.ok(coldMs < 5000, `cold pack took ${coldMs.toFixed(0)} ms`);
    // The same topic again, 100 times: served from the cache.
    const cached = [];
    for (let i = 0; i < 100; i += 1) { const [msv, pack] = await timed(() => topic(kit, { topic: "playlist campaign exchange" })); assert.strictEqual(pack.cache.hit, true); cached.push(msv); }
    assert.ok(p95(cached) < 300, `cached get_topic_context p95 ${p95(cached).toFixed(1)} ms`);
    // 100 different searches over the warm index (none of them cached).
    const searches = [];
    for (let i = 0; i < 100; i += 1) { const [msv, r] = await timed(() => search(kit, { query: `${words[i % words.length]} ${words[(i * 5 + 1) % words.length]} ${i}`, sources: ["ticket"], limit: 10 })); assert.ok(r.cache === "none" && r.matched > 0); searches.push(msv); }
    assert.ok(p95(searches) < 800, `search_console p95 ${p95(searches).toFixed(1)} ms`);
    // And the timings are on record for review.
    const log = await tool(kit, "list_search_runs", { since: "1h", limit: 1 });
    assert.ok(log.json.summary.topic.cachedP95Ms < 300 && log.json.summary.search.p95Ms < 800 && log.json.summary.topic.coldP95Ms < 5000, JSON.stringify(log.json.summary));
    console.log(`        cold pack ${coldMs.toFixed(0)} ms · cached pack p95 ${p95(cached).toFixed(1)} ms · search p95 ${p95(searches).toFixed(1)} ms · ${ctx._mem.entries.size} records`);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
