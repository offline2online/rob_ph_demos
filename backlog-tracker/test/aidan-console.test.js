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
const { TOOLS } = mcp.__test;

const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const snapshot = () => JSON.stringify([...env.store.data].map(([k, v]) => [k, [...v]]));

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

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }
  console.log(failed ? `\n${failed} of ${checks.length} failed` : `\naidan-console: ${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
