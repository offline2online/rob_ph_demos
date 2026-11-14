// The board's flake ledger (scripts/flaky-ledger.js) and the automation's
// update of it from a run's flaky-tests artifact (updateFlakyLedger in
// run-backlog-automation.js). No network: every reader and writer is a stub.
//   cd backlog-tracker/test && node flaky-ledger.test.js
const assert = require("assert");
const L = require("../scripts/flaky-ledger.js");
const { updateFlakyLedger, FLAKY_LEDGER_PROJECT_ID, FLAKY_ARTIFACT_WORKFLOWS } = require("../scripts/run-backlog-automation.js");

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-11-14T10:00:00Z");
let n = 0;
const ok = (name) => { n += 1; console.log(`  ok  ${name}`); };

// A sample artifact, as ui/flaky-report.mjs writes it.
const artifact = (rows) => JSON.stringify({ generatedAt: new Date(T0).toISOString(), runUrl: "https://github.com/o/r/actions/runs/1", flaky: rows });
const row = (id, profile = "desktop-1280", at = T0) => ({ suite: "staff-kanban-console", id, profile, error: `${id} lost a frame`, at: new Date(at).toISOString() });

// flakesFromArtifact: the report, the jsonl it came from, and junk.
{
  assert.deepStrictEqual(L.flakesFromArtifact(artifact([row("TC-55")])).map((f) => [f.id, f.profile, f.suite]), [["TC-55", "desktop-1280", "staff-kanban-console"]]);
  assert.strictEqual(L.flakesFromArtifact(`${JSON.stringify(row("A"))}\nnot json\n${JSON.stringify(row("B"))}\n`).length, 2);
  assert.deepStrictEqual(L.flakesFromArtifact(""), []);
  assert.deepStrictEqual(L.flakesFromArtifact("{\"flaky\":[{\"id\":\"\"},{\"nope\":1},null]}"), []);
  assert.deepStrictEqual(L.flakesFromArtifact("<html>"), []);
  ok("an artifact is read as flakes; anything else is dropped");
}

// applyRun: counts, last seen, last run URL; the same run twice counts once.
{
  let { ledger, changed } = L.applyRun(null, { runId: 1, runUrl: "u/1", flakes: [row("TC-55"), row("KB-C13", "phone-390")], now: T0 });
  assert.ok(changed);
  assert.deepStrictEqual(ledger.cases.map((c) => [c.id, c.count, c.lastRunUrl]), [["TC-55", 1, "u/1"], ["KB-C13", 1, "u/1"]]);
  assert.deepStrictEqual(ledger.processedRuns, ["1"]);
  const again = L.applyRun(ledger, { runId: 1, runUrl: "u/1", flakes: [row("TC-55")], now: T0 });
  assert.strictEqual(again.changed, false);
  assert.strictEqual(again.ledger, ledger);
  ({ ledger } = L.applyRun(ledger, { runId: 2, runUrl: "u/2", flakes: [row("TC-55", "tablet-820", T0 + DAY)], now: T0 + DAY }));
  const c = ledger.cases[0];
  assert.deepStrictEqual([c.id, c.count, c.lastRunUrl, c.profile, c.lastSeenAt], ["TC-55", 2, "u/2", "tablet-820", new Date(T0 + DAY).toISOString()]);
  // A run with no flakes is still remembered, so its artifact is not downloaded again.
  const none = L.applyRun(ledger, { runId: 3, runUrl: "u/3", flakes: [], now: T0 + DAY });
  assert.ok(none.changed && none.ledger.processedRuns.includes("3") && none.ledger.cases.length === 2);
  ok("a run's flakes are counted once, with last seen and the run's URL");
}

// Capped at the 50 most recent cases.
{
  let ledger = null;
  for (let i = 0; i < 60; i++) ({ ledger } = L.applyRun(ledger, { runId: 100 + i, flakes: [row(`CASE-${i}`, "", T0 + i * 1000)], now: T0 + i * 1000 }));
  assert.strictEqual(ledger.cases.length, L.MAX_CASES);
  assert.strictEqual(ledger.cases[0].id, "CASE-59");
  assert.ok(!ledger.cases.some((c) => c.id === "CASE-9"), "the oldest cases fall off");
  ok("the ledger keeps the 50 most recent cases");
}

// The week: flakes in the last 7 days; three in 7 days needs a ticket, an open one stops a second.
{
  let ledger = null;
  ({ ledger } = L.applyRun(ledger, { runId: 1, flakes: [row("TC-55", "", T0 - 9 * DAY)], now: T0 - 9 * DAY }));
  ({ ledger } = L.applyRun(ledger, { runId: 2, flakes: [row("TC-55", "", T0 - 2 * DAY)], now: T0 - 2 * DAY }));
  ({ ledger } = L.applyRun(ledger, { runId: 3, flakes: [row("TC-55", "", T0 - DAY)], now: T0 - DAY }));
  assert.strictEqual(L.flakesThisWeek(ledger, T0), 2, "the flake nine days ago is outside the week");
  assert.deepStrictEqual(L.casesNeedingTicket(ledger, { now: T0 }), [], "three in total but only two in 7 days: no ticket");
  ({ ledger } = L.applyRun(ledger, { runId: 4, flakes: [row("TC-55", "", T0)], now: T0 }));
  assert.deepStrictEqual(L.casesNeedingTicket(ledger, { now: T0 }).map((c) => c.id), ["TC-55"]);
  const title = L.flakyTicketTitle("TC-55");
  assert.strictEqual(title, "Flaky test: TC-55");
  for (const status of L.OPEN_STATUSES) assert.deepStrictEqual(L.casesNeedingTicket(ledger, { now: T0, openTickets: [{ id: "t", title, status }] }), [], `an open ticket (${status}) stops a second`);
  for (const status of ["published-live", "archived"]) assert.strictEqual(L.casesNeedingTicket(ledger, { now: T0, openTickets: [{ id: "t", title, status }] }).length, 1, `a ${status} ticket does not`);
  const desc = L.flakyTicketDesc(ledger.cases[0], T0);
  for (const h of ["## Outcome", "## Test steps", "## Dependencies", "## Spec reference"]) assert.ok(desc.includes(h), `the ticket has ${h}`);
  assert.ok(!/To be completed by the build session|Not provided/.test(desc), "no intake placeholder");
  ok("three flakes in 7 days need one ticket; an open one stops a second");
}

// The automation's update, from sample artifacts: the third flake in 7 days files exactly one
// ticket, and a fourth files none while it is open.
(async () => {
  const store = { ledger: null, tickets: [], created: [] };
  const runsByWorkflow = { "firestore-rules-test.yml": [], "kanban-staff-board-tests.yml": [] };
  const artifacts = {};
  let now = T0;
  const io = {
    getLedger: async () => store.ledger,
    putLedger: async (l) => { store.ledger = JSON.parse(JSON.stringify(l)); },
    listRuns: async (wf) => runsByWorkflow[wf],
    readFlakes: async (id) => L.flakesFromArtifact(artifacts[id] || ""),
    openTickets: async () => store.tickets,
    createTicket: async (fields) => { const id = `ticket${store.created.length + 1}`; store.created.push(fields); store.tickets.push({ id, title: fields.title, status: fields.status }); return id; },
    now: () => now,
  };
  const addRun = (wf, id, rows) => { runsByWorkflow[wf].push({ id, url: `https://github.com/o/r/actions/runs/${id}` }); artifacts[id] = artifact(rows); };
  assert.deepStrictEqual(FLAKY_ARTIFACT_WORKFLOWS, ["firestore-rules-test.yml", "kanban-staff-board-tests.yml"]);

  addRun("firestore-rules-test.yml", 11, [row("TC-55", "desktop-1280", now)]);
  let out = await updateFlakyLedger(io);
  assert.deepStrictEqual([out.runs, out.flakes, out.filed.length], [1, 1, 0]);
  assert.strictEqual(store.ledger.cases[0].lastRunUrl, "https://github.com/o/r/actions/runs/11");

  now = T0 + DAY;
  addRun("kanban-staff-board-tests.yml", 12, [row("TC-55", "phone-390", now), row("KB-C13", "phone-390", now)]);
  out = await updateFlakyLedger(io);
  assert.deepStrictEqual([out.runs, out.flakes, out.filed.length], [1, 2, 0], "run 11 is not read again; two flakes of TC-55 file nothing");

  now = T0 + 2 * DAY;
  addRun("firestore-rules-test.yml", 13, [row("TC-55", "tablet-820", now)]);
  out = await updateFlakyLedger(io);
  assert.deepStrictEqual(out.filed, [{ caseId: "TC-55", ticketId: "ticket1" }], "the third flake in 7 days files one ticket");
  assert.strictEqual(store.created.length, 1);
  const t = store.created[0];
  assert.deepStrictEqual([t.title, t.projectId, t.status, t.type, t.flakyCaseId], ["Flaky test: TC-55", FLAKY_LEDGER_PROJECT_ID, "backlog", "bug", "TC-55"]);
  assert.ok(t.desc.includes("## Outcome") && t.desc.includes("runs/13"));
  assert.strictEqual(store.ledger.cases.find((c) => c.id === "TC-55").ticketId, "ticket1");
  assert.strictEqual(store.ledger.cases.find((c) => c.id === "TC-55").count, 3);

  now = T0 + 3 * DAY;
  addRun("firestore-rules-test.yml", 14, [row("TC-55", "desktop-1024", now)]);
  out = await updateFlakyLedger(io);
  assert.deepStrictEqual([out.flakes, out.filed.length, store.created.length], [1, 0, 1], "a fourth flake files none while the ticket is open");
  assert.strictEqual(store.ledger.cases.find((c) => c.id === "TC-55").count, 4);

  // Nothing new: nothing written.
  const before = JSON.stringify(store.ledger);
  out = await updateFlakyLedger(io);
  assert.deepStrictEqual([out.runs, out.flakes, out.filed.length], [0, 0, 0]);
  assert.strictEqual(JSON.stringify(store.ledger), before);

  // Once the ticket has shipped, a case that is still flaking gets a new one.
  store.tickets[0].status = "published-live";
  out = await updateFlakyLedger(io);
  assert.strictEqual(out.filed.length, 1, "a shipped ticket no longer counts as open");
  ok("the automation's ledger update: one ticket at the third flake, none at the fourth while it is open");

  console.log(`flaky-ledger: ${n} checks passed`);
})().catch((err) => { console.error(err); process.exit(1); });
