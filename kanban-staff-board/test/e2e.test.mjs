// End-to-end suite for the Staff Kanban prototype (kanban-staff-board/prototype).
// One test per case in ../docs/E2E-TEST-PLAN.md (TC-01 … TC-25), each in a
// fresh browser context so localStorage starts from the demo data.
// Run: cd kanban-staff-board/test && npm install && npx playwright install chromium && npm test
// (the sandbox's global Playwright is used when there is no local install).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

let pw;
try { pw = await import("playwright"); } catch { pw = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright"); }
const { chromium } = pw;

const here = dirname(fileURLToPath(import.meta.url));
const BASE = pathToFileURL(resolve(here, "../prototype/index.html")).href;
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

// Opens the board in a fresh context; collects page errors, which every test asserts are none.
async function open(hash = "#kanban", opts = DESKTOP, init) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (init) await page.addInitScript(init.fn, init.arg);
  await page.goto(BASE + hash);
  await page.waitForSelector(".kb-col, .page-header");
  await page.waitForTimeout(150);
  page.done = async () => { assert.deepEqual(errors, [], "no page errors"); await context.close(); };
  page.ctx = context;
  return page;
}
const where = (page, key) => page.evaluate((k) => {
  const c = document.querySelector(`.kb-card[data-key="${k}"]`);
  if (!c) return null;
  const l = c.closest(".kb-list");
  return { status: c.closest(".kb-col").dataset.status, resolution: (l && l.dataset.resolution) || null, lane: c.closest(".kb-col").dataset.lane || null, avatar: (c.querySelector(".kb-card-footer .kb-avatar") || {}).title || "" };
}, key);
async function mouseDrag(page, key, targetSel, offset = { x: 40, y: 20 }) {
  const c = await (await page.$(`.kb-card[data-key="${key}"]`)).boundingBox();
  await page.mouse.move(c.x + 30, c.y + 20);
  await page.mouse.down();
  await page.mouse.move(c.x + 50, c.y + 30, { steps: 3 });
  const t = await (await page.$(targetSel)).boundingBox();
  await page.mouse.move(t.x + offset.x, t.y + offset.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}
// Speech and microphone stubs: the "recording" says `phrase`.
const speechStub = (phrase) => ({
  arg: phrase,
  fn: (said) => {
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    window.SpeechRecognition = class { start() { setTimeout(() => this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: said }], { isFinal: true })] }), 150); } stop() { setTimeout(() => this.onend && this.onend(), 10); } abort() {} };
  },
});

test("TC-01 board renders six columns with counts, keys and the pinned header row", async () => {
  const p = await open();
  const heads = await p.$$eval("#kb-lanes-head .kb-col-title", (e) => e.map((x) => x.textContent));
  assert.deepEqual(heads, ["Backlog", "Ready for Dev", "In Progress", "Ready for Testing", "Approved for Deployment", "Completed / Withdrawn"]);
  assert.equal(await p.textContent(".page-header h2"), "Staff Kanban");
  assert.match(await p.textContent("#kb-count"), /^\d+ tasks$/);
  const keys = await p.$$eval(".kb-card .kb-key", (e) => e.map((x) => x.textContent));
  assert.ok(keys.length > 30 && keys.every((k) => /^PH-\d+$/.test(k)));
  assert.equal(await p.textContent('.nav-drawer-item[data-route="kanban"]'), "view_kanbanStaff Kanban");
  await p.done();
});

test("TC-02 drag a card from Backlog to In Progress", async () => {
  const p = await open("#kanban", { viewport: { width: 1440, height: 1600 } });
  await mouseDrag(p, "PH-34", '.kb-col[data-status="in-progress"] .kb-list');
  assert.equal((await where(p, "PH-34")).status, "in-progress");
  assert.match(await p.textContent("#kb-toast"), /PH-34 moved to In Progress/);
  await p.done();
});

test("TC-03 Ready for Testing reassigns to the tester; moving back returns it to the developer", async () => {
  const p = await open("#kanban", { viewport: { width: 1440, height: 1600 } });
  await mouseDrag(p, "PH-19", '.kb-col[data-status="ready-for-testing"] .kb-list');
  let w = await where(p, "PH-19");
  assert.equal(w.status, "ready-for-testing");
  assert.equal(w.avatar, "Rob");
  assert.match(await p.textContent("#kb-toast"), /reassigned to Rob for testing/);
  assert.match(await p.textContent('.kb-card[data-key="PH-19"] .kb-handoff'), /From Đức/);
  await mouseDrag(p, "PH-19", '.kb-col[data-status="in-progress"] .kb-list');
  w = await where(p, "PH-19");
  assert.equal(w.status, "in-progress");
  assert.equal(w.avatar, "Đức");
  await p.done();
});

test("TC-04 drop targets: Completed (3/4) and Withdrawn (1/4) replace the last column while dragging", async () => {
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
  await p.mouse.move(w.x + w.width / 2, w.y + w.height / 2, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(150);
  assert.deepEqual((({ status, resolution }) => ({ status, resolution }))(await where(p, "PH-21")), { status: "done", resolution: "withdrawn" });
  assert.equal(await p.$(".kb-close-zones"), null);
  assert.match(await p.textContent("#kb-lanes-head .kb-col-done"), /3/);
  await p.done();
});

test("TC-05 touch: press-and-hold drag on a phone moves a card", async () => {
  const p = await open("#kanban", { viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true });
  const cdp = await p.ctx.newCDPSession(p);
  const c = await (await p.$('.kb-card[data-key="PH-27"]')).boundingBox();
  const t = await (await p.$('.kb-col[data-status="in-progress"] .kb-list')).boundingBox();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c.x + 30, y: c.y + 20 }] });
  await p.waitForTimeout(400);
  for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: c.x + 30 + (t.x - c.x) * i / 10, y: c.y + 20 + (t.y + 5 - c.y) * i / 10 }] }); await p.waitForTimeout(20); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.waitForTimeout(200);
  assert.equal((await where(p, "PH-27")).status, "in-progress");
  assert.equal(await p.$eval("#task-backdrop", (e) => e.hidden), true, "the drag did not open the task");
  await p.done();
});

test("TC-06 staff filter makes swimlanes; dragging into another lane reassigns", async () => {
  const p = await open("#kanban", { viewport: { width: 1440, height: 2000 } });
  for (const id of ["linh", "huy"]) await p.click(`.kb-person-chip[data-person="${id}"]`);
  assert.deepEqual(await p.$$eval(".kb-lane", (e) => e.map((x) => x.dataset.lane)), ["linh", "huy"]);
  await mouseDrag(p, "PH-29", '.kb-lane-cell[data-lane="linh"][data-status="in-progress"]');
  const w = await where(p, "PH-29");
  assert.equal(w.lane, "linh"); assert.equal(w.status, "in-progress");
  await p.click('.kb-lane[data-lane="huy"] .kb-lane-head');
  assert.equal(await p.$$eval('.kb-lane-cell[data-lane="huy"].kb-cell-hidden', (e) => e.length), 6);
  await p.click("#kb-lanes-expand");
  assert.equal(await p.$$eval(".kb-cell-hidden", (e) => e.length), 0);
  await p.done();
});

test("TC-07 My tasks shows only the signed-in person's tasks", async () => {
  const p = await open();
  await p.click("#kb-mine");
  const avatars = await p.$$eval(".kb-card .kb-card-footer .kb-avatar", (e) => e.map((x) => x.title));
  assert.ok(avatars.length > 0 && avatars.every((a) => a === "Rob"));
  await p.done();
});

test("TC-08 secondary filters live in the Filters menu; a filter change keeps the scroll position", async () => {
  const p = await open("#kanban", { viewport: { width: 1440, height: 700 } });
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
  await p.selectOption("#kb-release", "4.12");
  await p.waitForTimeout(150);
  assert.equal(await p.evaluate(() => scrollY), 400);
  await p.click("#kb-filter-toggle"); await p.click("#kb-flagged");
  const flagged = await p.$$eval(".kb-card", (e) => e.every((c) => c.classList.contains("kb-flagged")));
  assert.ok(flagged);
  await p.done();
});

test("TC-09 filter bar and column headers stay pinned; filter bar fits one line from 1024px", async () => {
  for (const w of [1440, 1024]) {
    const p = await open("#kanban", { viewport: { width: w, height: 900 } });
    await p.click("#kb-mine");
    for (const id of ["rob", "minh", "linh", "huy", "thao", "duc", "none"]) await p.click(`.kb-person-chip[data-person="${id}"]`);
    await p.selectOption("#kb-release", "4.12");
    const rows = await p.$$eval(".kb-filters > *", (e) => new Set(e.map((x) => Math.round(x.getBoundingClientRect().top))).size);
    assert.equal(rows, 1, `one line at ${w}`);
    await p.evaluate(() => scrollTo(0, 800));
    await p.waitForTimeout(100);
    assert.equal(await p.$eval("#kb-sticky", (e) => Math.round(e.getBoundingClientRect().top)), 0);
    const head = await p.$$eval("#kb-lanes-head .kb-lanes-head", (e) => e.map((x) => Math.round(x.getBoundingClientRect().left)));
    const cells = await p.$$eval('.kb-lane-cell[data-lane="rob"]', (e) => e.map((x) => Math.round(x.getBoundingClientRect().left)));
    assert.deepEqual(head, cells, "pinned headers line up with the columns");
    await p.done();
  }
});

test("TC-10 phone: columns are a carousel; tabs and swipe change column; no sideways page scroll", async () => {
  const p = await open("#kanban", PHONE);
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
  assert.equal(await p.$eval("#kb-sticky", (e) => Math.round(e.getBoundingClientRect().top)), 0);
  await p.done();
});

test("TC-11 new task: required fields, type-specific button, starts in Backlog with a PH key", async () => {
  const p = await open();
  await p.click("#kb-new-btn");
  assert.equal(await p.$('[data-field="status"]'), null, "no Status on a new task");
  assert.equal(await p.$('[data-field="comments"]'), null, "no Comments on a new task");
  const order = await p.$$eval(".kb-task-side .kb-field:not([hidden])", (e) => e.map((x) => x.dataset.field));
  assert.deepEqual(order.slice(0, 8), ["priority", "type", "epic", "assignee", "reporter", "release", "estimate", "logged"]);
  for (const [t, cta] of [["bug", "Raise bug"], ["epic", "Create epic"], ["task", "Create task"]]) {
    await p.click(`.type-opt[data-type="${t}"]`);
    assert.equal(await p.textContent("#f-save"), cta);
  }
  await p.click("#f-save");
  assert.match(await p.textContent("#f-error"), /Title is required/);
  await p.fill("#f-title", "E2E created task");
  await p.fill("#f-estimate", "1d 4h");
  await p.click("#f-save");
  await p.waitForTimeout(150);
  assert.match(await p.textContent("#kb-toast"), /PH-40 created in Backlog/);
  assert.equal((await where(p, "PH-40")).status, "backlog");
  assert.match(await p.textContent('.kb-card[data-key="PH-40"] .kb-est'), /1d 4h left/);
  await p.done();
});

test("TC-12 voice: Record task fills title, description and details, marked Agent", async () => {
  const p = await open("#kanban", DESKTOP, speechStub("so there's a bug where the menu board preview shows the wrong price for Welsh stores. it's urgent. assign it to Huy. it should take about four hours for the current release"));
  await p.click("#kb-new-btn");
  await p.click("#f-record");
  await p.waitForTimeout(400);
  assert.equal(await p.textContent("#f-record-label"), "Stop recording");
  await p.click("#f-record");
  await p.waitForTimeout(1400);
  assert.equal(await p.inputValue("#f-title"), "Menu board preview shows the wrong price for Welsh stores");
  assert.match(await p.$eval("#f-description .ql-editor", (e) => e.innerText), /wrong price for Welsh stores/);
  assert.equal(await p.inputValue("#f-priority"), "highest");
  assert.equal(await p.inputValue("#f-assignee"), "huy");
  assert.equal(await p.inputValue("#f-estimate"), "4h");
  assert.equal(await p.textContent("#f-save"), "Raise bug");
  assert.ok((await p.$$eval(".kb-agent-filled", (e) => e.length)) >= 6);
  await p.done();
});

test("TC-13 rich description: link, @mention, screenshot, table and callout survive save and reload", async () => {
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
  await p.waitForTimeout(300);
  await p.click('[data-field="description"] .ql-faqtable'); await p.click('.kb-ed-panel [data-x="ok"]');
  await p.click(ed); await p.keyboard.press("Control+End"); await p.keyboard.press("Enter"); await p.keyboard.type("Customers see the wrong price.");
  await p.click('[data-field="description"] .ql-callout .ql-picker-label');
  await p.click('[data-field="description"] .ql-callout .ql-picker-item[data-value="warning"]');
  await p.click("#f-save");
  await p.waitForTimeout(200);
  await p.reload(); await p.waitForTimeout(200);
  await p.click('.kb-card[data-key="PH-20"]');
  const html = await p.$eval(ed, (e) => e.innerHTML);
  assert.match(html, /<a href="https:\/\/offline2online\.com\/menu-board"/);
  assert.match(html, /data-user="minh"/);
  assert.match(html, /<img src="data:image/);
  assert.match(html, /faq-table/);
  assert.match(html, /callout-warning/);
  await p.done();
});

test("TC-14 comments: rich comment with @mention, and a dictated comment via the round mic", async () => {
  const p = await open("#kanban", DESKTOP, speechStub("checked this on the Covent Garden store and it is fixed"));
  await p.click('.kb-card[data-key="PH-23"]');
  const mic = await p.$eval("#f-comment-mic", (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  assert.deepEqual(mic, [36, 36], "round mic");
  await p.click("#f-comment-mic"); await p.waitForTimeout(300);
  assert.equal(await p.textContent("#f-comment-mic"), "stop");
  await p.click("#f-comment-mic"); await p.waitForTimeout(400);
  assert.equal(await p.textContent("#f-comment-mic"), "mic");
  await p.click('[data-field="comments"] .ql-editor'); await p.keyboard.press("Control+End"); await p.keyboard.type(" @hu"); await p.waitForTimeout(100); await p.keyboard.press("Enter");
  await p.click("#f-comment-add"); await p.waitForTimeout(100);
  const last = await p.$$eval(".kb-comment-text", (e) => e[e.length - 1].innerHTML);
  assert.match(last, /Checked this on the Covent Garden store and it is fixed/);
  assert.match(last, /data-user="huy"/);
  assert.match(await p.textContent("#kb-toast"), /Huy notified/);
  await p.done();
});

test("TC-15 epics: create an epic, add a bug from inside it, add and remove an existing ticket", async () => {
  const p = await open();
  await p.click("#kb-new-btn");
  await p.click('.type-opt[data-type="epic"]');
  await p.fill("#f-title", "Loyalty app pilot");
  await p.click('[data-add-child="bug"]');
  await p.waitForTimeout(150);
  assert.equal(await p.textContent("#task-title-h"), "New bug");
  assert.equal(await p.inputValue("#f-epic"), "PH-40");
  await p.fill("#f-title", "Points balance not refreshing");
  await p.click("#f-save"); await p.waitForTimeout(150);
  assert.equal(await p.textContent("#task-title-h"), "PH-40");
  assert.deepEqual(await p.$$eval("[data-open-child]", (e) => e.map((x) => x.dataset.openChild)), ["PH-41"]);
  await p.click("#f-child-link .kb-picker-input"); await p.keyboard.type("PH-36"); await p.waitForTimeout(80); await p.keyboard.press("Enter");
  await p.waitForTimeout(150);
  assert.deepEqual((await p.$$eval("[data-open-child]", (e) => e.map((x) => x.dataset.openChild))).sort(), ["PH-36", "PH-41"]);
  await p.click('[data-unlink-child="PH-36"]'); await p.waitForTimeout(100);
  assert.deepEqual(await p.$$eval("[data-open-child]", (e) => e.map((x) => x.dataset.openChild)), ["PH-41"]);
  await p.click("#f-cancel");
  assert.match(await p.textContent('.kb-card[data-key="PH-41"] .kb-parent-epic'), /Loyalty app pilot/);
  await p.done();
});

test("TC-16 ticket search picker: number, title words, description words with snippet", async () => {
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

test("TC-17 flags: quick flag on a card, Flag toggle in the modal", async () => {
  const p = await open();
  await p.hover('.kb-card[data-key="PH-27"]');
  await p.click('.kb-card[data-key="PH-27"] .kb-flag-btn');
  assert.ok(await p.$eval('.kb-card[data-key="PH-27"]', (e) => e.classList.contains("kb-flagged")));
  assert.equal(await p.$eval("#task-backdrop", (e) => e.hidden), true);
  await p.click('.kb-card[data-key="PH-28"]');
  await p.click("#task-flag");
  assert.equal(await p.textContent("#task-flag-label"), "Flagged");
  await p.click("#f-save"); await p.waitForTimeout(100);
  assert.ok(await p.$eval('.kb-card[data-key="PH-28"]', (e) => e.classList.contains("kb-flagged")));
  await p.done();
});

test("TC-18 modal: pinned action bar, collapsible details column remembered", async () => {
  const p = await open("#kanban", { viewport: { width: 1440, height: 760 } });
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

test("TC-19 settings: hide or require an optional field; change the tester", async () => {
  const p = await open("#settings");
  await p.click('[data-show="sprint"]');
  await p.click('[data-req="sprint"]');
  await p.selectOption("#st-tester", "minh");
  await p.goto(BASE + "#kanban"); await p.waitForTimeout(150);
  await p.click("#kb-new-btn"); await p.fill("#f-title", "Needs a sprint"); await p.click("#f-save");
  assert.match(await p.textContent("#f-error"), /Sprint is required/);
  await p.click("#f-cancel");
  await p.evaluate(() => { document.querySelector("#kb-board-wrap").style.height = "auto"; });
  await mouseDrag(p, "PH-19", '.kb-col[data-status="ready-for-testing"] .kb-list');
  assert.equal((await where(p, "PH-19")).avatar, "Minh");
  await p.done();
});

test("TC-20 release report: defaults to current release, filters in the URL, per-person breakdown", async () => {
  const p = await open("#report");
  assert.equal(await p.textContent(".page-header-count"), "PH 4.12");
  assert.ok((await p.$$eval(".kb-bar-row", (e) => e.length)) >= 5);
  await p.goto(BASE + "#report?release=4.12&status=all");
  await p.waitForTimeout(150);
  const cols = await p.$$eval(".kb-table thead th", (e) => e.map((x) => x.textContent));
  assert.ok(cols.includes("Completed") && cols.includes("Withdrawn"));
  await p.click('.kb-click-row[data-person="huy"]');
  await p.waitForTimeout(150);
  assert.match(await p.evaluate(() => location.hash), /assignee=huy/);
  await p.goto(BASE + "#report?release=4.12&status=done%3Awithdrawn");
  await p.waitForTimeout(150);
  assert.deepEqual((await p.$$eval("[data-open]", (e) => e.map((x) => x.dataset.open))).sort(), ["PH-38", "PH-39"]);
  await p.done();
});

test("TC-21 profile photos: Rob's photo by default; upload another person's; remove", async () => {
  const p = await open();
  assert.ok(await p.$("#profile-btn .kb-avatar-img"));
  assert.ok(await p.$('.kb-card[data-key="PH-15"] .kb-avatar-img'));
  const png = Buffer.from(await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 200; c.height = 300; c.getContext("2d").fillRect(0, 0, 200, 300); return c.toDataURL("image/png").split(",")[1]; }), "base64");
  await p.goto(BASE + "#settings"); await p.waitForTimeout(100);
  await p.setInputFiles('[data-photo-for="minh"]', { name: "m.png", mimeType: "image/png", buffer: png });
  await p.waitForTimeout(300);
  await p.goto(BASE + "#kanban"); await p.waitForTimeout(150);
  assert.ok(await p.$('.kb-person-chip[data-person="minh"] .kb-avatar-img'));
  await p.click("#profile-btn"); await p.click("#kb-photo-remove"); await p.waitForTimeout(100);
  assert.equal(await p.$("#profile-btn .kb-avatar-img"), null);
  await p.done();
});

test("TC-22 tooltips stay inside the window (Record task tip, desktop and phone)", async () => {
  for (const opts of [DESKTOP, PHONE]) {
    const p = await open("#kanban", opts);
    if (opts.isMobile) { await p.tap("#kb-new-btn"); await p.tap("#f-voice .info-tip"); } else { await p.click("#kb-new-btn"); await p.hover("#f-voice .info-tip"); }
    await p.waitForTimeout(100);
    const r = await p.$eval(".kb-tip-bubble", (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, shown: !e.hidden }; });
    assert.ok(r.shown);
    assert.ok(r.l >= 0 && r.t >= 0 && r.r <= opts.viewport.width && r.b <= opts.viewport.height, JSON.stringify(r));
    await p.done();
  }
});

test("TC-23 Agent Board is a separate page in the navigation", async () => {
  const p = await open("#agent-board");
  assert.equal(await p.textContent(".page-header h2"), "Agent Board");
  assert.ok(await p.$('.nav-drawer-item[data-route="agent-board"][aria-current="page"]'));
  await p.click('.nav-drawer-item[data-route="kanban"]');
  await p.waitForTimeout(100);
  assert.equal(await p.textContent(".page-header h2"), "Staff Kanban");
  await p.done();
});

test("TC-24 completed vs withdrawn via the Status menu; epic progress ignores withdrawn", async () => {
  const p = await open();
  await p.click('.kb-card[data-key="PH-26"]');
  const opts = await p.$$eval("#f-status option", (o) => o.map((x) => x.textContent));
  assert.ok(opts.includes("Completed") && opts.includes("Withdrawn") && !opts.some((t) => /Completed \//.test(t)));
  await p.selectOption("#f-status", "done:withdrawn"); await p.click("#f-save"); await p.waitForTimeout(100);
  assert.deepEqual((({ status, resolution }) => ({ status, resolution }))(await where(p, "PH-26")), { status: "done", resolution: "withdrawn" });
  assert.ok(await p.$eval('.kb-card[data-key="PH-26"]', (e) => e.classList.contains("kb-card-withdrawn")));
  await p.click('.kb-card[data-key="PH-1"]');
  assert.match(await p.textContent('[data-field="children"] .field-label'), /withdrawn/);
  await p.done();
});

test("TC-25 phone swimlanes: every lane shows the current column; swipe changes it", async () => {
  const p = await open("#kanban", PHONE);
  for (const id of ["rob", "huy"]) await p.tap(`.kb-person-chip[data-person="${id}"]`);
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
