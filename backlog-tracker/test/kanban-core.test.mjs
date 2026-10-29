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
console.log(`\n${n} passed`);
