// Aidan's read-only view of the console (functions/mcp-server.js →
// consoleReader, 1W4QQzYdlJzfdqizePWR): the real MCP read tools over stubbed
// Firestore (test/mcp-stubs.js), as functions/aidan.js uses them. The email
// side (plans, answers, recipients, the read-only reply) is in
// support-mail.test.js. No emulator, no credentials, no network.
// Run: node test/aidan-console.test.js
"use strict";
const assert = require("assert");
const { install } = require("./mcp-stubs");

process.env.GCLOUD_PROJECT = "backlog-tracker-e4ed2";
process.env.MCP_PUBLIC_ORIGIN = "https://backlog-tracker-e4ed2.web.app";

const env = install();
const mcp = require("../functions/mcp-server.js");
const ac = require("../functions/aidan-core.js");
// Code Mode runs in a REAL sandbox here (test/package.json installs isolated-vm).
require("../functions/code-mode").sandbox.setIsolatedVmPath(require.resolve("isolated-vm"));
const { TOOLS } = mcp.__test;

const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const snapshot = () => JSON.stringify([...env.store.data].map(([k, v]) => [k, [...v]]));
const snapshotWithout = (names) => JSON.stringify([...env.store.data].filter(([k]) => !names.includes(k)).map(([k, v]) => [k, [...v]]));

const BT = "oTcLAbnhUUO2S7NkbsuV";
const CONCEPT = "Cu5t0merSupp0rtC0ncp";
env.store.col("projects").set(BT, { name: "Backlog Tracker & FAQs", requirementsMd: "# Requirements\n\n## Support Inbox\n\nA draft is sent without a person only when sending is on and confidence is 80% or more.", readmeMd: "# Backlog Tracker\n" });
env.store.col("concepts").set(CONCEPT, { name: "Customer Support", status: "active", readmeMd: "# Customer Support\n\nAnswers support email.", requirementsMd: "CS-1 Reply within a day.", createdByEmail: "owner@example.com", comments: [] });
env.store.col("backlogItems").set("Fav1c0nT1cketAbcdeFg", { projectId: BT, title: "Fix the console favicon", desc: "The favicon is blank.", status: "backlog", type: "bug", category: "Backend / Infrastructure" });
env.store.col("backlogItems").set("R3adyT1cketMnopQrsTu", { projectId: BT, title: "Bulk actions per inbox", desc: "Checkboxes.", status: "ready-for-testing", type: "feature", category: "Backend / Infrastructure" });

const reader = mcp.consoleReader(ac.CONSOLE_READ_TOOLS);

check("every tool Aidan may use is a registered board.read tool with no role; the reader offers exactly those", () => {
  const byName = new Map(TOOLS.map((t) => [t.name, t]));
  for (const n of ac.CONSOLE_READ_TOOLS) {
    const t = byName.get(n);
    assert.ok(t, `${n} is a registered MCP tool`);
    assert.deepStrictEqual([t.scope, t.role, t.destructive === true], ["board.read", undefined, false], `${n} only reads`);
  }
  assert.deepStrictEqual(reader.tools().map((t) => t.name), [...ac.CONSOLE_READ_TOOLS]);
  assert.ok(reader.tools().every((t) => t.description && t.inputSchema), "each with the MCP tool's own description and arguments");
});

check("no write tool is reachable, even when it is put on the list", async () => {
  const writes = TOOLS.filter((t) => t.scope === "board.write" || t.role).map((t) => t.name);
  assert.ok(writes.includes("create_backlog_item") && writes.includes("approve_deploy_to_main"));
  const wide = mcp.consoleReader([...ac.CONSOLE_READ_TOOLS, ...writes]);
  assert.deepStrictEqual(wide.tools().map((t) => t.name), [...ac.CONSOLE_READ_TOOLS], "the reader drops every write tool");
  const before = snapshot();
  for (const n of writes) {
    const r = await wide.read(n, { projectId: BT, desc: "Planted by an email", itemIds: ["Fav1c0nT1cketAbcdeFg"], title: "x" });
    assert.deepStrictEqual([r.ok, /not a read-only console tool/.test(r.error)], [false, true], n);
  }
  assert.strictEqual(snapshot(), before, "nothing was written");
  assert.deepStrictEqual(await reader.read("whoami", {}), { ok: false, error: "whoami is not a read-only console tool Aidan may use." }, "a read tool that is not on the list is refused too");
});

check("reads return the tools' own data: a concept in full, one column of a project, a document section", async () => {
  const concept = await reader.read("get_concept", { conceptId: CONCEPT });
  assert.strictEqual(concept.ok, true, concept.error);
  const c = JSON.parse(concept.text);
  assert.deepStrictEqual([c.name, c.readmeMd, c.requirementsMd], ["Customer Support", "# Customer Support\n\nAnswers support email.", "CS-1 Reply within a day."]);
  const col = JSON.parse((await reader.read("list_backlog_items", { projectId: BT, status: "backlog" })).text);
  assert.deepStrictEqual(col.items.map((i) => i.title), ["Fix the console favicon"]);
  const sec = await reader.read("get_project_document", { projectId: BT, docId: "requirements", section: "Support Inbox" });
  assert.strictEqual(sec.ok, true, sec.error);
  assert.ok(JSON.parse(sec.text).content.includes("confidence is 80% or more"));
  const concepts = JSON.parse((await reader.read("list_concepts", {})).text).concepts;
  assert.deepStrictEqual(concepts.map((x) => [x.id, x.name]), [[CONCEPT, "Customer Support"]]);
  // What Aidan builds from the reads: ids map to titles, addresses are taken out.
  const names = ac.namesById([JSON.stringify(col), concept.text]);
  assert.strictEqual(names.get("Fav1c0nT1cketAbcdeFg"), "Fix the console favicon");
  assert.ok(!ac.consoleBlock([{ tool: "list_concepts", args: {}, ok: true, text: JSON.stringify({ concepts }) }]).includes("owner@example.com"));
});

check("arguments are cut to the tool's own schema; a missing required one, or a tool error, is a failed read", async () => {
  const r = await reader.read("list_backlog_items", { projectId: BT, status: "", limit: 5, desc: "not an argument" });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(JSON.parse(r.text).returned, 2, "an empty status means every column");
  assert.deepStrictEqual(await reader.read("get_concept", {}), { ok: false, error: "get_concept needs conceptId." });
  const missing = await reader.read("get_backlog_item", { itemId: "NoSuchT1cketAbcdeFgH" });
  assert.deepStrictEqual([missing.ok, /No ticket/.test(missing.error)], [false, true]);
  assert.strictEqual((await reader.read("get_concept", "not an object")).ok, false);
});

// ── Code Mode by default (IJhIIzTxOJyZVCzzYggZ) ──
const DSP = "mIPdOCAWevhrgD8g2tCZ";
env.store.col("projects").set(DSP, { name: "Display Types & DSP Integration", deployBranch: "deploy/dsp-integration" });
env.store.col("backlogItems").set("Dsp0neT1cketAbcdeFgh", { projectId: DSP, title: "Sell a play window per position", desc: "x", status: "backlog", type: "feature", category: "HQ Admin" });
env.store.col("backlogItems").set("Dsp7woT1cketAbcdeFgh", { projectId: DSP, title: "Partner API rate limits", desc: "y", status: "ready-for-testing", type: "feature", category: "Backend / Infrastructure", blocked: { reason: "waiting-on-input", note: "Needs the partner's limits" } });

check("Code Mode: Aidan's script tools are his own list cut to Code Mode's read-only allow-list; the description is the script's signatures", () => {
  const names = reader.scriptTools();
  assert.ok(names.includes("list_projects") && names.includes("list_backlog_items") && names.includes("list_leads") && names.includes("list_prospects"));
  assert.ok(!names.some((n) => /^kanban_/.test(n) || n === "get_skill" || n === "list_skills"), "Code Mode tools that aren't on Aidan's list are not his");
  assert.ok(names.every((n) => ac.CONSOLE_READ_TOOLS.includes(n)));
  const text = reader.describeScriptTools();
  assert.ok(text.includes("declare const tools") && text.includes("list_backlog_items(") && !text.includes("kanban_list_tasks("));
  assert.deepStrictEqual(reader.insights().map((i) => i.name).filter((n) => ac.AIDAN_INSIGHTS.includes(n)).sort(), [...ac.AIDAN_INSIGHTS].sort());
});

check("Code Mode: \"status summary of the DSP project\" is ONE sandboxed run, accurate against the board, audited as Aidan's", async () => {
  const runs = env.store.col("scriptRuns").size;
  const ins = await reader.insight("project_status", { projectId: "display types" }, { timeoutMs: ac.CONSOLE_SCRIPT_TIMEOUT_MS });
  assert.strictEqual(ins.ok, true, ins.error);
  const st = JSON.parse(ins.text);
  assert.strictEqual(JSON.stringify(st).includes("Display Types & DSP Integration"), true, "the project resolved by name");
  assert.ok(JSON.stringify(st).includes("Partner API rate limits"), "the blocker is the board's");
  assert.ok(ins.toolCalls.length >= 2, "one run, several reads inside it");
  assert.ok(/kanban_list_tasks is not available/.test(ins.text), "Staff Kanban is not Aidan's: refused inside the run, and the insight carries on without it");
  const code = `const r = await tools.list_backlog_items({ projectId: params.p || ${JSON.stringify(DSP)} });
    const by = {}; for (const i of r.items) by[i.statusLabel] = (by[i.statusLabel] || 0) + 1;
    return { matched: r.matched, by, blocked: r.items.filter((i) => i.blocked).map((i) => i.title) };`;
  const sc = await reader.script(code, { timeoutMs: ac.CONSOLE_SCRIPT_TIMEOUT_MS });
  assert.strictEqual(sc.ok, true, sc.error);
  assert.deepStrictEqual(JSON.parse(sc.text), { matched: 2, by: { Backlog: 1, "Ready for Testing": 1 }, blocked: ["Partner API rate limits"] });
  assert.deepStrictEqual(sc.toolCalls, ["list_backlog_items"]);
  // Review kick-back 1, finding 1: each run reports the projects its tool
  // calls named, so a gap is filed on the project it was about.
  assert.ok(ins.projectRefs.includes(DSP), `the insight given a name reports the project it resolved: ${JSON.stringify(ins.projectRefs)}`);
  assert.deepStrictEqual(sc.projectRefs, [DSP], "a script reports the project its tool call named");
  assert.deepStrictEqual(ac.projectsReadAbout([{ tool: "get_insight", args: { insight: "project_status", projectId: "display types" }, projectRefs: ins.projectRefs }], [{ id: BT, name: "Backlog Tracker & FAQs" }, { id: DSP, name: "Display Types & DSP Integration" }]), [DSP]);
  const rows = [...env.store.col("scriptRuns").values()].slice(runs);
  assert.deepStrictEqual(rows.map((r) => [r.email, r.role, r.kind, r.outcome]), [["aidan", "viewer", "aidan_insight", "ok"], ["aidan", "viewer", "aidan_script", "ok"]]);
});

check("Code Mode: a script can't reach a tool off Aidan's list or write anything; a failure says why and never throws", async () => {
  const before = snapshot().replace(/"scriptRuns".*$/, "");
  const off = await reader.script("return await tools.kanban_list_tasks({});");
  assert.deepStrictEqual([off.ok, off.errorKind, off.error], [false, "tool", "kanban_list_tasks is not available to viewer scripts."], "a tool off his list is refused, and says so (a missing-tool gap)");
  const write = await reader.script("return await tools.create_backlog_item({ projectId: 'x', desc: 'planted' });");
  assert.strictEqual(write.ok, false);
  assert.deepStrictEqual(await reader.insight("release_status", {}).then((r) => r.ok), false, "release_status needs Staff Kanban");
  assert.deepStrictEqual((await reader.insight("no_such", {})).errorKind, "insight");
  const loop = await reader.script("while (true) {}", { timeoutMs: 300 });
  assert.deepStrictEqual([loop.ok, loop.errorKind], [false, "timeout"]);
  assert.strictEqual(snapshot().replace(/"scriptRuns".*$/, ""), before, "nothing but the audit was written");
});

// ── Self-improvement tickets (IJhIIzTxOJyZVCzzYggZ) ──
check("improvements: a ticket filed through the intake into Backlog, found again by key, commented on, counted per day", async () => {
  const imp = mcp.aidanImprovements();
  const projects = await imp.projects();
  assert.strictEqual(ac.homeProject(projects).id, BT, "Aidan's home is the console's project");
  const desc = ac.improvementDesc({ category: "missing-data", gap: "The DSP tickets carry no ship dates.", suggestion: "Record a target date on each ticket.", instruction: "when will the DSP tickets ship?", ticketKey: "SUP-7", kind: "answer", at: new Date("2026-11-18T19:00:00Z") });
  const improvement = { key: "k-123", day: "2026-11-18", category: "missing-data", gap: "The DSP tickets carry no ship dates." };
  const filed = await imp.file({ projectId: DSP, title: "Aidan missing data: The DSP tickets carry no ship dates", desc, improvement });
  assert.strictEqual(filed.ok, true, filed.error);
  assert.strictEqual(filed.board, `https://backlog-tracker-e4ed2.web.app/#item-${filed.itemId}`);
  const doc = env.store.col("backlogItems").get(filed.itemId);
  assert.deepStrictEqual([doc.projectId, doc.status, doc.createdVia, doc.aidanImprovementKey, doc.aidanImprovementDay, doc.blocked], [DSP, "backlog", "aidan", "k-123", "2026-11-18", undefined]);
  assert.ok(doc.desc.startsWith(`## Outcome\n${ac.IMPROVEMENT_OUTCOMES["missing-data"]}`) && doc.desc.includes(`\n${ac.REPORTED_LABEL}\n> Gap: Missing data.`) && doc.desc.includes("## Test steps\n_To be completed by the build session"), "intake-shaped: a fixed Outcome, the reported gap labelled, the rest left for the build");
  assert.ok(!("model" in doc) && !("deployCommit" in doc) && !("patchReady" in doc), "no pipeline field");
  assert.deepStrictEqual((await imp.byKey("k-123")).map((t) => t.id), [filed.itemId]);
  assert.ok((await imp.openTickets(DSP)).some((t) => t.id === filed.itemId && t.aidanImprovement.category === "missing-data"));
  assert.strictEqual(await imp.filedOn("2026-11-18"), 1);
  await imp.comment(filed.itemId, "Aidan hit this again: still no dates.");
  await imp.comment(filed.itemId, "Aidan hit this again: and again.");
  const notes = env.store.col("backlogItems").get(filed.itemId).notes;
  assert.deepStrictEqual(notes.map((n) => [n.author, n.text]), [["aidan", "Filed by Aidan's self-check after a run that didn't fully or well meet a request."], ["aidan", "Aidan hit this again: still no dates."], ["aidan", "Aidan hit this again: and again."]], "comments are appended");
  await assert.rejects(imp.comment("D3letedT1cketAbcdeFg", "Aidan hit this again: gone."), "a comment on a deleted ticket fails");
  assert.strictEqual(env.store.col("backlogItems").has("D3letedT1cketAbcdeFg"), false, "and never recreates it");
  env.store.col("backlogItems").set(filed.itemId, Object.assign({}, env.store.col("backlogItems").get(filed.itemId), { status: "published-live" }));
  assert.deepStrictEqual(await imp.byKey("k-123"), [], "a shipped ticket is not open: the next gap files again");
  assert.strictEqual((await imp.file({ projectId: "NoSuchProject", desc, improvement })).ok, false);
});

// ── PH Agent Context: context first, from the cache ──
check("PH Agent Context: Aidan's script tools now reach documents, critiques, the search, topic context, Support threads and run history", () => {
  const names = reader.scriptTools();
  for (const n of ["list_project_documents", "get_project_document", "list_concept_critiques", "search_console", "get_topic_context", "list_support_threads", "get_support_thread", "list_aidan_runs", "list_script_runs"]) assert.ok(names.includes(n), `${n} is one of Aidan's script tools`);
  assert.ok(ac.SCRIPT_COVERED_READS.every((n) => n === "get_project_docs" || names.includes(n)), "what is no longer a single read is reachable from the script");
  assert.ok(reader.insights().some((i) => i.name === "topic_context") && ac.AIDAN_INSIGHTS.includes("topic_context"));
});

check("PH Agent Context: a repeat question on a topic is served from the cache, with no read of any source collection", async () => {
  await mcp.context.backfill();
  mcp.context._hot.clear();
  const ask = async () => { const r = await reader.read("get_topic_context", { topic: "Display Types" }); assert.strictEqual(r.ok, true, r.error); return JSON.parse(r.text); };
  const first = await ask();
  assert.deepStrictEqual([first.kind, first.entity.id, first.cache.tier, first.cache.hit], ["project", DSP, "cold", false], "the first question builds the pack");
  assert.ok(first.records.ticket.shown.some((x) => x.title === "Partner API rate limits") && first.blockers.shown.length === 1);
  env.store.reads.clear();
  const again = await ask();
  assert.deepStrictEqual([again.cache.tier, again.cache.hit], ["hot", true], "the repeat is a cache hit");
  assert.deepStrictEqual(again.records, first.records, "with the same records");
  for (const c of ["backlogItems", "projects", "concepts", "projectDocs", "interfaces", "leads", "prospects", "supportTickets", "faqArticles", "searchIndex", "topicContext"]) assert.ok(!env.store.reads.get(c), `${c} was not read (${env.store.reads.get(c)})`);
  // Another mail-function instance (its own memory): the pack comes from the warm tier.
  mcp.context._hot.clear();
  env.store.reads.clear();
  const warm = await ask();
  assert.deepStrictEqual([warm.cache.tier, warm.cache.hit], ["warm", true]);
  assert.ok(!env.store.reads.get("backlogItems"), "still no ticket read");
  // The pack is the viewer stand-in's own (the role is in the key), and each call is audited as Aidan's.
  const packs = [...env.store.col("topicContext").values()].filter((d) => d.ref === `project:${DSP}`);
  assert.deepStrictEqual(packs.map((d) => [d.role, d.usedBy.includes("aidan-email"), d.hits >= 1, d.misses]), [["viewer", true, true, 1]]);
  const audits = [...env.store.col("searchRuns").values()].filter((r) => r.email === "aidan");
  assert.deepStrictEqual(audits.slice(-3).map((r) => [r.kind, r.via, r.cacheTier]), [["topic", "aidan-email", "cold"], ["topic", "aidan-email", "hot"], ["topic", "aidan-email", "warm"]]);
  // No gap in a run like this one.
  assert.strictEqual(ac.contextGap([{ tool: "get_topic_context", args: { topic: "Display Types" }, ok: true, text: JSON.stringify(again) }]), null);
});

check("PH Agent Context: the topics of a thread are written back to the cache, and search_console answers inside Aidan's one Code Mode run", async () => {
  const before = env.store.col("topicContext").size;
  assert.strictEqual(await reader.rememberTopics(["Backlog Tracker & FAQs", "favicon", "favicon", "", null]), 2, "each topic once");
  const added = [...env.store.col("topicContext").values()].slice(before);
  assert.deepStrictEqual(added.map((d) => [d.ref, d.role, d.stale, d.pack, d.usedBy]).sort(), [[`project:${BT}`, "viewer", true, null, ["aidan-email"]], ["text:favicon", "viewer", true, null, ["aidan-email"]]].sort(), "kept as stubs for the prewarm to build");
  const stub = added.find((d) => d.ref === "text:favicon");
  assert.deepStrictEqual(await mcp.context.triggers.find((t) => t.name === "contextPrewarmTopic").run({ id: stub.key }, null, stub), { built: true, tier: "cold" });
  mcp.context._hot.clear();
  const pack = JSON.parse((await reader.read("get_topic_context", { topic: "favicon" })).text);
  assert.deepStrictEqual([pack.cache.tier, pack.records.ticket.shown[0].title], ["warm", "Fix the console favicon"], "ready before the next question");
  assert.strictEqual(await mcp.consoleReader(["list_projects"]).rememberTopics(["favicon"]), 0, "a reader without the context tools remembers nothing");
  const run = await reader.script("const r = await tools.search_console({ query: 'rate limits', sources: ['ticket'] }); return r.hits.map((h) => h.title);", { timeoutMs: ac.CONSOLE_SCRIPT_TIMEOUT_MS });
  assert.deepStrictEqual([run.ok, JSON.parse(run.text)], [true, ["Partner API rate limits"]]);
  const before2 = snapshotWithout(["searchRuns", "topicContext", "scriptRuns", "searchIndex", "searchIndexState"]);
  await reader.read("search_console", { query: "favicon" });
  assert.strictEqual(snapshotWithout(["searchRuns", "topicContext", "scriptRuns", "searchIndex", "searchIndexState"]), before2, "a search writes nothing but its audit row and the topic cache");
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }
  console.log(failed ? `\n${failed} of ${checks.length} failed` : `\naidan-console: ${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
