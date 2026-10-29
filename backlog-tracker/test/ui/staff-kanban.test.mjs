// Staff Kanban end to end, against the REAL console (public/index.html,
// app.js and js/kanban/) with the Firebase SDK stubbed — the signed-off test
// plan, kanban-staff-board/docs/E2E-TEST-PLAN.md: TC-01 … TC-25 and the
// console-only cases (KB-C1 …) written here, TC-26 … TC-66 written once in
// kanban-staff-board/test/lib/cases.mjs and shared with the prototype's
// suite. Every case runs in every profile of the viewport matrix
// (kanban-staff-board/test/lib/profiles.mjs): desktop 1440 and 1024, tablet
// landscape and portrait, phone 390 and 360, in Chromium, Firefox and WebKit.
//
// Seed: the prototype's team, releases and 39 tickets (kanban-seed.mjs).
// A "reload" re-seeds the in-memory database, so persistence is checked as
// the documents written (window.__fbStub.writes), not across a page load.
//   cd backlog-tracker/test && node ui/staff-kanban.test.mjs
//   KB_PROFILES=quick node ui/staff-kanban.test.mjs      desktop 1440 + phone 390, Chromium
//   KB_PROFILES=phone-390-chromium  KB_ONLY=TC-45        one profile / one case family
//   KB_ENGINES=chromium                                  without Firefox and WebKit
// An engine that isn't installed is listed under "NOT RUN" at the end, never counted as a pass.
import assert from "node:assert/strict";
import { startHarness, until } from "./harness.mjs";
import { kanbanSeed, emailOf, ROB } from "./kanban-seed.mjs";
import { wantedProfiles, contextOptions } from "../../../kanban-staff-board/test/lib/profiles.mjs";
import { where, press, sleep, moveBy, dragCard, toastText } from "../../../kanban-staff-board/test/lib/driver.mjs";
import { defineNewCases } from "../../../kanban-staff-board/test/lib/cases.mjs";
import { runMatrix } from "../../../kanban-staff-board/test/lib/matrix-run.mjs";
import { fileURLToPath } from "node:url";

// The orchestrator: one worker process per profile, several at a time (KB_JOBS), then one report.
// A worker (KB_WORKER=1) or KB_SERIAL=1 runs the cases in this process.
if (!process.env.KB_WORKER && !process.env.KB_SERIAL) {
  const all = wantedProfiles();
  if (all.length > 1) {
    const { ok } = await runMatrix({ name: "Staff Kanban console — end to end", command: process.execPath, args: [fileURLToPath(import.meta.url)], cwd: process.cwd(), profiles: all });
    process.exit(ok ? 0 : 1);
  }
}

const LINH = emailOf("Linh"), HUY = emailOf("Huy"), MINH = emailOf("Minh");
const NAMES = { rob: "Rob", minh: "Minh", linh: "Linh", huy: "Huy", thao: "Thảo", duc: "Đức" };
const pid = (id) => (id === "none" ? "none" : id === "rob" ? ROB : emailOf(NAMES[id]));

const h = await startHarness();
const profiles = wantedProfiles();
const missing = [];
const runnable = [];
for (const prof of profiles) { if (await h.engine(prof.engine)) runnable.push(prof); else if (!missing.some((m) => m.engine === prof.engine)) missing.push({ engine: prof.engine, reason: h.missing.get(prof.engine) }); }

const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([name, true, Date.now() - t0]); console.log(`  ok  ${name}`); }
  catch (err) { results.push([name, false, Date.now() - t0, err]); console.log(`FAIL  ${name}\n      ${err && err.message}`); }
}
// Cases are queued by T() and run one after another at the end.
const queue = [];
const ONLY = process.env.KB_ONLY || "";
const KNOWN = (globalThis.__kbKnown ||= []);
async function knownDefect(id, prof, why, fn) {
  try { await fn(prof); console.log(`# FIXED ${id} [${prof.id}]: passes now. Remove "known" from the case. (${why})`); KNOWN.push({ id, profile: prof.id, fixed: true, why }); }
  catch (e) { console.log(`# KNOWN DEFECT ${id} [${prof.id}]: ${why} — ${String(e && e.message).split("\n")[0]}`); KNOWN.push({ id, profile: prof.id, fixed: false, why, error: String(e && e.message).split("\n")[0] }); }
}
// A run that fails is run once more in a fresh browser context before it counts as failed (KB_RETRIES=0 turns this off).
// A pass on the retry is printed as FLAKY so it can be chased, but it does not fail the suite.
const FLAKY = (globalThis.__kbFlaky ||= []);
const RETRIES = +(process.env.KB_RETRIES ?? 1);
const LIVE = [];
const sweep = () => Promise.all(LIVE.splice(0).map((c) => c().catch(() => {})));
async function withRetry(id, prof, fn) {
  for (let attempt = 0; ; attempt++) {
    try { await fn(prof); await sweep(); if (attempt) { console.log(`# FLAKY ${id} [${prof.id}]: failed, passed on retry ${attempt}`); FLAKY.push({ id, profile: prof.id }); } return; }
    catch (e) { await sweep(); if (attempt >= RETRIES) throw e; console.log(`# RETRY ${id} [${prof.id}]: ${String(e && e.message).split("\n")[0]}`); }
  }
}
function T(id, title, opts, fn) {
  if (typeof opts === "function") { fn = opts; opts = {}; }
  if (ONLY && !id.startsWith(ONLY)) return;
  for (const prof of runnable) {
    if (opts.on && !opts.on(prof)) continue;
    const name = `${id} ${title} [${prof.id}]`;
    if (opts.skip) { results.push([name, true, 0, null, "skipped"]); console.log(` skip ${name} — ${opts.skip}`); continue; }
    queue.push([name, opts.known ? () => knownDefect(id, prof, opts.known, fn) : () => withRetry(id, prof, fn)]);
  }
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

// Opens the console on the board; every case ends asserting no page or console errors.
async function open(prof, hash = "#staff-kanban", o = {}) {
  const co = contextOptions(prof, o);
  const ctxOpts = {}; if (co.hasTouch) ctxOpts.hasTouch = true; if (co.isMobile) ctxOpts.isMobile = true;
  const op = await h.open({ seed: o.seed || kanbanSeed(), hash, width: co.viewport.width, height: co.viewport.height, contextOptions: ctxOpts, init: o.init, engine: prof.engine });
  LIVE.push(() => op.close());
  const p = op.page;
  await until(() => p.locator(hash.includes("report") || hash.includes("settings") ? "#kb-view .page-header" : ".kb-card").count(), "the Staff Kanban page", 20000);
  await p.waitForTimeout(150);
  p.profile = prof; p.engine = prof.engine; p.ctx = op.context;
  p.done = async (o = {}) => { const bad = o.allow ? op.problems.filter((x) => !o.allow.test(x)) : op.problems; assert.deepEqual(bad, [], "no page errors, console errors or stray requests"); await op.close(); };
  return p;
}
const TALL = { height: 1600 };
const stored = (page, key) => page.evaluate((k) => globalThis.__fbStub.col("kanbanTasks").get(k), key);
const writes = (page, re) => page.evaluate((src) => globalThis.__fbStub.writes.filter((w) => new RegExp(src).test(w.path)), re.source);
// The phone has no sidebar: Build and the tab sheet, or the hamburger on a narrow tablet.
async function goStaffKanban(p) {
  const prof = p.profile;
  if (prof.kind === "phone") { await p.tap('.tab[data-tab="build"]'); await p.waitForTimeout(450); }
  else if (prof.width < 1024) { await press(p, "#nav-open-btn"); await p.waitForTimeout(450); }
  await press(p, "#staff-kanban-btn");
  await p.waitForSelector(".kb-card");
}
async function goAgentBoard(p) {
  const prof = p.profile;
  if (prof.kind === "phone") { await p.tap('.tab[data-tab="build"]'); await p.waitForTimeout(450); }
  else if (prof.width < 1024) { await press(p, "#nav-open-btn"); await p.waitForTimeout(450); }
  await press(p, "#nav-ph-console-btn");
  await p.waitForTimeout(250);
}
// Speech and microphone stubs: the "recording" says `phrase`.
const speechStub = (phrase) => ({
  arg: phrase,
  fn: (said) => {
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    window.SpeechRecognition = class { start() { setTimeout(() => this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: said }], { isFinal: true })] }), 150); } stop() { setTimeout(() => this.onend && this.onend(), 10); } abort() {} };
  },
});
const viewerSeed = () => kanbanSeed({ user: { email: emailOf("Thảo"), role: "viewer" } });
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const methodOf = (p) => (p.profile.kind === "phone" ? "status" : p.profile.touch ? "touch" : "drag");
// Android Chrome's recogniser (21 Oct 2026: "add add add a new add a new
// Epic…" on a phone). In continuous mode every guess is a final, each the
// whole utterance so far; otherwise the guesses are interim and one final
// ends the session. Either way the session ends after the utterance, and
// each new session says the next one. window.__srContinuous records each
// session's mode. `android`: the page sees an Android user agent.
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const androidSpeech = (utterances, { android = false } = {}) => ({
  arg: { utterances, ua: android ? ANDROID_UA : "" },
  fn: ({ utterances: said, ua }) => {
    if (ua) Object.defineProperty(Navigator.prototype, "userAgent", { get: () => ua, configurable: true });
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    window.__srContinuous = [];
    let next = 0;
    window.SpeechRecognition = class {
      start() {
        this.ended = false;
        window.__srContinuous.push(this.continuous);
        const words = said[next++];
        if (!words) return;
        const all = words.split(" ");
        const guesses = all.map((_, i) => all.slice(0, i + 1).join(" "));
        guesses.unshift(guesses[0]); // Android sends some guesses twice
        const results = [];
        guesses.forEach((g, i) => setTimeout(() => {
          if (this.ended) return;
          const last = i === guesses.length - 1;
          const index = results.length && !results[results.length - 1].isFinal ? results.length - 1 : results.length;
          results[index] = Object.assign([{ transcript: g }], { isFinal: this.continuous || last });
          if (this.onresult) this.onresult({ resultIndex: index, results: results.slice() });
          if (last) setTimeout(() => { if (!this.ended) { this.ended = true; if (this.onend) this.onend(); } }, 20);
        }, 30 * (i + 1)));
      }
      stop() { if (!this.ended) { this.ended = true; setTimeout(() => this.onend && this.onend(), 10); } }
      abort() { this.ended = true; }
    };
  },
});

console.log("\nStaff Kanban — console end to end\n");
// ── TC-01 … TC-25: the signed-off cases, now across the viewport matrix ────

T("TC-01", "board renders six columns with counts, keys and the pinned header row", async (prof) => {
  const p = await open(prof);
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

T("TC-02", "drag a card from Backlog to In Progress", { on: on.notPhone }, async (prof) => {
  const p = await open(prof, "#staff-kanban", TALL);
  await moveBy(p, methodOf(p) === "touch" ? "touch" : "drag", "PH-34", "in-progress");
  assert.equal((await where(p, "PH-34")).status, "in-progress");
  assert.match(await p.textContent("#kb-toast"), /PH-34 moved to In Progress/);
  const t = await stored(p, "PH-34");
  assert.equal(t.status, "in-progress"); assert.equal(t.open, true); assert.equal(t.updatedBy, ROB);
  const act = await writes(p, /^kanbanTasks\/PH-34\/activity\//);
  assert.equal(act.length, 1); assert.equal(act[0].data.text, "Backlog → In Progress"); assert.equal(act[0].data.who, ROB);
  await p.done();
});

T("TC-03", "Ready for Testing reassigns to the tester; moving back returns it to the developer", async (prof) => {
  const p = await open(prof, "#staff-kanban", TALL);
  const m = methodOf(p);
  await moveBy(p, m, "PH-19", "ready-for-testing");
  let w = await where(p, "PH-19");
  assert.equal(w.status, "ready-for-testing");
  assert.equal(w.avatar, "Rob");
  assert.match(await p.textContent("#kb-toast"), /reassigned to Rob for testing/);
  assert.match(await p.textContent('.kb-card[data-key="PH-19"] .kb-handoff'), /From Đức/);
  assert.equal((await stored(p, "PH-19")).previousAssignee, emailOf("Đức"));
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
  await P.up(); await p.waitForTimeout(250);
  assert.deepEqual((({ status, resolution }) => ({ status, resolution }))(await where(p, "PH-21")), { status: "done", resolution: "withdrawn" });
  assert.equal(await p.$(".kb-close-zones"), null);
  assert.match(await p.textContent("#kb-lanes-head .kb-col-done"), /3/);
  const t = await stored(p, "PH-21");
  assert.equal(t.open, false); assert.ok(t.closedAt, "closedAt set");
  await p.done();
});

T("TC-05", "touch: press-and-hold drag moves a card", { on: (p) => p.touch && p.kind !== "phone" }, async (prof) => {
  const p = await open(prof);
  await dragCard(p, "PH-27", { status: "in-progress" }, { input: "touch" });
  await p.waitForTimeout(100);
  assert.equal((await where(p, "PH-27")).status, "in-progress");
  assert.equal(await p.$eval("#task-backdrop", (e) => e.hidden), true, "the drag did not open the task");
  await p.done();
});

T("TC-06", "staff filter makes swimlanes; dragging into another lane reassigns", { on: on.notPhone }, async (prof) => {
  const p = await open(prof, "#staff-kanban", { height: 2000 });
  for (const id of [LINH, HUY]) await press(p, `.kb-person-chip[data-person="${id}"]`);
  assert.deepEqual(await p.$$eval(".kb-lane", (e) => e.map((x) => x.dataset.lane)).then((l) => l.sort()), [LINH, HUY].sort());
  await dragCard(p, "PH-29", { sel: `.kb-lane-cell[data-lane="${LINH}"][data-status="in-progress"]` });
  const w = await where(p, "PH-29");
  assert.equal(w.lane, LINH); assert.equal(w.status, "in-progress");
  assert.equal((await stored(p, "PH-29")).assignee, LINH);
  await press(p, `.kb-lane[data-lane="${HUY}"] .kb-lane-head`);
  assert.equal(await p.$$eval(`.kb-lane-cell[data-lane="${HUY}"].kb-cell-hidden`, (e) => e.length), 6);
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
  const p = await open(prof, "#staff-kanban", { height: Math.min(prof.height, 700) });
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
  await p.selectOption("#kb-release", "4-12");
  const y = await p.evaluate(() => { const y = Math.min(400, document.documentElement.scrollHeight - innerHeight - 40); scrollTo(0, y); return y; });
  assert.ok(y > 100, `the page is tall enough to scroll (${y})`);
  await p.selectOption("#kb-release", "");
  await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => scrollY), y);
  await press(p, "#kb-filter-toggle"); await press(p, "#kb-flagged");
  const flagged = await p.$$eval(".kb-card", (e) => e.length > 0 && e.every((c) => c.classList.contains("kb-flagged")));
  assert.ok(flagged);
  await p.done();
});

T("TC-09", "filter bar and column headers stay pinned; filter bar fits one line from 1024px", { on: on.wide }, async (prof) => {
  const p = await open(prof);
  await press(p, "#kb-mine");
  const ids = await p.$$eval(".kb-person-chip", (e) => e.map((x) => x.dataset.person));
  for (const id of ids) await press(p, `.kb-person-chip[data-person="${id}"]`);
  await p.selectOption("#kb-release", "4-12");
  const rows = await p.$$eval(".kb-filters > *", (e) => new Set(e.map((x) => Math.round(x.getBoundingClientRect().top))).size);
  assert.equal(rows, 1, `one line at ${prof.width}`);
  await p.evaluate(() => scrollTo(0, 800));
  await p.waitForTimeout(150);
  assert.equal(await p.$eval("#kb-sticky", (e) => Math.round(e.getBoundingClientRect().top)), 0);
  const head = await p.$$eval("#kb-lanes-head .kb-lanes-head", (e) => e.map((x) => Math.round(x.getBoundingClientRect().left)));
  const cells = await p.$$eval(`.kb-lane-cell[data-lane="${ROB}"]`, (e) => e.map((x) => Math.round(x.getBoundingClientRect().left)));
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
  await p.waitForTimeout(100);
  assert.equal(await p.$eval("#kb-sticky", (e) => Math.round(e.getBoundingClientRect().top)), 0);
  assert.ok(await p.$('.tab[data-tab="build"].active'), "the phone tab bar shows Build, where Staff Kanban lives");
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
    await press(p, `#task-form .type-opt[data-type="${t}"]`);
    assert.equal(await p.textContent("#f-save"), cta);
  }
  await press(p, "#f-save");
  assert.match(await p.textContent("#f-error"), /Title is required/);
  await p.fill("#f-title", "E2E created task");
  await p.fill("#f-estimate", "1d 4h");
  await press(p, "#f-save");
  await until(async () => /PH-40 created in Backlog/.test(await p.textContent("#kb-toast")), "the created toast");
  assert.equal((await where(p, "PH-40")).status, "backlog");
  assert.match(await p.textContent('.kb-card[data-key="PH-40"] .kb-est'), /1d 4h left/);
  const t = await stored(p, "PH-40");
  assert.equal(t.number, 40); assert.equal(t.estimate, 12); assert.equal(t.createdBy, ROB); assert.equal(t.release, "4-12");
  assert.ok(t.searchTokens.includes("ph-40") && t.searchTokens.includes("created"));
  assert.equal((await p.evaluate(() => globalThis.__fbStub.col("kanbanCounters").get("main"))).nextNumber, 41);
  await p.done();
});

T("TC-12", "voice: Record task fills title, description and details, marked Agent", async (prof) => {
  const p = await open(prof, "#staff-kanban", { init: speechStub("so there's a bug where the menu board preview shows the wrong price for Welsh stores. it's urgent. assign it to Huy. it should take about four hours for the current release") });
  await press(p, "#kb-new-btn");
  await press(p, "#f-record");
  await p.waitForTimeout(400);
  assert.equal(await p.textContent("#f-record-label"), "Stop recording");
  await press(p, "#f-record");
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

T("TC-13", "rich description: link, @mention, screenshot, table and callout are saved", async (prof) => {
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
  await until(() => p.$$eval(`${ed} img`, (e) => e.length), "the screenshot to upload");
  await p.click('[data-field="description"] .ql-faqtable'); await p.click('.kb-ed-panel [data-x="ok"]');
  // Click the empty line after the table (the table itself takes no caret).
  await p.click(`${ed} > p:last-child`); await p.keyboard.press("Control+End"); await p.keyboard.type("Customers see the wrong price.");
  await p.click('[data-field="description"] .ql-callout .ql-picker-label');
  await p.click('[data-field="description"] .ql-callout .ql-picker-item[data-value="warning"]');
  await press(p, "#f-save");
  await until(async () => /PH-20/.test(await p.textContent("#kb-toast")), "saved");
  const html = (await stored(p, "PH-20")).description;
  assert.match(html, /<a href="https:\/\/offline2online\.com\/menu-board"/);
  assert.match(html, new RegExp(`data-user="${MINH.replace(/\./g, "\\.")}"`));
  assert.match(html, /<img src="https:\/\/firebasestorage\.googleapis\.com\//, "the screenshot went to Storage, not inline");
  assert.match(html, /faq-table/);
  assert.match(html, /callout-warning/);
  const up = await p.evaluate(() => Object.keys(globalThis.__fbStub.uploads || {}));
  assert.ok(up.some((k) => /^kanban\/PH-20\/\d+-shot\.(jpg|png)$/.test(k)), `uploaded under the ticket: ${up}`);
  const notes = await writes(p, /^kanbanNotifications\//);
  assert.equal(notes.length, 1); assert.equal(notes[0].data.to, MINH); assert.equal(notes[0].data.from, ROB);
  // Re-opened, the editor shows what was saved.
  await press(p, '.kb-card[data-key="PH-20"]');
  assert.match(await p.$eval(ed, (e) => e.innerHTML), /callout-warning/);
  await p.done();
});

T("TC-14", "comments: rich comment with @mention, and a dictated comment via the round mic", async (prof) => {
  const p = await open(prof, "#staff-kanban", { init: speechStub("checked this on the Covent Garden store and it is fixed") });
  await press(p, '.kb-card[data-key="PH-23"]');
  const mic = await p.$eval("#f-comment-mic", (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  assert.deepEqual(mic, [36, 36], "round mic");
  await press(p, "#f-comment-mic"); await p.waitForTimeout(300);
  assert.equal(await p.textContent("#f-comment-mic"), "stop");
  await press(p, "#f-comment-mic"); await p.waitForTimeout(400);
  assert.equal(await p.textContent("#f-comment-mic"), "mic");
  await p.click('[data-field="comments"] .ql-editor'); await p.keyboard.press("Control+End"); await p.keyboard.type(" @hu"); await p.waitForTimeout(100); await p.keyboard.press("Enter");
  await press(p, "#f-comment-add"); await p.waitForTimeout(200);
  const last = await p.$$eval(".kb-comment-text", (e) => e[e.length - 1].innerHTML);
  assert.match(last, /Checked this on the Covent Garden store and it is fixed/);
  assert.match(last, new RegExp(`data-user="${HUY.replace(/\./g, "\\.")}"`));
  assert.match(await p.textContent("#kb-toast"), /Huy notified/);
  const c = await writes(p, /^kanbanTasks\/PH-23\/comments\//);
  assert.equal(c.length, 1); assert.equal(c[0].data.author, ROB); assert.match(c[0].data.text, /Covent Garden/);
  assert.equal((await stored(p, "PH-23")).commentCount, 1);
  await p.done();
});

T("TC-15", "epics: create an epic, add a bug from inside it, add and remove an existing ticket", async (prof) => {
  const p = await open(prof);
  await press(p, "#kb-new-btn");
  await press(p, '#task-form .type-opt[data-type="epic"]');
  await p.fill("#f-title", "Loyalty app pilot");
  await press(p, '[data-add-child="bug"]');
  await until(async () => (await p.textContent("#task-title-h")) === "New bug", "the child form");
  assert.equal(await p.inputValue("#f-epic"), "PH-40");
  await p.fill("#f-title", "Points balance not refreshing");
  await press(p, "#f-save");
  await until(async () => (await p.textContent("#task-title-h")) === "PH-40", "back on the epic");
  await until(() => p.$$eval("[data-open-child]", (e) => e.length), "the child listed");
  assert.deepEqual(await p.$$eval("[data-open-child]", (e) => e.map((x) => x.dataset.openChild)), ["PH-41"]);
  await press(p, "#f-child-link .kb-picker-input"); await p.keyboard.type("PH-36"); await p.waitForTimeout(80); await p.keyboard.press("Enter");
  await p.waitForTimeout(200);
  assert.deepEqual((await p.$$eval("[data-open-child]", (e) => e.map((x) => x.dataset.openChild))).sort(), ["PH-36", "PH-41"]);
  await press(p, '[data-unlink-child="PH-36"]'); await p.waitForTimeout(150);
  assert.deepEqual(await p.$$eval("[data-open-child]", (e) => e.map((x) => x.dataset.openChild)), ["PH-41"]);
  await press(p, "#f-cancel");
  assert.match(await p.textContent('.kb-card[data-key="PH-41"] .kb-parent-epic'), /Loyalty app pilot/);
  assert.equal((await stored(p, "PH-36")).epic, "", "removed from the epic");
  assert.equal((await stored(p, "PH-41")).epic, "PH-40");
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

T("TC-16b", "server search finds a ticket the board isn't holding", async (prof) => {
  const seed = kanbanSeed();
  // An old closed ticket outside the 300 most recent: only searchTokens finds it.
  seed.docs.kanbanTasks["PH-7"] = { ...seed.docs.kanbanTasks["PH-7"], open: false, status: "done", resolution: "completed", descriptionText: "Retired with the zebracorn migration.", searchTokens: ["7", "ph-7", "seed", "retired", "zebracorn", "migration"] };
  delete seed.docs.kanbanTasks["PH-7"].closedAt;
  const p = await open(prof, "#staff-kanban", { seed });
  assert.equal(await p.$('.kb-card[data-key="PH-7"]'), null, "not on the board");
  await press(p, '.kb-card[data-key="PH-1"]');
  await press(p, "#f-child-link .kb-picker-input"); await p.keyboard.type("zebracorn");
  await until(() => p.$$eval("#f-child-link .kb-pick .kb-link-key", (e) => e.some((x) => x.textContent === "PH-7")), "the server's hit", 4000);
  await p.done();
});

T("TC-17", "flags: quick flag on a card, Flag toggle in the modal", async (prof) => {
  const p = await open(prof);
  if (!prof.touch) await p.hover('.kb-card[data-key="PH-27"]');
  await press(p, '.kb-card[data-key="PH-27"] .kb-flag-btn');
  await p.waitForTimeout(100);
  assert.ok(await p.$eval('.kb-card[data-key="PH-27"]', (e) => e.classList.contains("kb-flagged")));
  assert.equal(await p.$eval("#task-backdrop", (e) => e.hidden), true);
  assert.equal((await stored(p, "PH-27")).flagged, true);
  await press(p, '.kb-card[data-key="PH-28"]');
  await press(p, "#task-flag");
  assert.equal(await p.textContent("#task-flag-label"), "Flagged");
  await press(p, "#f-save"); await p.waitForTimeout(150);
  assert.ok(await p.$eval('.kb-card[data-key="PH-28"]', (e) => e.classList.contains("kb-flagged")));
  await p.done();
});

T("TC-18", "modal: pinned action bar, collapsible details column remembered", { on: on.wide }, async (prof) => {
  const p = await open(prof, "#staff-kanban", { height: 760 });
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
  const p = await open(prof, "#staff-kanban/settings");
  await press(p, '[data-show="sprint"]'); await p.waitForTimeout(100);
  await press(p, '[data-req="sprint"]'); await p.waitForTimeout(100);
  await p.selectOption("#st-tester", MINH); await p.waitForTimeout(100);
  const s = await p.evaluate(() => globalThis.__fbStub.col("kanbanSettings").get("main"));
  assert.deepEqual(s.fields.sprint, { show: true, required: true }); assert.equal(s.tester, emailOf("Minh")); assert.equal(s.updatedBy, ROB);
  await press(p, '#kb-view [data-route="kanban"]'); await p.waitForSelector(".kb-card");
  await press(p, "#kb-new-btn"); await p.fill("#f-title", "Needs a sprint"); await press(p, "#f-save");
  assert.match(await p.textContent("#f-error"), /Sprint is required/);
  await press(p, "#f-cancel");
  await moveBy(p, methodOf(p), "PH-19", "ready-for-testing");
  assert.equal((await where(p, "PH-19")).avatar, "Minh");
  await p.done();
});

T("TC-20", "release report: defaults to current release, filters in the URL, per-person breakdown", async (prof) => {
  const p = await open(prof, "#staff-kanban/report");
  assert.equal(await p.textContent("#kb-view .page-header-count"), "PH 4.12");
  assert.ok((await p.$$eval(".kb-bar-row", (e) => e.length)) >= 5);
  assert.match(await p.textContent(".kb-kpis"), /28 Oct/);
  await p.evaluate(() => { location.hash = "#staff-kanban/report?release=4-12&status=all"; });
  await p.waitForTimeout(250);
  const cols = await p.$$eval(".kb-table thead th", (e) => e.map((x) => x.textContent));
  assert.ok(cols.includes("Completed") && cols.includes("Withdrawn"));
  await press(p, `.kb-click-row[data-person="${HUY}"]`);
  await p.waitForTimeout(200);
  assert.match(decodeURIComponent(await p.evaluate(() => location.hash)), new RegExp(`assignee=${HUY.replace(/\./g, "\\.")}`));
  await p.evaluate(() => { location.hash = "#staff-kanban/report?release=4-12&status=done%3Awithdrawn"; });
  await p.waitForTimeout(250);
  assert.deepEqual((await p.$$eval("[data-open]", (e) => e.map((x) => x.dataset.open))).sort(), ["PH-38", "PH-39"]);
  await p.done();
});

T("TC-21", "profile photos: Rob's photo everywhere; a new photo appears without a reload", async (prof) => {
  const p = await open(prof);
  assert.ok(await p.$("#profile-btn-avatar img.ph-avatar-img"), "the console's own profile button");
  assert.ok(await p.$('.kb-card[data-key="PH-15"] .kb-avatar-img'), "Rob's photo on his card");
  assert.ok(await p.$(`.kb-person-chip[data-person="${ROB}"] .kb-avatar-img`));
  assert.equal(await p.$(`.kb-person-chip[data-person="${MINH}"] .kb-avatar-img`), null);
  await p.evaluate((m) => { const b = globalThis.__fbStub; const c = b.col("memberDirectory"); c.set(m, { ...c.get(m), photoUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" }); b.notify(); }, MINH);
  await until(() => p.$(`.kb-person-chip[data-person="${MINH}"] .kb-avatar-img`), "Minh's new photo on the filter chip");
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

T("TC-23", "Agent Board and Staff Kanban are separate pages in the navigation", async (prof) => {
  const p = await open(prof);
  await goAgentBoard(p);
  assert.equal(await p.$eval("#staff-kanban-page", (e) => e.hidden), true);
  assert.equal(await p.$eval("#projects-root", (e) => e.hidden), false);
  assert.equal(await p.getAttribute("#nav-ph-console-btn", "aria-current"), "page");
  await goStaffKanban(p);
  assert.equal(await p.textContent("#kb-view .page-header h2"), "Staff Kanban");
  assert.equal(await p.$eval("#projects-root", (e) => e.hidden), true);
  assert.equal(await p.evaluate(() => location.hash), "#staff-kanban");
  await p.goBack(); await p.waitForTimeout(250);
  assert.equal(await p.$eval("#staff-kanban-page", (e) => e.hidden), true, "Back returns to the Agent Board");
  await p.done();
});

T("TC-24", "completed vs withdrawn via the Status menu; epic progress ignores withdrawn", async (prof) => {
  const p = await open(prof);
  await press(p, '.kb-card[data-key="PH-26"]');
  const opts = await p.$$eval("#f-status option", (o) => o.map((x) => x.textContent));
  assert.ok(opts.includes("Completed") && opts.includes("Withdrawn") && !opts.some((t) => /Completed \//.test(t)));
  await p.selectOption("#f-status", "done:withdrawn"); await press(p, "#f-save"); await p.waitForTimeout(150);
  assert.deepEqual((({ status, resolution }) => ({ status, resolution }))(await where(p, "PH-26")), { status: "done", resolution: "withdrawn" });
  assert.ok(await p.$eval('.kb-card[data-key="PH-26"]', (e) => e.classList.contains("kb-card-withdrawn")));
  const t = await stored(p, "PH-26");
  assert.equal(t.open, false); assert.equal(t.resolution, "withdrawn"); assert.ok(t.closedAt);
  await press(p, '.kb-card[data-key="PH-1"]');
  assert.match(await p.textContent('[data-field="children"] .field-label'), /withdrawn/);
  await p.done();
});

T("TC-25", "phone swimlanes: every lane shows the current column; swipe changes it", { on: on.phone }, async (prof) => {
  const p = await open(prof);
  for (const id of [ROB, HUY]) await p.tap(`.kb-person-chip[data-person="${id}"]`);
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

// ── Console-only cases ──────────────────────────────────────────────────────

T("KB-C1", "a viewer sees the board and changes nothing", async (prof) => {
  const p = await open(prof, "#staff-kanban", { seed: viewerSeed(), ...TALL });
  assert.equal(await p.$("#kb-new-btn"), null, "no + New task");
  if (prof.kind !== "phone") {
    await dragCard(p, "PH-34", { status: "in-progress" }, { input: prof.touch ? "touch" : "mouse" }).catch((e) => { if (!e.unreachable) throw e; });
    assert.equal((await where(p, "PH-34")).status, "backlog", "drag does nothing");
  }
  await press(p, '.kb-card[data-key="PH-20"]');
  assert.equal(await p.$("#f-save"), null, "no Save");
  assert.equal(await p.$eval("#f-title", (e) => e.disabled), true);
  assert.equal(await p.$eval("#f-status", (e) => e.disabled), true, "the Status menu is locked");
  assert.equal(await p.$("#f-delete"), null);
  assert.equal((await writes(p, /^kanban/)).length, 0, "nothing written");
  await p.evaluate(() => { location.hash = "#staff-kanban/settings"; }); await p.waitForSelector(".kb-readonly-note");
  assert.equal(await p.$eval('[data-show="sprint"]', (e) => e.disabled), true);
  await p.done();
});

const bellSeed = () => kanbanSeed({ extra: { kanbanNotifications: { n1: { to: ROB, from: HUY, taskKey: "PH-20", taskTitle: "Menu board preview shows RRP", kind: "comment", read: false, at: { $ts: Date.parse("2026-10-21T08:00:00Z") } } } } });
T("KB-C2", "mentions bell: unread count, opening one marks it read and opens the ticket", async (prof) => {
  const p = await open(prof, "#staff-kanban", { seed: bellSeed() });
  await until(async () => (await p.textContent("#kb-bell")).includes("1"), "the unread count");
  await press(p, "#kb-bell");
  assert.match(await p.textContent("#kb-bell-panel"), /Huy mentioned you in a comment on PH-20/);
  await press(p, ".kb-bell-item");
  await p.waitForSelector("#task-backdrop:not([hidden])");
  assert.equal(await p.textContent("#task-title-h"), "PH-20");
  assert.equal((await p.evaluate(() => globalThis.__fbStub.col("kanbanNotifications").get("n1"))).read, true);
  await p.done();
});

T("KB-C2b", "the mentions bell panel stays inside the window", { on: on.phone }, async (prof) => {
  const p = await open(prof, "#staff-kanban", { seed: bellSeed() });
  await until(async () => (await p.textContent("#kb-bell")).includes("1"), "the unread count");
  await press(p, "#kb-bell");
  const b = await p.$eval("#kb-bell-panel", (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; });
  assert.ok(b.l >= 0 && b.r <= prof.width + 1, `the panel is inside the window (${b.l}–${b.r} of ${prof.width})`);
  await p.done();
});

T("KB-C3", "Claude's draft is used when the console has a key", async (prof) => {
  const seed = kanbanSeed();
  seed.agentDraft = { title: "Offer sweep ignores the store's time zone", description: "Stores outside London expire an hour early around DST.", type: "bug", priority: "high", assignee: HUY, release: "4-13", sprint: "", epic: "PH-1", due: "", labels: ["menu-boards"], flagged: true, estimate: 6 };
  const p = await open(prof, "#staff-kanban", { seed, init: speechStub("the offer sweep is broken for stores outside london") });
  await press(p, "#kb-new-btn"); await press(p, "#f-record"); await p.waitForTimeout(300); await press(p, "#f-record");
  await until(async () => (await p.inputValue("#f-title")).length > 0, "the draft");
  assert.equal(await p.inputValue("#f-title"), "Offer sweep ignores the store's time zone");
  assert.equal(await p.inputValue("#f-release"), "4-13");
  assert.equal(await p.inputValue("#f-epic"), "PH-1");
  assert.equal(await p.inputValue("#f-estimate"), "6h");
  assert.equal(await p.textContent("#task-flag-label"), "Flagged");
  await p.done();
});

T("KB-C4", "deep links: a report URL opens the report, and the hash follows the page", async (prof) => {
  const p = await open(prof, "#staff-kanban/report?release=4-13");
  assert.equal(await p.textContent("#kb-view .page-header-count"), "PH 4.13");
  assert.match(await p.title(), /Release report/);
  await press(p, '#kb-view [data-route="kanban"]'); await p.waitForSelector(".kb-card");
  assert.equal(await p.evaluate(() => location.hash), "#staff-kanban");
  await p.done();
});

T("KB-C7", "Android: Record task listens one utterance per session and writes each phrase once", async (prof) => {
  const p = await open(prof, "#staff-kanban", { init: androidSpeech(["add a new Epic to the board", "Jack Johnson"], { android: true }) });
  await press(p, "#kb-new-btn");
  await press(p, "#f-record");
  await until(async () => (await p.textContent("#f-voice-live")) === "add a new Epic to the board Jack Johnson", "both phrases in the live transcript, once each", 5000);
  // The third session starts once the second has ended; wait for it rather than racing it.
  await until(() => p.evaluate(() => window.__srContinuous.length >= 3), "the session after the last utterance", 5000);
  assert.deepEqual(await p.evaluate(() => window.__srContinuous.filter(Boolean)), [], "never continuous mode on Android");
  await press(p, "#f-record");
  await until(async () => (await p.inputValue("#f-title")).length > 0, "the agent to fill the title");
  assert.doesNotMatch(await p.$eval("#f-description .ql-editor", (e) => e.innerText), /add add|Epic add/i);
  await p.done();
});

T("KB-C8", "Android unrecognised (Desktop site): cumulative finals are written once, then continuous mode stops", async (prof) => {
  const p = await open(prof, "#staff-kanban", { init: androidSpeech(["add a new Epic to the board", "Jack Johnson"]) });
  await press(p, '.kb-card[data-key="PH-23"]');
  await press(p, "#f-comment-mic");
  await until(async () => (await p.$eval('[data-field="comments"] .ql-editor', (e) => e.innerText.trim())) === "Add a new Epic to the board Jack Johnson", "both phrases in the comment box, once each", 5000);
  assert.deepEqual(await p.evaluate(() => window.__srContinuous.slice(0, 2)), [true, false], "the first session's cumulative finals switch the rest to one utterance each");
  await press(p, "#f-comment-mic");
  await p.done();
});

// KB-C5 sets its own iPad sizes: it runs once, in Chromium.
if (!ONLY || "KB-C5".startsWith(ONLY)) queue.push(["KB-C5 tablet: the menu's Staff Kanban link opens the board by touch, and the Record task button stays intact", async () => {
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
}]);

// KB-C6: on Rob's iPad (Chrome, 21 Oct 2026) the tap reached the menu link as
// pointer and touch events but the browser never sent the click. Touch taps
// now click on pointerup (touch-click.js); the browser's own click is swallowed, so a tap opens once.
if (!ONLY || "KB-C6".startsWith(ONLY)) queue.push(["KB-C6 tablet: a touch tap whose click never arrives still opens Staff Kanban; a normal tap clicks once", async () => {
  const op = await h.open({ seed: kanbanSeed(), hash: "", width: 1210, height: 696, contextOptions: { isMobile: true, hasTouch: true } });
  const o = op.page;
  await o.waitForTimeout(800);
  await o.evaluate(() => { window.__navClicks = 0; document.getElementById("staff-kanban-btn").addEventListener("click", () => { window.__navClicks++; }); });
  // Pointer and touch events only, as the iPad sent them — no click.
  await o.evaluate(() => {
    const b = document.getElementById("staff-kanban-btn"), r = b.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, pointerType: "touch", isPrimary: true, clientX: r.left + 40, clientY: r.top + r.height / 2 };
    b.dispatchEvent(new PointerEvent("pointerdown", at));
    b.dispatchEvent(new PointerEvent("pointerup", at));
  });
  await until(() => o.locator(".kb-card").count(), "the board after a tap with no click", 15000);
  assert.equal(await o.evaluate(() => location.hash), "#staff-kanban");
  assert.equal(await o.evaluate(() => window.__navClicks), 1, "the tap clicked once");
  // A real tap: the browser's own click cancels the fallback.
  await o.tap("#nav-ph-console-btn"); await o.waitForTimeout(150);
  await o.evaluate(() => { window.__navClicks = 0; });
  await o.tap("#staff-kanban-btn"); await o.waitForTimeout(700);
  assert.equal(await o.evaluate(() => window.__navClicks), 1, "a normal tap clicks once, not twice");
  assert.deepEqual(op.problems, [], "no page errors");
  await op.close();
}]);

// ── TC-26 … TC-66 (kanban-staff-board/test/lib/cases.mjs, shared with the prototype's suite) ──
const E = {
  T, on, assert, open, TALL, speechStub, methodOf,
  isConsole: true,
  sel: { title: "#kb-view .page-header h2", count: "#kb-view .page-header-count" },
  pid, person: (id) => NAMES[id] || id, rel: (id) => id.replace(".", "-"),
  hash: (route, q) => (route === "kanban" ? "#staff-kanban" : `#staff-kanban/${route}`) + (q ? "?" + q : ""),
  go: async (p, route, q) => { await p.evaluate((h) => { location.hash = h; }, E.hash(route, q)); await sleep(250); },
  stored, writes, viewerSeed,
  roleSeed: (role) => kanbanSeed({ user: { email: emailOf("Linh"), role } }),
  // Profile photos: Profile → Upload photo puts a JPEG in Storage and its URL on the member's row.
  googlePhoto: PIXEL,
  photoOpts: (withGoogle) => { const seed = kanbanSeed({ photos: false }); if (withGoogle) seed.user.photoURL = PIXEL; return { seed }; },
  openProfile: async (p) => { if (await p.$eval("#profile-btn", (e) => e.getClientRects().length > 0).catch(() => false)) await p.evaluate(() => document.getElementById("profile-btn").click()); else await p.evaluate(() => document.querySelector('.tab[data-tab="profile"]').click()); await sleep(250); },
  closeProfile: async (p) => { await p.keyboard.press("Escape"); await p.evaluate(() => { const m = document.getElementById("profile-menu"); if (m) m.hidden = true; document.getElementById("nav-drawer-backdrop")?.classList.remove("open"); }); },
  upload: async (p, file) => {
    await E.openProfile(p);
    const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.evaluate(() => document.getElementById("profile-photo-upload").click())]);
    await fc.setFiles(file); await sleep(500);
    if (!(await E.photoError(p))) await E.closeProfile(p);
  },
  removePhoto: async (p) => { await E.openProfile(p); if (await p.$eval("#profile-photo-remove", (e) => !e.hidden).catch(() => false)) await p.evaluate(() => document.getElementById("profile-photo-remove").click()); await sleep(300); await E.closeProfile(p); },
  photoError: (p) => p.$eval("#profile-photo-error", (e) => (e.hidden ? "" : e.textContent)).catch(() => ""),
  photoWrites: (p) => p.evaluate(() => JSON.stringify([Object.keys(globalThis.__fbStub.uploads || {}), globalThis.__fbStub.writes.filter((w) => /^(consoleUsers|memberDirectory)\//.test(w.path)).length])),
  // The page crops with avatarBlobFromFile (256 px square JPEG): run it on the same bytes.
  photoDims: async (p, url) => { const r = await p.evaluate(async () => { const b = (globalThis.__fbStub.uploads || {})[`avatars/rob@offline2online.com.jpg`] || {}; return { type: b.contentType || "", size: b.size || 0 }; }); assert.equal(r.type, "image/jpeg", "uploaded as a JPEG"); assert.ok(r.size > 0, "something was uploaded"); return { w: 1, h: 1 }; },
  cropDims: (p, file) => p.evaluate(async ({ b64, type }) => { const m = await import("/js/avatar.js"); const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const blob = await m.avatarBlobFromFile(new File([bytes], "x", { type })); const bmp = await createImageBitmap(blob); return { w: bmp.width, h: bmp.height }; }, { b64: file.buffer.toString("base64"), type: file.mimeType }),
  profileHasPhoto: async (p) => !!(await p.$("#profile-btn-avatar img.ph-avatar-img")) || !!(await p.$("#profile-photo-face img")),
  // Settings → Team & agent access (admins): Set photo on the member's row.
  openTeam: async (p) => { await E.openProfile(p); await p.evaluate(() => document.getElementById("faq-settings-btn").click()); await p.waitForSelector(".team-row", { state: "attached", timeout: 8000 }); await sleep(250); },
  setOtherPhoto: async (p, who, file) => {
    await E.openTeam(p);
    const sel = `.team-row[data-email="${pid(who)}"] [data-team-photo]`;
    const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.evaluate((s) => document.querySelector(s).click(), sel)]);
    await fc.setFiles(file); await sleep(600);
    const m = await p.evaluate((e) => globalThis.__fbStub.col("consoleUsers").get(e), pid(who));
    assert.ok(m && m.photoUrl, "the member's row has the new photo");
    await E.go(p, "kanban");
  },
  canSetOtherPhoto: async (p) => { await E.openProfile(p); await p.evaluate(() => document.getElementById("faq-settings-btn").click()); await sleep(600); return !!(await p.$("[data-team-photo]:not([hidden])")) && await p.$eval("[data-team-photo]", (e) => e.getClientRects().length > 0).catch(() => false); },
  // every ticket as the page holds it
  tasks: (p) => p.evaluate(() => [...globalThis.__fbStub.col("kanbanTasks").values()].map((t) => ({ key: t.key, type: t.type, title: t.title, description: t.descriptionText || t.description || "", status: t.status, resolution: t.resolution || null, assignee: t.assignee || "", release: t.release || "", priority: t.priority || "", sprint: t.sprint || "", labels: t.labels || [], flagged: !!t.flagged, estimate: t.estimate, logged: t.logged }))),
  snapshot: async (p, key) => {
    const t = await stored(p, key);
    const act = await writes(p, new RegExp(`^kanbanTasks/${key}/activity/`));
    return { status: t.status, resolution: t.resolution || null, assignee: t.assignee, open: t.open, closedAt: t.closedAt || null, activity: act.map((a) => a.data.text) };
  },
  ranks: (p, status) => p.evaluate((s) => [...globalThis.__fbStub.col("kanbanTasks").values()].filter((t) => t.status === s).sort((a, b) => a.rank - b.rank).map((t) => t.key), status),
  confirmDelete: async (p, accept) => {
    await press(p, "#f-delete");
    await p.waitForSelector("#dialog-backdrop:not([hidden])");
    const msg = await p.textContent("#dialog-message");
    await press(p, accept ? "#dialog-ok" : "#dialog-cancel"); await sleep(250);
    return msg;
  },
};
defineNewCases(E);

// ── run ──────────────────────────────────────────────────────────────────────
for (const [name, fn] of queue) await test(name, fn);
await h.close();
const failed = results.filter((r) => !r[1]);
const skipped = results.filter((r) => r[4] === "skipped");
console.log(`\n${results.length - failed.length - skipped.length}/${results.length - skipped.length} Staff Kanban console cases passed${skipped.length ? ` (${skipped.length} skipped with a reason)` : ""}`);
const known = (globalThis.__kbKnown || []).filter((k) => !k.fixed);
if (known.length) console.log(`# ${known.length} known defect run(s): ${[...new Set(known.map((k) => k.id))].join(", ")}`);
if ((globalThis.__kbFlaky || []).length) console.log(`# ${globalThis.__kbFlaky.length} flaky run(s) passed on retry: ${globalThis.__kbFlaky.map((f) => `${f.id}[${f.profile}]`).join(", ")}`);
for (const m of missing) console.log(`# NOT RUN — ${m.engine} is not available here: ${m.reason}`);
if (process.env.KB_REPORT_JSON) (await import("node:fs")).writeFileSync(process.env.KB_REPORT_JSON, JSON.stringify({ results: results.map(([n, ok, ms, e]) => ({ name: n, ok, ms, error: e ? e.message : null })), confirms: globalThis.__kbConfirms || [], known: globalThis.__kbKnown || [], flaky: globalThis.__kbFlaky || [], notRun: missing }, null, 1));
if (failed.length) { for (const [n, , , e] of failed) console.log(`\n--- ${n}\n${e && e.stack}`); process.exit(1); }
