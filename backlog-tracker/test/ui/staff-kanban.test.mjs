// Staff Kanban end to end, against the REAL console (public/index.html,
// app.js and js/kanban/) in Chromium with the Firebase SDK stubbed — the
// signed-off test plan, kanban-staff-board/docs/E2E-TEST-PLAN.md, TC-01 to
// TC-25, now run against the production build instead of the prototype,
// plus the console-only cases (KB-C1 …): viewer read-only, the mentions
// bell, Claude's draft preferred over the local fill, and what is written.
//
// Seed: the prototype's team, releases and 39 tickets (kanban-seed.mjs).
// A "reload" re-seeds the in-memory database, so persistence is checked as
// the documents written (window.__fbStub.writes), not across a page load.
//   cd backlog-tracker/test && node ui/staff-kanban.test.mjs
import assert from "node:assert/strict";
import { startHarness, until } from "./harness.mjs";
import { kanbanSeed, emailOf, ROB } from "./kanban-seed.mjs";

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844, contextOptions: { isMobile: true, hasTouch: true } };
const LINH = emailOf("Linh"), HUY = emailOf("Huy"), MINH = emailOf("Minh");

const h = await startHarness();
const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([name, true, Date.now() - t0]); console.log(`  ok  ${name}`); }
  catch (err) { results.push([name, false, Date.now() - t0, err]); console.log(`FAIL  ${name}\n      ${err && err.message}`); }
}

// Opens the console on the board; every case ends asserting no page or console errors.
async function open(hash = "#staff-kanban", size = DESKTOP, opts = {}) {
  const o = await h.open({ seed: opts.seed || kanbanSeed(), hash, width: size.width, height: size.height, contextOptions: size.contextOptions || {}, init: opts.init });
  const p = o.page;
  await until(() => p.locator(hash.includes("report") || hash.includes("settings") ? "#kb-view .page-header" : ".kb-card").count(), "the Staff Kanban page", 15000);
  await p.waitForTimeout(150);
  p.done = async () => { assert.deepEqual(o.problems, [], "no page errors, console errors or stray requests"); await o.close(); };
  p.ctx = o.context;
  return p;
}
const where = (page, key) => page.evaluate((k) => {
  const c = document.querySelector(`.kb-card[data-key="${k}"]`);
  if (!c) return null;
  const l = c.closest(".kb-list");
  return { status: c.closest(".kb-col").dataset.status, resolution: (l && l.dataset.resolution) || null, lane: c.closest(".kb-col").dataset.lane || null, avatar: (c.querySelector(".kb-card-footer .kb-avatar") || {}).title || "" };
}, key);
const stored = (page, key) => page.evaluate((k) => globalThis.__fbStub.col("kanbanTasks").get(k), key);
const writes = (page, re) => page.evaluate((src) => globalThis.__fbStub.writes.filter((w) => new RegExp(src).test(w.path)), re.source);
async function mouseDrag(page, key, targetSel, offset = { x: 40, y: 20 }) {
  const c = await (await page.$(`.kb-card[data-key="${key}"]`)).boundingBox();
  await page.mouse.move(c.x + 30, c.y + 20);
  await page.mouse.down();
  await page.mouse.move(c.x + 50, c.y + 30, { steps: 3 });
  const t = await (await page.$(targetSel)).boundingBox();
  await page.mouse.move(t.x + offset.x, t.y + offset.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}
// Speech and microphone stubs: the "recording" says `phrase`.
const speechStub = (phrase) => ({
  arg: phrase,
  fn: (said) => {
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    window.SpeechRecognition = class { start() { setTimeout(() => this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: said }], { isFinal: true })] }), 150); } stop() { setTimeout(() => this.onend && this.onend(), 10); } abort() {} };
  },
});

console.log("\nStaff Kanban — console end to end\n");

await test("TC-01 board renders six columns with counts, keys and the pinned header row", async () => {
  const p = await open();
  const heads = await p.$$eval("#kb-lanes-head .kb-col-title", (e) => e.map((x) => x.textContent));
  assert.deepEqual(heads, ["Backlog", "Ready for Dev", "In Progress", "Ready for Testing", "Approved for Deployment", "Completed / Withdrawn"]);
  assert.equal(await p.textContent("#kb-view .page-header h2"), "Staff Kanban");
  assert.match(await p.textContent("#kb-count"), /^39 tasks$/);
  const keys = await p.$$eval(".kb-card .kb-key", (e) => e.map((x) => x.textContent));
  assert.ok(keys.length > 30 && keys.every((k) => /^PH-\d+$/.test(k)));
  assert.equal((await p.textContent("#staff-kanban-btn")).trim(), "view_kanbanStaff Kanban");
  assert.equal(await p.getAttribute("#staff-kanban-btn", "aria-current"), "page");
  assert.match(await p.title(), /^Staff Kanban — PH Agent Console$/);
  await p.done();
});

await test("TC-02 drag a card from Backlog to In Progress", async () => {
  const p = await open("#staff-kanban", { width: 1440, height: 1600 });
  await mouseDrag(p, "PH-34", '.kb-col[data-status="in-progress"] .kb-list');
  assert.equal((await where(p, "PH-34")).status, "in-progress");
  assert.match(await p.textContent("#kb-toast"), /PH-34 moved to In Progress/);
  const t = await stored(p, "PH-34");
  assert.equal(t.status, "in-progress"); assert.equal(t.open, true); assert.equal(t.updatedBy, ROB);
  const act = await writes(p, /^kanbanTasks\/PH-34\/activity\//);
  assert.equal(act.length, 1); assert.equal(act[0].data.text, "Backlog → In Progress"); assert.equal(act[0].data.who, ROB);
  await p.done();
});

await test("TC-03 Ready for Testing reassigns to the tester; moving back returns it to the developer", async () => {
  const p = await open("#staff-kanban", { width: 1440, height: 1600 });
  await mouseDrag(p, "PH-19", '.kb-col[data-status="ready-for-testing"] .kb-list');
  let w = await where(p, "PH-19");
  assert.equal(w.status, "ready-for-testing");
  assert.equal(w.avatar, "Rob");
  assert.match(await p.textContent("#kb-toast"), /reassigned to Rob for testing/);
  assert.match(await p.textContent('.kb-card[data-key="PH-19"] .kb-handoff'), /From Đức/);
  assert.equal((await stored(p, "PH-19")).previousAssignee, emailOf("Đức"));
  await mouseDrag(p, "PH-19", '.kb-col[data-status="in-progress"] .kb-list');
  w = await where(p, "PH-19");
  assert.equal(w.status, "in-progress");
  assert.equal(w.avatar, "Đức");
  await p.done();
});

await test("TC-04 drop targets: Completed (3/4) and Withdrawn (1/4) replace the last column while dragging", async () => {
  const p = await open();
  await p.evaluate(() => scrollTo(0, 400));
  const c = await (await p.$('.kb-card[data-key="PH-21"]')).boundingBox();
  await p.mouse.move(c.x + 30, c.y + 20); await p.mouse.down(); await p.mouse.move(c.x + 50, c.y + 30, { steps: 3 });
  const z = await p.$$eval(".kb-close-zone", (e) => e.map((x) => ({ r: x.dataset.resolution, h: x.getBoundingClientRect().height })));
  assert.equal(z.length, 2);
  const ratio = z[0].h / z[1].h;
  assert.ok(ratio > 2.6 && ratio < 3.4, `3:1 split, got ${ratio}`);
  assert.equal(await p.$eval('.kb-col[data-status="done"] .kb-res-split', (e) => getComputedStyle(e).visibility), "hidden");
  const w = await (await p.$(".kb-close-withdrawn")).boundingBox();
  await p.mouse.move(w.x + w.width / 2, w.y + w.height / 2, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(200);
  assert.deepEqual((({ status, resolution }) => ({ status, resolution }))(await where(p, "PH-21")), { status: "done", resolution: "withdrawn" });
  assert.equal(await p.$(".kb-close-zones"), null);
  assert.match(await p.textContent("#kb-lanes-head .kb-col-done"), /3/);
  const t = await stored(p, "PH-21");
  assert.equal(t.open, false); assert.ok(t.closedAt, "closedAt set");
  await p.done();
});

await test("TC-05 touch: press-and-hold drag on a tablet moves a card", async () => {
  const p = await open("#staff-kanban", { width: 1024, height: 768, contextOptions: { isMobile: true, hasTouch: true } });
  const cdp = await p.ctx.newCDPSession(p);
  const c = await (await p.$('.kb-card[data-key="PH-27"]')).boundingBox();
  const t = await (await p.$('.kb-col[data-status="in-progress"] .kb-list')).boundingBox();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c.x + 30, y: c.y + 20 }] });
  await p.waitForTimeout(400);
  for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: c.x + 30 + (t.x - c.x) * i / 10, y: c.y + 20 + (t.y + 5 - c.y) * i / 10 }] }); await p.waitForTimeout(20); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.waitForTimeout(250);
  assert.equal((await where(p, "PH-27")).status, "in-progress");
  assert.equal(await p.$eval("#task-backdrop", (e) => e.hidden), true, "the drag did not open the task");
  await p.done();
});

await test("TC-06 staff filter makes swimlanes; dragging into another lane reassigns", async () => {
  const p = await open("#staff-kanban", { width: 1440, height: 2000 });
  for (const id of [LINH, HUY]) await p.click(`.kb-person-chip[data-person="${id}"]`);
  assert.deepEqual(await p.$$eval(".kb-lane", (e) => e.map((x) => x.dataset.lane)).then((l) => l.sort()), [LINH, HUY].sort());
  await mouseDrag(p, "PH-29", `.kb-lane-cell[data-lane="${LINH}"][data-status="in-progress"]`);
  const w = await where(p, "PH-29");
  assert.equal(w.lane, LINH); assert.equal(w.status, "in-progress");
  assert.equal((await stored(p, "PH-29")).assignee, LINH);
  await p.click(`.kb-lane[data-lane="${HUY}"] .kb-lane-head`);
  assert.equal(await p.$$eval(`.kb-lane-cell[data-lane="${HUY}"].kb-cell-hidden`, (e) => e.length), 6);
  await p.click("#kb-lanes-expand");
  assert.equal(await p.$$eval(".kb-cell-hidden", (e) => e.length), 0);
  await p.done();
});

await test("TC-07 My tasks shows only the signed-in person's tasks", async () => {
  const p = await open();
  await p.click("#kb-mine");
  const avatars = await p.$$eval(".kb-card .kb-card-footer .kb-avatar", (e) => e.map((x) => x.title));
  assert.ok(avatars.length > 0 && avatars.every((a) => a === "Rob"));
  await p.done();
});

await test("TC-08 secondary filters live in the Filters menu; a filter change keeps the scroll position", async () => {
  const p = await open("#staff-kanban", { width: 1440, height: 700 });
  assert.equal(await p.$eval("#kb-filter-panel", (e) => e.hidden), true);
  await p.click("#kb-filter-toggle");
  await p.selectOption("#kb-type", "bug");
  await p.waitForTimeout(100);
  assert.equal(await p.$eval("#kb-filter-panel", (e) => e.hidden), false, "menu stays open while adjusting");
  const types = await p.$$eval(".kb-card .kb-type", (e) => e.map((x) => x.title));
  assert.ok(types.length && types.every((t) => t === "Bug"));
  await p.click("#kb-filter-done");
  assert.match(await p.textContent("#kb-filter-toggle"), /Filters\s*1/);
  await p.click("#kb-clear");
  await p.evaluate(() => scrollTo(0, 400));
  await p.selectOption("#kb-release", "4-12");
  await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => scrollY), 400);
  await p.click("#kb-filter-toggle"); await p.click("#kb-flagged");
  const flagged = await p.$$eval(".kb-card", (e) => e.length > 0 && e.every((c) => c.classList.contains("kb-flagged")));
  assert.ok(flagged);
  await p.done();
});

await test("TC-09 filter bar and column headers stay pinned; filter bar fits one line from 1024px", async () => {
  for (const w of [1440, 1024]) {
    const p = await open("#staff-kanban", { width: w, height: 900 });
    await p.click("#kb-mine");
    const ids = await p.$$eval(".kb-person-chip", (e) => e.map((x) => x.dataset.person));
    for (const id of ids) await p.click(`.kb-person-chip[data-person="${id}"]`);
    await p.selectOption("#kb-release", "4-12");
    const rows = await p.$$eval(".kb-filters > *", (e) => new Set(e.map((x) => Math.round(x.getBoundingClientRect().top))).size);
    assert.equal(rows, 1, `one line at ${w}`);
    await p.evaluate(() => scrollTo(0, 800));
    await p.waitForTimeout(150);
    assert.equal(await p.$eval("#kb-sticky", (e) => Math.round(e.getBoundingClientRect().top)), 0);
    const head = await p.$$eval("#kb-lanes-head .kb-lanes-head", (e) => e.map((x) => Math.round(x.getBoundingClientRect().left)));
    const cells = await p.$$eval(`.kb-lane-cell[data-lane="${ROB}"]`, (e) => e.map((x) => Math.round(x.getBoundingClientRect().left)));
    assert.deepEqual(head, cells, "pinned headers line up with the columns");
    await p.done();
  }
});

await test("TC-10 phone: columns are a carousel; tabs and swipe change column; no sideways page scroll", async () => {
  const p = await open("#staff-kanban", PHONE);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390);
  await p.tap('.kb-pager-tab[data-col="3"]');
  await p.waitForTimeout(800);
  assert.match(await p.textContent(".kb-pager-tab.on"), /Ready for Testing/);
  const x = await p.$eval("#kb-board-wrap", (w) => w.scrollLeft);
  const colLeft = await p.$eval('.kb-col[data-status="ready-for-testing"]', (c) => c.getBoundingClientRect().left);
  assert.ok(x > 900 && colLeft >= 0 && colLeft < 40, `column in view (scrollLeft ${x}, left ${colLeft})`);
  await p.evaluate(() => { const w = document.getElementById("kb-board-wrap"); w.style.scrollBehavior = "auto"; w.scrollLeft = w.querySelectorAll(".kb-col")[1].offsetLeft - 12; });
  await p.waitForTimeout(300);
  assert.match(await p.textContent(".kb-pager-tab.on"), /Ready for Dev/);
  await p.evaluate(() => scrollTo(0, 500));
  await p.waitForTimeout(100);
  assert.equal(await p.$eval("#kb-sticky", (e) => Math.round(e.getBoundingClientRect().top)), 0);
  assert.ok(await p.$('.tab[data-tab="build"].active'), "the phone tab bar shows Build, where Staff Kanban lives");
  await p.done();
});

await test("TC-11 new task: required fields, type-specific button, starts in Backlog with a PH key", async () => {
  const p = await open();
  await p.click("#kb-new-btn");
  assert.equal(await p.$('[data-field="status"]'), null, "no Status on a new task");
  assert.equal(await p.$('[data-field="comments"]'), null, "no Comments on a new task");
  const order = await p.$$eval(".kb-task-side .kb-field:not([hidden])", (e) => e.map((x) => x.dataset.field));
  assert.deepEqual(order.slice(0, 8), ["priority", "type", "epic", "assignee", "reporter", "release", "estimate", "logged"]);
  for (const [t, cta] of [["bug", "Raise bug"], ["epic", "Create epic"], ["task", "Create task"]]) {
    await p.click(`#task-form .type-opt[data-type="${t}"]`);
    assert.equal(await p.textContent("#f-save"), cta);
  }
  await p.click("#f-save");
  assert.match(await p.textContent("#f-error"), /Title is required/);
  await p.fill("#f-title", "E2E created task");
  await p.fill("#f-estimate", "1d 4h");
  await p.click("#f-save");
  await until(async () => /PH-40 created in Backlog/.test(await p.textContent("#kb-toast")), "the created toast");
  assert.equal((await where(p, "PH-40")).status, "backlog");
  assert.match(await p.textContent('.kb-card[data-key="PH-40"] .kb-est'), /1d 4h left/);
  const t = await stored(p, "PH-40");
  assert.equal(t.number, 40); assert.equal(t.estimate, 12); assert.equal(t.createdBy, ROB); assert.equal(t.release, "4-12");
  assert.ok(t.searchTokens.includes("ph-40") && t.searchTokens.includes("created"));
  assert.equal((await p.evaluate(() => globalThis.__fbStub.col("kanbanCounters").get("main"))).nextNumber, 41);
  await p.done();
});

await test("TC-12 voice: Record task fills title, description and details, marked Agent", async () => {
  const p = await open("#staff-kanban", DESKTOP, { init: speechStub("so there's a bug where the menu board preview shows the wrong price for Welsh stores. it's urgent. assign it to Huy. it should take about four hours for the current release") });
  await p.click("#kb-new-btn");
  await p.click("#f-record");
  await p.waitForTimeout(400);
  assert.equal(await p.textContent("#f-record-label"), "Stop recording");
  await p.click("#f-record");
  await until(async () => (await p.inputValue("#f-title")).length > 0, "the agent to fill the title");
  assert.equal(await p.inputValue("#f-title"), "Menu board preview shows the wrong price for Welsh stores");
  assert.match(await p.$eval("#f-description .ql-editor", (e) => e.innerText), /wrong price for Welsh stores/);
  assert.equal(await p.inputValue("#f-priority"), "highest");
  assert.equal(await p.inputValue("#f-assignee"), HUY);
  assert.equal(await p.inputValue("#f-estimate"), "4h");
  assert.equal(await p.inputValue("#f-release"), "4-12");
  assert.equal(await p.textContent("#f-save"), "Raise bug");
  assert.ok((await p.$$eval(".kb-agent-filled", (e) => e.length)) >= 6);
  await p.done();
});

await test("TC-13 rich description: link, @mention, screenshot, table and callout are saved", async () => {
  const p = await open();
  await p.click('.kb-card[data-key="PH-20"]');
  const ed = '[data-field="description"] .ql-editor';
  await p.click(ed); await p.keyboard.press("Control+End");
  await p.keyboard.type(" See https://offline2online.com/menu-board for the preview. Ask @mi");
  await p.waitForTimeout(150);
  assert.ok((await p.$$eval('[data-field="description"] .kb-mention-item', (e) => e.length)) >= 1);
  await p.keyboard.press("Enter");
  await p.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 300; c.height = 160; c.getContext("2d").fillRect(0, 0, 300, 160);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer(); dt.items.add(new File([blob], "shot.png", { type: "image/png" }));
    document.querySelector('[data-field="description"] .ql-editor').dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await until(() => p.$$eval(`${ed} img`, (e) => e.length), "the screenshot to upload");
  await p.click('[data-field="description"] .ql-faqtable'); await p.click('.kb-ed-panel [data-x="ok"]');
  // Click the empty line after the table (the table itself takes no caret).
  await p.click(`${ed} > p:last-child`); await p.keyboard.press("Control+End"); await p.keyboard.type("Customers see the wrong price.");
  await p.click('[data-field="description"] .ql-callout .ql-picker-label');
  await p.click('[data-field="description"] .ql-callout .ql-picker-item[data-value="warning"]');
  await p.click("#f-save");
  await until(async () => /PH-20/.test(await p.textContent("#kb-toast")), "saved");
  const html = (await stored(p, "PH-20")).description;
  assert.match(html, /<a href="https:\/\/offline2online\.com\/menu-board"/);
  assert.match(html, new RegExp(`data-user="${MINH.replace(/\./g, "\\.")}"`));
  assert.match(html, /<img src="https:\/\/firebasestorage\.googleapis\.com\//, "the screenshot went to Storage, not inline");
  assert.match(html, /faq-table/);
  assert.match(html, /callout-warning/);
  const up = await p.evaluate(() => Object.keys(globalThis.__fbStub.uploads || {}));
  assert.ok(up.some((k) => /^kanban\/PH-20\/\d+-shot\.jpg$/.test(k) || /^kanban\/PH-20\/\d+-shot\.png$/.test(k)), `uploaded under the ticket: ${up}`);
  const notes = await writes(p, /^kanbanNotifications\//);
  assert.equal(notes.length, 1); assert.equal(notes[0].data.to, MINH); assert.equal(notes[0].data.from, ROB);
  // Re-opened, the editor shows what was saved.
  await p.click('.kb-card[data-key="PH-20"]');
  assert.match(await p.$eval(ed, (e) => e.innerHTML), /callout-warning/);
  await p.done();
});

await test("TC-14 comments: rich comment with @mention, and a dictated comment via the round mic", async () => {
  const p = await open("#staff-kanban", DESKTOP, { init: speechStub("checked this on the Covent Garden store and it is fixed") });
  await p.click('.kb-card[data-key="PH-23"]');
  const mic = await p.$eval("#f-comment-mic", (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  assert.deepEqual(mic, [36, 36], "round mic");
  await p.click("#f-comment-mic"); await p.waitForTimeout(300);
  assert.equal(await p.textContent("#f-comment-mic"), "stop");
  await p.click("#f-comment-mic"); await p.waitForTimeout(400);
  assert.equal(await p.textContent("#f-comment-mic"), "mic");
  await p.click('[data-field="comments"] .ql-editor'); await p.keyboard.press("Control+End"); await p.keyboard.type(" @hu"); await p.waitForTimeout(100); await p.keyboard.press("Enter");
  await p.click("#f-comment-add"); await p.waitForTimeout(200);
  const last = await p.$$eval(".kb-comment-text", (e) => e[e.length - 1].innerHTML);
  assert.match(last, /Checked this on the Covent Garden store and it is fixed/);
  assert.match(last, new RegExp(`data-user="${HUY.replace(/\./g, "\\.")}"`));
  assert.match(await p.textContent("#kb-toast"), /Huy notified/);
  const c = await writes(p, /^kanbanTasks\/PH-23\/comments\//);
  assert.equal(c.length, 1); assert.equal(c[0].data.author, ROB); assert.match(c[0].data.text, /Covent Garden/);
  assert.equal((await stored(p, "PH-23")).commentCount, 1);
  await p.done();
});

await test("TC-15 epics: create an epic, add a bug from inside it, add and remove an existing ticket", async () => {
  const p = await open();
  await p.click("#kb-new-btn");
  await p.click('#task-form .type-opt[data-type="epic"]');
  await p.fill("#f-title", "Loyalty app pilot");
  await p.click('[data-add-child="bug"]');
  await until(async () => (await p.textContent("#task-title-h")) === "New bug", "the child form");
  assert.equal(await p.inputValue("#f-epic"), "PH-40");
  await p.fill("#f-title", "Points balance not refreshing");
  await p.click("#f-save");
  await until(async () => (await p.textContent("#task-title-h")) === "PH-40", "back on the epic");
  await until(() => p.$$eval("[data-open-child]", (e) => e.length), "the child listed");
  assert.deepEqual(await p.$$eval("[data-open-child]", (e) => e.map((x) => x.dataset.openChild)), ["PH-41"]);
  await p.click("#f-child-link .kb-picker-input"); await p.keyboard.type("PH-36"); await p.waitForTimeout(80); await p.keyboard.press("Enter");
  await p.waitForTimeout(200);
  assert.deepEqual((await p.$$eval("[data-open-child]", (e) => e.map((x) => x.dataset.openChild))).sort(), ["PH-36", "PH-41"]);
  await p.click('[data-unlink-child="PH-36"]'); await p.waitForTimeout(150);
  assert.deepEqual(await p.$$eval("[data-open-child]", (e) => e.map((x) => x.dataset.openChild)), ["PH-41"]);
  await p.click("#f-cancel");
  assert.match(await p.textContent('.kb-card[data-key="PH-41"] .kb-parent-epic'), /Loyalty app pilot/);
  assert.equal((await stored(p, "PH-36")).epic, "", "removed from the epic");
  assert.equal((await stored(p, "PH-41")).epic, "PH-40");
  await p.done();
});

await test("TC-16 ticket search picker: number, title words, description words with snippet", async () => {
  const p = await open();
  await p.click('.kb-card[data-key="PH-1"]');
  const inp = "#f-child-link .kb-picker-input";
  await p.click(inp);
  assert.match(await p.textContent("#f-child-link .kb-pick-foot"), /\d+ match/);
  await p.fill(inp, "36"); await p.waitForTimeout(80);
  assert.equal(await p.$eval("#f-child-link .kb-pick .kb-link-key", (e) => e.textContent), "PH-36");
  await p.fill(inp, "archived articles"); await p.waitForTimeout(80);
  assert.deepEqual(await p.$$eval("#f-child-link .kb-pick .kb-link-key", (e) => e.map((x) => x.textContent)), ["PH-36"]);
  await p.fill(inp, "SQLite"); await p.waitForTimeout(80);
  assert.equal(await p.$eval("#f-child-link .kb-pick .kb-link-key", (e) => e.textContent), "PH-24");
  assert.match(await p.$eval("#f-child-link .kb-pick-snip", (e) => e.innerHTML), /<mark>SQLite<\/mark>/);
  await p.done();
});

await test("TC-16b server search finds a ticket the board isn't holding", async () => {
  const seed = kanbanSeed();
  // An old closed ticket outside the 300 most recent: only searchTokens finds it.
  seed.docs.kanbanTasks["PH-7"] = { ...seed.docs.kanbanTasks["PH-7"], open: false, status: "done", resolution: "completed", descriptionText: "Retired with the zebracorn migration.", searchTokens: ["7", "ph-7", "seed", "retired", "zebracorn", "migration"] };
  delete seed.docs.kanbanTasks["PH-7"].closedAt;
  const p = await open("#staff-kanban", DESKTOP, { seed });
  assert.equal(await p.$('.kb-card[data-key="PH-7"]'), null, "not on the board");
  await p.click('.kb-card[data-key="PH-1"]');
  await p.click("#f-child-link .kb-picker-input"); await p.keyboard.type("zebracorn");
  await until(() => p.$$eval("#f-child-link .kb-pick .kb-link-key", (e) => e.some((x) => x.textContent === "PH-7")), "the server's hit", 4000);
  await p.done();
});

await test("TC-17 flags: quick flag on a card, Flag toggle in the modal", async () => {
  const p = await open();
  await p.hover('.kb-card[data-key="PH-27"]');
  await p.click('.kb-card[data-key="PH-27"] .kb-flag-btn');
  await p.waitForTimeout(100);
  assert.ok(await p.$eval('.kb-card[data-key="PH-27"]', (e) => e.classList.contains("kb-flagged")));
  assert.equal(await p.$eval("#task-backdrop", (e) => e.hidden), true);
  assert.equal((await stored(p, "PH-27")).flagged, true);
  await p.click('.kb-card[data-key="PH-28"]');
  await p.click("#task-flag");
  assert.equal(await p.textContent("#task-flag-label"), "Flagged");
  await p.click("#f-save"); await p.waitForTimeout(150);
  assert.ok(await p.$eval('.kb-card[data-key="PH-28"]', (e) => e.classList.contains("kb-flagged")));
  await p.done();
});

await test("TC-18 modal: pinned action bar, collapsible details column remembered", async () => {
  const p = await open("#staff-kanban", { width: 1440, height: 760 });
  await p.click('.kb-card[data-key="PH-20"]');
  for (const pos of [0, 99999]) {
    await p.$eval(".kb-task-panel", (el, y) => { el.scrollTop = y; }, pos);
    const ok = await p.evaluate(() => { const pn = document.querySelector(".kb-task-panel").getBoundingClientRect(), s = document.getElementById("f-save").getBoundingClientRect(); return s.top >= pn.top && s.bottom <= pn.bottom; });
    assert.ok(ok, "Save visible");
  }
  const before = await p.$eval('[data-field="description"]', (e) => e.getBoundingClientRect().width);
  await p.click("#task-side-toggle"); await p.waitForTimeout(250);
  const afterW = await p.$eval('[data-field="description"]', (e) => e.getBoundingClientRect().width);
  assert.ok(afterW > before + 150);
  await p.click("#f-cancel");
  await p.click('.kb-card[data-key="PH-21"]');
  assert.ok(await p.$eval(".kb-task-grid", (e) => e.classList.contains("kb-side-collapsed")));
  await p.done();
});

await test("TC-19 settings: hide or require an optional field; change the tester", async () => {
  const p = await open("#staff-kanban/settings");
  await p.click('[data-show="sprint"]'); await p.waitForTimeout(100);
  await p.click('[data-req="sprint"]'); await p.waitForTimeout(100);
  await p.selectOption("#st-tester", MINH); await p.waitForTimeout(100);
  const s = await p.evaluate(() => globalThis.__fbStub.col("kanbanSettings").get("main"));
  assert.deepEqual(s.fields.sprint, { show: true, required: true }); assert.equal(s.tester, emailOf("Minh")); assert.equal(s.updatedBy, ROB);
  await p.click('#kb-view [data-route="kanban"]'); await p.waitForSelector(".kb-card");
  await p.click("#kb-new-btn"); await p.fill("#f-title", "Needs a sprint"); await p.click("#f-save");
  assert.match(await p.textContent("#f-error"), /Sprint is required/);
  await p.click("#f-cancel");
  await p.setViewportSize({ width: 1440, height: 1600 });
  await mouseDrag(p, "PH-19", '.kb-col[data-status="ready-for-testing"] .kb-list');
  assert.equal((await where(p, "PH-19")).avatar, "Minh");
  await p.done();
});

await test("TC-20 release report: defaults to current release, filters in the URL, per-person breakdown", async () => {
  const p = await open("#staff-kanban/report");
  assert.equal(await p.textContent("#kb-view .page-header-count"), "PH 4.12");
  assert.ok((await p.$$eval(".kb-bar-row", (e) => e.length)) >= 5);
  assert.match(await p.textContent(".kb-kpis"), /28 Oct/);
  await p.evaluate(() => { location.hash = "#staff-kanban/report?release=4-12&status=all"; });
  await p.waitForTimeout(250);
  const cols = await p.$$eval(".kb-table thead th", (e) => e.map((x) => x.textContent));
  assert.ok(cols.includes("Completed") && cols.includes("Withdrawn"));
  await p.click(`.kb-click-row[data-person="${HUY}"]`);
  await p.waitForTimeout(200);
  assert.match(decodeURIComponent(await p.evaluate(() => location.hash)), new RegExp(`assignee=${HUY.replace(/\./g, "\\.")}`));
  await p.evaluate(() => { location.hash = "#staff-kanban/report?release=4-12&status=done%3Awithdrawn"; });
  await p.waitForTimeout(250);
  assert.deepEqual((await p.$$eval("[data-open]", (e) => e.map((x) => x.dataset.open))).sort(), ["PH-38", "PH-39"]);
  await p.done();
});

await test("TC-21 profile photos: Rob's photo everywhere; a new photo appears without a reload", async () => {
  const p = await open();
  assert.ok(await p.$("#profile-btn-avatar img.ph-avatar-img"), "the console's own profile button");
  assert.ok(await p.$('.kb-card[data-key="PH-15"] .kb-avatar-img'), "Rob's photo on his card");
  assert.ok(await p.$(`.kb-person-chip[data-person="${ROB}"] .kb-avatar-img`));
  assert.equal(await p.$(`.kb-person-chip[data-person="${MINH}"] .kb-avatar-img`), null);
  await p.evaluate((m) => { const b = globalThis.__fbStub; const c = b.col("memberDirectory"); c.set(m, { ...c.get(m), photoUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" }); b.notify(); }, MINH);
  await until(() => p.$(`.kb-person-chip[data-person="${MINH}"] .kb-avatar-img`), "Minh's new photo on the filter chip");
  await p.done();
});

await test("TC-22 tooltips stay inside the window (Record task tip, desktop and phone)", async () => {
  for (const size of [DESKTOP, PHONE]) {
    const p = await open("#staff-kanban", size);
    if (size === PHONE) { await p.tap("#kb-new-btn"); await p.tap("#f-voice .info-tip"); } else { await p.click("#kb-new-btn"); await p.hover("#f-voice .info-tip"); }
    await p.waitForTimeout(100);
    const r = await p.$eval(".kb-tip-bubble", (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, shown: !e.hidden }; });
    assert.ok(r.shown);
    assert.ok(r.l >= 0 && r.t >= 0 && r.r <= size.width && r.b <= size.height, JSON.stringify(r));
    await p.done();
  }
});

await test("TC-23 Agent Board and Staff Kanban are separate pages in the navigation", async () => {
  const p = await open();
  await p.click("#nav-ph-console-btn");
  await p.waitForTimeout(150);
  assert.equal(await p.$eval("#staff-kanban-page", (e) => e.hidden), true);
  assert.equal(await p.$eval("#projects-root", (e) => e.hidden), false);
  assert.equal(await p.getAttribute("#nav-ph-console-btn", "aria-current"), "page");
  await p.click("#staff-kanban-btn");
  await p.waitForSelector(".kb-card");
  assert.equal(await p.textContent("#kb-view .page-header h2"), "Staff Kanban");
  assert.equal(await p.$eval("#projects-root", (e) => e.hidden), true);
  assert.equal(await p.evaluate(() => location.hash), "#staff-kanban");
  await p.goBack(); await p.waitForTimeout(150);
  assert.equal(await p.$eval("#staff-kanban-page", (e) => e.hidden), true, "Back returns to the Agent Board");
  await p.done();
});

await test("TC-24 completed vs withdrawn via the Status menu; epic progress ignores withdrawn", async () => {
  const p = await open();
  await p.click('.kb-card[data-key="PH-26"]');
  const opts = await p.$$eval("#f-status option", (o) => o.map((x) => x.textContent));
  assert.ok(opts.includes("Completed") && opts.includes("Withdrawn") && !opts.some((t) => /Completed \//.test(t)));
  await p.selectOption("#f-status", "done:withdrawn"); await p.click("#f-save"); await p.waitForTimeout(150);
  assert.deepEqual((({ status, resolution }) => ({ status, resolution }))(await where(p, "PH-26")), { status: "done", resolution: "withdrawn" });
  assert.ok(await p.$eval('.kb-card[data-key="PH-26"]', (e) => e.classList.contains("kb-card-withdrawn")));
  await p.click('.kb-card[data-key="PH-1"]');
  await p.waitForTimeout(150);
  assert.match(await p.textContent('[data-field="children"] .field-label'), /withdrawn/);
  await p.done();
});

await test("TC-25 phone swimlanes: every lane shows the current column; swipe changes it", async () => {
  const p = await open("#staff-kanban", PHONE);
  for (const id of [ROB, HUY]) await p.tap(`.kb-person-chip[data-person="${id}"]`);
  await p.tap('.kb-pager-tab[data-col="3"]'); await p.waitForTimeout(200);
  const shown = await p.$$eval(".kb-lane-cell", (e) => e.filter((c) => getComputedStyle(c).display !== "none").map((c) => c.dataset.status));
  assert.ok(shown.length >= 1 && shown.every((s) => s === "ready-for-testing"));
  const cdp = await p.ctx.newCDPSession(p);
  for (const [type, x] of [["touchStart", 320], ["touchMove", 200], ["touchMove", 80]]) await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [{ x, y: 600 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.waitForTimeout(200);
  assert.equal(await p.$eval("#kb-board", (e) => e.dataset.col), "approved");
  await p.done();
});

// ── Console-only cases ──────────────────────────────────────────────────────
await test("KB-C1 a viewer sees the board and changes nothing", async () => {
  const p = await open("#staff-kanban", { width: 1440, height: 1600 }, { seed: kanbanSeed({ user: { email: emailOf("Thảo"), role: "viewer" } }) });
  assert.equal(await p.$("#kb-new-btn"), null, "no + New task");
  await mouseDrag(p, "PH-34", '.kb-col[data-status="in-progress"] .kb-list');
  assert.equal((await where(p, "PH-34")).status, "backlog", "drag does nothing");
  await p.click('.kb-card[data-key="PH-20"]');
  assert.equal(await p.$("#f-save"), null, "no Save");
  assert.equal(await p.$eval("#f-title", (e) => e.disabled), true);
  assert.equal(await p.$("#f-delete"), null);
  assert.equal((await writes(p, /^kanban/)).length, 0, "nothing written");
  await p.goto(p.url().replace(/#.*$/, "#staff-kanban/settings")); await p.waitForSelector(".kb-readonly-note");
  assert.equal(await p.$eval('[data-show="sprint"]', (e) => e.disabled), true);
  await p.done();
});

await test("KB-C2 mentions bell: unread count, opening one marks it read and opens the ticket", async () => {
  const seed = kanbanSeed({ extra: { kanbanNotifications: { n1: { to: ROB, from: HUY, taskKey: "PH-20", taskTitle: "Menu board preview shows RRP", kind: "comment", read: false, at: { $ts: Date.parse("2026-10-21T08:00:00Z") } } } } });
  const p = await open("#staff-kanban", DESKTOP, { seed });
  await until(async () => (await p.textContent("#kb-bell")).includes("1"), "the unread count");
  await p.click("#kb-bell");
  assert.match(await p.textContent("#kb-bell-panel"), /Huy mentioned you in a comment on PH-20/);
  await p.click(".kb-bell-item");
  await p.waitForSelector("#task-backdrop:not([hidden])");
  assert.equal(await p.textContent("#task-title-h"), "PH-20");
  assert.equal((await p.evaluate(() => globalThis.__fbStub.col("kanbanNotifications").get("n1"))).read, true);
  await p.done();
});

await test("KB-C3 Claude's draft is used when the console has a key", async () => {
  const seed = kanbanSeed();
  seed.agentDraft = { title: "Offer sweep ignores the store's time zone", description: "Stores outside London expire an hour early around DST.", type: "bug", priority: "high", assignee: HUY, release: "4-13", sprint: "", epic: "PH-1", due: "", labels: ["menu-boards"], flagged: true, estimate: 6 };
  const p = await open("#staff-kanban", DESKTOP, { seed, init: speechStub("the offer sweep is broken for stores outside london") });
  await p.click("#kb-new-btn"); await p.click("#f-record"); await p.waitForTimeout(300); await p.click("#f-record");
  await until(async () => (await p.inputValue("#f-title")).length > 0, "the draft");
  assert.equal(await p.inputValue("#f-title"), "Offer sweep ignores the store's time zone");
  assert.equal(await p.inputValue("#f-release"), "4-13");
  assert.equal(await p.inputValue("#f-epic"), "PH-1");
  assert.equal(await p.inputValue("#f-estimate"), "6h");
  assert.equal(await p.textContent("#task-flag-label"), "Flagged");
  await p.done();
});

await test("KB-C4 deep links: a report URL opens the report, and the hash follows the page", async () => {
  const p = await open("#staff-kanban/report?release=4-13");
  assert.equal(await p.textContent("#kb-view .page-header-count"), "PH 4.13");
  assert.match(await p.title(), /Release report/);
  await p.click('#kb-view [data-route="kanban"]'); await p.waitForSelector(".kb-card");
  assert.equal(await p.evaluate(() => location.hash), "#staff-kanban");
  await p.done();
});

await test("KB-C5 tablet: the menu's Staff Kanban link opens the board by touch, and the Record task button stays intact", async () => {
  for (const [w, hgt] of [[820, 1180], [1180, 820]]) {
    const op = await h.open({ seed: kanbanSeed(), hash: "", width: w, height: hgt, contextOptions: { isMobile: true, hasTouch: true } });
    const o = op.page;
    await o.waitForTimeout(800);
    if (w < 1024) { await o.tap("#nav-open-btn"); await o.waitForTimeout(450); }
    await o.tap("#staff-kanban-btn");
    await until(() => o.locator(".kb-card").count(), `the board at ${w}px`, 15000);
    assert.equal(await o.evaluate(() => location.hash), "#staff-kanban");
    await o.tap("#kb-new-btn"); await o.waitForSelector("#f-record");
    const g = await o.evaluate(() => { const d = document.querySelector(".kb-record-dot"), r = d.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), overflow: d.scrollWidth > d.clientWidth + 1 || d.scrollHeight > d.clientHeight + 1, radius: getComputedStyle(d).borderRadius }; });
    assert.deepEqual([g.w, g.h, g.overflow, g.radius], [44, 44, false, "50%"], `Record dot is a clean 44px circle at ${w}px`);
    assert.deepEqual(op.problems, [], "no page errors");
    await op.close();
  }
});

await h.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} Staff Kanban console cases passed`);
if (process.env.KB_REPORT_JSON) (await import("node:fs")).writeFileSync(process.env.KB_REPORT_JSON, JSON.stringify(results.map(([n, ok, ms, e]) => ({ name: n, ok, ms, error: e ? e.message : null })), null, 1));
if (failed.length) { for (const [n, , , e] of failed) console.log(`\n--- ${n}\n${e && e.stack}`); process.exit(1); }
