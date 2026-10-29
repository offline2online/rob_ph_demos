// Unit tests for public/js/kanban/kanban-core.js, the Staff Kanban rules the
// page, the MCP tools and the tests share.   node kanban-core.test.mjs
import assert from "node:assert/strict";
import * as k from "../public/js/kanban/kanban-core.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

t("durations: 1d = 8h; formats round to the half hour", () => {
  assert.equal(k.parseDur("1d 4h"), 12); assert.equal(k.parseDur("1d4h"), 12); assert.equal(k.parseDur("30m"), 0.5);
  assert.equal(k.parseDur("6"), 6); assert.equal(k.parseDur(""), null); assert.ok(Number.isNaN(k.parseDur("soon"))); assert.ok(Number.isNaN(k.parseDur("2h then 3x")));
  assert.equal(k.fmtH(12), "1d 4h"); assert.equal(k.fmtH(0.5), "0.5h"); assert.equal(k.fmtH(0), "0h"); assert.equal(k.fmtH(""), "—");
});
t("the testing hand-off: to the tester, and back to the developer", () => {
  const first = (e) => e.split("@")[0];
  const a = k.statusChange({ status: "in-progress", assignee: "duc@x" }, "ready-for-testing", { tester: "rob@x", firstName: first });
  assert.deepEqual(a.patch, { status: "ready-for-testing", resolution: null, open: true, previousAssignee: "duc@x", assignee: "rob@x" });
  assert.equal(a.activity, "In Progress → Ready for Testing · reassigned to rob for testing");
  const b = k.statusChange({ status: "ready-for-testing", assignee: "rob@x", previousAssignee: "duc@x" }, "in-progress", { tester: "rob@x", firstName: first });
  assert.equal(b.patch.assignee, "duc@x");
  assert.equal(k.statusChange({ status: "backlog" }, "backlog", {}), null);
  const w = k.statusChange({ status: "approved" }, "done", { resolution: "withdrawn" });
  assert.deepEqual([w.patch.open, w.patch.resolution, w.activity], [false, "withdrawn", "Approved for Deployment → Withdrawn"]);
  assert.equal(k.statusChange({ status: "approved" }, "done", {}).resolution, "completed");
});
t("search: exact key, title words, description words; tokens and the server query word", () => {
  const list = [
    { key: "PH-36", title: "Help Centre search returns archived articles", descriptionText: "" },
    { key: "PH-24", title: "Exchange: two winners", descriptionText: "Seen on SQLite under load" },
    { key: "PH-3", title: "Help Centre migration", descriptionText: "" },
  ];
  assert.equal(k.searchTickets(list, "36")[0].t.key, "PH-36");
  assert.equal(k.searchTickets(list, "ph-3")[0].t.key, "PH-3");
  assert.deepEqual(k.searchTickets(list, "archived articles").map((r) => r.t.key), ["PH-36"]);
  const sq = k.searchTickets(list, "sqlite"); assert.equal(sq[0].t.key, "PH-24"); assert.equal(sq[0].where, "desc");
  const tok = k.searchTokens({ key: "PH-36", title: "Đức's archived articles", labels: ["help-centre"], descriptionText: "returns stuff" });
  for (const x of ["36", "ph-36", "ar", "archived", "duc", "help-centre", "returns"]) assert.ok(tok.includes(x), x);
  assert.equal(k.queryToken("PH-36"), "36"); assert.equal(k.queryToken("old archived note"), "archived");
});
t("release report: outstanding, remaining, capacity, epics left out", () => {
  const tasks = [
    { key: "PH-1", type: "epic", status: "in-progress", release: "r", estimate: 100 },
    { key: "PH-2", type: "task", status: "in-progress", release: "r", assignee: "a@x", estimate: 10, logged: 4 },
    { key: "PH-3", type: "bug", status: "done", resolution: "withdrawn", release: "r", assignee: "a@x", estimate: 5 },
    { key: "PH-4", type: "task", status: "backlog", release: "other", estimate: 8 },
  ];
  const r = k.releaseReport(tasks, { release: "r" }, { people: ["a@x"], releaseDate: "2026-10-28", today: new Date("2026-10-21T12:00:00") });
  assert.equal(r.outstanding.length, 1); assert.equal(r.totals.remaining, 6); assert.equal(r.totals.withdrawn, 1);
  assert.equal(r.workingDays, 5); assert.equal(r.capacityPerPerson, 30);
});
t("settings: release is never required, even if saved so", () => {
  assert.equal(k.normaliseSettings({ fields: { release: { show: true, required: true } } }).fields.release.required, false);
  assert.equal(k.defaultFields().release.required, false);
});
t("settings: an unset tester defaults to Rob; a stored one wins (TC-47)", () => {
  const d = k.normaliseSettings(null);
  assert.equal(d.tester, "rob@offline2online.com"); assert.equal(d.testerIsDefault, true);
  assert.equal(k.normaliseSettings({ tester: "" }).tester, k.DEFAULT_TESTER);
  const s = k.normaliseSettings({ tester: "huy@x" });
  assert.equal(s.tester, "huy@x"); assert.equal(s.testerIsDefault, false);
  const ch = k.statusChange({ status: "in-progress", assignee: "duong@x" }, "ready-for-testing", { tester: d.tester });
  assert.equal(ch.patch.assignee, "rob@offline2online.com"); assert.match(ch.note, /reassigned to .* for testing/);
});
t("settings: an unset current release is the earliest unreleased by version (TC-47)", () => {
  const rels = [{ id: "a", version: "4.12", released: false, order: 1 }, { id: "b", version: "4.9", released: false, order: 2 }, { id: "c", version: "4.1", released: true, order: 3 }];
  assert.equal(k.currentReleaseId({ currentRelease: "" }, rels), "b");
  assert.equal(k.currentReleaseId({ currentRelease: "a" }, rels), "a");
  assert.equal(k.currentReleaseId({}, []), "");
});
t("settings: core fields always shown, title and status always required", () => {
  const s = k.normaliseSettings({ fields: { title: { show: false, required: false }, sprint: { show: false, required: true } }, firstNames: { "h@x": "Huy" } });
  assert.deepEqual(s.fields.title, { show: true, required: true });
  assert.equal(s.fields.sprint.required, false, "a hidden field can't be required");
  assert.equal(s.firstNames["h@x"], "Huy");
});
t("project: a ticket's project is a bounded string, filters, and rides on the card", () => {
  assert.equal(k.cleanTaskFields({ title: "x", project: " p1 " }).value.project, "p1");
  assert.match(k.cleanTaskFields({ title: "x", project: "p".repeat(101) }).errors.join(), /project is limited to 100/);
  const list = [{ key: "PH-1", project: "p1" }, { key: "PH-2", project: "" }, { key: "PH-3" }];
  assert.deepEqual(k.filterTasks(list, { project: "p1" }).map((t) => t.key), ["PH-1"]);
  assert.equal(k.filterTasks(list, {}).length, 3);
  assert.equal(k.cardOf({ key: "PH-1", project: "p1" }).project, "p1");
  assert.equal(k.cardOf({ key: "PH-3" }).project, "");
  assert.equal(k.cardPatchOf({ project: "p2" }).project, "p2");
  assert.ok(k.OPTIONAL_FIELDS.some((f) => f.key === "project") && k.normaliseSettings(null).fields.project.show === true);
});
t("local agent fill reads people, priority, estimate, release and type", () => {
  const out = k.agentDraft("there's a bug where the preview shows the wrong price. it's urgent. assign it to Huy. it should take about four hours for the next release", {
    users: [{ id: "huy@x", first: "Huy" }], releases: [{ id: "r1", name: "PH 4.12" }, { id: "r2", name: "PH 4.13" }], currentRelease: "r1", today: new Date("2026-10-21T12:00:00"),
  });
  assert.deepEqual([out.type, out.priority, out.assignee, out.estimate, out.release], ["bug", "highest", "huy@x", 4, "r2"]);
  assert.match(out.title, /^Preview shows the wrong price/);
});
t("an alias address is its owner", () => {
  assert.equal(k.canonicalEmail(" Rob@PersonalisationHub.com "), "rob@offline2online.com");
  assert.equal(k.canonicalEmail("huy@x"), "huy@x");
  assert.equal(k.canonicalEmail(""), "");
  assert.equal(k.isAliasEmail("rob@personalisationhub.com"), true);
  assert.equal(k.isAliasEmail("rob@offline2online.com"), false);
});
t("local agent fill gives a note the speaker means for themselves to the speaker", () => {
  const users = [{ id: "rob@offline2online.com", first: "Rob" }, { id: "huy@x", first: "Huy" }];
  const today = new Date("2026-10-21T12:00:00");
  for (const note of ["I need to send the release notes to the client", "remind me to chase the DSP contract", "add a task for myself to review the FAQ", "assign it to me: review the pricing page"]) {
    assert.equal(k.agentDraft(note, { users, me: "rob@offline2online.com", today }).assignee, "rob@offline2online.com", note);
  }
  // signed in as the alias, it is still the owner
  assert.equal(k.agentDraft("I need to call the printer", { users, me: "rob@personalisationhub.com", today }).assignee, "rob@offline2online.com");
  // someone named wins, and without a speaker nothing is guessed
  assert.equal(k.agentDraft("I need Huy to look at this, assign it to Huy", { users, me: "rob@offline2online.com", today }).assignee, "huy@x");
  assert.equal(k.agentDraft("I need to call the printer", { users, today }).assignee, undefined);
});
t("field validation names what's wrong", () => {
  const { errors, value } = k.cleanTaskFields({ title: "x", estimate: "1d", assignee: "Huy", labels: ["Menu Boards", "menu-boards"] });
  assert.deepEqual(errors, ["assignee must be an email"]); assert.equal(value.estimate, 8); assert.deepEqual(value.labels, ["menu-boards"]);
});
t("acceptance criteria: cleaned, stored as id/done/text lines, counted, diffed and carried on the card", () => {
  const { value, errors } = k.cleanCriteria(["  First\n item ", { text: "Second", done: true }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(value.map((c) => [c.text, c.done]), [["First item", false], ["Second", true]]);
  assert.ok(value.every((c) => /^[a-z0-9]{8}$/.test(c.id)) && value[0].id !== value[1].id);
  const stored = k.encodeCriteria(value);
  assert.ok(stored.every((l) => /^[a-z0-9]{8}\t[01]\t[^\t\n]+$/.test(l)));
  assert.deepEqual(k.decodeCriteria(stored), value);
  assert.deepEqual(k.acCounts(stored), { total: 2, done: 1 });
  assert.deepEqual(k.acCounts(value), { total: 2, done: 1 });
  // unchanged text keeps its id (and a list sent again is the same list)
  const again = k.cleanCriteria(["Second", "Brand new"], stored).value;
  assert.equal(again[0].id, value[1].id); assert.notEqual(again[1].id, value[0].id);
  // limits
  assert.match(k.cleanCriteria(Array.from({ length: 51 }, (_, i) => "c" + i)).errors.join(), /limited to 50 items/);
  assert.deepEqual(k.cleanCriteria(Array.from({ length: 50 }, (_, i) => "c" + i)).errors, []);
  assert.match(k.cleanCriteria(["x".repeat(501)]).errors.join(), /limited to 500 characters/);
  assert.deepEqual(k.cleanCriteria(["x".repeat(500)]).errors, []);
  assert.match(k.cleanCriteria(["ok", "   "]).errors.join(), /item 2 is empty/);
  assert.match(k.cleanCriteria("nope").errors.join(), /must be a list/);
  assert.deepEqual(k.cleanTaskFields({ title: "x", acceptanceCriteria: ["a"] }).value.acceptanceCriteria.map((c) => c.text), ["a"]);
  assert.match(k.cleanTaskFields({ title: "x", acceptanceCriteria: ["x".repeat(501)] }).errors.join(), /500 characters/);
  // the card carries the counts, never the text
  const card = k.cardOf({ key: "PH-1", acceptanceCriteria: stored });
  assert.equal(card.acTotal, 2); assert.equal(card.acDone, 1); assert.ok(!("acceptanceCriteria" in card));
  assert.equal(k.cardOf({ key: "PH-1" }).acTotal, 0);
  assert.equal(k.cardOf({ key: "PH-1", acTotal: 4, acDone: 3 }).acDone, 3, "a card read back keeps its counts");
  assert.deepEqual([k.cardPatchOf({ acceptanceCriteria: stored }).acTotal, k.cardPatchOf({ acceptanceCriteria: stored }).acDone], [2, 1]);
  assert.ok(k.CARD_FIELDS.includes("acTotal") && k.CARD_FIELDS.includes("acDone"));
  // activity lines
  const after = value.map((c) => ({ ...c })); after[0].done = true; after[1].text = "Second, reworded"; after.push({ id: "zzzzzzzz", text: "Third", done: false });
  assert.deepEqual(k.diffCriteria(value, after), ['ticked criterion "First item"', 'edited criterion "Second" → "Second, reworded"', 'added criterion "Third"']);
  assert.ok(k.diffCriteria(value, after).includes('ticked criterion "First item"'));
  assert.deepEqual(k.diffCriteria(value, [value[1], value[0]]), ["reordered the acceptance criteria"]);
  assert.deepEqual(k.diffCriteria(value, value), []);
});
console.log(`\n${n} passed`);
