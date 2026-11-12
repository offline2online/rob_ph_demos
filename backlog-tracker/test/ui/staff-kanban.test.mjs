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
import { kanbanSeed, cardOfTask, emailOf, ROB, KB } from "./kanban-seed.mjs";
import { wantedProfiles, contextOptions } from "../../../kanban-staff-board/test/lib/profiles.mjs";
import { where, press, sleep, moveBy, dragCard, toastText, headers } from "../../../kanban-staff-board/test/lib/driver.mjs";
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
  let why = "";
  for (let attempt = 0; ; attempt++) {
    // The FLAKY line carries the first failure, so the run's summary says what to chase (a passing profile's output is not printed).
    try { await fn(prof); await sweep(); if (attempt) { console.log(`# FLAKY ${id} [${prof.id}]: failed, passed on retry ${attempt} — ${why}`); FLAKY.push({ id, profile: prof.id, why }); } return; }
    catch (e) { await sweep(); if (attempt >= RETRIES) throw e; why = String(e && e.message).split("\n").slice(0, 3).join(" ").slice(0, 300); console.log(`# RETRY ${id} [${prof.id}]: ${why}`); }
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
  // A card opens its ticket in a new tab (KB-LINK-1). The cases written before that drive the ticket in this page, which is
  // what the board does when the browser refuses a new tab; KB-C15 (o.newTab) covers the new tab itself.
  if (!o.newTab) { const block = () => { window.open = () => null; }; await p.addInitScript(block); await p.evaluate(block); }
  // Every case also ends comparing each ticket with its board card: a write path that changes a ticket without its card fails here.
  p.done = async (o = {}) => { const bad = o.allow ? op.problems.filter((x) => !o.allow.test(x)) : op.problems; assert.deepEqual(bad, [], "no page errors, console errors or stray requests"); assert.deepEqual(await cardDrift(p), [], "every ticket's card matches the ticket"); await op.close(); };
  return p;
}
const TALL = { height: 1600 };
// Repeats a check until it passes. The board redraws on the next animation frame (or a 100 ms timer) and a busy
// runner can hold a frame back for longer than any fixed sleep, so a case waits on what it is about to assert.
// When time runs out the check's own failure is thrown, so the report says what was wrong, not "timed out".
async function eventually(check, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    try { return await check(); }
    catch (e) { if (Date.now() - t0 > ms) throw e; await sleep(40); }
  }
}
// Tickets whose card (kanbanCards) differs from the ticket, or is missing; cards without a ticket.
const cardDrift = (page) => page.evaluate(async () => {
  const core = await import("/js/kanban/kanban-core.js");
  const b = globalThis.__fbStub, tasks = b.col("kanbanTasks"), cards = b.col("kanbanCards");
  const out = [];
  const ms = (v) => (v && v.ms !== undefined ? v.ms : v == null ? null : v);
  for (const [k, t] of tasks) {
    const c = cards.get(k);
    if (!c) { out.push(`${k}: no card`); continue; }
    const want = core.cardOf(t);
    for (const f of core.CARD_FIELDS) if (JSON.stringify(c[f]) !== JSON.stringify(want[f])) out.push(`${k}.${f}: card ${JSON.stringify(c[f])}, ticket ${JSON.stringify(want[f])}`);
    // (each server timestamp resolves separately in the stub, so only presence is compared)
    if ((c.closedAt != null) !== (t.closedAt != null)) out.push(`${k}.closedAt: card ${ms(c.closedAt)}, ticket ${ms(t.closedAt)}`);
    for (const f of Object.keys(c)) if (!core.CARD_FIELDS.includes(f) && !["closedAt", "updatedAt", "updatedBy"].includes(f)) out.push(`${k}.${f}: not a card field`);
  }
  for (const k of cards.keys()) if (!tasks.has(k)) out.push(`${k}: card without a ticket`);
  return out;
});
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

T("TC-03", "Ready for Testing asks who tests (never Rob by default); moving back returns it to the developer", async (prof) => {
  const p = await open(prof, "#staff-kanban", TALL);
  const m = methodOf(p);
  await moveBy(p, m, "PH-19", "ready-for-testing");
  let w;
  if (m === "status") {
    // The edit form has its own Assignee field: the status change alone assigns nobody.
    w = await where(p, "PH-19");
    assert.equal(w.status, "ready-for-testing"); assert.equal(w.avatar, "Đức", "no automatic tester");
    assert.equal((await stored(p, "PH-19")).assignee, emailOf("Đức"));
    await moveBy(p, m, "PH-19", "in-progress");
    assert.equal((await where(p, "PH-19")).status, "in-progress");
    await p.done();
    return;
  }
  await p.waitForSelector("#kb-tester-pick");
  assert.equal((await where(p, "PH-19")).status, "in-progress", "nothing is written until a tester is chosen");
  await p.selectOption("#kb-tester-pick", emailOf("Huy")); await press(p, "#kb-tester-ok"); await p.waitForTimeout(150);
  w = await where(p, "PH-19");
  assert.equal(w.status, "ready-for-testing");
  assert.equal(w.avatar, "Huy");
  assert.match(await p.textContent("#kb-toast"), /reassigned to Huy for testing/);
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
  await p.waitForSelector('[data-field="description"] .kb-mention-item.on');
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
  // The tag is stored on the ticket: that list, not the toast, is what the server notifies from.
  assert.deepEqual((await stored(p, "PH-20")).mentions, [MINH], "the ticket lists who its description tags");
  assert.match(html, /<a href="https:\/\/offline2online\.com\/menu-board"/);
  assert.match(html, new RegExp(`data-user="${MINH.replace(/\./g, "\\.")}"`));
  assert.match(html, /<img src="https:\/\/firebasestorage\.googleapis\.com\//, "the screenshot went to Storage, not inline");
  assert.match(html, /faq-table/);
  assert.match(html, /callout-warning/);
  const up = await p.evaluate(() => Object.keys(globalThis.__fbStub.uploads || {}));
  assert.ok(up.some((k) => /^kanban\/PH-20\/\d+-shot\.(jpg|png)$/.test(k)), `uploaded under the ticket: ${up}`);
  const notes = await writes(p, /^kanbanNotifications\//);
  assert.equal(notes.length, 0, "the page writes no notification: the server's fan-out trigger does");
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
  await p.click('[data-field="comments"] .ql-editor'); await p.keyboard.press("Control+End"); await p.keyboard.type(" @hu"); await p.waitForSelector(".kb-mention-item.on"); await p.keyboard.press("Enter");
  await press(p, "#f-comment-add"); await p.waitForTimeout(200);
  const last = await p.$$eval(".kb-comment-text", (e) => e[e.length - 1].innerHTML);
  assert.match(last, /Checked this on the Covent Garden store and it is fixed/);
  assert.match(last, new RegExp(`data-user="${HUY.replace(/\./g, "\\.")}"`));
  assert.match(await p.textContent("#kb-toast"), /Huy notified/);
  const c = await writes(p, /^kanbanTasks\/PH-23\/comments\//);
  assert.equal(c.length, 1); assert.equal(c[0].data.author, ROB); assert.match(c[0].data.text, /Covent Garden/);
  assert.deepEqual(c[0].data.mentions, [HUY], "the comment lists who it tags: the server notifies from that");
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
  // (the board holds cards, which carry no description: words in descriptions arrive with the server's hits, a moment after the keystroke)
  const keys = () => p.$$eval("#f-child-link .kb-pick .kb-link-key", (e) => e.map((x) => x.textContent));
  await p.fill(inp, "archived articles");
  await until(async () => (await keys()).join() === "PH-36", "the description hit PH-36", 5000);
  await p.fill(inp, "SQLite");
  await until(async () => (await keys())[0] === "PH-24", "the description hit PH-24", 5000);
  assert.match(await p.$eval("#f-child-link .kb-pick-snip", (e) => e.innerHTML), /<mark>SQLite<\/mark>/);
  await p.done();
});

T("TC-16b", "server search finds a ticket the board isn't holding", async (prof) => {
  const seed = kanbanSeed();
  // An old closed ticket outside the 300 most recent: only searchTokens finds it.
  seed.docs.kanbanTasks["PH-7"] = { ...seed.docs.kanbanTasks["PH-7"], open: false, status: "done", resolution: "completed", descriptionText: "Retired with the zebracorn migration.", searchTokens: ["7", "ph-7", "seed", "retired", "zebracorn", "migration"] };
  delete seed.docs.kanbanTasks["PH-7"].closedAt;
  seed.docs.kanbanCards["PH-7"] = cardOfTask(seed.docs.kanbanTasks["PH-7"]);
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
  // The ticket is read before its modal opens: measuring a closed modal compares empty boxes, which passes.
  await p.waitForSelector('#task-backdrop:not([hidden]) [data-field="description"]');
  for (const pos of [0, 99999]) {
    await p.$eval(".kb-task-panel", (el, y) => { el.scrollTop = y; }, pos);
    const ok = await p.evaluate(() => { const pn = document.querySelector(".kb-task-panel").getBoundingClientRect(), s = document.getElementById("f-save").getBoundingClientRect(); return s.top >= pn.top && s.bottom <= pn.bottom; });
    assert.ok(ok, "Save visible");
  }
  const before = await p.$eval('[data-field="description"]', (e) => e.getBoundingClientRect().width);
  await press(p, "#task-side-toggle");
  // The column closes over a 0.2 s transition that only advances when a frame is drawn. Wait for the transition
  // itself to end, however long the runner takes over it, then measure the width it ended at.
  await until(() => p.$eval(".kb-task-grid", (g) => g.classList.contains("kb-side-collapsed") && !g.getAnimations().length), "the details column to finish closing");
  const afterW = await p.$eval('[data-field="description"]', (e) => e.getBoundingClientRect().width);
  assert.ok(afterW > before + 150, `the description is ${Math.round(afterW)} px wide with the details column closed, ${Math.round(before)} px with it open`);
  assert.equal(await p.getAttribute("#task-side-toggle", "aria-expanded"), "false");
  await press(p, "#f-cancel");
  await press(p, '.kb-card[data-key="PH-21"]');
  // The next ticket's own modal, not the one just closed (its grid is still in the page, still collapsed).
  await until(async () => /PH-21/.test(await p.textContent("#task-title-h")) && !(await p.$eval("#task-backdrop", (e) => e.hidden)), "PH-21 to open");
  assert.ok(await p.$eval(".kb-task-grid", (e) => e.classList.contains("kb-side-collapsed")), "the next ticket opens with the details column still closed");
  assert.ok(await p.isHidden("#kb-task-side"), "and the column is not shown");
  await p.done();
});

T("TC-19", "settings: hide or require an optional field", async (prof) => {
  const p = await open(prof, "#staff-kanban/settings");
  await press(p, '[data-show="sprint"]'); await p.waitForTimeout(100);
  await press(p, '[data-req="sprint"]'); await p.waitForTimeout(100);
  const s = await p.evaluate(() => globalThis.__fbStub.col("kanbanSettings").get("main"));
  assert.deepEqual(s.fields.sprint, { show: true, required: true }); assert.equal(s.updatedBy, ROB);
  await press(p, '#kb-view [data-route="kanban"]'); await p.waitForSelector(".kb-card");
  await press(p, "#kb-new-btn"); await p.fill("#f-title", "Needs a sprint"); await press(p, "#f-save");
  assert.match(await p.textContent("#f-error"), /Sprint is required/);
  await press(p, "#f-cancel");
  await moveBy(p, methodOf(p), "PH-19", "ready-for-testing");
  if (methodOf(p) !== "status") { await p.selectOption("#kb-tester-pick", MINH); await press(p, "#kb-tester-ok"); await p.waitForTimeout(150); assert.equal((await where(p, "PH-19")).avatar, "Minh"); }
  await p.done();
});

T("TC-20", "release report: defaults to current release, filters in the URL, per-person breakdown", async (prof) => {
  const p = await open(prof, "#staff-kanban/report");
  assert.equal(await p.textContent("#kb-view .page-header-count"), "4.12 (PH 4.12)");
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
  // No Epic drop-down; Epic is a Type option and shows an epics-only page with an epic summary.
  assert.equal(await p.$$eval('[data-rf="epic"]', (e) => e.length), 0);
  assert.ok((await p.$$eval('[data-rf="type"] option', (e) => e.map((x) => x.value))).includes("epic"));
  await p.evaluate(() => { location.hash = "#staff-kanban/report?release=all&status=all&type=epic"; });
  await p.waitForTimeout(300);
  assert.equal(await p.$$eval("#rp-epics", (e) => e.length), 1);
  const opened = await p.$$eval("[data-open]", (e) => e.map((x) => x.dataset.open));
  assert.ok(opened.length >= 1);
  assert.equal(await p.$$eval("#rp-epics + * .kb-type-task, .kb-task-cell .kb-type-task", (e) => e.length), 0);
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
T("KB-C2", "notifications bell: unread count, opening one marks it read and opens the ticket", async (prof) => {
  const p = await open(prof, "#staff-kanban", { seed: bellSeed() });
  await until(async () => (await p.textContent("#kb-bell")).includes("1"), "the unread count");
  await press(p, "#kb-bell");
  assert.match(await p.textContent("#kb-bell-panel"), /PH-20[\s\S]*Huy mentioned you in a comment/);
  await press(p, ".kb-bell-item");
  await p.waitForSelector("#task-backdrop:not([hidden])");
  assert.equal(await p.textContent("#task-title-h"), "PH-20");
  assert.equal((await p.evaluate(() => globalThis.__fbStub.col("kanbanNotifications").get("n1"))).read, true);
  await p.done();
});

T("KB-C2f", "notifications bell: the owner signed in with his second address sees the notifications addressed to his first", async (prof) => {
  const seed = bellSeed();
  seed.user = { email: "rob@personalisationhub.com", role: "admin" };
  const p = await open(prof, "#staff-kanban", { seed });
  await until(async () => (await p.textContent("#kb-bell")).includes("1"), "the unread count");
  await press(p, "#kb-bell");
  assert.match(await p.textContent("#kb-bell-panel"), /PH-20[\s\S]*Huy mentioned you in a comment/);
  await press(p, ".kb-bell-item");
  await p.waitForSelector("#task-backdrop:not([hidden])");
  await eventually(async () => assert.equal((await p.evaluate(() => globalThis.__fbStub.col("kanbanNotifications").get("n1"))).read, true, "opening it marks it read"));
  await p.done();
});

T("KB-C2c", "notifications bell: the newest 30 of 150, the badge counts them all, Mark all as read clears them, and it is in the topbar of every page", async (prof) => {
  const seed = kanbanSeed({ extra: { kanbanNotifications: Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`n${i}`, { to: ROB, from: HUY, taskKey: i % 2 ? "PH-20" : "PH-21", taskTitle: i % 2 ? "Menu board preview shows RRP" : "Other", kind: i === 149 ? "assigned" : "commented", read: false, at: { $ts: Date.UTC(2026, 9, 29, 0, 0, i) } }])) } });
  const p = await open(prof, "#staff-kanban", { seed });
  await goAgentBoard(p);
  assert.equal(await p.isVisible("#kb-view .kb-card"), false, "on the Agent Board, not the Kanban");
  await until(async () => (await p.textContent("#kb-bell")).includes("150"), "the unread count, on the Agent Board");
  await press(p, "#kb-bell");
  assert.equal((await p.$$(".kb-bell-item")).length, 30, "the newest 30");
  assert.match(await p.textContent(".kb-bell-item"), /Huy assigned this to you/, "newest first");
  assert.equal((await p.$$(".kb-bell-ticket")).length, 2, "grouped by ticket");
  await press(p, "#kb-bell-read");
  await until(async () => !/\d/.test(await p.textContent("#kb-bell")), "Mark all as read");
  assert.equal(await p.evaluate(() => [...globalThis.__fbStub.col("kanbanNotifications").values()].filter((n) => !n.read).length), 0, "every note, not only the 30 shown");
  await p.done();
});

T("KB-C2e", "notifications bell: Mark all as read clears the badge when the unread ones are all older than the newest 30", async (prof) => {
  // The newest 30 are already read, so the bell's own listener sees no change when the rest are marked.
  const seed = kanbanSeed({ extra: { kanbanNotifications: Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`n${i}`, { to: ROB, from: HUY, taskKey: "PH-20", taskTitle: "Menu board preview shows RRP", kind: "commented", read: i >= 15, at: { $ts: Date.UTC(2026, 9, 29, 0, 0, i) } }])) } });
  const p = await open(prof, "#staff-kanban", { seed });
  await until(async () => (await p.textContent("#kb-bell")).includes("15"), "the unread count");
  await press(p, "#kb-bell");
  assert.equal((await p.$$(".kb-bell-item.unread")).length, 0, "none of the newest 30 is unread");
  assert.match(await p.textContent("#kb-bell-read"), /Mark all as read/);
  await press(p, "#kb-bell-read");
  await until(async () => !/\d/.test(await p.textContent("#kb-bell")), "the badge clears");
  assert.equal(await p.evaluate(() => [...globalThis.__fbStub.col("kanbanNotifications").values()].filter((n) => !n.read).length), 0, "every note is read in the store");
  await p.done();
});

T("KB-C2d", "the Watch toggle: saved at once, and implicit for the assignee", async (prof) => {
  const p = await open(prof, "#staff-kanban");
  await press(p, '.kb-card[data-key="PH-23"]');
  const w = "#task-watch";
  const implicit = await p.$eval(w, (e) => e.disabled);
  if (!implicit) {
    assert.equal(await p.textContent("#task-watch-label"), "Watch");
    await press(p, w);
    await until(async () => (await stored(p, "PH-23")).watchers?.includes(ROB), "the watcher is saved");
    assert.equal(await p.textContent("#task-watch-label"), "Watching");
    await press(p, w);
    await until(async () => !(await stored(p, "PH-23")).watchers?.includes(ROB), "…and removed");
  } else assert.equal(await p.textContent("#task-watch-label"), "Watching");
  await p.done();
});

T("KB-C2b", "the notifications bell panel stays inside the window", { on: on.phone }, async (prof) => {
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

T("KB-REL-1", "release filters list the number first and only releases with open tickets", async (prof) => {
  const p = await open(prof);
  const labels = await p.$$eval("#kb-release option", (e) => e.map((x) => x.textContent.trim()));
  assert.equal(labels[0], "All releases");
  const rest = labels.slice(1);
  assert.ok(rest.length && rest.every((l) => /^\d+\.\d+ \(PH \d+\.\d+\)/.test(l)), `number first: ${rest}`);
  assert.ok(!rest.some((l) => l.startsWith("4.11")), "a release with no open ticket is left out");
  await p.evaluate(() => { location.hash = "#staff-kanban/report?release=4-12"; });
  await p.waitForTimeout(250);
  const rl = await p.$$eval("select[data-rf=release] option", (e) => e.map((x) => x.textContent.trim()));
  assert.ok(rl.filter((l) => l !== "All releases").every((l) => /^\d+\.\d+ \(PH/.test(l)) && !rl.some((l) => l.startsWith("4.11")), `report: ${rl}`);
  await p.done();
});

T("KB-C4", "deep links: a report URL opens the report, and the hash follows the page", async (prof) => {
  const p = await open(prof, "#staff-kanban/report?release=4-13");
  assert.equal(await p.textContent("#kb-view .page-header-count"), "4.13 (PH 4.13)");
  assert.match(await p.title(), /Release report/);
  await press(p, '#kb-view [data-route="kanban"]'); await p.waitForSelector(".kb-card");
  assert.equal(await p.evaluate(() => location.hash), "#staff-kanban");
  await p.done();
});

T("KB-C13", "project: set in the modal, named on the card, filtered from Filters and kept in the URL (PH-21)", async (prof) => {
  const seed = kanbanSeed();
  seed.docs.projects = { pA: { name: "Staff Kanban", createdAt: { $ts: Date.parse("2026-10-01T00:00:00Z") } }, pB: { name: "Menu Board", createdAt: { $ts: Date.parse("2026-10-02T00:00:00Z") } } };
  seed.docs.kanbanSettings.main.fields = { ...(seed.docs.kanbanSettings.main.fields || {}), project: { show: true, required: false } };
  for (const [k, id] of [["PH-20", "pA"], ["PH-21", "pB"]]) { seed.docs.kanbanTasks[k].project = id; seed.docs.kanbanCards[k].project = id; }
  const p = await open(prof, "#staff-kanban?project=pA", { seed });
  assert.deepEqual(await p.$$eval(".kb-card", (e) => e.map((x) => x.dataset.key)), ["PH-20"], "the address filters the board");
  assert.match(await p.textContent('.kb-card[data-key="PH-20"] .kb-project-chip'), /Staff Kanban/);
  assert.equal(await p.evaluate(() => location.hash), "#staff-kanban?project=pA");
  await press(p, "#kb-filter-toggle");
  assert.equal(await p.inputValue("#kb-project"), "pA");
  await p.selectOption("#kb-project", "pB");
  await eventually(async () => assert.deepEqual(await p.$$eval(".kb-card", (e) => e.map((x) => x.dataset.key)), ["PH-21"]));
  await eventually(async () => assert.equal(await p.evaluate(() => location.hash), "#staff-kanban?project=pB"));
  await p.selectOption("#kb-project", "");
  await eventually(async () => assert.ok((await p.$$eval(".kb-card", (e) => e.length)) > 2, "every project's cards are back"));
  await eventually(async () => assert.equal(await p.evaluate(() => location.hash), "#staff-kanban"));
  await press(p, "#kb-filter-done");
  await press(p, '.kb-card[data-key="PH-22"]');
  await until(async () => /PH-22/.test(await p.textContent("#task-title-h")) && !(await p.$eval("#task-backdrop", (e) => e.hidden)), "PH-22 to open");
  assert.equal(await p.inputValue("#f-project"), "");
  await p.selectOption("#f-project", "pB");
  await press(p, "#f-save");
  await eventually(async () => assert.equal((await stored(p, "PH-22")).project, "pB"));
  await eventually(async () => assert.match((await p.textContent('.kb-card[data-key="PH-22"]')) || "", /Menu Board/, "the card names the project"));
  assert.match(await p.textContent('.kb-card[data-key="PH-22"] .kb-project-chip'), /Menu Board/);
  await p.done();
});

T("KB-C14", "an API contract ticket shows Interface: <name> in its modal, linking to that project's Docs page at it (PH-23)", async (prof) => {
  const seed = kanbanSeed();
  seed.docs.projects = { pA: { name: "Staff Kanban", createdAt: { $ts: Date.parse("2026-10-01T00:00:00Z") } }, pB: { name: "Console API", createdAt: { $ts: Date.parse("2026-10-02T00:00:00Z") } } };
  seed.docs.interfaces = { ifc1: { name: "Staff Kanban to Console API", projectIds: ["pA", "pB"], endpoints: [{ type: "project", id: "pA" }, { type: "project", id: "pB" }], contentMd: "# Draft", createdAt: { $ts: Date.parse("2026-10-03T00:00:00Z") }, updatedAt: { $ts: Date.parse("2026-10-03T00:00:00Z") } } };
  seed.docs.kanbanTasks["PH-20"].interfaceId = "ifc1"; seed.docs.kanbanTasks["PH-20"].project = "pA"; seed.docs.kanbanCards["PH-20"].project = "pA";
  const p = await open(prof, "#staff-kanban", { seed });
  await press(p, '.kb-card[data-key="PH-21"]');
  assert.equal(await p.$("#f-interface"), null, "a ticket with no interface shows none");
  await press(p, "#f-cancel");
  await press(p, '.kb-card[data-key="PH-20"]');
  await until(() => p.$("#f-interface a"), "the interface link");
  assert.match(await p.textContent("#f-interface"), /^Interface: Staff Kanban to Console API$/);
  assert.equal(await p.getAttribute("#f-interface a", "href"), "#docs/pA?interface=ifc1");
  await p.done();
});

T("TC-68", "acceptance criteria: shown, ticked and edited in the modal with an activity line each, counted on the card, updated live, and saved with a new ticket (PH-22)", async (prof) => {
  const line = (i, done, text) => `crit000${i}\t${done}\t${text}`;
  const texts = ["Field A is required", "Saves on Enter", "Shows an error on 500", "Clears on cancel", "Keyboard reachable"];
  const seed = kanbanSeed();
  seed.docs.kanbanTasks["PH-20"].acceptanceCriteria = texts.map((t, i) => line(i, 0, t));
  seed.docs.kanbanCards["PH-20"].acTotal = 5; seed.docs.kanbanCards["PH-20"].acDone = 0;
  const p = await open(prof, "#staff-kanban", { seed });
  const chip = () => p.textContent('.kb-card[data-key="PH-20"] .kb-ac-chip');
  const activityOf = async () => (await writes(p, /kanbanTasks\/PH-20\/activity\//)).map((w) => w.data.text);
  assert.match(await chip(), /AC 0\/5/, "the card shows AC 0/5");
  await press(p, '.kb-card[data-key="PH-20"]');
  await until(() => p.$("#f-ac .kb-ac-item"), "the criteria in the modal");
  assert.deepEqual(await p.$$eval("#f-ac [data-ac-text]", (e) => e.map((x) => x.value)), texts, "the modal shows the 5");
  assert.match(await p.textContent("#f-ac-count"), /0 of 5 done/);
  // Tick two: each is saved at once, with its own activity line.
  // Each step waits for what it saved (the ticket, then the card, which redraws on the next frame), not for a fixed time.
  const ticks = async () => (await stored(p, "PH-20")).acceptanceCriteria.map((l) => l.split("\t")[1]);
  await p.check('#f-ac [data-ac="crit0000"] [data-ac-tick]');
  await eventually(async () => assert.deepEqual(await ticks(), ["1", "0", "0", "0", "0"]));
  await p.check('#f-ac [data-ac="crit0002"] [data-ac-tick]');
  await eventually(async () => assert.deepEqual(await ticks(), ["1", "0", "1", "0", "0"]));
  await eventually(async () => assert.match(await chip(), /AC 2\/5/, "the card follows"));
  await eventually(async () => assert.match(await p.textContent("#f-ac-count"), /2 of 5 done/));
  await eventually(async () => assert.deepEqual((await activityOf()).sort(), ['ticked criterion "Field A is required"', 'ticked criterion "Shows an error on 500"']));
  // Edit one, add one, move one, remove one.
  await p.fill('#f-ac [data-ac="crit0001"] [data-ac-text]', "Saves on Enter or Save"); await p.press('#f-ac [data-ac="crit0001"] [data-ac-text]', "Tab");
  await eventually(async () => assert.ok((await activityOf()).includes('edited criterion "Saves on Enter" → "Saves on Enter or Save"'), "the edit has its activity line"));
  await p.fill("#f-ac-input", "Works on a phone"); await p.press("#f-ac-input", "Enter");
  await eventually(async () => assert.equal((await stored(p, "PH-20")).acceptanceCriteria.length, 6));
  await eventually(async () => assert.match(await chip(), /AC 2\/6/));
  await press(p, '#f-ac [data-ac="crit0004"] [data-ac-up]');
  await eventually(async () => assert.equal((await stored(p, "PH-20")).acceptanceCriteria[3].split("\t")[2], "Keyboard reachable"));
  await press(p, '#f-ac [data-ac="crit0003"] [data-ac-rm]');
  await eventually(async () => assert.equal((await stored(p, "PH-20")).acceptanceCriteria.length, 5));
  await eventually(async () => assert.match(await chip(), /AC 2\/5/));
  // Someone else (over MCP) unticks one: the open modal and the card follow without a reload.
  await p.evaluate(() => {
    const b = globalThis.__fbStub, t = b.col("kanbanTasks").get("PH-20");
    const list = t.acceptanceCriteria.map((l) => (l.startsWith("crit0000") ? l.replace("\t1\t", "\t0\t") : l));
    b.col("kanbanTasks").set("PH-20", { ...t, acceptanceCriteria: list });
    const c = b.col("kanbanCards").get("PH-20");
    b.col("kanbanCards").set("PH-20", { ...c, acDone: 1, updatedAt: new globalThis.__fbStubTimestamp(Date.now() + 5000), updatedBy: "other@personalisationhub.com" });
    b.notify();
  });
  await until(async () => !(await p.isChecked('#f-ac [data-ac="crit0000"] [data-ac-tick]')), "the open modal to show the untick");
  await eventually(async () => assert.match(await chip(), /AC 1\/5/));
  await press(p, "#f-cancel");
  // A new ticket saves with criteria; 51 can't be added.
  await press(p, "#kb-new-btn");
  await p.fill("#f-title", "Ticket with criteria");
  for (const t of ["One", "Two", "Three"]) { await p.fill("#f-ac-input", t); await p.press("#f-ac-input", "Enter"); }
  assert.equal((await p.$$("#f-ac .kb-ac-item")).length, 3);
  await press(p, "#f-save");
  const made = await until(async () => (await p.evaluate(() => [...globalThis.__fbStub.col("kanbanTasks")].filter(([, t]) => t.title === "Ticket with criteria")))[0], "the new ticket to be saved");
  assert.deepEqual(made[1].acceptanceCriteria.map((l) => l.split("\t")[2]), ["One", "Two", "Three"]);
  await eventually(async () => assert.match(await p.textContent(`.kb-card[data-key="${made[0]}"] .kb-ac-chip`), /AC 0\/3/));
  await p.done();
});

// ── Cards (kanbanCards): the board reads only what a card shows ─────────────
const readBytes = (p, path) => p.evaluate((x) => (globalThis.__fbStub.readBytes || {})[x] || 0, path);
const watching = (p, path) => p.evaluate((x) => (globalThis.__fbStub.watching || {})[x] || 0, path);

T("KB-C9", "screenshots in a description are held in Storage, never inline, however they got there", async (prof) => {
  const p = await open(prof);
  await press(p, '.kb-card[data-key="PH-20"]');
  await until(() => p.$('[data-field="description"] .ql-editor'), "the editor (it loads when a ticket first opens)");
  // Three pictures arrive as data: URIs (a paste the editor kept inline, a drop, an older ticket's content).
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
  const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  await p.evaluate(([a, b, c]) => {
    const q = document.querySelector('[data-field="description"] .ql-editor');
    q.innerHTML += `<p>One</p><p><img src="${a}"></p><p>Two</p><p><img src="${b}"></p><p>Three</p><p><img src="${c}"></p>`;
  }, [PNG, JPG, GIF]);
  await p.waitForTimeout(150);
  await press(p, "#f-save");
  await until(async () => /PH-20/.test(await p.textContent("#kb-toast")), "saved");
  const html = (await stored(p, "PH-20")).description;
  assert.doesNotMatch(html, /data:image/, "no inline picture is stored");
  assert.equal((html.match(/<img src="https:\/\/firebasestorage\.googleapis\.com\//g) || []).length, 3, "three Storage URLs");
  const up = await p.evaluate(() => Object.keys(globalThis.__fbStub.uploads || {}));
  assert.equal(up.filter((k) => /^kanban\/PH-20\/\d+-screenshot\.(png|jpeg|gif)$/.test(k)).length, 3, `three uploads under the ticket: ${up}`);
  await p.done();
});

T("KB-C10", "the board downloads cards: 60 tickets of 150 KB each cost it a few KB, and no ticket is listened to", async (prof) => {
  const seed = kanbanSeed();
  const big = "<p>" + "Lorem ipsum dolor sit amet. ".repeat(5400) + "</p>";
  for (const [i, k] of Object.keys(seed.docs.kanbanTasks).slice(0, 60).entries()) seed.docs.kanbanTasks[k] = { ...seed.docs.kanbanTasks[k], description: big, descriptionText: "Lorem ipsum" + i };
  const p = await open(prof, "#staff-kanban", { seed });
  const tasksTotal = Object.keys(seed.docs.kanbanTasks).length;
  assert.ok(tasksTotal >= 39);
  const cards = await readBytes(p, "kanbanCards");
  assert.ok(cards > 0 && cards < 60 * 1024, `the board's payload is ${cards} bytes of cards`);
  assert.equal(await readBytes(p, "kanbanTasks"), 0, "no ticket was downloaded to draw the board");
  assert.equal(await watching(p, "kanbanTasks"), 0, "nothing listens to kanbanTasks");
  assert.ok((await watching(p, "kanbanCards")) >= 2, "the open and closed listeners are on the cards");
  await p.done();
});

T("KB-C11", "editing a description sends the board one small card update, not the description", async (prof) => {
  const seed = kanbanSeed();
  seed.docs.kanbanTasks["PH-20"] = { ...seed.docs.kanbanTasks["PH-20"], description: "<p>" + "Lorem ipsum dolor sit amet. ".repeat(5400) + "</p>" };
  const p = await open(prof, "#staff-kanban", { seed });
  const before = await readBytes(p, "kanbanCards");
  await press(p, '.kb-card[data-key="PH-20"]');
  await until(() => p.$('[data-field="description"] .ql-editor'), "the ticket's modal");
  await p.click('[data-field="description"] .ql-editor'); await p.keyboard.press("Control+Home"); await p.keyboard.type("Edited. "); // (search words come from the first 20,000 characters)
  await press(p, "#f-save");
  await until(async () => /PH-20/.test(await p.textContent("#kb-toast")), "saved");
  const sent = (await readBytes(p, "kanbanCards")) - before;
  assert.ok(sent < 2048, `the board received ${sent} bytes for a description edit`);
  assert.equal(await readBytes(p, "kanbanTasks"), 0, "the board's listeners never carried the description");
  assert.match((await stored(p, "PH-20")).description, /Edited\./);
  assert.ok((await stored(p, "PH-20")).searchTokens.includes("edited"), "search words follow the description");
  await p.done();
});

T("KB-C12", "cards behind the tickets: the board reads the tickets, asks the server to fill the cards, then moves to them", async (prof) => {
  const seed = kanbanSeed();
  seed.docs.kanbanCards = {};
  const fillOnBackfill = { fn: () => {
    const orig = window.fetch;
    window.fetch = async (u, o) => {
      if (!/\/mcp\/kanban\/backfill$/.test(String(u))) return orig(u, o);
      const core = await import("/js/kanban/kanban-core.js");
      const b = globalThis.__fbStub;
      for (const [k, t] of b.col("kanbanTasks")) b.col("kanbanCards").set(k, { ...core.cardOf(t), ...(t.closedAt ? { closedAt: t.closedAt } : {}), updatedBy: "server" });
      window.__backfills = (window.__backfills || 0) + 1;
      return new Response(JSON.stringify({ done: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  } };
  const p = await open(prof, "#staff-kanban", { seed, init: fillOnBackfill });
  // every open ticket is on the board, as before the cards existed
  const open1 = Object.values(seed.docs.kanbanTasks).filter((t) => t.open).length;
  await until(async () => (await p.$$eval(".kb-card", (e) => e.length)) >= Math.min(open1, 1), "the board");
  await until(() => p.evaluate(() => window.__backfills === 1), "the server fill, asked for once", 8000);
  await until(async () => (await watching(p, "kanbanTasks")) === 0 && (await watching(p, "kanbanCards")) >= 2, "the board on the cards", 8000);
  const shown = await p.$$eval(".kb-card", (e) => e.map((x) => x.dataset.key));
  assert.ok(shown.length >= open1, `no ticket disappeared: ${shown.length} of ${open1}`);
  await p.done();
});

T("KB-LINKS", "one-sided links: the board asks the server to make them two-sided once, and not once the settings are stamped", async (prof) => {
  const counting = { fn: () => {
    const orig = window.fetch;
    window.fetch = async (u, o) => {
      if (!/\/mcp\/kanban\/backfill-links$/.test(String(u))) return orig(u, o);
      window.__linkFills = (window.__linkFills || 0) + 1;
      return new Response(JSON.stringify({ done: true, links: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  } };
  const unstamped = kanbanSeed();
  const p = await open(prof, "#staff-kanban", { seed: unstamped, init: counting });
  await until(async () => (await p.$$eval(".kb-card", (e) => e.length)) >= 1, "the board");
  await until(() => p.evaluate(() => window.__linkFills === 1), "the links backfill, asked for once", 8000);
  await p.done();
  const stamped = kanbanSeed();
  stamped.docs.kanbanSettings.main.linksTwoSidedAt = { $ts: Date.now() };
  const q = await open(prof, "#staff-kanban", { seed: stamped, init: counting });
  await until(async () => (await q.$$eval(".kb-card", (e) => e.length)) >= 1, "the board");
  await new Promise((r) => setTimeout(r, 1200));
  assert.ok(!(await q.evaluate(() => window.__linkFills)), "no ask once the settings carry linksTwoSidedAt");
  await q.done();
});

// ── Scale: the board stays fast however many tickets are open (KB §13) ───────
// 2,000 and 5,000 open tickets, spread over the open columns. Backlog draws 25
// cards and every other column 50, "Show 50 more" reveals the rest, and the
// headers still count them all. A colleague's move patches one card.
// Limits. `first`, `mine` and `mineMedian` are how many times longer the big board may take than the 39-ticket
// board measured beside it (measured here: first cards ×1 to ×1.8, My tasks ×3 to ×4.4, the small board's click
// being one frame). `cards` is the most cards a board may hold: Backlog's 25 and 50 for each other place, plus
// one "Show 50 more". `perCard` is the most elements a board may hold for each card it has more than the small
// board, and `spare` the allowance on top: a list that grew with the tickets rather than the cards would pass both.
const SCALE = { first: 5, mine: 10, mineMedian: 10, cards: 25 + 50 * 6 + 50, perCard: 80, spare: 500 };
for (const N of [2000, 5000]) {
  T(`KB-SCALE-${N}`, `${N} open tickets: first cards fast, a filter is quick, a remote move patches one card, counts stay exact`, { on: on.desktop }, async (prof) => {
    const seed = kanbanSeed();
    const base = Object.values(KB.kanbanTasks).find((t) => t.open && t.type === "task");
    const statuses = ["backlog", "backlog", "backlog", "backlog", "backlog", "ready-for-dev", "in-progress", "in-progress", "ready-for-testing", "approved"];
    const extraTasks = {}, extraCards = {};
    const per = Object.fromEntries(statuses.map((st) => [st, 0]));
    for (let i = 0; i < N; i++) {
      const key = `PH-${1000 + i}`, status = statuses[i % statuses.length];
      const t = { ...base, key, number: 1000 + i, title: `Scale ticket ${i}`, status, open: true, rank: i, assignee: i % 10 === 0 ? ROB : emailOf("Linh"), estimate: 2, logged: 0, resolution: null, labels: [], epic: "", links: [], attachments: [], flagged: false };
      delete t.closedAt;
      extraTasks[key] = t; extraCards[key] = cardOfTask(t);
      per[status]++;
    }
    seed.docs.kanbanTasks = { ...seed.docs.kanbanTasks, ...extraTasks };
    seed.docs.kanbanCards = { ...seed.docs.kanbanCards, ...extraCards };
    const timing = { fn: () => {
      window.__t0 = performance.now();
      const mo = new MutationObserver(() => { if (document.querySelector(".kb-card")) { window.__firstCard = performance.now() - window.__t0; mo.disconnect(); } });
      mo.observe(document, { childList: true, subtree: true });
    } };
    // Speed is judged against the seed board (39 tickets) opened beside the big one: the same pages, code,
    // browser and runner, measured in turn, so a busy runner slows both and the comparison holds. A fixed
    // number of milliseconds failed three runs on 12 Nov 2026 with nothing in the board changed. What a
    // slow board would do is also counted, which no runner can change: the cards and nodes a redraw makes.
    const smallSeed = kanbanSeed();
    const firstOf = async (q) => { await until(() => q.evaluate(() => window.__firstCard > 0), "the first card's time"); return q.evaluate(() => window.__firstCard); };
    let p, s, first = Infinity, firstSmall = Infinity;
    for (let tryNo = 0; tryNo < 3; tryNo++) {
      const qs = await open(prof, "#staff-kanban", { seed: smallSeed, init: timing });
      firstSmall = Math.min(firstSmall, await firstOf(qs));
      const q = await open(prof, "#staff-kanban", { seed, init: timing });
      first = Math.min(first, await firstOf(q));
      if (first <= firstSmall * SCALE.first || tryNo === 2) { p = q; s = qs; break; }
      await q.done(); await qs.done();
    }
    assert.ok(first <= firstSmall * SCALE.first, `first cards with ${N} tickets took ${Math.round(first)} ms, over ${SCALE.first}× the ${Math.round(firstSmall)} ms the 39-ticket board took on this runner (best of up to 3 each)`);
    // paged: the columns draw a first page, the headers count everything
    const drawn = (st) => p.$$eval(`.kb-col[data-status="${st}"] .kb-card`, (e) => e.length);
    const seedBacklog = Object.values(seed.docs.kanbanTasks).filter((t) => t.open && t.status === "backlog").length;
    const seedRft = Object.values(seed.docs.kanbanTasks).filter((t) => t.open && t.status === "ready-for-testing").length;
    assert.equal(await drawn("backlog"), 25, "Backlog draws its first 25");
    assert.equal(await drawn("ready-for-testing"), 50, "other columns draw 50");
    const boardSize = (q) => q.$eval("#kb-board", (e) => ({ nodes: e.querySelectorAll("*").length, cards: e.querySelectorAll(".kb-card").length }));
    const sizeBig = await boardSize(p), sizeSmall = await boardSize(s);
    const nodeLimit = (bigCards, smallNodes, smallCards) => smallNodes + Math.max(0, bigCards - smallCards) * SCALE.perCard + SCALE.spare;
    assert.ok(sizeBig.cards <= SCALE.cards, `the board draws ${sizeBig.cards} cards with ${N} tickets (at most ${SCALE.cards}: a page per column)`);
    assert.ok(sizeBig.nodes <= nodeLimit(sizeBig.cards, sizeSmall.nodes, sizeSmall.cards), `the board holds ${sizeBig.nodes} elements for ${sizeBig.cards} cards with ${N} tickets; the 39-ticket board holds ${sizeSmall.nodes} for ${sizeSmall.cards} (limit ${nodeLimit(sizeBig.cards, sizeSmall.nodes, sizeSmall.cards)})`);
    const hs = await headers(p);
    assert.equal(hs[0].count, seedBacklog, "the Backlog header counts every ticket");
    assert.equal(hs[3].count, seedRft, "the Ready for Testing header counts every ticket");
    const effort = await p.evaluate(async (st) => { const core = await import("/js/kanban/kanban-core.js"); const ts = [...globalThis.__fbStub.col("kanbanCards").values()].filter((t) => t.status === st && t.open); return core.fmtH(ts.reduce((n, t) => n + core.remaining(t), 0)); }, "backlog");
    assert.equal(hs[0].effort, effort, "remaining effort covers the tickets not drawn");
    await press(p, '.kb-col[data-status="backlog"] .kb-more');
    await eventually(async () => assert.equal(await drawn("backlog"), 75, "Show 50 more reveals 50"));
    assert.equal((await headers(p))[0].count, seedBacklog, "the count does not change with paging");
    // My tasks: switched on 5 times on each board in turn, each click measured to the next painted frame, with
    // the elements the redraw added counted. The big board's fastest and median clicks are held to a multiple of
    // the small board's (one lucky frame cannot hide a real regression), and its redraw to a page per column.
    const mineOn = (q) => q.evaluate(async () => {
      let added = 0;
      const mo = new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) added += 1 + n.querySelectorAll("*").length; });
      mo.observe(document.querySelector("#kb-view"), { childList: true, subtree: true });
      const t0 = performance.now();
      document.querySelector("#kb-mine").click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const ms = performance.now() - t0;
      mo.disconnect();
      return { ms, added, cards: document.querySelectorAll("#kb-board .kb-card").length };
    });
    const isMine = (q) => q.getAttribute("#kb-mine", "aria-pressed");
    const big = [], small = [];
    for (let i = 0; i < 5; i++) {
      for (const [q, runs] of [[p, big], [s, small]]) {
        runs.push(await mineOn(q));
        assert.equal(await isMine(q), "true", "My tasks is on");
        if (q === p) assert.equal(await drawn("backlog"), 75, "My tasks still draws Backlog a page at a time");
        if (i < 4) { await press(q, "#kb-mine"); await until(async () => (await isMine(q)) === "false", "My tasks to switch off"); }
      }
    }
    const stat = (runs) => { const ms = runs.map((r) => r.ms).sort((x, y) => x - y); return { best: ms[0], median: ms[2], list: runs.map((r) => Math.round(r.ms)).join(", ") }; };
    const tb = stat(big), ts = stat(small);
    const { best, median } = tb;
    const work = big[big.length - 1], workSmall = small[small.length - 1];
    console.log(`  KB-SCALE-${N} first cards ${Math.round(first)} ms (39 tickets: ${Math.round(firstSmall)} ms, ×${(first / firstSmall).toFixed(2)}), My tasks best ${Math.round(best)} ms / median ${Math.round(median)} ms (39 tickets: ${Math.round(ts.best)} / ${Math.round(ts.median)} ms, ×${(best / ts.best).toFixed(2)} / ×${(median / ts.median).toFixed(2)}), board ${sizeBig.nodes} elements / ${sizeBig.cards} cards (39 tickets: ${sizeSmall.nodes} / ${sizeSmall.cards}), My tasks redraw ${work.added} elements / ${work.cards} cards (39 tickets: ${workSmall.added} / ${workSmall.cards})`);
    assert.ok(work.cards <= SCALE.cards, `My tasks drew ${work.cards} cards with ${N} tickets (at most ${SCALE.cards}: a page per column)`);
    assert.ok(work.added <= nodeLimit(work.cards, workSmall.added, workSmall.cards), `My tasks added ${work.added} elements for ${work.cards} cards with ${N} tickets; on the 39-ticket board it added ${workSmall.added} for ${workSmall.cards} (limit ${nodeLimit(work.cards, workSmall.added, workSmall.cards)})`);
    assert.ok(best <= ts.best * SCALE.mine, `My tasks with ${N} tickets: best of 5 took ${Math.round(best)} ms, over ${SCALE.mine}× the ${Math.round(ts.best)} ms on the 39-ticket board (runs ${tb.list}; 39 tickets ${ts.list})`);
    assert.ok(median <= ts.median * SCALE.mineMedian, `My tasks with ${N} tickets: median of 5 took ${Math.round(median)} ms, over ${SCALE.mineMedian}× the ${Math.round(ts.median)} ms on the 39-ticket board (runs ${tb.list}; 39 tickets ${ts.list})`);
    await s.done();
    const mine = Object.values(seed.docs.kanbanTasks).filter((t) => t.open && t.assignee === ROB && t.status === "backlog").length;
    assert.equal((await headers(p))[0].count, mine, "My tasks counts Rob's backlog");
    await press(p, "#kb-mine");
    await eventually(async () => assert.equal((await headers(p))[0].count, seedBacklog, "My tasks off: every ticket is counted again"));
    // a colleague moves one ticket: one card is patched, the rest of the board is left alone
    await p.evaluate(() => {
      window.__muts = 0;
      window.__mo = new MutationObserver((list) => { window.__muts += list.length; });
      window.__mo.observe(document.querySelector("#kb-board"), { childList: true, subtree: true, attributes: true, characterData: true });
    });
    await p.evaluate(async () => {
      const core = await import("/js/kanban/kanban-core.js"); const b = globalThis.__fbStub;
      const c = b.col("kanbanTasks"); const key = "PH-1001";
      const t = { ...c.get(key), status: "in-progress", open: true }; c.set(key, t);
      b.col("kanbanCards").set(key, { ...core.cardOf(t), updatedBy: "other@personalisationhub.com" }); b.notify();
    });
    await eventually(async () => assert.equal((await headers(p))[0].count, seedBacklog - 1, "the Backlog header follows the move"));
    await eventually(async () => assert.equal((await where(p, "PH-1001")).status, "in-progress", "the moved card is in its new column"));
    // Two frames more, so a redraw that came after the patch would be counted too.
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const muts = await p.evaluate(() => { window.__mo.disconnect(); return window.__muts; });
    assert.ok(muts > 0 && muts < 40, `a remote move changed ${muts} nodes`);
    await p.done();
  });
}

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

// ── Ticket addresses and Share link (KB-LINK-1..3) ──
const modalKey = (page) => page.$eval("#task-title-h", (e) => e.textContent.trim());
const hashOf = (page) => page.evaluate(() => location.hash);
const modalOpen = (page) => page.$eval("#task-backdrop", (e) => !e.hidden);

T("KB-C15", "a click opens the ticket here, over the board, at its PH-key address; Cmd/Ctrl-click opens a new tab", { on: (p) => p.engine === "chromium" }, async (prof) => {
  const p = await open(prof, "#staff-kanban", { newTab: true });
  let tabs = 0;
  p.ctx.on("page", () => { tabs++; });
  await press(p, '.kb-card[data-key="PH-20"]');
  await p.waitForSelector("#task-backdrop:not([hidden])");
  assert.equal(tabs, 0, "a plain click opens no new tab (no second copy of the console to load)");
  assert.equal(await modalKey(p), "PH-20");
  assert.equal(await hashOf(p), "#staff-kanban/ticket/PH-20", "the address bar holds the ticket's address");
  assert.match(await p.title(), /^PH-20 /, "the tab is named after the ticket");
  assert.ok(await p.$(".kb-card"), "the board is still underneath");
  await press(p, "#task-close");
  assert.equal(await hashOf(p), "#staff-kanban");
  // Cmd/Ctrl-click: the ticket in a new tab, the board left as it was.
  if (!prof.touch) {
    const [tab] = await Promise.all([p.ctx.waitForEvent("page"), p.click('.kb-card[data-key="PH-21"] .card-title', { modifiers: ["ControlOrMeta"] })]);
    await tab.waitForSelector("#task-backdrop:not([hidden])", { timeout: 20000 });
    assert.match(tab.url(), /#staff-kanban\/ticket\/PH-21$/, "the new tab's address ends with the PH key");
    assert.equal(await modalKey(tab), "PH-21");
    assert.equal(await modalOpen(p), false, "the board's own tab stays on the board");
    assert.equal(await hashOf(p), "#staff-kanban");
    await tab.close();
  }
  await p.done();
});

T("KB-C19", "a card's copy-link icon copies the ticket's address without opening it", async (prof) => {
  const p = await open(prof, "#staff-kanban");
  await p.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } }); });
  const btn = '.kb-card[data-key="PH-20"] .kb-link-btn';
  assert.equal(await p.getAttribute(btn, "aria-label"), "Copy a link to PH-20");
  await p.hover('.kb-card[data-key="PH-20"]').catch(() => {});
  await press(p, btn);
  await until(async () => /Link to PH-20 copied/.test(await toastText(p)), "the Link copied confirmation");
  assert.equal(await p.evaluate(() => window.__copied), (await p.evaluate(() => location.origin + location.pathname)) + "#staff-kanban/ticket/PH-20");
  assert.equal(await p.$eval(btn + " .material-symbols-outlined", (e) => e.textContent), "done", "the icon confirms too");
  assert.equal(await modalOpen(p), false, "copying doesn't open the ticket");
  assert.equal(await hashOf(p), "#staff-kanban");
  // The card's top row still fits: key, priority, link and flag inside the card.
  const fits = await p.$eval('.kb-card[data-key="PH-20"]', (c) => { const r = c.getBoundingClientRect(); return [...c.querySelectorAll(".kb-card-top > *")].every((e) => { const b = e.getBoundingClientRect(); return b.right <= r.right + 1 && b.left >= r.left - 1; }); });
  assert.ok(fits, "the card's top row fits inside the card");
  assert.deepEqual(await writes(p, /kanban/), [], "copying a link writes nothing");
  await p.done();
});

T("KB-C20", "a person with no photo shows their first and last initials on cards, the people filter and the ticket", async (prof) => {
  const p = await open(prof, "#staff-kanban");
  const chip = (who) => p.$eval(`.kb-person-chip[data-person="${who}"] .kb-avatar`, (e) => e.textContent.trim());
  // Only a display name: its first two words, as Users shows them.
  assert.equal(await chip(LINH), "TT", "Trần Thị Linh");
  // First and last name saved in Users win over the display name.
  await p.evaluate((m) => { const b = globalThis.__fbStub; const c = b.col("memberDirectory"); c.set(m, { ...c.get(m), firstName: "Minh", lastName: "Nguyen" }); b.notify(); }, MINH);
  await until(async () => (await chip(MINH)) === "MN", "Minh's chip to read MN");
  const card = await p.$$eval(".kb-card .kb-card-footer .kb-avatar:not(.kb-avatar-img):not(.kb-avatar-none)", (e) => e.map((x) => x.textContent.trim()));
  assert.ok(card.length && card.every((t) => /^[A-ZÀ-Ỹ]{1,2}$/u.test(t)), "every card avatar without a photo shows initials: " + card.join(","));
  await until(() => p.$('.kb-card[data-key="PH-23"]'), "PH-23 on the board");
  assert.equal(await p.$eval('.kb-card[data-key="PH-23"] .kb-card-footer .kb-avatar', (e) => e.textContent.trim()), "MN", "Minh's card");
  // In a ticket: the comment from Huy (Lê Quang Huy, no first/last name saved) shows LQ, as Users does.
  await press(p, '.kb-card[data-key="PH-20"] .card-title');
  await p.waitForSelector("#task-backdrop:not([hidden])");
  await until(async () => (await p.$$eval("#task-backdrop .kb-comment .kb-avatar", (e) => e.map((x) => x.textContent.trim()))).includes("LQ"), "Huy's comment to show LQ");
  await p.done();
});

T("KB-C21", "a field changed before the editor has loaded still switches Save on", async (prof) => {
  const p = await open(prof);
  // The editor downloads the first time a ticket opens. Hold it back, as a slow connection or a busy runner does.
  let release; const held = new Promise((r) => { release = r; });
  await p.route(/\/quill\/1\.3\.7\/quill\.min\.js$/, async (route) => { await held; await route.fallback(); });
  await press(p, '.kb-card[data-key="PH-26"]');
  await p.waitForSelector("#task-backdrop:not([hidden]) #f-title");
  assert.equal(await p.$("#f-description .ql-editor"), null, "the editor has not arrived");
  assert.ok(await p.isDisabled("#f-save"), "nothing has changed: Save is off");
  await p.fill("#f-title", "Changed before the editor loaded");
  release();
  await p.waitForSelector("#f-description .ql-editor");
  await eventually(async () => assert.ok(await p.isEnabled("#f-save"), "Save is on: the title changed"));
  await press(p, "#f-save");
  await eventually(async () => assert.equal((await stored(p, "PH-26")).title, "Changed before the editor loaded"));
  // Nothing changed this time, and the editor is already here: Save stays off.
  await until(() => p.$eval("#task-backdrop", (e) => e.hidden), "the saved ticket to close");
  await press(p, '.kb-card[data-key="PH-27"]');
  await until(async () => /PH-27/.test(await p.textContent("#task-title-h")) && !(await p.$eval("#task-backdrop", (e) => e.hidden)), "PH-27 to open");
  await p.waitForSelector("#f-description .ql-editor");
  await sleep(300); // Save's state is re-read every 100 ms: long enough for a wrong "changed" to show
  assert.ok(await p.isDisabled("#f-save"), "an untouched ticket keeps Save off");
  await p.done();
});

T("KB-C22", "the image button opens the computer's file picker at once; choosing files inserts them, with nothing in between", async (prof) => {
  const p = await open(prof);
  await press(p, '.kb-card[data-key="PH-20"]');
  const ed = '[data-field="description"] .ql-editor', btn = '[data-field="description"] .ql-image';
  await p.waitForSelector(ed);
  // A real PNG (2×2), so the page can shrink it as it does a screenshot.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQIW2P8z8DwnwEImBigAMwAAC0EAgGkP6pJAAAAAElFTkSuQmCC", "base64");
  const shot = (name) => ({ name, mimeType: "image/png", buffer: png });
  const before = await p.$$eval(`${ed} img`, (e) => e.length);
  // One press: the picker is what opens, not a dialog in the editor.
  const [chooser] = await Promise.all([p.waitForEvent("filechooser", { timeout: 5000 }), press(p, btn)]);
  assert.equal(await p.$(".kb-ed-panel"), null, "no dialog to click through");
  assert.ok(chooser.isMultiple(), "several screenshots can be chosen at once");
  await chooser.setFiles([shot("Checkout error.png"), shot("Basket total.png")]);
  // Choosing is the last step: both are uploaded under the ticket and are in the description.
  await eventually(async () => assert.equal(await p.$$eval(`${ed} img`, (e) => e.length), before + 2, "both images are in the description"));
  const imgs = await p.$$eval(`${ed} img`, (e) => e.slice(-2).map((i) => ({ src: i.getAttribute("src"), alt: i.getAttribute("alt") })));
  assert.deepEqual(imgs.map((i) => i.alt), ["Checkout error", "Basket total"], "in the order chosen, each named after its file");
  for (const i of imgs) assert.match(i.src, /firebasestorage.*kanban%2FPH-20%2F/, "held in the ticket's storage, not inline");
  const up = await p.evaluate(() => Object.keys(globalThis.__fbStub.uploads || {}));
  assert.equal(up.filter((k) => /^kanban\/PH-20\//.test(k)).length, 2, `two uploads under the ticket: ${up}`);
  assert.equal(await p.$(`${btn}.kb-ed-busy`), null, "the button is ready again");
  // Saved with the ticket.
  await eventually(async () => assert.ok(await p.isEnabled("#f-save"), "Save is on"));
  await press(p, "#f-save");
  await eventually(async () => assert.equal(((await stored(p, "PH-20")).description.match(/<img /g) || []).length, before + 2, "the saved description holds both"));
  // Closing the picker without choosing adds nothing and leaves no dialog.
  await press(p, '.kb-card[data-key="PH-21"]');
  await until(async () => /PH-21/.test(await p.textContent("#task-title-h")) && !(await p.$eval("#task-backdrop", (e) => e.hidden)), "PH-21 to open");
  await p.waitForSelector(ed);
  const had = await p.$$eval(`${ed} img`, (e) => e.length);
  const [again] = await Promise.all([p.waitForEvent("filechooser", { timeout: 5000 }), press(p, btn)]);
  await again.setFiles([]);
  await sleep(200);
  assert.equal(await p.$$eval(`${ed} img`, (e) => e.length), had, "nothing chosen, nothing added");
  assert.equal(await p.$(".kb-ed-panel"), null);
  // An image that is already on the web: Shift-click still opens the link dialog (mouse only).
  if (!prof.touch) {
    await p.click(btn, { modifiers: ["Shift"] });
    await p.waitForSelector('.kb-ed-panel [data-f="url"]');
    await p.click('.kb-ed-panel [data-x="cancel"]');
  }
  await p.done();
});

T("KB-SEC-1", "stored text never runs as script: a description, a member's photo address, an assignee on the report, an attachment link, a comment", async (prof) => {
  const hit = `window.__xss = (window.__xss || 0) + 1`;
  const seed = kanbanSeed();
  // A description as another writer could have stored it.
  seed.docs.kanbanTasks["PH-20"].description = `<p>Before</p><img src="x" onerror="${hit}"><svg onload="${hit}"></svg><form action="https://example.test"><input name="password"></form><p style="position:fixed;inset:0">After</p><table><tbody><tr><td><img src="x" onerror="${hit}"></td></tr></tbody></table>`;
  seed.docs.kanbanTasks["PH-20"].attachments = [{ name: "notes.txt", url: `javascript:${hit}`, size: 10 }, { name: "ok.txt", url: "https://example.test/ok.txt", size: 10 }];
  seed.docs.kanbanCards["PH-20"].attachmentCount = 2;
  // A member's own photo address, as that member could have set it.
  const bad = `https://firebasestorage.googleapis.com/v0/b/x/o/avatars"><img src=x onerror="${hit}">');background:url('https://example.test/x`;
  seed.docs.memberDirectory[HUY].photoUrl = bad; seed.docs.consoleUsers[HUY].photoUrl = bad;
  // A ticket in the current release assigned to something that is not an address.
  const who = `x@x"><img src=x onerror="${hit}">`;
  seed.docs.kanbanTasks["PH-21"].assignee = who; seed.docs.kanbanCards["PH-21"].assignee = who;
  seed.docs["kanbanTasks/PH-20/comments"] = { c1: { author: HUY, at: { $ts: Date.parse("2026-10-20T09:00:00Z") }, text: "hello", html: `<p>hello</p><img src=x onerror="${hit}"><iframe src="javascript:${hit}"></iframe><form action="https://example.test"><input type="password"></form><p style="position:fixed;inset:0;z-index:99999">cover</p>` } };
  const p = await open(prof, "#staff-kanban", { seed });
  await press(p, '.kb-card[data-key="PH-20"]');
  const ed = '[data-field="description"] .ql-editor';
  await p.waitForSelector(ed);
  await until(async () => /Before/.test(await p.textContent(ed)), "the description in the editor");
  assert.match(await p.textContent(ed), /After/, "the text is kept");
  assert.equal(await p.$$eval(`${ed} form, ${ed} input, ${ed} svg, ${ed} [style*="fixed"], ${ed} [onerror], ${ed} [onload]`, (e) => e.length), 0, "nothing active is left in the description");
  // The comment, cleaned the same way.
  await until(() => p.$(".kb-comment-text"), "the comment");
  assert.equal(await p.$$eval(".kb-comment-text form, .kb-comment-text input, .kb-comment-text iframe, .kb-comment-text [style], .kb-comment-text [onerror]", (e) => e.length), 0, "nothing active is left in the comment");
  // The attachment with a script address is listed, not linked.
  assert.deepEqual(await p.$$eval("#f-attachments a", (e) => e.map((a) => a.getAttribute("href"))), ["https://example.test/ok.txt"]);
  // The @ list draws every member's picture.
  await p.click(ed); await p.keyboard.press("Control+End"); await p.keyboard.type(" @hu");
  await p.waitForSelector(".kb-mention-item");
  assert.equal(await p.$$eval(".kb-mention-box img, .kb-mention-item img", (e) => e.length), 0, "the photo address added no element");
  await p.keyboard.press("Escape");
  await press(p, "#f-cancel");
  // The board's own avatars and the report's rows.
  assert.equal(await p.$$eval("#kb-view img[src='x']", (e) => e.length), 0);
  const q = await open(prof, "#staff-kanban/report?status=all", { seed });
  await q.waitForSelector("#kb-view .page-header");
  await until(() => q.$("[data-person]"), "the report's people");
  assert.equal(await q.$$eval("#kb-view img[src='x']", (e) => e.length), 0, "the assignee added no element to the report");
  assert.ok((await q.$$eval("[data-person]", (e) => e.map((x) => x.dataset.person))).includes(who), "the assignee is carried as text");
  // A real photo address is used exactly as it is stored.
  const real = "https://firebasestorage.googleapis.com/v0/b/backlog-tracker-e4ed2.firebasestorage.app/o/avatars%2Fhuy.le%40personalisationhub.com.jpg?alt=media&token=0a1b2c3d-0000-4000-8000-123456789abc";
  assert.equal(await q.evaluate(async (u) => (await import("/js/kanban/kanban-editor.js")).KBEditor.cssUrl(u), real), real);
  await sleep(300); // long enough for an image that had been added to fail and fire
  for (const page of [p, q]) assert.equal(await page.evaluate(() => window.__xss || 0), 0, "no stored script ran");
  // (the harmless <img src="x"> that is left asks the server for /x)
  const allow = /404 \(Not Found\) \(http:\/\/127\.0\.0\.1:\d+\/x\)/;
  await q.done({ allow }); await p.done({ allow });
});

T("KB-R1", "an editor (every team member but the owner) creates, moves, edits, flags and comments under their own name; Kanban settings are read-only for them", async (prof) => {
  const p = await open(prof, "#staff-kanban", { seed: kanbanSeed({ user: { email: LINH, role: "editor" } }), ...TALL });
  // Create.
  await press(p, "#kb-new-btn");
  await p.fill("#f-title", "Raised by an editor");
  await press(p, "#f-save");
  const made = await until(async () => (await p.evaluate(() => [...globalThis.__fbStub.col("kanbanTasks")].filter(([, t]) => t.title === "Raised by an editor")))[0], "the new ticket");
  assert.equal(made[1].createdBy, LINH); assert.equal(made[1].reporter, LINH);
  await until(() => p.$eval("#task-backdrop", (e) => e.hidden), "the new ticket's modal to close");
  // Edit, move by the Status menu and flag, in one ticket.
  await press(p, '.kb-card[data-key="PH-34"]');
  await until(async () => /PH-34/.test(await p.textContent("#task-title-h")) && !(await p.$eval("#task-backdrop", (e) => e.hidden)), "PH-34 to open");
  assert.ok(await p.isEnabled("#f-title"), "an editor can change a ticket");
  await p.fill("#f-title", "Edited by an editor");
  await p.selectOption("#f-status", "ready-for-dev");
  await press(p, "#task-flag");
  await eventually(async () => assert.ok(await p.isEnabled("#f-save")));
  await press(p, "#f-save");
  await eventually(async () => { const t = await stored(p, "PH-34"); assert.deepEqual([t.title, t.status, t.flagged, t.updatedBy], ["Edited by an editor", "ready-for-dev", true, LINH]); });
  await eventually(async () => assert.equal((await where(p, "PH-34")).status, "ready-for-dev", "the card moved"));
  // Comment.
  await press(p, '.kb-card[data-key="PH-34"]');
  await until(async () => /PH-34/.test(await p.textContent("#task-title-h")) && !(await p.$eval("#task-backdrop", (e) => e.hidden)), "PH-34 to open again");
  await p.waitForSelector('[data-field="comments"] .ql-editor');
  await p.click('[data-field="comments"] .ql-editor'); await p.keyboard.type("Looked at this today");
  await press(p, "#f-comment-add");
  const c = await until(async () => (await writes(p, /^kanbanTasks\/PH-34\/comments\//))[0], "the comment to be written");
  assert.equal(c.data.author, LINH);
  await press(p, "#f-cancel");
  // Everything written to a ticket, its card or its log carries the editor's own address: the rules refuse anything else.
  const all = await writes(p, /^kanban(Tasks|Cards)\//);
  assert.ok(all.length >= 4, `${all.length} writes`);
  for (const w of all) {
    if (!w.data) continue;
    if (/\/activity\//.test(w.path)) assert.equal(w.data.who, LINH, `${w.path} who`);
    else if (/\/comments\//.test(w.path)) assert.equal(w.data.author, LINH, `${w.path} author`);
    else if ("updatedBy" in w.data) assert.equal(w.data.updatedBy, LINH, `${w.path} updatedBy`);
  }
  assert.equal((await writes(p, /^kanban(Settings|Sprints|Notifications)\//)).length, 0, "an editor writes no settings, sprints or notifications");
  await p.done();
  // Settings: shown, not changeable.
  const q = await open(prof, "#staff-kanban/settings", { seed: kanbanSeed({ user: { email: LINH, role: "editor" } }) });
  await q.waitForSelector("[data-show]");
  assert.equal(await q.$$eval("[data-show]:not([disabled]), [data-req]:not([disabled])", (e) => e.length), 0, "every field switch is disabled");
  assert.equal(await q.$("#st-sprint-add"), null, "no Add sprint");
  await q.done();
});

T("KB-C24", "typing in a table cell of the description switches Save on, and what was typed is saved", async (prof) => {
  // A table cell is edited in place: the editor reports no text change for it, so Save has to notice by itself.
  const seed = kanbanSeed();
  seed.docs.kanbanTasks["PH-20"].description = '<p>Steps</p><div class="faq-table"><table><thead><tr><th>Step</th><th>Expected</th></tr></thead><tbody><tr><td>1</td><td>Offer shows</td></tr></tbody></table></div><p>End</p>';
  const p = await open(prof, "#staff-kanban", { seed });
  await press(p, '.kb-card[data-key="PH-20"]');
  const cell = '[data-field="description"] .ql-editor td >> nth=1';
  await p.waitForSelector('[data-field="description"] .ql-editor td');
  await sleep(350); // Save's state is re-read every 100 ms: it has settled as "nothing changed"
  assert.ok(await p.isDisabled("#f-save"), "nothing changed yet");
  await p.locator(cell).click();
  await p.keyboard.press("End"); await p.keyboard.type(" on the board");
  await eventually(async () => assert.ok(await p.isEnabled("#f-save"), "Save is on after typing in the cell"));
  await press(p, "#f-save");
  await eventually(async () => assert.match((await stored(p, "PH-20")).description, /Offer shows on the board/));
  await p.done();
});

T("KB-C25", "a tag written over MCP shows as a mention in the ticket and survives a save from the board", async (prof) => {
  // The markup kanban_create_task / kanban_update_task write for `mention` (functions/kanban.js tagPeople).
  const seed = kanbanSeed();
  seed.docs.kanbanTasks["PH-20"].description = `<p>Please look at the offer banner.</p><p><span class="kb-mention" data-user="${HUY}" data-name="Huy">@Huy</span></p>`;
  seed.docs.kanbanTasks["PH-20"].mentions = [HUY];
  const p = await open(prof, "#staff-kanban", { seed });
  await press(p, '.kb-card[data-key="PH-20"]');
  const ed = '[data-field="description"] .ql-editor';
  await p.waitForSelector(`${ed} .kb-mention`);
  assert.deepEqual(await p.$$eval(`${ed} .kb-mention`, (e) => e.map((m) => [m.dataset.user, m.textContent.trim()])), [[HUY, "@Huy"]]);
  await sleep(350);
  assert.ok(await p.isDisabled("#f-save"), "opening it changes nothing");
  await p.fill("#f-title", "Offer banner, retitled");
  await eventually(async () => assert.ok(await p.isEnabled("#f-save")));
  await press(p, "#f-save");
  await eventually(async () => assert.equal((await stored(p, "PH-20")).title, "Offer banner, retitled"));
  const t = await stored(p, "PH-20");
  assert.deepEqual(t.mentions, [HUY], "the tag is still on the ticket, so nobody is told a second time");
  assert.match(t.description, new RegExp(`data-user="${HUY.replace(/\./g, "\\.")}"`));
  await p.done();
});

T("KB-C16", "a ticket address opens that ticket; editing the key opens another; an unknown key says Ticket not found", async (prof) => {
  const p = await open(prof, "#staff-kanban/ticket/PH-21");
  await p.waitForSelector("#task-backdrop:not([hidden])");
  assert.equal(await modalKey(p), "PH-21");
  assert.equal(await hashOf(p), "#staff-kanban/ticket/PH-21");
  // Edit the key in the address bar: lower case and a bare number are read as PH keys.
  await p.evaluate(() => { location.hash = "#staff-kanban/ticket/ph-22"; });
  await until(async () => (await modalOpen(p)) && (await modalKey(p)) === "PH-22", "PH-22 to open from the edited address");
  assert.equal(await hashOf(p), "#staff-kanban/ticket/PH-22", "the address is tidied to the key");
  await p.evaluate(() => { location.hash = "#staff-kanban/ticket/23"; });
  await until(async () => (await modalOpen(p)) && (await modalKey(p)) === "PH-23", "PH-23 to open from a bare number");
  // Closing the ticket leaves the board, at the board's address.
  await press(p, "#task-close");
  assert.equal(await modalOpen(p), false);
  assert.equal(await hashOf(p), "#staff-kanban");
  assert.ok(await p.$(".kb-card"), "the board is underneath");
  // A key that doesn't exist, then something that isn't a key at all.
  for (const [typed, named] of [["PH-9999", "PH-9999"], ["banana", "banana"]]) {
    await p.evaluate((h) => { location.hash = h; }, `#staff-kanban/ticket/${typed}`);
    await p.waitForSelector(".kb-notfound");
    assert.match(await p.textContent(".kb-notfound h3"), /Ticket not found/);
    assert.match(await p.textContent(".kb-notfound p"), new RegExp(named));
    assert.equal(await modalOpen(p), false);
    assert.equal(await p.$(".kb-card"), null, "no board behind the message");
    assert.match(await p.title(), /Ticket not found/);
  }
  await press(p, "#kb-notfound-board");
  await p.waitForSelector(".kb-card");
  assert.equal(await hashOf(p), "#staff-kanban");
  assert.equal(await p.$(".kb-notfound"), null);
  assert.deepEqual(await writes(p, /kanban/), [], "opening tickets by address writes nothing");
  await p.done();
});

T("KB-C17", "Share link copies the ticket's address and says Link copied; the copied link opens the ticket", async (prof) => {
  const p = await open(prof, "#staff-kanban");
  await p.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } }); });
  // A new ticket has no address yet: no Share link.
  if (await p.$("#kb-new-btn")) {
    await press(p, "#kb-new-btn"); await p.waitForSelector("#f-title");
    assert.equal(await p.isVisible("#task-share"), false, "no Share link on a ticket that isn't saved");
    await press(p, "#f-cancel");
  }
  await press(p, '.kb-card[data-key="PH-20"]');
  await p.waitForSelector("#task-backdrop:not([hidden])");
  assert.equal(await hashOf(p), "#staff-kanban/ticket/PH-20", "the address bar holds the open ticket's address");
  assert.ok(await p.isVisible("#task-share"));
  assert.equal(await p.getAttribute("#task-share", "aria-label"), "Copy a link to this ticket");
  const box = await p.$eval("#task-share", (e) => { const r = e.getBoundingClientRect(), pn = document.querySelector(".kb-task-panel").getBoundingClientRect(); return { w: r.width, h: r.height, inside: r.left >= pn.left && r.right <= pn.right }; });
  assert.ok(box.w >= 36 && box.h >= 36 && box.inside, "a 36px target, inside the ticket's header");
  await press(p, "#task-share");
  await until(async () => /Link copied/.test(await toastText(p)), "the Link copied confirmation");
  const copied = await p.evaluate(() => window.__copied);
  assert.equal(copied, (await p.evaluate(() => location.origin + location.pathname)) + "#staff-kanban/ticket/PH-20");
  assert.equal(await p.$eval("#task-share .material-symbols-outlined", (e) => e.textContent), "done", "the icon confirms too");
  // The copied link, opened fresh (another tab of the same browser), opens the same ticket.
  const other = await p.ctx.newPage();
  await other.goto(copied);
  await other.waitForSelector("#task-backdrop:not([hidden])", { timeout: 20000 });
  assert.equal(await modalKey(other), "PH-20");
  await other.close();
  // Where the browser won't copy, the link is shown to copy by hand.
  await p.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("denied"); }; document.execCommand = () => false; });
  await press(p, "#task-share");
  await until(async () => /couldn't be copied/.test(await toastText(p)), "the copy-by-hand message");
  assert.match(await p.textContent("#kb-toast .kb-toast-url"), /#staff-kanban\/ticket\/PH-20$/);
  await press(p, "#task-close");
  assert.equal(await hashOf(p), "#staff-kanban");
  assert.deepEqual(await writes(p, /kanban/), [], "sharing writes nothing");
  await p.done();
});

T("KB-C18", "a ticket opened from the report keeps the report's address for when it closes", { on: on.wide }, async (prof) => {
  const p = await open(prof, "#staff-kanban/report?release=4-13");
  const before = await hashOf(p);
  await p.waitForSelector("#kb-view [data-open]");
  await press(p, "#kb-view [data-open]");
  await p.waitForSelector("#task-backdrop:not([hidden])");
  assert.match(await hashOf(p), /^#staff-kanban\/ticket\/PH-\d+$/);
  await press(p, "#task-close");
  assert.equal(await hashOf(p), before);
  assert.ok(await p.$("#kb-view .page-header"), "still on the report");
  await p.done();
});

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
  // User Management → Users (admins): Manage → Set photo on the member's row.
  openTeam: async (p) => { await p.evaluate(() => document.getElementById("faq-settings-btn").click()); await p.waitForSelector(".um-manage", { state: "attached", timeout: 8000 }); await sleep(250); },
  setOtherPhoto: async (p, who, file) => {
    await E.openTeam(p);
    await p.evaluate((e) => document.querySelector(`.um-manage[data-manage="${e}"]`).click(), pid(who));
    const sel = `#um-manage [data-team-photo]`;
    const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.evaluate((s) => document.querySelector(s).click(), sel)]);
    await fc.setFiles(file); await sleep(600);
    const m = await p.evaluate((e) => globalThis.__fbStub.col("consoleUsers").get(e), pid(who));
    assert.ok(m && m.photoUrl, "the member's row has the new photo");
    await E.go(p, "kanban");
  },
  canSetOtherPhoto: async (p) => { await p.evaluate(() => document.getElementById("faq-settings-btn").click()); await sleep(600); return !!(await p.$(".um-manage")) && await p.$eval(".um-manage", (e) => e.getClientRects().length > 0).catch(() => false); },
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
