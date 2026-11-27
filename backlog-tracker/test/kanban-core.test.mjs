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
t("no global tester: the ticket's own, else the chosen one, else the assignee stays", () => {
  const d = k.normaliseSettings(null);
  assert.equal(d.tester, undefined); assert.equal(k.DEFAULT_TESTER, undefined);
  const none = k.statusChange({ status: "in-progress", assignee: "duong@x" }, "ready-for-testing", {});
  assert.equal(none.patch.assignee, undefined); assert.equal(none.note, "");
  const chosen = k.statusChange({ status: "in-progress", assignee: "duong@x" }, "ready-for-testing", { tester: "thuc@x" });
  assert.equal(chosen.patch.assignee, "thuc@x"); assert.match(chosen.note, /reassigned to .* for testing/);
  const own = k.statusChange({ status: "in-progress", assignee: "duong@x", tester: "thuc@x" }, "ready-for-testing", { tester: "huy@x" });
  assert.equal(own.patch.assignee, "thuc@x");
});
t("settings: an unset current release is the earliest unreleased by version (TC-47)", () => {
  const rels = [{ id: "a", version: "4.12", released: false, order: 1 }, { id: "b", version: "4.9", released: false, order: 2 }, { id: "c", version: "4.1", released: true, order: 3 }];
  assert.equal(k.currentReleaseId({ currentRelease: "" }, rels), "b");
  assert.equal(k.currentReleaseId({ currentRelease: "a" }, rels), "a");
  assert.equal(k.currentReleaseId({}, []), "");
});
t("settings: Attachments are always on the create and edit forms, even if saved hidden", () => {
  assert.equal(k.defaultFields().attachments.show, true);
  assert.equal(k.normaliseSettings({ fields: { attachments: { show: false, required: true } } }).fields.attachments.show, true);
  assert.equal(k.normaliseSettings({ fields: { attachments: { show: false, required: true } } }).fields.attachments.required, false, "never required");
  assert.ok(k.OPTIONAL_FIELDS.find((f) => f.key === "attachments").lockShow);
  assert.equal(k.normaliseSettings({ fields: { sprint: { show: false, required: false } } }).fields.sprint.show, false, "other optional fields can still be hidden");
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
t("an alias address is its owner (the map is config, handed in at run time)", () => {
  assert.equal(k.isAliasEmail("owner.alias@example.com"), false, "no address is built into the code");
  k.setPersonAliases({ " Owner.Alias@Example.com ": "owner@example.com", "bad": "x", "a@b.example": "a@b.example" });
  assert.deepEqual({ ...k.PERSON_ALIASES }, { "owner.alias@example.com": "owner@example.com" }, "trimmed, lowercased; junk and self-maps dropped");
  assert.equal(k.canonicalEmail(" owner.alias@example.com "), "owner@example.com");
  assert.equal(k.canonicalEmail("huy@x"), "huy@x");
  assert.equal(k.canonicalEmail(""), "");
  assert.equal(k.isAliasEmail("owner.alias@example.com"), true);
  assert.equal(k.isAliasEmail("owner@example.com"), false);
  k.setPersonAliases({});
  assert.equal(k.canonicalEmail("owner.alias@example.com"), "owner.alias@example.com");
});
t("local agent fill gives a note the speaker means for themselves to the speaker", () => {
  const users = [{ id: "owner@example.com", first: "Rob" }, { id: "huy@x", first: "Huy" }];
  const today = new Date("2026-10-21T12:00:00");
  for (const note of ["I need to send the release notes to the client", "remind me to chase the DSP contract", "add a task for myself to review the FAQ", "assign it to me: review the pricing page"]) {
    assert.equal(k.agentDraft(note, { users, me: "owner@example.com", today }).assignee, "owner@example.com", note);
  }
  // signed in as the alias, it is still the owner
  k.setPersonAliases({ "owner.alias@example.com": "owner@example.com" });
  assert.equal(k.agentDraft("I need to call the printer", { users, me: "owner.alias@example.com", today }).assignee, "owner@example.com");
  k.setPersonAliases({});
  // someone named wins, and without a speaker nothing is guessed
  assert.equal(k.agentDraft("I need Huy to look at this, assign it to Huy", { users, me: "owner@example.com", today }).assignee, "huy@x");
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
  // Send to Agent (KB-AGENT-1): the agent counts ride on a card only once there are agent tickets
  assert.ok(!("agentTotal" in k.cardOf({ key: "PH-1" })) && !("agentDone" in k.cardOf({ key: "PH-1", agentDone: 2 })));
  assert.deepEqual([k.cardOf({ key: "PH-1", agentTotal: 3, agentDone: 1 }).agentTotal, k.cardOf({ key: "PH-1", agentTotal: 3 }).agentDone], [3, 0]);
  assert.ok(!("agentTotal" in k.cardPatchOf({ title: "x", agentTotal: 3 })), "only the server writes the counts");
  assert.deepEqual(k.agentRollup([{ status: "backlog" }, { status: "ready-for-testing", deployCommit: "d1" }, { status: "archived", mergeCommit: "abc" }, { status: "archived" }, null]), { total: 4, done: 2 });
  // A status a browser wrote is not proof: only a pipeline stamp is.
  assert.equal(k.agentBuilt({ status: "ready-for-testing" }), false, "status alone, no stamp");
  assert.equal(k.agentBuilt({ status: "ready-to-publish", testVersion: "1.5.414" }), true);
  assert.equal(k.agentBuilt({ status: "published-live", mergeCommit: "m" }), true);
  // What the server writes must stay editable on the board (10,000 characters).
  const long = { title: "t", description: "d".repeat(6000), acceptanceCriteria: Array.from({ length: 20 }, () => "c".repeat(400)) };
  assert.match(k.cleanAgentSplit([long]).error, /too long for the Agent Board/);
  assert.ok(k.cleanAgentSplit([{ title: "t", description: "d".repeat(3000), acceptanceCriteria: ["a", "b"] }]).tickets, "an ordinary one passes");
  assert.equal(k.canSendToAgent({ key: "PH-1", assignee: "a@x.example", status: "in-progress" }, "A@x.example"), true);
  assert.equal(k.canSendToAgent({ key: "PH-1", assignee: "a@x.example", status: "in-progress" }, "b@x.example"), false);
  assert.equal(k.canSendToAgent({ key: "PH-1", assignee: "", status: "backlog" }, "a@x.example"), false);
  assert.equal(k.canSendToAgent({ key: "PH-1", assignee: "a@x.example", status: "done" }, "a@x.example"), false);
  assert.deepEqual(k.cleanAgentSplit([{ title: " A  b ", description: " d ", acceptanceCriteria: "- one\n\n* two" }]).tickets, [{ title: "A b", description: "d", acceptanceCriteria: ["one", "two"] }]);
  assert.match(k.cleanAgentSplit([]).error, /at least one/);
  assert.match(k.cleanAgentSplit([{ title: "" }]).error, /needs a title/);
  assert.match(k.cleanAgentSplit(Array.from({ length: 11 }, () => ({ title: "t" }))).error, /At most 10/);
  const agentDesc = k.agentTicketDesc({ title: "T", description: "Do it.", acceptanceCriteria: ["Works"] }, { key: "PH-7", title: "Parent", url: "https://x/#staff-kanban/ticket/PH-7" });
  assert.match(agentDesc, /^## Outcome\nDo it\.\n\nAcceptance criteria:\n- Works\n\n## Test steps\n1\. Check: Works\n\n## Dependencies\n\n\n## Spec reference\nStaff Kanban ticket PH-7 "Parent"/);
  // activity lines
  const after = value.map((c) => ({ ...c })); after[0].done = true; after[1].text = "Second, reworded"; after.push({ id: "zzzzzzzz", text: "Third", done: false });
  assert.deepEqual(k.diffCriteria(value, after), ['ticked criterion "First item"', 'edited criterion "Second" → "Second, reworded"', 'added criterion "Third"']);
  assert.ok(k.diffCriteria(value, after).includes('ticked criterion "First item"'));
  assert.deepEqual(k.diffCriteria(value, [value[1], value[0]]), ["reordered the acceptance criteria"]);
  assert.deepEqual(k.diffCriteria(value, value), []);
});
t("links: the reverse type for each, and what a save added or removed", () => {
  assert.deepEqual(Object.fromEntries(k.LINK_TYPES.map((x) => [x, k.INVERSE_LINK[x]])), { blocks: "is blocked by", "is blocked by": "blocks", "relates to": "relates to", duplicates: "is duplicated by", "is duplicated by": "duplicates" });
  assert.deepEqual(k.inverseOf("PH-1", { type: "blocks", key: "PH-2" }), { type: "is blocked by", key: "PH-1" });
  const c = k.linkChanges([{ type: "blocks", key: "PH-2" }, { type: "relates to", key: "PH-3" }], [{ type: "relates to", key: "PH-3" }, { type: "duplicates", key: "PH-4" }]);
  assert.deepEqual(c, { added: [{ type: "duplicates", key: "PH-4" }], removed: [{ type: "blocks", key: "PH-2" }] });
  assert.equal(k.cleanTaskFields({ links: [{ type: "blocks", key: "ph-2" }, { type: "blocks", key: "PH-2" }] }, { partial: true }).value.links.length, 1);
});
t("an edit writes one activity line per changed field, with old and new values", () => {
  const before = { title: "A", priority: "medium", assignee: "", estimate: 8, labels: ["x"], links: [], flagged: false, release: "r1" };
  const after = { ...before, priority: "high", assignee: "d@x", estimate: 16, labels: ["y"], links: [{ type: "blocks", key: "PH-2" }], flagged: true, release: "" };
  const lines = k.editActivity(before, after, { person: (e) => e.split("@")[0].toUpperCase(), release: (id) => `Rel ${id}` });
  assert.deepEqual(lines, ["assigned to D", "changed Priority from Medium to High", "changed Estimate from 1d to 2d", "changed Release from Rel r1 to none",
    "added label y", "removed label x", "linked: blocks PH-2", "flagged this ticket"]);
  assert.deepEqual(k.editActivity(before, { ...before }), []);
  assert.deepEqual(k.editActivity({ ...before, assignee: "d@x" }, before, { person: () => "Duong" }), ["unassigned (was Duong)"]);
});
t("ticket addresses: the PH key in, the PH key out", () => {
  assert.equal(k.ticketHash("PH-123"), "#staff-kanban/ticket/PH-123");
  assert.equal(k.ticketSub("PH-7"), "ticket/PH-7");
  for (const [sub, key] of [["ticket/PH-123", "PH-123"], ["ticket/ph-123", "PH-123"], ["ticket/123", "PH-123"], ["ticket/PH123", "PH-123"], ["ticket/PH-007", "PH-7"], ["ticket/PH-12/", "PH-12"], ["ticket/%50H-9", "PH-9"]]) {
    assert.equal(k.ticketFromSub(sub).key, key, sub);
  }
  assert.deepEqual(k.ticketFromSub("ticket/banana"), { key: "", raw: "banana" });
  assert.deepEqual(k.ticketFromSub("ticket/PH-12x"), { key: "", raw: "PH-12x" });
  assert.deepEqual(k.ticketFromSub("ticket"), { key: "", raw: "" });
  assert.deepEqual(k.ticketFromSub("ticket/"), { key: "", raw: "" });
  assert.deepEqual(k.ticketFromSub("ticket/%"), { key: "", raw: "%" });
  for (const sub of ["", "report", "settings", "tickets/PH-1", undefined]) assert.equal(k.ticketFromSub(sub), null, String(sub));
  assert.equal(k.ticketFromSub(k.ticketSub("PH-42")).key, "PH-42");
});
t("hierarchy: four levels (Epic > Task > Subtask > Sub-subtask), loops refused, parents roll up and advance", () => {
  const list = [
    { key: "PH-1", type: "epic", status: "in-progress", epic: "" },
    { key: "PH-2", type: "task", status: "in-progress", epic: "PH-1" },
    { key: "PH-3", type: "task", status: "backlog", epic: "PH-2" },
    { key: "PH-4", type: "task", status: "in-progress", epic: "PH-3" },
    { key: "PH-5", type: "bug", status: "done", resolution: "withdrawn", epic: "PH-3" },
    { key: "PH-6", type: "task", status: "backlog", epic: "" },
    { key: "PH-7", type: "task", status: "backlog", epic: "PH-6" },
  ];
  const by = new Map(list.map((x) => [x.key, x]));
  const get = (key) => by.get(key) || null;
  const kids = (key) => list.filter((x) => x.epic === key && x.type !== "epic");
  assert.deepEqual(list.slice(0, 4).map((x) => k.levelOf(x, get)), [1, 2, 3, 4]);
  assert.deepEqual([1, 2, 3, 4].map((l) => k.levelName(l, "task")), ["Task", "Task", "Subtask", "Sub-subtask"]);
  assert.equal(k.levelName(1, "epic"), "Epic");
  assert.deepEqual(k.ancestorsOf(get("PH-4"), get), ["PH-3", "PH-2", "PH-1"]);
  assert.equal(k.heightOf("PH-1", kids), 4); assert.equal(k.heightOf("PH-4", kids), 1);
  // A fifth level is refused, at create time and when moving a branch under another.
  assert.match(k.parentProblem({ key: "", type: "task" }, "PH-4", get, kids), /at most 4 levels: Epic > Task > Subtask > Sub-subtask/);
  assert.equal(k.parentProblem({ key: "", type: "task" }, "PH-3", get, kids), null);
  assert.match(k.parentProblem(get("PH-6"), "PH-3", get, kids), /PH-6 has 1 level of tickets under it/);
  assert.equal(k.parentProblem(get("PH-6"), "PH-2", get, kids), null);
  assert.match(k.parentProblem(get("PH-2"), "PH-4", get, kids), /is under PH-2/);
  assert.match(k.parentProblem(get("PH-2"), "PH-2", get, kids), /own parent/);
  assert.match(k.parentProblem({ key: "", type: "task" }, "PH-99", get, kids), /PH-99 isn't a ticket/);
  assert.match(k.parentProblem(get("PH-1"), "PH-6", get, kids), /epic is always at the top level/);
  // Roll-up: withdrawn left out; nothing advances until the leaves are done.
  assert.deepEqual(k.rollup("PH-3", kids), { done: 0, total: 1, withdrawn: 1 });
  assert.deepEqual(k.parentsToAdvance(get("PH-4"), get, kids), []);
  get("PH-4").status = "done"; get("PH-4").resolution = "completed";
  // Completing the last leaf moves the subtask, then the task and the epic, each in turn.
  assert.deepEqual(k.parentsToAdvance(get("PH-4"), get, kids), ["PH-3", "PH-2", "PH-1"]);
  assert.deepEqual(k.rollup("PH-3", kids), { done: 1, total: 1, withdrawn: 1 });
  // A parent already in testing or beyond is left alone, and stops the walk.
  get("PH-2").status = "approved";
  assert.deepEqual(k.parentsToAdvance(get("PH-4"), get, kids), ["PH-3"]);
  // A parent with an open child doesn't move.
  assert.deepEqual(k.parentsToAdvance(get("PH-7"), get, kids), []);
  assert.equal(k.isFinished(get("PH-3"), kids), false, "a parent still in Backlog isn't done");
});
t("history: the log read back into moves, hand-offs and time in each column (KB-HIST-1)", () => {
  assert.deepEqual(k.parseActivity("Backlog → In Progress"), { kind: "move", from: "backlog", to: "in-progress", fromLabel: "Backlog", toLabel: "In Progress", note: "" });
  assert.equal(k.parseActivity("In Progress → Ready for Testing · reassigned to Rob for testing").handoffTo, "Rob");
  assert.equal(k.parseActivity("Approved for Deployment → Withdrawn").to, "done");
  assert.deepEqual(k.parseActivity("reassigned Huy → Linh"), { kind: "assign", from: "Huy", to: "Linh" });
  assert.deepEqual(k.parseActivity("reassigned Unassigned → Linh"), { kind: "assign", from: "", to: "Linh" });
  assert.deepEqual(k.parseActivity("assigned to Thảo"), { kind: "assign", from: null, to: "Thảo" });
  assert.deepEqual(k.parseActivity("unassigned (was Thảo)"), { kind: "assign", from: "Thảo", to: "" });
  assert.equal(k.parseActivity("edited a comment").kind, "comment");
  assert.equal(k.parseActivity("changed Priority from Medium to High").kind, "edit");
  // A title with an arrow in it is not a move.
  assert.equal(k.parseActivity("changed Title from A → B to C").kind, "edit");
  const at = (d, h) => `2026-11-0${d}T${String(h).padStart(2, "0")}:00:00Z`;
  const task = { created: at(1, 10), createdBy: "a@x", status: "in-progress", assignee: "c@x" };
  const log = [
    { id: "5", who: "a@x", at: at(3, 13), text: "Ready for Testing → In Progress · returned to Cee" },
    { id: "1", who: "a@x", at: at(2, 10), text: "Backlog → In Progress" },
    { id: "2", who: "a@x", at: at(2, 11), text: "assigned to Bee" },
    { id: "3", who: "b@x", at: at(3, 11), text: "reassigned Bee → Cee" },
    { id: "4", who: "c@x", at: at(3, 12), text: "In Progress → Ready for Testing · reassigned to Dee for testing" },
    { id: "6", who: "c@x", at: at(3, 14), text: "edited a comment" },
  ];
  const h = k.ticketHistory(task, log, { now: new Date(at(4, 10)).getTime(), person: (e) => e.split("@")[0] });
  assert.deepEqual(h.events.map((e) => e.id), ["6", "5", "4", "3", "2", "1", "created"], "newest first, ending where it was opened");
  assert.equal(h.events.at(-1).who, "a@x"); assert.equal(h.events.at(-1).text, "opened this ticket");
  assert.equal(h.events.find((e) => e.id === "2").from, null, "nobody held it before the first assignment");
  assert.equal(h.events.find((e) => e.id === "4").handoffFrom, "Cee"); assert.equal(h.events.find((e) => e.id === "5").handoffFrom, "Dee");
  const H = 3600000;
  assert.equal(h.stats.openMs, 72 * H); assert.equal(h.stats.closed, false);
  assert.equal(h.stats.handoffs, 4); assert.equal(h.stats.moves, 3); assert.equal(h.stats.edits, 1);
  const col = Object.fromEntries(h.stats.columns.map((c) => [c.status, c.ms / H]));
  assert.deepEqual(col, { backlog: 24, "ready-for-dev": 0, "in-progress": 26 + 21, "ready-for-testing": 1, approved: 0 });
  assert.equal(h.stats.columns.reduce((a, c) => a + c.ms, 0), h.stats.openMs, "the columns add up to the time open");
  // A closed ticket's clock stops when it was closed; a ticket with no moves has spent all its time where it is.
  const done = k.ticketHistory({ created: at(1, 10), status: "done", closedAt: at(2, 10) }, [{ who: "a@x", at: at(2, 10), text: "Backlog → Completed" }], { now: new Date(at(9, 10)).getTime() });
  assert.equal(done.stats.openMs, 24 * H); assert.equal(done.stats.closed, true);
  const still = k.ticketHistory({ created: at(1, 10), status: "ready-for-dev" }, [], { now: new Date(at(1, 12)).getTime() });
  assert.equal(still.stats.columns.find((c) => c.status === "ready-for-dev").ms, 2 * H); assert.equal(still.stats.handoffs, 0);
  assert.equal(k.fmtAge(72 * H), "3d"); assert.equal(k.fmtAge(73 * H), "3d 1h"); assert.equal(k.fmtAge(1.5 * H), "1h 30m"); assert.equal(k.fmtAge(5 * 60000), "5m"); assert.equal(k.fmtAge(20000), "under a minute");
});
t("spoken names: a name or its pronunciation becomes a tag only when it is certain (KB-VOICE-1)", () => {
  assert.deepEqual(k.soundAlikes('Said "Zuong" (northern Vietnamese)'), ["zuong"]);
  assert.deepEqual(k.soundAlikes('Said close to "Took"'), ["took"]);
  assert.deepEqual(k.soundAlikes("Hong"), ["hong"]); assert.deepEqual(k.soundAlikes("Rhymes with song, more or less"), []); assert.deepEqual(k.soundAlikes(null), []);
  const ppl = [
    { id: "duong@x", name: "Nguyễn Dương", first: "Dương", said: ["zuong"] },
    { id: "thuc@x", name: "Trần Thức", first: "Thức", said: ["took"] },
    { id: "rob@x", name: "Rob Smith", first: "Rob", said: ["rob"] },
    { id: "m1@x", name: "Minh Anh", first: "Minh" }, { id: "m2@x", name: "Minh Châu", first: "Minh" },
  ];
  const shape = (text) => k.matchSpokenNames(text, ppl).map((x) => (x.t === "mention" ? `@${x.id}` : x.t === "unsure" ? `?${x.text}:${x.candidates.map((c) => c.id).join("/")}` : x.text)).join("|");
  // A pronunciation that is no ordinary word is the person; one that is ("took") needs the sentence to say so.
  assert.equal(shape("Can you ask Zuong to check this and tell Took as well"), "Can you ask |@duong@x| to check this and tell |@thuc@x| as well");
  assert.equal(shape("I took the bus. Rob please review"), "I took the bus. |@rob@x| please review");
  assert.equal(shape("they rob the bank"), "they rob the bank", "an everyday word with nothing pointing at a person is left alone, not even offered");
  // The spelling without its accents, a full name, "at Rob" and "@ Rob" said for a tag.
  assert.equal(shape("Rob Smith's fix works, ask Duong"), "@rob@x|'s fix works, ask |@duong@x");
  assert.equal(shape("At rob this is ready"), "@rob@x| this is ready");
  assert.equal(shape("@ Rob have a look"), "@rob@x| have a look");
  // Two people with the name, or a near miss where a name is expected: offered, never tagged.
  assert.equal(shape("please tag Minh"), "please tag |?Minh:m1@x/m2@x");
  assert.equal(shape("Thanks Zoung looks good"), "Thanks |?Zoung:duong@x| looks good");
  assert.equal(shape("the zoning is wrong"), "the zoning is wrong");
  // The segments always spell the transcript back exactly.
  for (const text of ["Can you ask Zuong to check this and tell Took as well", "please tag Minh", "At rob this is ready", "nothing here", ""]) {
    assert.equal(k.matchSpokenNames(text, ppl).map((x) => (x.t === "mention" ? x.said : x.text)).join(""), text);
  }
  assert.deepEqual(k.matchSpokenNames("hello Rob", []), [{ t: "text", text: "hello Rob" }]);
});
t("board order: priority Highest to Lowest (none = Medium), then rank; a drop ranks among its own priority", () => {
  const list = [
    { key: "A", priority: "low", rank: 1 }, { key: "B", priority: "highest", rank: 50 }, { key: "C", priority: "", rank: 5 },
    { key: "D", priority: "high", rank: 30 }, { key: "E", priority: "highest", rank: 20 }, { key: "F", priority: "medium", rank: 2 },
    { key: "G", priority: "lowest", rank: 0 }, { key: "H", priority: "bogus", rank: 3 },
  ].sort(k.byBoardOrder);
  assert.deepEqual(list.map((x) => x.key), ["E", "B", "D", "F", "H", "C", "A", "G"]);
  assert.equal(k.prioRank({}), 2); assert.equal(k.prioRank({ priority: "highest" }), 0); assert.equal(k.prioRank({ priority: "lowest" }), 4);
  // a High ticket dropped above E (top of Highest) lands at the top of High: before D
  let { prev, next } = k.dropNeighbours(list, 0, { priority: "high" });
  assert.deepEqual([prev, next && next.key], [null, "D"]);
  assert.ok(k.rankBetween(null, next.rank) < next.rank);
  // a Medium ticket dropped between F and H ranks between them
  ({ prev, next } = k.dropNeighbours(list, 4, { priority: "medium" }));
  assert.deepEqual([prev.key, next.key], ["F", "H"]);
  // a Highest ticket dropped at the column's end lands at the end of Highest: after B
  ({ prev, next } = k.dropNeighbours(list, list.length, { priority: "highest" }));
  assert.deepEqual([prev.key, next], ["B", null]);
  // a priority with no tickets in the column: no neighbours, the first rank
  assert.deepEqual(k.dropNeighbours([{ key: "X", priority: "low", rank: 4 }], 0, { priority: "high" }), { prev: null, next: null });
});
t("needs more work (KB-BOARD-5a): sent back from testing with a stamp, drawn first, cleared on the way back to testing", () => {
  const first = (e) => (e || "").split("@")[0];
  const stamp = { reason: "  Save button still greys out  ", by: "rob@x", at: "2026-11-24T03:30:00.000Z" };
  const back = k.statusChange({ status: "ready-for-testing", assignee: "rob@x", previousAssignee: "duc@x" }, "ready-for-dev", { firstName: first, needsMoreWork: stamp });
  assert.deepEqual(back.patch.needsMoreWork, { reason: "Save button still greys out", by: "rob@x", at: "2026-11-24T03:30:00.000Z" });
  assert.equal(back.patch.assignee, "duc@x");
  assert.equal(back.activity, "Ready for Testing → Ready for Dev · returned to duc");
  assert.equal(back.stampLine, "marked Needs more work: Save button still greys out");
  // the move line still reads as a hand-off back to the developer
  assert.equal(k.parseActivity(back.activity).handoffTo, "duc");
  // only from Ready for Testing, and only backwards
  assert.equal(k.statusChange({ status: "in-progress" }, "ready-for-dev", { needsMoreWork: stamp }).patch.needsMoreWork, undefined);
  assert.equal(k.statusChange({ status: "ready-for-testing" }, "approved", { needsMoreWork: stamp }).patch.needsMoreWork, undefined);
  // kept while it is worked on, cleared once it is back in testing (or approved or closed)
  const stamped = { status: "ready-for-dev", needsMoreWork: back.patch.needsMoreWork };
  const ip = k.statusChange(stamped, "in-progress", {});
  assert.equal("needsMoreWork" in ip.patch, false); assert.equal(ip.stampLine, "");
  for (const to of ["ready-for-testing", "approved", "done"]) {
    const ch = k.statusChange({ ...stamped, status: "in-progress" }, to, {});
    assert.equal(ch.patch.needsMoreWork, null); assert.equal(ch.stampLine, "cleared Needs more work");
  }
  // the card carries it, normalised
  assert.ok(k.CARD_FIELDS.includes("needsMoreWork"));
  assert.deepEqual(k.cardOf({ key: "PH-1", title: "x", needsMoreWork: { reason: "r", by: "a@x", at: "t", junk: 1 } }).needsMoreWork, { reason: "r", by: "a@x", at: "t" });
  assert.equal(k.cardOf({ key: "PH-1", title: "x" }).needsMoreWork, null);
  assert.equal(k.cardPatchOf({ needsMoreWork: null }).needsMoreWork, null);
  // drawn above everything else in its column, Highest included; then priority and rank as usual
  const list = [
    { key: "A", priority: "highest", rank: 1 }, { key: "B", priority: "low", rank: 9, needsMoreWork: { reason: "x" } },
    { key: "C", priority: "high", rank: 2 }, { key: "D", priority: "high", rank: 5, needsMoreWork: { reason: "y" } },
  ].sort(k.byBoardOrder);
  assert.deepEqual(list.map((x) => x.key), ["D", "B", "A", "C"]);
  // a drag ranks a stamped ticket among stamped ones of its priority, an unstamped one among its own
  assert.deepEqual(k.dropNeighbours(list, 0, { priority: "high" }), { prev: null, next: list[3] });
  assert.deepEqual(k.dropNeighbours(list, 4, { priority: "high", needsMoreWork: { reason: "z" } }), { prev: list[0], next: null });
});
t("needs more work (KB-BOARD-5a): to Backlog with its developer, then straight back to the tester who sent it", () => {
  const first = (e) => (e || "").split("@")[0];
  const stamp = { reason: "Still greys out", by: "rob@x", at: "2026-11-26T04:00:00.000Z" };
  // the board's button sends it to Backlog, stamped, and returns it to the developer
  const back = k.statusChange({ status: "ready-for-testing", assignee: "rob@x", previousAssignee: "duc@x" }, "backlog", { firstName: first, needsMoreWork: stamp });
  assert.equal(back.patch.status, "backlog");
  assert.equal(back.patch.assignee, "duc@x");
  assert.equal(back.patch.needsMoreWork.reason, "Still greys out");
  assert.equal(back.activity, "Ready for Testing → Backlog · returned to duc");
  // a plain move to Backlog (no stamp) still leaves the assignee alone
  assert.equal("assignee" in k.statusChange({ status: "ready-for-testing", assignee: "rob@x", previousAssignee: "duc@x" }, "backlog", {}).patch, false);
  // reaching Ready for Testing again hands it to the tester who sent it back, ahead of a designated or chosen tester
  const stamped = { status: "in-progress", assignee: "duc@x", previousAssignee: "duc@x", tester: "ana@x", needsMoreWork: back.patch.needsMoreWork };
  const again = k.statusChange(stamped, "ready-for-testing", { firstName: first, tester: "lan@x" });
  assert.equal(again.patch.assignee, "rob@x");
  assert.equal(again.patch.previousAssignee, "duc@x");
  assert.equal(again.patch.needsMoreWork, null);
  assert.equal(again.activity, "In Progress → Ready for Testing · reassigned to rob for testing");
  // an unstamped ticket keeps today's rule: designated tester, else the chosen one
  assert.equal(k.statusChange({ status: "in-progress", assignee: "duc@x" }, "ready-for-testing", { tester: "lan@x" }).patch.assignee, "lan@x");
});
t("Ready for Testing order (KB-BOARD-3b): bugs, then tasks, then epics, each by priority then rank; other columns unchanged", () => {
  const rft = (key, type, priority, rank) => ({ key, type, priority, rank, status: "ready-for-testing" });
  const list = [
    rft("E1", "epic", "highest", 1), rft("T1", "task", "low", 2), rft("B1", "bug", "low", 3), rft("T2", "task", "highest", 4),
    rft("B2", "bug", "high", 9), rft("B3", "bug", "high", 5), rft("E2", "epic", "", 0), rft("X", "", "high", 6),
  ].sort(k.byBoardOrder);
  assert.deepEqual(list.map((x) => x.key), ["B3", "B2", "B1", "T2", "X", "T1", "E1", "E2"]);
  assert.equal(k.typeBand({ status: "ready-for-testing", type: "bug" }), 0);
  assert.equal(k.typeBand({ status: "ready-for-testing", type: "toString" }), 1);
  assert.equal(k.typeBand({ status: "in-progress", type: "epic" }), 0);
  // in any other column type plays no part: priority, then rank
  const ip = list.map((x) => ({ ...x, status: "in-progress" })).sort(k.byBoardOrder);
  assert.deepEqual(ip.map((x) => x.key), ["E1", "T2", "B3", "X", "B2", "E2", "T1", "B1"]);
  // a drag ranks a ticket among its own type and priority: a High task dropped at the top lands before X
  assert.deepEqual(k.dropNeighbours(list, 0, { type: "task", priority: "high", status: "ready-for-testing" }), { prev: null, next: list[4] });
  // a High bug dropped at the bottom lands after B2, the last High bug
  assert.deepEqual(k.dropNeighbours(list, list.length, { type: "bug", priority: "high", status: "ready-for-testing" }), { prev: list[1], next: null });
});
console.log(`\n${n} passed`);
