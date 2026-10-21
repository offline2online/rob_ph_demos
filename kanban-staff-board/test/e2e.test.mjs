// End-to-end suite for the Staff Kanban prototype (kanban-staff-board/prototype).
// One test per case in ../docs/E2E-TEST-PLAN.md (TC-01 … TC-66, KB-C… are the
// console's), each in a fresh browser context so localStorage starts from the
// demo data, each run once per profile of the viewport matrix (lib/profiles.mjs).
//
//   cd kanban-staff-board/test && npm install && npx playwright install chromium firefox webkit && npm test
//   KB_PROFILES=quick npm test            desktop 1440 + phone 390 only
//   KB_PROFILES=phone-390-chromium npm test
//   KB_ONLY=TC-45 npm test                cases whose id starts with that
//   KB_ENGINES=chromium npm test          without Firefox and WebKit
// (the sandbox's global Playwright is used when there is no local install).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { wantedProfiles, launchEngines, contextOptions } from "./lib/profiles.mjs";
import { where, press, sleep, moveBy, dragCard, toastText } from "./lib/driver.mjs";
import { defineNewCases } from "./lib/cases.mjs";

let pw;
try { pw = await import("playwright"); } catch { pw = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright"); }

const here = dirname(fileURLToPath(import.meta.url));
const BASE = pathToFileURL(resolve(here, "../prototype/index.html")).href;

const profiles = wantedProfiles();
const { launched, missing } = await launchEngines(pw, { chromium: () => pw.chromium.launch(), firefox: () => pw.firefox.launch(), webkit: () => pw.webkit.launch() }, profiles);
after(async () => {
  for (const b of launched.values()) await b.close();
  if (missing.length) console.log(`# NOT RUN — engine not available here: ${missing.map((m) => `${m.engine} (${m.reason})`).join("; ")}`);
});

// Registers one test per profile where `on(profile)` holds. `fn(profile)` runs it.
const ONLY = process.env.KB_ONLY || "";
function T(id, title, opts, fn) {
  if (typeof opts === "function") { fn = opts; opts = {}; }
  if (ONLY && !id.startsWith(ONLY)) return;
  for (const prof of profiles) {
    if (opts.on && !opts.on(prof)) continue;
    const name = `${id} ${title} [${prof.id}]`;
    if (!launched.has(prof.engine)) { test(name, { skip: `${prof.engine} is not installed here` }, () => {}); continue; }
    if (opts.skip) { test(name, { skip: opts.skip }, () => {}); continue; }
    if (opts.known) { test(name, { timeout: opts.timeout || 180000 }, () => knownDefect(id, prof, opts.known, fn)); continue; }
    test(name, { timeout: opts.timeout || 180000 }, () => withRetry(id, prof, fn));
  }
}
// A case that asserts the CORRECT behaviour of a defect the suite found. It is reported, not failed,
// until the defect is fixed (then it says so; delete the `known` option from the case).
const KNOWN = (globalThis.__kbKnown ||= []);
// A run that fails is run once more in a fresh browser context before it counts as failed (KB_RETRIES=0 turns this off).
// A pass on the retry is printed as FLAKY so it can be chased, but it does not raise a bug ticket on its own.
const FLAKY = (globalThis.__kbFlaky ||= []);
const RETRIES = +(process.env.KB_RETRIES ?? 1);
const LIVE = [];
const sweep = () => Promise.all(LIVE.splice(0).map((c) => c.close().catch(() => {})));
async function withRetry(id, prof, fn) {
  for (let attempt = 0; ; attempt++) {
    try { await fn(prof); await sweep(); if (attempt) { console.log(`# FLAKY ${id} [${prof.id}]: failed, passed on retry ${attempt}`); FLAKY.push({ id, profile: prof.id }); } return; }
    catch (e) { await sweep(); if (attempt >= RETRIES) throw e; console.log(`# RETRY ${id} [${prof.id}]: ${String(e && e.message).split("\n")[0]}`); }
  }
}
async function knownDefect(id, prof, why, fn) {
  try { await fn(prof); console.log(`# FIXED ${id} [${prof.id}]: passes now. Remove "known" from the case. (${why})`); KNOWN.push({ id, profile: prof.id, fixed: true, why }); }
  catch (e) { console.log(`# KNOWN DEFECT ${id} [${prof.id}]: ${why} — ${String(e && e.message).split("\n")[0]}`); KNOWN.push({ id, profile: prof.id, fixed: false, why, error: String(e && e.message).split("\n")[0] }); }
}
const on = {
  all: () => true,
  notPhone: (p) => p.kind !== "phone",
  phone: (p) => p.kind === "phone",
  touch: (p) => p.touch,
  mouse: (p) => !p.touch,
  wide: (p) => p.width >= 1024,
  desktop: (p) => p.kind === "desktop",
};

// Opens the board in a fresh context; collects page errors, which every test asserts are none.
async function open(prof, hash = "#kanban", o = {}) {
  const context = await launched.get(prof.engine).newContext(contextOptions(prof, o));
  LIVE.push(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (o.init) await page.addInitScript(o.init.fn, o.init.arg);
  await page.goto(BASE + hash);
  await page.waitForSelector(".kb-col, .page-header");
  await page.waitForTimeout(150);
  page.profile = prof; page.engine = prof.engine; page.ctx = context;
  page.done = async () => { assert.deepEqual(errors, [], "no page errors"); await context.close(); };
  page.errors = errors;
  return page;
}
// Taller window for a case that drags: width, engine and input stay the profile's.
const TALL = { height: 1600 };
// The phone has no sidebar: its menu is the tab bar and a drawer behind the hamburger.
async function goRoute(p, route) {
  if (p.profile.kind === "phone") return press(p, `.tab[data-route="${route}"]`);
  if (p.profile.width < 1024) { await press(p, "#nav-open-btn"); await p.waitForTimeout(250); }
  return press(p, `.nav-drawer-item[data-route="${route}"]`);
}
// Speech and microphone stubs: the "recording" says `phrase`.
const speechStub = (phrase) => ({
  arg: phrase,
  fn: (said) => {
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    window.SpeechRecognition = class { start() { setTimeout(() => this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: said }], { isFinal: true })] }), 150); } stop() { setTimeout(() => this.onend && this.onend(), 10); } abort() {} };
  },
});
// A drag by the profile's own input (mouse, or touch on tablets), tall window assumed.
const move = (p, key, status) => (status === "done" ? dragCard(p, key, { zone: "completed" }) : dragCard(p, key, { status }));
const methodOf = (p) => (p.profile.kind === "phone" ? "status" : p.profile.touch ? "touch" : "drag");

// ── TC-01 … TC-25: the signed-off cases, now across the viewport matrix ────

T("TC-01", "board renders six columns with counts, keys and the pinned header row", async (prof) => {
  const p = await open(prof);
  const heads = await p.$$eval("#kb-lanes-head .kb-col-title", (e) => e.map((x) => x.textContent));
  assert.deepEqual(heads, ["Backlog", "Ready for Dev", "In Progress", "Ready for Testing", "Approved for Deployment", "Completed / Withdrawn"]);
  assert.equal(await p.textContent(".page-header h2"), "Staff Kanban");
  assert.match(await p.textContent("#kb-count"), /^\d+ tasks$/);
  const keys = await p.$$eval(".kb-card .kb-key", (e) => e.map((x) => x.textContent));
  assert.ok(keys.length > 30 && keys.every((k) => /^PH-\d+$/.test(k)));
  assert.equal(await p.textContent('.nav-drawer-item[data-route="kanban"]'), "view_kanbanStaff Kanban");
  await p.done();
});

T("TC-02", "drag a card from Backlog to In Progress", { on: on.notPhone }, async (prof) => {
  const p = await open(prof, "#kanban", TALL);
  await moveBy(p, methodOf(p) === "touch" ? "touch" : "drag", "PH-34", "in-progress");
  assert.equal((await where(p, "PH-34")).status, "in-progress");
  assert.match(await p.textContent("#kb-toast"), /PH-34 moved to In Progress/);
  await p.done();
});

T("TC-03", "Ready for Testing reassigns to the tester; moving back returns it to the developer", async (prof) => {
  const p = await open(prof, "#kanban", TALL);
  const m = methodOf(p);
  await moveBy(p, m, "PH-19", "ready-for-testing");
  let w = await where(p, "PH-19");
  assert.equal(w.status, "ready-for-testing");
  assert.equal(w.avatar, "Rob");
  assert.match(await p.textContent("#kb-toast"), /reassigned to Rob for testing/);
  assert.match(await p.textContent('.kb-card[data-key="PH-19"] .kb-handoff'), /From Đức/);
  await moveBy(p, m, "PH-19", "in-progress");
  w = await where(p, "PH-19");
  assert.equal(w.status, "in-progress");
  assert.equal(w.avatar, "Đức");
  await p.done();
});

T("TC-04", "drop targets: Completed (3/4) and Withdrawn (1/4) replace the last column while dragging", { on: on.notPhone }, async (prof) => {
  const p = await open(prof);
  await p.evaluate(() => scrollTo(0, 400));
  const { P } = await dragCard(p, "PH-21", { zone: "withdrawn" }, { hold: true, scrollTop: false });
  const z = await p.$$eval(".kb-close-zone", (e) => e.map((x) => ({ r: x.dataset.resolution, h: x.getBoundingClientRect().height })));
  assert.equal(z.length, 2);
  const ratio = z[0].h / z[1].h;
  assert.ok(ratio > 2.6 && ratio < 3.4, `3:1 split, got ${ratio}`);
  assert.equal(await p.$eval('.kb-col[data-status="done"] .kb-res-split', (e) => getComputedStyle(e).visibility), "hidden");
  await P.up(); await p.waitForTimeout(220);
  assert.deepEqual((({ status, resolution }) => ({ status, resolution }))(await where(p, "PH-21")), { status: "done", resolution: "withdrawn" });
  assert.equal(await p.$(".kb-close-zones"), null);
  assert.match(await p.textContent("#kb-lanes-head .kb-col-done"), /3/);
  await p.done();
});

T("TC-05", "touch: press-and-hold drag moves a card", { on: (p) => p.touch && p.kind !== "phone" }, async (prof) => {
  const p = await open(prof);
  await dragCard(p, "PH-27", { status: "in-progress" }, { input: "touch" });
  assert.equal((await where(p, "PH-27")).status, "in-progress");
  assert.equal(await p.$eval("#task-backdrop", (e) => e.hidden), true, "the drag did not open the task");
  await p.done();
});

T("TC-06", "staff filter makes swimlanes; dragging into another lane reassigns", { on: on.notPhone }, async (prof) => {
  const p = await open(prof, "#kanban", { height: 2000 });
  for (const id of ["linh", "huy"]) await press(p, `.kb-person-chip[data-person="${id}"]`);
  assert.deepEqual(await p.$$eval(".kb-lane", (e) => e.map((x) => x.dataset.lane)), ["linh", "huy"]);
  await dragCard(p, "PH-29", { sel: '.kb-lane-cell[data-lane="linh"][data-status="in-progress"]' });
  const w = await where(p, "PH-29");
  assert.equal(w.lane, "linh"); assert.equal(w.status, "in-progress");
  await press(p, '.kb-lane[data-lane="huy"] .kb-lane-head');
  assert.equal(await p.$$eval('.kb-lane-cell[data-lane="huy"].kb-cell-hidden', (e) => e.length), 6);
  await press(p, "#kb-lanes-expand");
  assert.equal(await p.$$eval(".kb-cell-hidden", (e) => e.length), 0);
  await p.done();
});

T("TC-07", "My tasks shows only the signed-in person's tasks", async (prof) => {
  const p = await open(prof);
  await press(p, "#kb-mine");
  const avatars = await p.$$eval(".kb-card .kb-card-footer .kb-avatar", (e) => e.map((x) => x.title));
  assert.ok(avatars.length > 0 && avatars.every((a) => a === "Rob"));
  await p.done();
});

T("TC-08", "secondary filters live in the Filters menu; a filter change keeps the scroll position", async (prof) => {
  const p = await open(prof, "#kanban", { height: Math.min(prof.height, 700) });
  assert.equal(await p.$eval("#kb-filter-panel", (e) => e.hidden), true);
  await press(p, "#kb-filter-toggle");
  await p.selectOption("#kb-type", "bug");
  await p.waitForTimeout(100);
  assert.equal(await p.$eval("#kb-filter-panel", (e) => e.hidden), false, "menu stays open while adjusting");
  const types = await p.$$eval(".kb-card .kb-type", (e) => e.map((x) => x.title));
  assert.ok(types.length && types.every((t) => t === "Bug"));
  await press(p, "#kb-filter-done");
  assert.match(await p.textContent("#kb-filter-toggle"), /Filters\s*1/);
  await press(p, "#kb-clear");
  await p.selectOption("#kb-release", "4.12");
  const y = await p.evaluate(() => { const y = Math.min(400, document.documentElement.scrollHeight - innerHeight - 40); scrollTo(0, y); return y; });
  assert.ok(y > 100, `the page is tall enough to scroll (${y})`);
  await p.selectOption("#kb-release", "");
  await p.waitForTimeout(150);
  assert.equal(await p.evaluate(() => scrollY), y);
  await press(p, "#kb-filter-toggle"); await press(p, "#kb-flagged");
  const flagged = await p.$$eval(".kb-card", (e) => e.every((c) => c.classList.contains("kb-flagged")));
  assert.ok(flagged);
  await p.done();
});

T("TC-09", "filter bar and column headers stay pinned; filter bar fits one line from 1024px", { on: on.wide }, async (prof) => {
  const p = await open(prof);
  await press(p, "#kb-mine");
  for (const id of ["rob", "minh", "linh", "huy", "thao", "duc", "none"]) await press(p, `.kb-person-chip[data-person="${id}"]`);
  await p.selectOption("#kb-release", "4.12");
  const rows = await p.$$eval(".kb-filters > *", (e) => new Set(e.map((x) => Math.round(x.getBoundingClientRect().top))).size);
  assert.equal(rows, 1, `one line at ${prof.width}`);
  await p.evaluate(() => scrollTo(0, 800));
  await p.waitForTimeout(100);
  assert.equal(await p.$eval("#kb-sticky", (e) => Math.round(e.getBoundingClientRect().top)), 0);
  const head = await p.$$eval("#kb-lanes-head .kb-lanes-head", (e) => e.map((x) => Math.round(x.getBoundingClientRect().left)));
  const cells = await p.$$eval('.kb-lane-cell[data-lane="rob"]', (e) => e.map((x) => Math.round(x.getBoundingClientRect().left)));
  assert.deepEqual(head, cells, "pinned headers line up with the columns");
  await p.done();
});

T("TC-10", "phone: columns are a carousel; tabs and swipe change column; no sideways page scroll", { on: on.phone }, async (prof) => {
  const p = await open(prof);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), prof.width);
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

T("TC-11", "new task: required fields, type-specific button, starts in Backlog with a PH key", async (prof) => {
  const p = await open(prof);
  await press(p, "#kb-new-btn");
  assert.equal(await p.$('[data-field="status"]'), null, "no Status on a new task");
  assert.equal(await p.$('[data-field="comments"]'), null, "no Comments on a new task");
  const order = await p.$$eval(".kb-task-side .kb-field:not([hidden])", (e) => e.map((x) => x.dataset.field));
  assert.deepEqual(order.slice(0, 8), ["priority", "type", "epic", "assignee", "reporter", "release", "estimate", "logged"]);
  for (const [t, cta] of [["bug", "Raise bug"], ["epic", "Create epic"], ["task", "Create task"]]) {
    await press(p, `.type-opt[data-type="${t}"]`);
    assert.equal(await p.textContent("#f-save"), cta);
  }
  await press(p, "#f-save");
  assert.match(await p.textContent("#f-error"), /Title is required/);
  await p.fill("#f-title", "E2E created task");
  await p.fill("#f-estimate", "1d 4h");
  await press(p, "#f-save");
  await p.waitForTimeout(150);
  assert.match(await p.textContent("#kb-toast"), /PH-40 created in Backlog/);
  assert.equal((await where(p, "PH-40")).status, "backlog");
  assert.match(await p.textContent('.kb-card[data-key="PH-40"] .kb-est'), /1d 4h left/);
  await p.done();
});

T("TC-12", "voice: Record task fills title, description and details, marked Agent", async (prof) => {
  const p = await open(prof, "#kanban", { init: speechStub("so there's a bug where the menu board preview shows the wrong price for Welsh stores. it's urgent. assign it to Huy. it should take about four hours for the current release") });
  await press(p, "#kb-new-btn");
  await press(p, "#f-record");
  await p.waitForTimeout(400);
  assert.equal(await p.textContent("#f-record-label"), "Stop recording");
  await press(p, "#f-record");
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

T("TC-13", "rich description: link, @mention, screenshot, table and callout survive save and reload", async (prof) => {
  const p = await open(prof);
  await press(p, '.kb-card[data-key="PH-20"]');
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
  await press(p, "#f-save");
  await p.waitForTimeout(200);
  await p.reload(); await p.waitForTimeout(200);
  await press(p, '.kb-card[data-key="PH-20"]');
  const html = await p.$eval(ed, (e) => e.innerHTML);
  assert.match(html, /<a href="https:\/\/offline2online\.com\/menu-board"/);
  assert.match(html, /data-user="minh"/);
  assert.match(html, /<img src="data:image/);
  assert.match(html, /faq-table/);
  assert.match(html, /callout-warning/);
  await p.done();
});

T("TC-14", "comments: rich comment with @mention, and a dictated comment via the round mic", async (prof) => {
  const p = await open(prof, "#kanban", { init: speechStub("checked this on the Covent Garden store and it is fixed") });
  await press(p, '.kb-card[data-key="PH-23"]');
  const mic = await p.$eval("#f-comment-mic", (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  assert.deepEqual(mic, [36, 36], "round mic");
  await press(p, "#f-comment-mic"); await p.waitForTimeout(300);
  assert.equal(await p.textContent("#f-comment-mic"), "stop");
  await press(p, "#f-comment-mic"); await p.waitForTimeout(400);
  assert.equal(await p.textContent("#f-comment-mic"), "mic");
  await p.click('[data-field="comments"] .ql-editor'); await p.keyboard.press("Control+End"); await p.keyboard.type(" @hu"); await p.waitForTimeout(100); await p.keyboard.press("Enter");
  await press(p, "#f-comment-add"); await p.waitForTimeout(100);
  const last = await p.$$eval(".kb-comment-text", (e) => e[e.length - 1].innerHTML);
  assert.match(last, /Checked this on the Covent Garden store and it is fixed/);
  assert.match(last, /data-user="huy"/);
  assert.match(await p.textContent("#kb-toast"), /Huy notified/);
  await p.done();
});

T("TC-15", "epics: create an epic, add a bug from inside it, add and remove an existing ticket", async (prof) => {
  const p = await open(prof);
  await press(p, "#kb-new-btn");
  await press(p, '.type-opt[data-type="epic"]');
  await p.fill("#f-title", "Loyalty app pilot");
  await press(p, '[data-add-child="bug"]');
  await p.waitForTimeout(150);
  assert.equal(await p.textContent("#task-title-h"), "New bug");
  assert.equal(await p.inputValue("#f-epic"), "PH-40");
  await p.fill("#f-title", "Points balance not refreshing");
  await press(p, "#f-save"); await p.waitForTimeout(150);
  assert.equal(await p.textContent("#task-title-h"), "PH-40");
  assert.deepEqual(await p.$$eval("[data-open-child]", (e) => e.map((x) => x.dataset.openChild)), ["PH-41"]);
  await press(p, "#f-child-link .kb-picker-input"); await p.keyboard.type("PH-36"); await p.waitForTimeout(80); await p.keyboard.press("Enter");
  await p.waitForTimeout(150);
  assert.deepEqual((await p.$$eval("[data-open-child]", (e) => e.map((x) => x.dataset.openChild))).sort(), ["PH-36", "PH-41"]);
  await press(p, '[data-unlink-child="PH-36"]'); await p.waitForTimeout(100);
  assert.deepEqual(await p.$$eval("[data-open-child]", (e) => e.map((x) => x.dataset.openChild)), ["PH-41"]);
  await press(p, "#f-cancel");
  assert.match(await p.textContent('.kb-card[data-key="PH-41"] .kb-parent-epic'), /Loyalty app pilot/);
  await p.done();
});

T("TC-16", "ticket search picker: number, title words, description words with snippet", async (prof) => {
  const p = await open(prof);
  await press(p, '.kb-card[data-key="PH-1"]');
  const inp = "#f-child-link .kb-picker-input";
  await press(p, inp);
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

T("TC-17", "flags: quick flag on a card, Flag toggle in the modal", async (prof) => {
  const p = await open(prof);
  if (!prof.touch) await p.hover('.kb-card[data-key="PH-27"]');
  await press(p, '.kb-card[data-key="PH-27"] .kb-flag-btn');
  assert.ok(await p.$eval('.kb-card[data-key="PH-27"]', (e) => e.classList.contains("kb-flagged")));
  assert.equal(await p.$eval("#task-backdrop", (e) => e.hidden), true);
  await press(p, '.kb-card[data-key="PH-28"]');
  await press(p, "#task-flag");
  assert.equal(await p.textContent("#task-flag-label"), "Flagged");
  await press(p, "#f-save"); await p.waitForTimeout(100);
  assert.ok(await p.$eval('.kb-card[data-key="PH-28"]', (e) => e.classList.contains("kb-flagged")));
  await p.done();
});

T("TC-18", "modal: pinned action bar, collapsible details column remembered", { on: on.wide }, async (prof) => {
  const p = await open(prof, "#kanban", { height: 760 });
  await press(p, '.kb-card[data-key="PH-20"]');
  for (const pos of [0, 99999]) {
    await p.$eval(".kb-task-panel", (el, y) => { el.scrollTop = y; }, pos);
    const ok = await p.evaluate(() => { const pn = document.querySelector(".kb-task-panel").getBoundingClientRect(), s = document.getElementById("f-save").getBoundingClientRect(); return s.top >= pn.top && s.bottom <= pn.bottom; });
    assert.ok(ok, "Save visible");
  }
  const before = await p.$eval('[data-field="description"]', (e) => e.getBoundingClientRect().width);
  await press(p, "#task-side-toggle"); await p.waitForTimeout(250);
  const afterW = await p.$eval('[data-field="description"]', (e) => e.getBoundingClientRect().width);
  assert.ok(afterW > before + 150);
  await press(p, "#f-cancel");
  await press(p, '.kb-card[data-key="PH-21"]');
  assert.ok(await p.$eval(".kb-task-grid", (e) => e.classList.contains("kb-side-collapsed")));
  await p.done();
});

T("TC-19", "settings: hide or require an optional field; change the tester", async (prof) => {
  const p = await open(prof, "#settings");
  await press(p, '[data-show="sprint"]');
  await press(p, '[data-req="sprint"]');
  await p.selectOption("#st-tester", "minh");
  await p.goto(BASE + "#kanban"); await p.waitForTimeout(150);
  await press(p, "#kb-new-btn"); await p.fill("#f-title", "Needs a sprint"); await press(p, "#f-save");
  assert.match(await p.textContent("#f-error"), /Sprint is required/);
  await press(p, "#f-cancel");
  await moveBy(p, methodOf(p), "PH-19", "ready-for-testing");
  assert.equal((await where(p, "PH-19")).avatar, "Minh");
  await p.done();
});

T("TC-20", "release report: defaults to current release, filters in the URL, per-person breakdown", async (prof) => {
  const p = await open(prof, "#report");
  assert.equal(await p.textContent(".page-header-count"), "PH 4.12");
  assert.ok((await p.$$eval(".kb-bar-row", (e) => e.length)) >= 5);
  await p.goto(BASE + "#report?release=4.12&status=all");
  await p.waitForTimeout(150);
  const cols = await p.$$eval(".kb-table thead th", (e) => e.map((x) => x.textContent));
  assert.ok(cols.includes("Completed") && cols.includes("Withdrawn"));
  await press(p, '.kb-click-row[data-person="huy"]');
  await p.waitForTimeout(150);
  assert.match(await p.evaluate(() => location.hash), /assignee=huy/);
  await p.goto(BASE + "#report?release=4.12&status=done%3Awithdrawn");
  await p.waitForTimeout(150);
  assert.deepEqual((await p.$$eval("[data-open]", (e) => e.map((x) => x.dataset.open))).sort(), ["PH-38", "PH-39"]);
  await p.done();
});

T("TC-21", "profile photos: Rob's photo by default; upload another person's; remove", async (prof) => {
  const p = await open(prof);
  assert.ok(await p.$("#profile-btn .kb-avatar-img"));
  assert.ok(await p.$('.kb-card[data-key="PH-15"] .kb-avatar-img'));
  const png = Buffer.from(await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 200; c.height = 300; c.getContext("2d").fillRect(0, 0, 200, 300); return c.toDataURL("image/png").split(",")[1]; }), "base64");
  await p.goto(BASE + "#settings"); await p.waitForTimeout(100);
  await p.setInputFiles('[data-photo-for="minh"]', { name: "m.png", mimeType: "image/png", buffer: png });
  await p.waitForTimeout(300);
  await p.goto(BASE + "#kanban"); await p.waitForTimeout(150);
  assert.ok(await p.$('.kb-person-chip[data-person="minh"] .kb-avatar-img'));
  await p.evaluate(() => document.getElementById("profile-btn").click()); await p.evaluate(() => document.getElementById("kb-photo-remove").click()); await p.waitForTimeout(100);
  assert.equal(await p.$("#profile-btn .kb-avatar-img"), null);
  await p.done();
});

T("TC-22", "tooltips stay inside the window (Record task tip)", async (prof) => {
  const p = await open(prof);
  await press(p, "#kb-new-btn");
  if (prof.touch) await p.tap("#f-voice .info-tip"); else await p.hover("#f-voice .info-tip");
  await p.waitForTimeout(100);
  const r = await p.$eval(".kb-tip-bubble", (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, shown: !e.hidden }; });
  assert.ok(r.shown);
  assert.ok(r.l >= 0 && r.t >= 0 && r.r <= prof.width && r.b <= prof.height, JSON.stringify(r));
  await p.done();
});

T("TC-23", "Agent Board is a separate page in the navigation", async (prof) => {
  const p = await open(prof, "#agent-board");
  assert.equal(await p.textContent(".page-header h2"), "Agent Board");
  assert.ok(await p.$('.nav-drawer-item[data-route="agent-board"][aria-current="page"]'));
  await goRoute(p, "kanban");
  await p.waitForTimeout(100);
  assert.equal(await p.textContent(".page-header h2"), "Staff Kanban");
  await p.done();
});

T("TC-24", "completed vs withdrawn via the Status menu; epic progress ignores withdrawn", async (prof) => {
  const p = await open(prof);
  await press(p, '.kb-card[data-key="PH-26"]');
  const opts = await p.$$eval("#f-status option", (o) => o.map((x) => x.textContent));
  assert.ok(opts.includes("Completed") && opts.includes("Withdrawn") && !opts.some((t) => /Completed \//.test(t)));
  await p.selectOption("#f-status", "done:withdrawn"); await press(p, "#f-save"); await p.waitForTimeout(100);
  assert.deepEqual((({ status, resolution }) => ({ status, resolution }))(await where(p, "PH-26")), { status: "done", resolution: "withdrawn" });
  assert.ok(await p.$eval('.kb-card[data-key="PH-26"]', (e) => e.classList.contains("kb-card-withdrawn")));
  await press(p, '.kb-card[data-key="PH-1"]');
  assert.match(await p.textContent('[data-field="children"] .field-label'), /withdrawn/);
  await p.done();
});

T("TC-25", "phone swimlanes: every lane shows the current column; swipe changes it", { on: on.phone }, async (prof) => {
  const p = await open(prof);
  for (const id of ["rob", "huy"]) await p.tap(`.kb-person-chip[data-person="${id}"]`);
  await p.tap('.kb-pager-tab[data-col="3"]'); await p.waitForTimeout(200);
  const shown = await p.$$eval(".kb-lane-cell", (e) => e.filter((c) => getComputedStyle(c).display !== "none").map((c) => c.dataset.status));
  assert.ok(shown.length >= 1 && shown.every((s) => s === "ready-for-testing"));
  if (prof.engine === "chromium") {
    // a real swipe: touch events over the DevTools protocol
    const cdp = await p.context().newCDPSession(p);
    for (const [type, x] of [["touchStart", prof.width - 70], ["touchMove", prof.width / 2], ["touchMove", 80]]) await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [{ x, y: 600 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    // no touch channel in WebKit/Firefox: scroll the carousel one column, as the swipe's scroll-snap would
    await p.evaluate(() => { const w = document.getElementById("kb-board-wrap"); w.style.scrollBehavior = "auto"; w.scrollLeft = w.querySelectorAll(".kb-col")[4].offsetLeft - 12; });
  }
  await p.waitForTimeout(300);
  assert.equal(await p.$eval("#kb-board", (e) => e.dataset.col), "approved");
  await p.done();
});

// ── TC-26 … TC-66 (lib/cases.mjs, shared with the console suite) ───────────
const E = {
  T, on, assert, open, goRoute, TALL, speechStub, methodOf, BASE,
  isConsole: false,
  sel: { title: ".page-header h2", count: ".page-header-count" },
  person: (id) => ({ rob: "Rob", huy: "Huy", linh: "Linh", minh: "Minh", thao: "Thảo", duc: "Đức" }[id] || id), // the name an avatar shows
  pid: (id) => id, // the id a filter chip / lane carries
  rel: (id) => id,
  snapshot: (p, key) => p.evaluate((k) => { const raw = localStorage.getItem("kb-proto-v4"); const t = (raw ? JSON.parse(raw).tasks : window.KB_SEED.tasks).find((x) => x.key === k); return { status: t.status, resolution: t.resolution || null, assignee: t.assignee, open: t.status !== "done", closedAt: null, activity: (t.activity || []).map((a) => a.text) }; }, key),
  hash: (route, q) => "#" + route + (q ? "?" + q : ""),
  // every ticket as the page holds it, ids as the chips and selects use them
  tasks: (p) => p.evaluate(() => { const raw = localStorage.getItem("kb-proto-v4"); return (raw ? JSON.parse(raw).tasks : window.KB_SEED.tasks).map((t) => ({ key: t.key, type: t.type, title: t.title, description: t.description || "", status: t.status, resolution: t.resolution || null, assignee: t.assignee || "", release: t.release || "", priority: t.priority || "", sprint: t.sprint || "", labels: t.labels || [], flagged: !!t.flagged, estimate: t.estimate, logged: t.logged })); }),
  go: async (p, route, q) => { await p.evaluate((h) => { location.hash = h; }, "#" + route + (q ? "?" + q : "")); await sleep(180); },
  // The prototype confirms with the browser's own dialog.
  // Profile photos: the prototype keeps a data URL in its own state.
  photoOpts: () => ({}),
  openProfile: async (p) => { if (await p.$eval("#profile-btn", (e) => e.getClientRects().length > 0).catch(() => false)) await p.evaluate(() => document.getElementById("profile-btn").click()); else await p.evaluate(() => document.querySelector('.tab[data-tab="profile"]').click()); await sleep(200); },
  closeProfile: (p) => p.evaluate(() => { document.getElementById("nav-drawer-backdrop").click(); document.getElementById("profile-menu").hidden = true; }),
  upload: async (p, file) => { await E.openProfile(p); await p.setInputFiles("#kb-photo-input", file); await sleep(350); await E.closeProfile(p); },
  removePhoto: async (p) => { await E.openProfile(p); if (await p.$("#kb-photo-remove")) await p.evaluate(() => document.getElementById("kb-photo-remove").click()); await sleep(200); await E.closeProfile(p); },
  photoError: async (p) => (await toastText(p)),
  photoWrites: (p) => p.evaluate(() => JSON.stringify((JSON.parse(localStorage.getItem("kb-proto-v4") || "{}").photos) || {})),
  photoDims: (p, url) => p.evaluate((u) => new Promise((r) => { const i = new Image(); i.onload = () => r({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => r({ w: 0, h: 1 }); i.src = u; }), url),
  profileHasPhoto: async (p) => { await E.openProfile(p); const v = !!(await p.$("#profile-btn .kb-avatar-img")) || !!(await p.$("#profile-menu-avatar .kb-avatar-img")); await E.closeProfile(p); return v; },
  setOtherPhoto: async (p, who, file) => { await E.go(p, "settings"); await p.waitForSelector("[data-photo-for]", { state: "attached" }); await p.setInputFiles(`[data-photo-for="${E.pid(who)}"]`, file); await sleep(350); },
  confirmDelete: async (p, accept) => {
    let msg = "";
    p.once("dialog", (d) => { msg = d.message(); return accept ? d.accept() : d.dismiss(); });
    await press(p, "#f-delete"); await sleep(250);
    return msg;
  },
};
defineNewCases(E);
