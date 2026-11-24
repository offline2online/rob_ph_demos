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
import { recordFlaky } from "./flaky.mjs";

// A build session that did not touch the Staff Kanban runs the quick profiles
// (desktop 1440 + phone 390, Chromium) and leaves the full tablet matrix to
// the train: `npm run test:fast-ui` sets BUILD_SESSION_FAST=1. CI never does.
if (process.env.BUILD_SESSION_FAST === "1" && !process.env.KB_PROFILES) {
  process.env.KB_PROFILES = "quick";
  console.log("staff-kanban: quick profiles only (BUILD_SESSION_FAST=1); the full viewport matrix is train-only for a build session");
}

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
// The name the board shows for each of them: first name + last name as saved, else the display name.
const FULL = { rob: "Rob", minh: "Nguyễn Văn Minh", linh: "Trần Thị Linh", huy: "Lê Quang Huy", thao: "Phạm Thu Thảo", duc: "Đỗ Minh Đức" };
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
    try { await fn(prof); await sweep(); if (attempt) { console.log(`# FLAKY ${id} [${prof.id}]: failed, passed on retry ${attempt} — ${why}`); FLAKY.push({ id, profile: prof.id, why }); recordFlaky({ suite: "staff-kanban-console", id, profile: prof.id, error: why }); } return; }
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
  p.profile = prof; p.engine = prof.engine; p.ctx = op.context; p.agentCalls = op.agentSendCalls; p.voiceCalls = op.voiceMentionCalls;
  // A card opens its ticket in a new tab (KB-LINK-1). The cases written before that drive the ticket in this page, which is
  // what the board does when the browser refuses a new tab; KB-C15 (o.newTab) covers the new tab itself.
  if (!o.newTab) { const block = () => { window.open = () => null; }; await p.addInitScript(block); await p.evaluate(block); }
  // An existing ticket opens for reading (KB-VIEW-1): its title, description, criteria, links and details are read-only
  // until their edit icon is pressed. The cases written before that drive the ticket's form, so here every edit icon is
  // pressed as soon as a ticket is drawn; KB-C35 to KB-C38 (o.review) cover the reading view itself.
  if (!o.review) {
    const openForEditing = () => {
      // (pressing an edit icon puts the cursor in its field; the case's own focus is put back)
      const press = () => {
        for (const b of document.querySelectorAll("#task-form .kb-locked [data-kb-edit]")) {
          const was = document.activeElement;
          b.click();
          const now = document.activeElement;
          if (now === was || !now || !document.querySelector("#task-form").contains(now)) continue;
          if (was && was !== document.body && was.focus) was.focus(); else now.blur();
        }
      };
      const start = () => { const form = document.querySelector("#task-form"); if (!form) return false; new MutationObserver(press).observe(form, { childList: true, subtree: true }); press(); return true; };
      if (!start()) document.addEventListener("DOMContentLoaded", start);
    };
    await p.addInitScript(openForEditing); await p.evaluate(openForEditing);
  }
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
// Opens the New task form and waits until it has finished opening. The form puts the cursor in its title on a short
// timer (openTask); on a busy runner that timer can fire after the case has already moved to another field, and an
// Enter meant for that field then lands in the title and submits the form. TC-68 flaked on exactly this: its first
// criterion's Enter created the ticket and closed the form, and the next fill waited 30 s for #f-ac-input.
async function openNewTask(p) {
  await press(p, "#kb-new-btn");
  await until(() => p.$("#task-backdrop:not([hidden]) #f-title"), "the New task form");
  await eventually(async () => assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.id), "f-title", "the form has put the cursor in its title"));
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
    assert.equal(w.status, "ready-for-testing"); assert.equal(w.avatar, FULL.duc, "no automatic tester");
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
  assert.equal(w.avatar, FULL.huy);
  assert.match(await p.textContent("#kb-toast"), /reassigned to Lê Quang Huy for testing/);
  assert.match(await p.textContent('.kb-card[data-key="PH-19"] .kb-handoff'), /From Đỗ Minh Đức/);
  assert.equal((await stored(p, "PH-19")).previousAssignee, emailOf("Đức"));
  await moveBy(p, m, "PH-19", "in-progress");
  w = await where(p, "PH-19");
  assert.equal(w.status, "in-progress");
  assert.equal(w.avatar, FULL.duc);
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
  // The open menu is the page's action: the Aidan launcher steps out of its way
  // (on a 360 px phone it used to sit on the menu's Done button).
  assert.notEqual(await p.evaluate(() => { const l = document.getElementById("aidan-chat-launcher"); return l ? getComputedStyle(l).visibility : "none"; }), "visible", "the Aidan launcher steps aside while Filters is open");
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

T("TC-09", "filter bar (with search) and column headers stay pinned; filter bar fits one line from 1024px", { on: on.wide }, async (prof) => {
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
  // Search is in the pinned bar, between My tasks and Release, and still usable after scrolling.
  const order = await p.$$eval(".kb-filters > *", (e) => e.map((x) => x.id || x.querySelector("input")?.id || x.className.split(" ")[0]));
  assert.deepEqual(order.slice(order.indexOf("kb-mine"), order.indexOf("kb-mine") + 3), ["kb-mine", "kb-q", "kb-release"], "search sits between My tasks and Release");
  assert.equal(await p.$eval("#kb-q", (e) => !!e.closest("#kb-sticky") && !e.closest(".page-header")), true, "search is in the pinned bar, not the page header");
  const q = await p.$eval("#kb-q", (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), w: Math.round(r.width) }; });
  assert.ok(q.top >= 0 && q.top < 80 && q.w > 60, `search visible in the pinned bar after scrolling (${JSON.stringify(q)})`);
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

// A new ticket goes to the top of Backlog (YTQ9JcaL8lIq5MbHtT3J): Backlog draws its first 25 cards by rank
// (KB §13), so a ticket ranked at the bottom of a long Backlog was behind "Show more" and looked missing.
T("KB-NEW-TOP", "a new ticket is drawn at the top of a long Backlog, with no filter, as soon as it is created", { on: on.desktop }, async (prof) => {
  const seed = kanbanSeed();
  const base = Object.values(KB.kanbanTasks).find((t) => t.open && t.type === "task");
  const extraTasks = {}, extraCards = {};
  for (let i = 0; i < 40; i++) {
    const key = `PH-${1000 + i}`;
    const t = { ...base, key, number: 1000 + i, title: `Long backlog ${i}`, status: "backlog", open: true, rank: 1000 + i * 10, resolution: null, labels: [], epic: "", links: [], attachments: [], flagged: false };
    delete t.closedAt;
    extraTasks[key] = t; extraCards[key] = cardOfTask(t);
  }
  seed.docs.kanbanTasks = { ...seed.docs.kanbanTasks, ...extraTasks };
  seed.docs.kanbanCards = { ...seed.docs.kanbanCards, ...extraCards };
  // One priority throughout (the form's default, Medium): Backlog lists by priority first (KB-BOARD-3a), and a new
  // ticket goes to the top of its own priority.
  for (const c of ["kanbanTasks", "kanbanCards"]) for (const t of Object.values(seed.docs[c])) t.priority = "medium";
  const p = await open(prof, "#staff-kanban", { seed });
  const drawn = () => p.$$eval('.kb-col[data-status="backlog"] .kb-card', (e) => e.map((x) => x.dataset.key));
  assert.equal((await drawn()).length, 25, "Backlog draws its first 25");
  await press(p, "#kb-new-btn");
  await p.fill("#f-title", "Raised on a long backlog");
  await press(p, "#f-save");
  await until(async () => /PH-40 created in Backlog/.test(await p.textContent("#kb-toast")), "the created toast");
  await eventually(async () => assert.equal((await drawn())[0], "PH-40", "the new ticket is the first card in Backlog"));
  const ranks = await p.evaluate(() => [...globalThis.__fbStub.col("kanbanTasks").values()].filter((t) => t.status === "backlog").map((t) => [t.key, t.rank]));
  const low = Math.min(...ranks.filter(([k]) => k !== "PH-40").map(([, r]) => r));
  assert.equal(ranks.find(([k]) => k === "PH-40")[1], low - 10, "ranked above every Backlog ticket");
  await p.done();
});

// Priority order (J0C1tqszxl1xETVj060b, KB-BOARD-3a): every column, on the unfiltered board and in a staff
// swimlane, lists Highest down to Lowest (none = Medium), and by rank within one priority.
T("KB-PRIO-ORDER", "columns list tickets by priority, Highest first, then rank, with no filter and in a swimlane", { on: on.desktop }, async (prof) => {
  const seed = kanbanSeed();
  const base = Object.values(KB.kanbanTasks).find((t) => t.open && t.type === "task");
  const extraTasks = {}, extraCards = {};
  // Ranked so rank order alone would be the reverse of priority order.
  [["lowest", 1], ["low", 2], ["", 3], ["medium", 4], ["high", 5], ["highest", 6], ["highest", 7]].forEach(([priority, r], i) => {
    const key = `PH-${2000 + i}`;
    const t = { ...base, key, number: 2000 + i, title: `Priority order ${i}`, status: "backlog", open: true, rank: -1000 + r, priority, assignee: LINH, resolution: null, labels: [], epic: "", links: [], attachments: [], flagged: false };
    delete t.closedAt;
    extraTasks[key] = t; extraCards[key] = cardOfTask(t);
  });
  seed.docs.kanbanTasks = { ...seed.docs.kanbanTasks, ...extraTasks };
  seed.docs.kanbanCards = { ...seed.docs.kanbanCards, ...extraCards };
  const p = await open(prof, "#staff-kanban", { seed, height: 2000 });
  const PR = ["highest", "high", "medium", "low", "lowest"];
  const pr = (t) => { const i = PR.indexOf(t.priority); return i < 0 ? 2 : i; };
  const sortedOk = async (sel, what) => {
    const keys = await p.$$eval(sel, (e) => e.map((x) => x.dataset.key));
    const byKey = await p.evaluate(() => Object.fromEntries([...globalThis.__fbStub.col("kanbanTasks").values()].map((t) => [t.key, { priority: t.priority || "", rank: t.rank }])));
    assert.ok(keys.length >= 7, `${what}: cards drawn`);
    for (let i = 1; i < keys.length; i++) {
      const a = byKey[keys[i - 1]], b = byKey[keys[i]];
      assert.ok(pr(a) < pr(b) || (pr(a) === pr(b) && a.rank <= b.rank), `${what}: ${keys[i - 1]} (${a.priority || "none"}) before ${keys[i]} (${b.priority || "none"})`);
    }
    return keys;
  };
  const plain = await sortedOk('.kb-col[data-status="backlog"] .kb-card', "plain board Backlog");
  assert.ok(plain.indexOf("PH-2005") < plain.indexOf("PH-2006"), "two Highest tickets keep their rank order");
  assert.ok(plain.indexOf("PH-2006") < plain.indexOf("PH-2004"), "Highest above High although ranked below it");
  assert.ok(plain.indexOf("PH-2000") > plain.indexOf("PH-2001"), "Lowest below Low");
  await press(p, `.kb-person-chip[data-person="${LINH}"]`);
  const lane = await sortedOk(`.kb-lane-cell[data-lane="${LINH}"][data-status="backlog"] .kb-card`, "swimlane Backlog");
  assert.deepEqual(lane.filter((k) => /^PH-20\d\d$/.test(k)), ["PH-2005", "PH-2006", "PH-2004", "PH-2002", "PH-2003", "PH-2001", "PH-2000"]);
  await p.done();
});

// Needs more work (DHtgfhGz2t1gcKX8adz0, KB-BOARD-5a): a ticket in Ready for Testing that didn't pass goes
// back to Ready for Dev and its developer with a red stamp and the reason, drawn above every other ticket.
T("KB-NEEDS-WORK", "Needs more work sends a tested ticket back to Ready for Dev, stamped and first in the column", { on: on.desktop }, async (prof) => {
  const seed = kanbanSeed();
  const base = Object.values(KB.kanbanTasks).find((t) => t.open && t.type === "task");
  const mk = (key, n, over) => { const t = { ...base, key, number: n, open: true, resolution: null, labels: [], epic: "", links: [], attachments: [], flagged: false, ...over }; delete t.closedAt; return t; };
  const tested = mk("PH-3000", 3000, { title: "Sent back from testing", status: "ready-for-testing", priority: "low", rank: 5, assignee: LINH, previousAssignee: HUY });
  const top = mk("PH-3001", 3001, { title: "Highest in Ready for Dev", status: "ready-for-dev", priority: "highest", rank: -5000, assignee: HUY, previousAssignee: "" });
  seed.docs.kanbanTasks = { ...seed.docs.kanbanTasks, [tested.key]: tested, [top.key]: top };
  seed.docs.kanbanCards = { ...seed.docs.kanbanCards, [tested.key]: cardOfTask(tested), [top.key]: cardOfTask(top) };
  // The reason is dictated (syB6fGiu5wIc1UBksHGa): the prompt's mic talks into the box, like the comment box's.
  const p = await open(prof, "#staff-kanban", { seed, height: 2000, init: speechStub("save button still greys out on the iPad") });
  const devKeys = () => p.$$eval('.kb-col[data-status="ready-for-dev"] .kb-card', (e) => e.map((x) => x.dataset.key));
  // A ticket outside Ready for Testing has no such action.
  await press(p, '.kb-card[data-key="PH-3001"] .card-title');
  await until(async () => !!(await p.$("#f-status")), "the open ticket");
  assert.equal(await p.$$eval("#f-needs-work", (e) => e.length), 0, "no Needs more work outside Ready for Testing");
  await press(p, "#f-cancel");
  await p.waitForFunction(() => document.getElementById("task-backdrop").hidden, null, { timeout: 5000 });
  await press(p, '.kb-card[data-key="PH-3000"] .card-title');
  await until(async () => !!(await p.$("#f-needs-work")), "the Needs more work action in the open ticket");
  await press(p, "#f-needs-work");
  await until(async () => !!(await p.$("#kb-needs-work-reason")), "the reason prompt");
  assert.equal(await p.$eval("#kb-needs-work-ok", (b) => b.disabled), true, "a reason is required");
  await press(p, "#kb-needs-work-mic");
  await eventually(async () => assert.equal(await p.$eval("#kb-needs-work-reason", (t) => t.value), "Save button still greys out on the iPad", "the words said land in the box"));
  assert.equal(await p.textContent("#kb-needs-work-mic"), "stop", "the mic shows it is listening");
  await press(p, "#kb-needs-work-mic");
  await eventually(async () => assert.equal(await p.textContent("#kb-needs-work-mic"), "mic"));
  assert.equal(await p.$eval("#kb-needs-work-ok", (b) => b.disabled), false, "a dictated reason can be sent");
  assert.match(await p.textContent("#kb-needs-work-count"), /^39 \/ 500/);
  await press(p, "#kb-needs-work-ok");
  await eventually(async () => assert.equal((await devKeys())[0], "PH-3000", "first in Ready for Dev, above the Highest ticket"));
  const card = '.kb-col[data-status="ready-for-dev"] .kb-card[data-key="PH-3000"]';
  assert.ok(await p.$eval(card, (c) => c.classList.contains("kb-card-needs-work")), "the card is marked");
  assert.match(await p.$eval(`${card} .kb-needs-work`, (e) => e.innerText), /Needs more work/i);
  assert.match(await p.$eval(`${card} .kb-needs-work-reason`, (e) => e.textContent), /Save button still greys out on the iPad/);
  const banner = await p.$eval(`${card} .kb-needs-work`, (e) => { const r = e.getBoundingClientRect(), c = e.closest(".kb-card").getBoundingClientRect(), h = e.querySelector(".kb-needs-work-head"); return { w: r.width, cw: c.width, bg: getComputedStyle(e).backgroundColor, caps: getComputedStyle(h).textTransform, size: parseFloat(getComputedStyle(h).fontSize) }; });
  assert.ok(banner.w > banner.cw * 0.8, "the stamp runs across the card");
  assert.notEqual(banner.bg, "rgba(0, 0, 0, 0)", "the stamp is filled");
  // A quiet alert, not a siren: a light fill, sentence case, no bigger than the card's own text.
  const [r, g, b] = banner.bg.match(/\d+/g).map(Number);
  assert.ok(r > 240 && g > 220 && b > 220, `the stamp's fill is light, not solid red (${banner.bg})`);
  assert.equal(banner.caps, "none", "the heading is not shouted in capitals");
  assert.ok(banner.size <= 12, "the heading is small");
  const stored = await p.evaluate(() => globalThis.__fbStub.col("kanbanTasks").get("PH-3000"));
  assert.equal(stored.status, "ready-for-dev");
  assert.equal(stored.assignee, HUY, "back with its developer");
  assert.equal(stored.needsMoreWork.reason, "Save button still greys out on the iPad");
  const storedCard = await p.evaluate(() => globalThis.__fbStub.col("kanbanCards").get("PH-3000"));
  assert.equal(storedCard.needsMoreWork.reason, "Save button still greys out on the iPad", "the card carries the stamp");
  // The open ticket shows the stamp too.
  await press(p, `${card} .card-title`);
  await until(async () => !!(await p.$("#task-form .kb-needs-work-modal")), "the stamp in the open ticket");
  assert.match(await p.$eval("#task-form .kb-needs-work-modal", (e) => e.innerText), /Save button still greys out on the iPad/);
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
  assert.match(await p.textContent("#kb-toast"), /Lê Quang Huy notified/);
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
  // The column closes over a 0.2 s transition (grid-template-columns in kanban.css) that only advances when a
  // frame is drawn. A fixed 250 ms wait lost that race on loaded CI runners (PR #584, 14 Nov 2026: desktop-1024
  // failed twice, then passed alone 9/9). Wait for the transition itself to end, however long the runner takes
  // over it, then for the width it ended at; the assertion is unchanged.
  await until(() => p.$eval(".kb-task-grid", (g) => g.classList.contains("kb-side-collapsed") && !g.getAnimations().length), "the details column to finish closing");
  const descWidth = () => p.$eval('[data-field="description"]', (e) => e.getBoundingClientRect().width);
  await until(async () => (await descWidth()) > before + 150, "the description to widen once the details column collapses", 3000).catch(() => {});
  const afterW = await descWidth();
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

T("KB-C40", "modal: the details column is frozen — the ticket scrolls under it, and every edit control on the right stays inside the modal above the Save bar (KB-MOD-8)", async (prof) => {
  const p = await open(prof);
  await press(p, '.kb-card[data-key="PH-20"]');
  await p.waitForSelector('#task-backdrop:not([hidden]) #kb-task-side [data-field="status"]');
  // Enough comments that the ticket is always longer than the modal, whatever the window.
  await p.$eval("#f-comments", (ul) => { for (let i = 0; i < 40; i++) { const li = document.createElement("li"); li.className = "kb-test-filler"; li.style.height = "40px"; li.textContent = `filler ${i}`; ul.appendChild(li); } });
  const frozen = prof.width > 760 && prof.height >= 520;
  const measure = () => p.evaluate(() => {
    const r = (el) => el.getBoundingClientRect();
    const pn = document.querySelector(".kb-task-panel"), side = document.getElementById("kb-task-side");
    return { panel: r(pn), head: r(pn.querySelector(".modal-header")), side: r(side), bar: r(document.querySelector(".kb-form-actions")), desc: r(document.querySelector('[data-field="description"]')), sticky: getComputedStyle(side).position, max: pn.scrollHeight - pn.clientHeight,
      fields: [...side.querySelectorAll(".kb-field:not([hidden])")].map((f) => f.dataset.field) };
  });
  const start = await measure();
  if (!frozen) {
    // A phone stacks the details under the ticket, as before: nothing is pinned.
    assert.notEqual(start.sticky, "sticky", "below 761 px the details column is not pinned");
    await p.done();
    return;
  }
  assert.equal(start.sticky, "sticky", "the details column is pinned beside the ticket");
  assert.ok(start.max > 200, `the ticket is longer than the modal (${start.max} px to scroll)`);
  for (const pos of [0, Math.round(start.max / 2), 99999]) {
    await p.$eval(".kb-task-panel", (el, y) => { el.scrollTop = y; }, pos);
    await p.waitForTimeout(50);
    const m = await measure();
    assert.ok(m.side.top >= m.head.bottom - 1, `scrolled to ${pos}: the column's top (${Math.round(m.side.top)}) is below the modal's header (${Math.round(m.head.bottom)}), not under it`);
    assert.ok(m.side.bottom <= m.bar.top + 1, `scrolled to ${pos}: the column ends (${Math.round(m.side.bottom)}) above the Save bar (${Math.round(m.bar.top)})`);
    if (pos) assert.ok(m.desc.top < start.desc.top - 100, "the ticket's own details scrolled up under the column");
  }
  // Every field in the column can be reached inside the column itself, and the page stays put.
  for (const f of start.fields) {
    await p.$eval(`#kb-task-side [data-field="${f}"]`, (el) => el.scrollIntoView({ block: "nearest" }));
    const ok = await p.evaluate((k) => { const s = document.getElementById("kb-task-side").getBoundingClientRect(), b = document.querySelector(`#kb-task-side [data-field="${k}"]`).getBoundingClientRect(); return b.top >= s.top - 1 && b.bottom <= s.bottom + 1; }, f);
    assert.ok(ok, `${f} can be shown inside the details column`);
  }
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
  if (methodOf(p) !== "status") { await p.selectOption("#kb-tester-pick", MINH); await press(p, "#kb-tester-ok"); await p.waitForTimeout(150); assert.equal((await where(p, "PH-19")).avatar, FULL.minh); }
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
  // The modal opens once the full ticket has been read: wait for PH-26's own form and its editor (Save's
  // change tracking starts when the editor arrives), not for whatever #f-status happens to be in the page.
  await until(async () => /PH-26/.test(await p.textContent("#task-title-h")) && !(await p.$eval("#task-backdrop", (e) => e.hidden)), "PH-26 to open");
  await p.waitForSelector("#task-backdrop:not([hidden]) #f-description .ql-editor");
  const opts = await p.$$eval("#f-status option", (o) => o.map((x) => x.textContent));
  assert.ok(opts.includes("Completed") && opts.includes("Withdrawn") && !opts.some((t) => /Completed \//.test(t)));
  // Choose Withdrawn, wait for Save to switch on, and press it, as one step. A form redrawn meanwhile (the ticket
  // re-read) shows the ticket's status again and switches Save off, and that can happen after Save was seen on and
  // before the tap lands: the tap then waited 30 s for a Save that stayed off (TC-24's flake on phone-360). So the
  // press only waits briefly, and a redrawn form gets the choice made again on the form that is there.
  await eventually(async () => {
    if ((await p.inputValue("#f-status", { timeout: 2000 })) !== "done:withdrawn") await p.selectOption("#f-status", "done:withdrawn", { timeout: 2000 });
    assert.ok(await p.isEnabled("#f-save", { timeout: 2000 }), "Save is on: the status changed");
    await press(p, "#f-save", { timeout: 2000 });
  }, 20000);
  await eventually(async () => assert.deepEqual((({ status, resolution }) => ({ status, resolution }))(await where(p, "PH-26")), { status: "done", resolution: "withdrawn" }));
  await eventually(async () => assert.ok(await p.$eval('.kb-card[data-key="PH-26"]', (e) => e.classList.contains("kb-card-withdrawn"))));
  const t = await stored(p, "PH-26");
  assert.equal(t.open, false); assert.equal(t.resolution, "withdrawn"); assert.ok(t.closedAt);
  await until(() => p.$eval("#task-backdrop", (e) => e.hidden), "the saved ticket to close");
  await press(p, '.kb-card[data-key="PH-1"]');
  await eventually(async () => assert.match(await p.textContent('#task-backdrop:not([hidden]) [data-field="children"] .field-label', { timeout: 2000 }), /withdrawn/));
  await p.done();
});

T("TC-25", "phone swimlanes: every lane shows the current column; swipe changes it", { on: on.phone }, async (prof) => {
  const p = await open(prof);
  for (const id of [ROB, HUY]) await p.tap(`.kb-person-chip[data-person="${id}"]`);
  await p.tap('.kb-pager-tab[data-col="3"]'); await p.waitForTimeout(200);
  const shown = await p.$$eval(".kb-lane-cell", (e) => e.filter((c) => getComputedStyle(c).display !== "none").map((c) => c.dataset.status));
  assert.ok(shown.length >= 1 && shown.every((s) => s === "ready-for-testing"));
  // Collapsing a lane hides its cards on a phone too, and expanding brings them back (dET0knIEG81wsnXoJ7ht)
  const visible = (sel) => p.$$eval(sel, (e) => e.filter((c) => getComputedStyle(c).display !== "none").length);
  const huyCells = `.kb-lane-cell[data-lane="${HUY}"]`;
  const huyShown = await visible(huyCells);
  await p.tap(`.kb-lane[data-lane="${HUY}"] .kb-lane-head`); await p.waitForTimeout(150);
  assert.equal(await visible(huyCells), 0, "a collapsed lane shows no cards");
  await p.tap(`.kb-lane[data-lane="${HUY}"] .kb-lane-head`); await p.waitForTimeout(150);
  assert.equal(await visible(huyCells), huyShown, "expanding the lane shows its cards again");
  await p.tap("#kb-lanes-collapse"); await p.waitForTimeout(150);
  assert.equal(await visible(".kb-lane-cell"), 0, "Collapse all hides every lane's cards");
  await p.tap("#kb-lanes-expand"); await p.waitForTimeout(150);
  assert.equal(await visible(".kb-lane-cell"), shown.length, "Expand all shows them again");
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
  // A viewer's touch drag above never starts a card drag, so Chromium treats it as a pan and flings; the next tap
  // only stops the fling and produces no click. So tap until PH-20's modal is open, tapping again only while it is
  // shut: the modal opens after an async read of the ticket, and a tap sent while that read was still in flight could
  // land on the backdrop the read had just put up (closing it), or a second open could redraw the form between two
  // separate lookups. KB-C1 flaked on exactly that, on tablet-l-chromium ("page.$eval: Failed to find element
  // matching selector #f-title" right after the modal was seen open). The modal is read in ONE evaluate and the case
  // waits until that read shows PH-20 open, so nothing can change between the check and the assertions.
  const modal = () => p.evaluate(() => {
    const b = document.getElementById("task-backdrop"), t = document.getElementById("f-title"), st = document.getElementById("f-status");
    const open = !!(b && !b.hidden && t && b.contains(t));
    return { open, key: open ? document.getElementById("task-title-h").textContent.trim() : "", save: !!document.getElementById("f-save"), titleDisabled: !!(t && t.disabled), statusDisabled: !!(st && st.disabled), del: !!document.getElementById("f-delete") };
  });
  const ph20Open = () => { const b = document.getElementById("task-backdrop"), t = document.getElementById("f-title"); return !!(b && !b.hidden && t && b.contains(t) && document.getElementById("task-title-h").textContent.trim() === "PH-20"); };
  let m = await modal();
  for (let i = 0; i < 6 && !(m.open && m.key === "PH-20"); i++) {
    if (!m.open) await press(p, '.kb-card[data-key="PH-20"]', { timeout: 5000 }).catch(() => {});
    await p.waitForFunction(ph20Open, null, { timeout: 4000 }).catch(() => {});
    m = await modal();
  }
  assert.deepEqual([m.open, m.key], [true, "PH-20"], "PH-20's modal opens");
  assert.equal(m.save, false, "no Save");
  assert.equal(m.titleDisabled, true);
  assert.equal(m.statusDisabled, true, "the Status menu is locked");
  assert.equal(m.del, false);
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
  await until(async () => /PH-20[\s\S]*Lê Quang Huy mentioned you in a comment/.test(await p.textContent("#kb-bell-panel")), "the sender's full name in the notification");
  await press(p, ".kb-bell-item");
  await p.waitForSelector("#task-backdrop:not([hidden])");
  assert.equal(await p.textContent("#task-title-h"), "PH-20");
  assert.equal((await p.evaluate(() => globalThis.__fbStub.col("kanbanNotifications").get("n1"))).read, true);
  await p.done();
});

// A mention (n1, the newest) whose comment is m1; m2 is by the same sender without a tag, m3 tags Rob after the notification.
const mentionSeed = () => kanbanSeed({ extra: {
  kanbanNotifications: {
    n1: { to: ROB, from: HUY, taskKey: "PH-20", taskTitle: "Menu board preview shows RRP", kind: "mention", via: "comment", read: false, at: { $ts: Date.parse("2026-10-21T08:00:00Z") } },
    n2: { to: ROB, from: HUY, taskKey: "PH-20", taskTitle: "Menu board preview shows RRP", kind: "commented", read: false, at: { $ts: Date.parse("2026-10-21T07:00:00Z") } },
  },
  "kanbanTasks/PH-20/comments": {
    m1: { author: HUY, text: "Rob, can you confirm the Covent Garden price?", html: "", mentions: [ROB], at: { $ts: Date.parse("2026-10-21T07:59:58Z") } },
    m2: { author: HUY, text: "Unrelated follow-up for the team.", html: "", mentions: [], at: { $ts: Date.parse("2026-10-21T07:59:59Z") } },
    m3: { author: HUY, text: "A later tag about something else.", html: "", mentions: [ROB], at: { $ts: Date.parse("2026-10-21T09:00:00Z") } },
  },
} });
T("KB-C2g", "notifications bell: hovering or focusing a mention shows the one comment that tagged you; nothing opens or is marked read", async (prof) => {
  const p = await open(prof, "#staff-kanban", { seed: mentionSeed() });
  const mention = '.kb-bell-item[data-note="n1"]', other = '.kb-bell-item[data-note="n2"]', card = "#kb-bell-preview";
  const unread = async () => (await p.evaluate(() => [...globalThis.__fbStub.col("kanbanNotifications").values()].filter((n) => !n.read).length));
  await until(async () => (await p.textContent("#kb-bell")).includes("2"), "the unread count");
  await press(p, "#kb-bell");
  await p.waitForSelector(mention);
  if (prof.touch) {
    // A touch screen has no hover: the tap opens the ticket, as before, and no comment card shows on the way.
    await press(p, mention);
    await p.waitForSelector("#task-backdrop:not([hidden])");
    assert.equal(await p.textContent("#task-title-h"), "PH-20");
    assert.equal(await p.locator(card).count(), 0, "no comment card on a touch screen");
    await p.done();
    return;
  }
  await p.hover(mention);
  await until(async () => /Rob, can you confirm the Covent Garden price\?/.test(await p.textContent(card).catch(() => "")), "the comment that tagged Rob");
  const text = await p.textContent(card);
  assert.match(text, /Lê Quang Huy/, "with its author's name");
  assert.doesNotMatch(text, /Unrelated follow-up|A later tag|cached price map|Seen on Covent Garden/, "and no other comment from the ticket");
  const side = await p.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); const c = r("#kb-bell-preview"), b = r("#kb-bell-panel"); return { cl: c.left, cr: c.right, ct: c.top, cb: c.bottom, bl: b.left, inPanel: !!document.querySelector("#kb-bell-panel #kb-bell-preview"), h: innerHeight }; });
  if (side.inPanel) assert.ok(side.cl >= 0 && side.cr <= prof.width + 1, "under the notification, inside the window");
  else assert.ok(side.cr <= side.bl && side.cl >= 0 && side.ct >= 0 && side.cb <= side.h, `beside the list, inside the window (${JSON.stringify(side)})`);
  assert.equal(await p.getAttribute(mention, "aria-describedby"), "kb-bell-preview");
  assert.equal(await p.isVisible("#task-backdrop:not([hidden])"), false, "the ticket does not open");
  assert.equal(await unread(), 2, "nothing is marked read");
  assert.match(await p.textContent("#kb-bell"), /2/, "the badge is unchanged");
  // Another kind of notification has no card.
  await p.hover(other);
  await until(async () => (await p.locator(card).count()) === 0, "the card goes on leaving the mention");
  await p.waitForTimeout(400);
  assert.equal(await p.locator(card).count(), 0, "a plain comment notification shows none");
  // A narrow window has no room beside the list: the comment shows under the notification.
  await p.setViewportSize({ width: 600, height: 800 });
  await p.hover("#kb-bell-panel .kb-bell-head");
  await p.hover(mention);
  await until(async () => (await p.locator("#kb-bell-panel #kb-bell-preview.inline").count()) === 1, "the comment under the notification");
  const narrow = await p.$eval(card, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, text: e.textContent }; });
  assert.ok(narrow.l >= 0 && narrow.r <= 600, `fully inside the 600 px window (${narrow.l}–${narrow.r})`);
  assert.match(narrow.text, /Rob, can you confirm the Covent Garden price\?/);
  await p.setViewportSize({ width: prof.width, height: prof.height || 900 });
  // The keyboard: tabbing to the mention shows the same comment; closing the bell takes it away.
  await p.hover("#kb-bell-panel .kb-bell-head");
  await until(async () => (await p.locator(card).count()) === 0, "the card goes");
  await p.focus("#kb-bell");
  for (let i = 0; i < 6 && !(await p.evaluate(() => document.activeElement && document.activeElement.dataset.note === "n1")); i++) await p.keyboard.press("Tab");
  await until(async () => /Covent Garden price/.test(await p.textContent(card).catch(() => "")), "the comment on keyboard focus");
  await p.evaluate(() => document.getElementById("kb-bell").click());
  await until(async () => (await p.locator(card).count()) === 0, "closing the bell removes the card");
  assert.equal(await unread(), 2, "still nothing marked read");
  // A click still opens the ticket and marks the notification read.
  await press(p, "#kb-bell");
  await press(p, mention);
  await p.waitForSelector("#task-backdrop:not([hidden])");
  assert.equal(await p.textContent("#task-title-h"), "PH-20");
  await eventually(async () => assert.equal((await p.evaluate(() => globalThis.__fbStub.col("kanbanNotifications").get("n1"))).read, true, "the click marks it read"));
  await p.done();
});

T("KB-C2f", "notifications bell: the owner signed in with his second address sees the notifications addressed to his first", async (prof) => {
  const seed = bellSeed();
  seed.user = { email: "owner.alias@example.com", role: "admin" };
  const p = await open(prof, "#staff-kanban", { seed });
  await until(async () => (await p.textContent("#kb-bell")).includes("1"), "the unread count");
  await press(p, "#kb-bell");
  await until(async () => /PH-20[\s\S]*Lê Quang Huy mentioned you in a comment/.test(await p.textContent("#kb-bell-panel")), "the sender's full name in the notification");
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
  await until(async () => /Lê Quang Huy assigned this to you/.test(await p.textContent(".kb-bell-item")), "newest first, from Lê Quang Huy by full name");
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

T("TC-70", "hierarchy: epic > task > subtask > sub-subtask, no fifth level, and completing the leaf moves each parent to Ready for Testing with progress at every level", async (prof) => {
  const p = await open(prof);
  const title = () => p.textContent("#task-title-h");
  const level = () => p.textContent('[data-field="children"] .kb-level');
  const closeAll = async () => { for (let i = 0; i < 5 && (await p.$eval("#task-backdrop", (e) => !e.hidden)); i++) { await press(p, "#f-cancel"); await p.waitForTimeout(150); } };
  // Epic, then a task inside it (from the epic's own Add task).
  await press(p, "#kb-new-btn");
  await press(p, '#task-form .type-opt[data-type="epic"]');
  await p.fill("#f-title", "Store rollout");
  await press(p, '[data-add-child="task"]');
  await until(async () => (await title()) === "New task", "the task form");
  assert.equal(await p.inputValue("#f-epic"), "PH-40");
  await p.fill("#f-title", "Front end");
  await press(p, "#f-save");
  await until(async () => (await title()) === "PH-40", "back on the epic");
  assert.match(await level(), /Level 1 of 4 · Epic/);
  // The task holds a subtask, the subtask a sub-subtask.
  await until(() => p.$$eval('[data-open-child="PH-41"]', (e) => e.length), "the task listed");
  await press(p, '[data-open-child="PH-41"]');
  await until(async () => (await title()) === "PH-41", "the task");
  await until(async () => /Level 2 of 4 · Task/.test(await level()), "the task's level");
  assert.match(await p.textContent('[data-add-child="task"]'), /Add subtask/);
  await press(p, '[data-add-child="task"]');
  await until(async () => (await title()) === "New subtask", "the subtask form");
  assert.equal(await p.inputValue("#f-epic"), "PH-41");
  await p.fill("#f-title", "Login page");
  await press(p, "#f-save");
  await until(async () => (await title()) === "PH-41", "back on the task");
  await until(() => p.$$eval('[data-open-child="PH-42"]', (e) => e.length), "the subtask listed");
  await press(p, '[data-open-child="PH-42"]');
  await until(async () => /Level 3 of 4 · Subtask/.test(await level()), "the subtask's level");
  await press(p, '[data-add-child="task"]');
  await until(async () => (await title()) === "New sub-subtask", "the sub-subtask form");
  await p.fill("#f-title", "Form layout");
  await press(p, "#f-save");
  await until(async () => (await title()) === "PH-42", "back on the subtask");
  assert.equal((await stored(p, "PH-43")).epic, "PH-42");
  // A fifth level is blocked: the sub-subtask can't hold children, and isn't offered as a parent.
  await until(() => p.$$eval('[data-open-child="PH-43"]', (e) => e.length), "the sub-subtask listed");
  await press(p, '[data-open-child="PH-43"]');
  await until(async () => /Level 4 of 4 · Sub-subtask/.test(await level()), "the sub-subtask's level");
  assert.match(await p.textContent("#f-level-cap"), /lowest level, so it can't have child tickets/);
  assert.equal(await p.$$eval("[data-add-child]", (e) => e.length), 0, "no Add buttons at the lowest level");
  await closeAll();
  await press(p, "#kb-new-btn");
  const offered = await p.$$eval("#f-epic option", (o) => o.map((x) => x.value));
  assert.ok(offered.includes("PH-42") && !offered.includes("PH-43"), `a new ticket can go under the subtask, not the sub-subtask: ${offered}`);
  await closeAll();
  // Progress at every level before the leaf is done.
  assert.match(await p.textContent('.kb-card[data-key="PH-42"] .kb-epic-count'), /0\/1 done/);
  assert.match(await p.textContent('.kb-card[data-key="PH-40"] .kb-epic-count'), /0\/1 done/);
  assert.match(await p.textContent('.kb-card[data-key="PH-43"] .kb-parent-epic'), /Login page/);
  // Complete the leaf: the subtask, the task and the epic each move to Ready for Testing.
  await press(p, '.kb-card[data-key="PH-43"]');
  await p.selectOption("#f-status", "done:completed"); await press(p, "#f-save");
  await until(async () => (await stored(p, "PH-40")).status === "ready-for-testing", "the epic moved", 8000);
  for (const k of ["PH-42", "PH-41", "PH-40"]) assert.equal((await stored(p, k)).status, "ready-for-testing", `${k} moved to Ready for Testing`);
  await until(async () => /1\/1 done/.test(await p.textContent('.kb-card[data-key="PH-40"] .kb-epic-count')), "the epic's progress");
  assert.match(await p.textContent('.kb-card[data-key="PH-41"] .kb-epic-count'), /1\/1 done/);
  assert.match(await p.textContent('.kb-card[data-key="PH-42"] .kb-epic-count'), /1\/1 done/);
  const acts = await writes(p, /^kanbanTasks\/PH-41\/activity\//);
  assert.ok(acts.some((w) => /all its child tickets are done/.test(w.data.text)), "the move is logged on the parent");
  await p.done();
});

T("TC-71", "Send to Agent: only the assignee sees it; the proposed split is edited to three and created; the agent tickets show live status and x of y done; the card counts them", async (prof) => {
  const seed = kanbanSeed();
  seed.docs.kanbanTasks["PH-20"].assignee = ROB; seed.docs.kanbanCards["PH-20"].assignee = ROB;
  seed.docs.kanbanTasks["PH-20"].project = "agentProj"; seed.docs.kanbanCards["PH-20"].project = "agentProj";
  seed.docs.projects.agentProj = { name: "Agent Proj", createdAt: { $ts: 1_760_000_000_000 } };
  seed.agentSplit = { proposal: [{ title: "Points API", description: "Expose points.", acceptanceCriteria: ["GET returns points"] }, { title: "Loyalty widget", description: "Show points.", acceptanceCriteria: [] }], source: "claude", projectId: "agentProj" };
  // What the server files (functions/kanban-agent.js), as the Agent Board will hold it.
  seed.docs.backlogItems = {
    // Built means the pipeline stamped it (deployCommit / mergeCommit / testVersion), not the status alone.
    "agent-1": { projectId: "agentProj", title: "Points API", status: "ready-for-testing", deployCommit: "d1a2b3c", testVersion: "1.5.414", kanbanKey: "PH-20", ownerEmail: ROB },
    "agent-2": { projectId: "agentProj", title: "Loyalty widget", status: "backlog", kanbanKey: "PH-20", ownerEmail: ROB },
    "agent-3": { projectId: "agentProj", title: "Help article", status: "backlog", kanbanKey: "PH-20", ownerEmail: ROB },
  };
  const p = await open(prof, "#staff-kanban", { seed });
  // Someone else's ticket: no Send to Agent.
  await press(p, '.kb-card[data-key="PH-21"]');
  await until(() => p.$("#f-title"), "PH-21's modal");
  assert.equal(await p.$("#f-agent-send"), null, "not the assignee: no Send to Agent");
  await press(p, "#f-cancel");
  await press(p, '.kb-card[data-key="PH-20"]');
  await until(() => p.$("#f-agent-send"), "Send to Agent on the assignee's ticket");
  await press(p, "#f-agent-send");
  await until(() => p.$("#f-agent-split"), "the proposed split");
  assert.equal(await p.$eval("#f-agent-project", (e) => e.value), "agentProj", "the ticket's project is preselected");
  assert.deepEqual(await p.$$eval("[data-agent-title]", (e) => e.map((x) => x.value)), ["Points API", "Loyalty widget"]);
  await press(p, "#f-agent-add");
  await until(async () => (await p.$$("[data-agent-title]")).length === 3, "a third agent ticket");
  await p.fill('[data-agent-i="2"] [data-agent-title]', "Help article");
  await p.fill('[data-agent-i="2"] [data-agent-ac]', "Explains points\nLinks from the widget");
  assert.match(await p.textContent("#f-agent-create"), /Create 3 agent tickets/);
  await press(p, "#f-agent-create");
  await eventually(() => assert.equal(p.agentCalls.filter((c) => c.action === "confirm").length, 1, "one confirm"));
  const sent = p.agentCalls.find((c) => c.action === "confirm");
  assert.equal(sent.key, "PH-20"); assert.equal(sent.projectId, "agentProj");
  assert.deepEqual(sent.tickets.map((x) => x.title), ["Points API", "Loyalty widget", "Help article"]);
  assert.deepEqual(sent.tickets[2].acceptanceCriteria, ["Explains points", "Links from the widget"]);
  // The linked agent tickets, with their live Agent Board status.
  await eventually(async () => assert.equal((await p.$$("#f-agents [data-agent-ticket]")).length, 3));
  await eventually(async () => assert.match(await p.textContent("#f-agent-count"), /1 of 3 done/));
  assert.equal(await p.getAttribute('#f-agents [data-agent-ticket="agent-1"] a', "href"), "#item-agent-1", "each links to its Agent Board card");
  await p.evaluate(() => { const b = globalThis.__fbStub; b.col("backlogItems").set("agent-2", { ...b.col("backlogItems").get("agent-2"), status: "published-live", deployCommit: "e4f5a6b", mergeCommit: "m7n8o9p" }); b.notify(); });
  await eventually(async () => assert.match(await p.textContent("#f-agent-count"), /2 of 3 done/, "follows the Agent Board live"));
  await press(p, "#f-cancel");
  // The server's counts on the ticket and its card: the card shows them.
  await p.evaluate(() => { const b = globalThis.__fbStub; for (const c of ["kanbanTasks", "kanbanCards"]) b.col(c).set("PH-20", { ...b.col(c).get("PH-20"), agentTotal: 3, agentDone: 2, updatedAt: new globalThis.__fbStubTimestamp(Date.now() + 5000) }); b.notify(); });
  await eventually(async () => assert.match(await p.textContent('.kb-card[data-key="PH-20"] .kb-agent-chip'), /2\/3/));
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
    b.col("kanbanCards").set("PH-20", { ...c, acDone: 1, updatedAt: new globalThis.__fbStubTimestamp(Date.now() + 5000), updatedBy: "other@ph.example" });
    b.notify();
  });
  await until(async () => !(await p.isChecked('#f-ac [data-ac="crit0000"] [data-ac-tick]')), "the open modal to show the untick");
  await eventually(async () => assert.match(await chip(), /AC 1\/5/));
  await press(p, "#f-cancel");
  // A new ticket saves with criteria; 51 can't be added.
  await openNewTask(p);
  await p.fill("#f-title", "Ticket with criteria");
  for (const [i, t] of ["One", "Two", "Three"].entries()) {
    await p.fill("#f-ac-input", t); await p.press("#f-ac-input", "Enter");
    await eventually(async () => assert.equal((await p.$$("#f-ac .kb-ac-item")).length, i + 1, `criterion ${i + 1} is listed`));
  }
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
      b.col("kanbanCards").set(key, { ...core.cardOf(t), updatedBy: "other@ph.example" }); b.notify();
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

T("KB-C26", "a staff avatar picked as a filter is about 30% larger than the rest, and goes back when it is switched off", async (prof) => {
  const p = await open(prof, "#staff-kanban");
  const size = (who) => p.$eval(`.kb-person-chip[data-person="${who}"] .kb-avatar`, (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  assert.deepEqual(await size(LINH), [28, 28], "not picked: 28px");
  await press(p, `.kb-person-chip[data-person="${LINH}"]`);
  await until(() => p.$(`.kb-person-chip.on[data-person="${LINH}"]`), "Linh's chip to be on");
  assert.deepEqual(await size(LINH), [36, 36], "picked: 36px, about 30% larger");
  assert.deepEqual(await size(HUY), [28, 28], "the others keep their size");
  await press(p, '.kb-person-chip[data-person="none"]');
  await until(() => p.$('.kb-person-chip.on[data-person="none"]'), "the Unassigned chip to be on");
  assert.deepEqual(await size("none"), [36, 36], "Unassigned grows too");
  await press(p, `.kb-person-chip[data-person="${LINH}"]`);
  await until(async () => !(await p.$(`.kb-person-chip.on[data-person="${LINH}"]`)), "Linh's chip to be off");
  assert.deepEqual(await size(LINH), [28, 28], "switched off: back to 28px");
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
  const real = "https://firebasestorage.googleapis.com/v0/b/backlog-tracker-e4ed2.firebasestorage.app/o/avatars%2Fhuy.le%40ph.example.jpg?alt=media&token=0a1b2c3d-0000-4000-8000-123456789abc";
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

// The recogniser keeps hearing "one two three …" until it is stopped; the
// page's getUserMedia probes are counted in window.__gum.
const talkingSpeech = () => ({
  arg: null,
  fn: () => {
    window.__gum = 0;
    navigator.mediaDevices.getUserMedia = async () => { window.__gum++; return { getTracks: () => [{ stop() {} }] }; };
    if (navigator.permissions) navigator.permissions.query = async () => ({ state: "prompt" });
    const words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
    window.SpeechRecognition = class {
      start() {
        let n = 0;
        this.t = setInterval(() => { n = Math.min(n + 1, words.length); if (this.onresult) this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: words.slice(0, n).join(" ") }], { isFinal: false })] }); }, 80);
      }
      stop() { clearInterval(this.t); setTimeout(() => this.onend && this.onend(), 10); }
      abort() { clearInterval(this.t); setTimeout(() => this.onend && this.onend(), 10); }
    };
  },
});

T("KB-C27", "the microphone is asked for once, and typing in a dictated comment stops the mic and keeps the edit", async (prof) => {
  const p = await open(prof, "#staff-kanban", { init: talkingSpeech() });
  const box = '[data-field="comments"] .ql-editor';
  const text = () => p.$$eval(box, (e) => (e[0] ? e[0].innerText.trim() : ""));
  await press(p, '.kb-card[data-key="PH-23"]');
  await p.waitForSelector(box);
  await press(p, "#f-comment-mic");
  await until(async () => /^One two/.test(await text()), "dictation in the comment box");
  await press(p, "#f-comment-mic");
  await until(async () => (await p.textContent("#f-comment-mic")) === "mic", "the mic to stop");
  // Again, and in another ticket: no second permission probe.
  await press(p, "#f-comment-mic");
  await until(async () => (await p.textContent("#f-comment-mic")) === "stop", "the mic to listen again");
  assert.equal(await p.evaluate(() => window.__gum), 1, "asked for the microphone once, not on every start");
  assert.equal(await p.evaluate(() => localStorage.getItem("kb-mic-granted")), "1", "the grant is remembered for the next visit");
  // Typing while it listens: the mic stops and the typed words stay.
  // (the caret is put at the end while words are still arriving: it stays there)
  await p.click(box); await p.keyboard.press("Control+End"); await p.waitForTimeout(200); await p.keyboard.type(" edited by hand");
  await until(async () => (await p.textContent("#f-comment-mic")) === "mic", "typing to stop the mic");
  await p.waitForTimeout(400);
  const kept = await text();
  assert.match(kept, /edited by hand$/, `the edit survives later results: ${kept}`);
  await p.keyboard.press("Backspace"); await p.keyboard.press("Backspace");
  await p.waitForTimeout(200);
  assert.match(await text(), /edited by ha$/, "and can be edited further");
  await press(p, "#f-comment-add"); await p.waitForTimeout(200);
  assert.match(await p.$$eval(".kb-comment-text", (e) => e[e.length - 1].textContent), /edited by ha$/, "the comment is saved as edited");
  await press(p, "#task-close");
  await press(p, '.kb-card[data-key="PH-20"]');
  await p.waitForSelector(box);
  await press(p, "#f-comment-mic");
  await until(async () => (await p.textContent("#f-comment-mic")) === "stop", "the mic on another ticket");
  await press(p, "#f-comment-mic");
  assert.equal(await p.evaluate(() => window.__gum), 1, "still asked only once");
  await p.done();
});

// Nothing a person does waits on the server (18 Nov 2026). On the live console a round trip
// took about half a second, and opening a ticket, saving one and creating one each showed
// nothing until one to three of them had come back. Here every server read, count and commit
// takes 400 ms (window.__FB_LATENCY, firebase-stub.mjs), and each step is checked in the same
// turn as its click, before any of them can have answered.
const SLOW = { fn: () => { window.__FB_LATENCY = 400; } };
T("KB-C28", "with a slow server: a ticket's dialog, a save and a create all answer at the click; a failed save or create is put back", { timeout: 120000 }, async (prof) => {
  const p = await open(prof, "#staff-kanban", { init: SLOW });
  const key = "PH-32"; // a Backlog task
  const title0 = KB.kanbanTasks[key].title;
  const clickCard = (k) => p.evaluate((k) => {
    document.querySelector(`.kb-card[data-key="${k}"]`).click();
    const bd = document.querySelector("#task-backdrop");
    return { shown: !bd.hidden, head: document.querySelector("#task-title-h").textContent, body: document.querySelector("#task-form").textContent, form: !!document.querySelector("#f-title") };
  }, k);
  const closed = () => p.evaluate(() => document.querySelector("#task-backdrop").hidden);
  const setTitle = (v) => p.evaluate((v) => { const f = document.querySelector("#f-title"); f.value = v; f.dispatchEvent(new Event("input", { bubbles: true })); }, v);
  const saveNow = () => p.evaluate((k) => {
    document.querySelector("#f-save").click();
    const card = document.querySelector(`.kb-card[data-key="${k}"]`);
    return { closed: document.querySelector("#task-backdrop").hidden, card: card ? card.textContent : "" };
  }, key);

  // 1. the dialog is there at the click, with the ticket's key and title; the form follows
  let at = await clickCard(key);
  assert.ok(at.shown, "the dialog shows in the same turn as the click");
  assert.equal(at.form, false, "the ticket itself is still being read");
  assert.ok(at.head.includes(key) && at.body.includes(title0), `the dialog names the ticket while it is read: "${at.head}" / "${at.body}"`);
  await until(() => p.$("#f-title"), "the ticket's form");
  assert.equal(await p.inputValue("#f-title"), title0);
  // closing while a ticket is still being read opens nothing afterwards
  await press(p, "#task-close");
  const other = "PH-34";
  at = await clickCard(other);
  assert.ok(at.shown && !at.form);
  await p.evaluate(() => document.querySelector("#task-close").click());
  await p.waitForTimeout(900);
  assert.ok(await closed(), "a ticket closed while it was being read stays closed");

  // 2. a ticket read a moment ago and not changed since opens whole, at once
  at = await clickCard(key);
  assert.ok(at.shown && at.form, "an unchanged ticket opens from the copy the page holds, without a read");
  await until(() => p.isEnabled("#f-save").then((x) => !x), "Save off: nothing changed");
  await until(() => p.$("#f-description .ql-editor"), "the editor");
  await p.waitForTimeout(700); // (the read behind the form has landed and changed nothing)
  assert.equal(await p.inputValue("#f-title"), title0);

  // 3. Save closes the form and shows the change on the card in the same turn
  await setTitle("Renamed without waiting");
  await until(() => p.isEnabled("#f-save"), "Save on");
  let saved = await saveNow();
  assert.ok(saved.closed, "the form closes at the click");
  assert.ok(saved.card.includes("Renamed without waiting"), "the card shows the new title at the click");
  await until(() => p.evaluate((k) => (globalThis.__fbStub.col("kanbanTasks").get(k) || {}).title === "Renamed without waiting", key), "the save reaching the server");
  // (a ticket just saved has changed since it was read: it is read again, never opened from the old copy)
  at = await clickCard(key);
  assert.ok(at.shown && !at.form, "a ticket changed since it was read is read again");
  await until(() => p.$("#f-title"), "the ticket's form");
  assert.equal(await p.inputValue("#f-title"), "Renamed without waiting");

  // 4. a save the server refuses says so and puts the old title back on the card
  await until(() => p.$("#f-description .ql-editor"), "the editor");
  await setTitle("This one is refused");
  await until(() => p.isEnabled("#f-save"), "Save on");
  await p.evaluate(() => { const b = globalThis.__fbStub; b.__commit = b.commit; b.commit = () => { throw Object.assign(new Error("refused"), { code: "permission-denied" }); }; });
  saved = await saveNow();
  assert.ok(saved.closed && saved.card.includes("This one is refused"));
  await until(async () => /wasn't saved/.test(await toastText(p)), "the refusal said");
  await until(() => p.evaluate((k) => document.querySelector(`.kb-card[data-key="${k}"]`).textContent.includes("Renamed without waiting"), key), "the old title back on the card");

  // 5. a new ticket that can't be created comes back with everything that was typed
  await press(p, "#kb-new-btn");
  await until(() => p.$("#task-backdrop:not([hidden]) #f-title"), "the New task form");
  await until(() => p.$("#f-description .ql-editor"), "the editor");
  await setTitle("Created without waiting");
  await p.evaluate(() => document.querySelector("#f-save").click());
  await until(() => p.$("#f-error:not([hidden])"), "the form back, with the reason");
  assert.match(await p.textContent("#f-error"), /permission to create/);
  assert.equal(await p.inputValue("#f-title"), "Created without waiting", "what was typed is still in the form");
  await p.evaluate(() => { const b = globalThis.__fbStub; b.commit = b.__commit; });

  // 6. Create closes the form at the click; the ticket and its number follow
  await until(() => p.$("#f-description .ql-editor"), "the editor");
  const made = await p.evaluate(() => { document.querySelector("#f-save").click(); return { closed: document.querySelector("#task-backdrop").hidden, toast: document.querySelector("#kb-toast").textContent }; });
  assert.ok(made.closed, "the New task form closes at the click");
  assert.match(made.toast, /Creating the ticket/);
  await until(async () => /PH-\d+ created in Backlog/.test(await toastText(p)), "the created toast");
  const newKey = /PH-\d+/.exec(await toastText(p))[0];
  assert.equal(await p.evaluate((k) => globalThis.__fbStub.col("kanbanTasks").get(k).title, newKey), "Created without waiting");
  await p.done();
});
// The board's cards never wait for the two counts that check the cards are complete: with a
// server that takes five seconds to answer, the cards (the listener answers from the local
// cache) are on the page long before.
T("KB-C29", "the board shows its cards without waiting for the server's counts", { timeout: 60000 }, async (prof) => {
  const p = await open(prof, "#staff-kanban", { init: { fn: () => {
    window.__FB_LATENCY = 5000;
    new MutationObserver((_, ob) => { if (document.querySelector(".kb-card")) { window.__firstCard = performance.now(); ob.disconnect(); } }).observe(document, { childList: true, subtree: true });
  } } });
  const first = await p.evaluate(() => window.__firstCard);
  assert.ok(first > 0 && first < 5000, `the first cards came ${Math.round(first)} ms in, before any count could have answered (5000 ms)`);
  await p.done();
});

T("KB-C30", "scrolled down, + New task stays pinned at the right of the filter bar, which keeps its height; it opens New task", { timeout: 60000 }, async (prof) => {
  const p = await open(prof, "#staff-kanban", TALL);
  const shown = () => p.$eval("#kb-pinned-new", (e) => getComputedStyle(e).visibility === "visible");
  assert.equal(await shown(), false, "hidden while the header's own + New task is on screen");
  const h0 = await p.$eval("#kb-sticky", (e) => Math.round(e.getBoundingClientRect().height));
  await p.evaluate(() => scrollTo(0, 900));
  await eventually(async () => assert.equal(await shown(), true, "shown once the header has scrolled away"));
  await eventually(async () => assert.equal(await p.$eval("#kb-sticky", (e) => Math.round(e.getBoundingClientRect().top)), 0, "the bar is pinned"));
  const m = await p.evaluate(() => {
    const bar = document.getElementById("kb-sticky").getBoundingClientRect(), b = document.getElementById("kb-pinned-new").getBoundingClientRect();
    return { barH: Math.round(bar.height), barR: bar.right, barT: bar.top, top: b.top, bottom: b.bottom, right: b.right, w: document.documentElement.scrollWidth, text: document.getElementById("kb-pinned-new").textContent.trim() };
  });
  assert.equal(m.text, "+ New task");
  assert.ok(m.barH <= h0, `the pinned bar is no taller (${m.barH} against ${h0})`);
  assert.ok(m.top >= m.barT && m.bottom <= m.barT + m.barH, "the button sits inside the bar");
  assert.ok(m.barR - m.right <= 16 && m.right <= m.barR + 0.5, `at the bar's right edge (${m.right} of ${m.barR})`);
  assert.equal(m.w, prof.width, "no sideways page scroll");
  assert.equal(await p.$$eval("#kb-sticky .btn-primary", (e) => e.filter((x) => x.getClientRects().length && getComputedStyle(x).visibility === "visible").length), 1, "the only CTA pinned");
  await press(p, "#kb-pinned-new");
  await until(() => p.$("#task-backdrop:not([hidden]) #f-title"), "the New task form");
  // The form has finished opening once its description editor is in (Quill loads the first time a modal opens, and
  // bindEditors fills the editor from the ticket in the same step). Escape before that closed the form under the
  // loading editor, which then read the closed form's ticket: "Cannot read properties of null (reading 'description')".
  await until(() => p.$("#task-backdrop:not([hidden]) #f-description .ql-editor"), "the New task form's description editor");
  await p.keyboard.press("Escape");
  await p.evaluate(() => scrollTo(0, 0));
  await eventually(async () => assert.equal(await shown(), false, "hidden again back at the top"));
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

// The "created in Backlog" toast opens the new ticket (to add a forgotten assignee or date)
// and stays longer than other toasts: 8 seconds, not 3.6.
T("KB-C30", "the created toast stays 8 seconds and a click on it opens the new ticket", async (prof) => {
  const p = await open(prof);
  await press(p, "#kb-new-btn");
  await p.fill("#f-title", "Opened from the toast");
  await press(p, "#f-save");
  await until(async () => /PH-\d+ created in Backlog/.test(await toastText(p)), "the created toast");
  const key = /PH-\d+/.exec(await toastText(p))[0];
  assert.equal(await p.getAttribute("#kb-toast .kb-toast-open", "aria-label"), `Open ${key}`, "the toast is a button naming the ticket");
  assert.match(await p.textContent("#kb-toast .kb-toast-cta"), /Open/);
  await sleep(4500);
  assert.ok(await p.isVisible("#kb-toast .kb-toast-open"), "still showing after 4.5 seconds (other toasts go at 3.6)");
  await press(p, "#kb-toast .kb-toast-open");
  await p.waitForSelector("#task-backdrop:not([hidden])");
  await until(async () => (await modalKey(p)) === key, "the new ticket open");
  assert.equal(await p.isVisible("#kb-toast"), false, "the toast goes when the ticket opens");
  // Over an open ticket a toast never takes a tap meant for the form beneath it.
  await p.evaluate((k) => { const el = document.querySelector("#kb-toast"); el.innerHTML = `<button type="button" class="kb-toast-open" data-toast-key="${k}">x</button>`; el.hidden = false; }, key);
  assert.equal(await p.$eval("#kb-toast", (e) => getComputedStyle(e).pointerEvents), "none", "taps go through the toast while a ticket is open");
  await p.evaluate(() => { document.querySelector("#kb-toast").hidden = true; });
  // Any other toast is plain text, not a button.
  await press(p, "#task-close");
  await p.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } }); });
  await press(p, '.kb-card[data-key="PH-20"]');
  await p.waitForSelector("#task-backdrop:not([hidden])");
  await press(p, "#task-share");
  await until(async () => /Link copied/.test(await toastText(p)), "the Link copied toast");
  assert.equal(await p.$("#kb-toast .kb-toast-open"), null, "a plain toast opens nothing");
  await p.done();
});
T("KB-C31", "attachments: videos, PDFs and spreadsheets attach when a ticket is created and when it is edited; files Storage would refuse are refused first; Attachments can't be hidden", async (prof) => {
  const p = await open(prof);
  const file = (name, mimeType, size = 64) => ({ name, mimeType, buffer: Buffer.alloc(size, 1) });
  // Created: the field is on the new-ticket form even though the seed's settings never showed it.
  await press(p, "#kb-new-btn");
  await p.waitForSelector('#task-form [data-field="attachments"]');
  const accept = await p.getAttribute("#f-file", "accept");
  for (const want of ["video/*", "application/pdf", ".xlsx", ".mov", ".docx"]) assert.ok(accept.includes(want), `the picker offers ${want}`);
  assert.equal(await p.$eval("#f-file", (e) => e.multiple), true, "several files at once");
  await p.fill("#f-title", "Ticket with files");
  // An .xlsx whose type the browser left empty is still sent as a spreadsheet.
  await p.setInputFiles("#f-file", [file("demo.mp4", "video/mp4"), file("spec.pdf", "application/pdf"), file("stock.xlsx", "")]);
  await eventually(async () => assert.equal(await p.$$eval("#f-attachments li[data-att-kind]", (e) => e.length), 3, "three listed"));
  assert.deepEqual(await p.$$eval("#f-attachments li[data-att-kind]", (e) => e.map((li) => li.dataset.attKind)), ["movie", "picture_as_pdf", "table_chart"], "each shows its kind");
  // A program is refused before it is uploaded.
  await p.setInputFiles("#f-file", [file("run.exe", "application/x-msdownload")]);
  await until(async () => /run\.exe.*can't be attached/.test(await toastText(p)), "the refusal toast");
  assert.equal(await p.$$eval("#f-attachments li[data-att-kind]", (e) => e.length), 3, "nothing else was attached");
  await eventually(async () => assert.equal(await p.$$eval("#f-attachments .kb-none", (e) => e.filter((x) => /Uploading/.test(x.textContent)).length), 0, "uploads finished"));
  await press(p, "#f-save");
  await until(async () => /PH-\d+ created in Backlog/.test(await toastText(p)), "the created toast");
  const key = /PH-\d+/.exec(await toastText(p))[0];
  const made = await stored(p, key);
  assert.deepEqual(made.attachments.map((a) => [a.name, a.contentType]), [["demo.mp4", "video/mp4"], ["spec.pdf", "application/pdf"], ["stock.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]]);
  for (const a of made.attachments) assert.match(a.url, /^https:\/\/firebasestorage\.googleapis\.com\//);
  const ups = await p.evaluate(() => globalThis.__fbStub.uploads || {});
  const sheet = Object.entries(ups).find(([k]) => /stock\.xlsx$/.test(k));
  assert.ok(sheet && sheet[1].contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Storage got the spreadsheet type, not application/octet-stream");
  assert.equal((await p.evaluate((k) => globalThis.__fbStub.col("kanbanCards").get(k), key)).attachmentCount, 3, "the card counts them");
  // Edited: an existing ticket takes a .mov (type left empty by the browser) and saves it.
  await press(p, '.kb-card[data-key="PH-20"]');
  await until(async () => (await modalKey(p)) === "PH-20", "PH-20 to open");
  await p.waitForSelector('.kb-task-main [data-field="attachments"]');
  const had = ((await stored(p, "PH-20")).attachments || []).map((a) => a.name);
  await p.setInputFiles("#f-file", [file("walkthrough.mov", "")]);
  await eventually(async () => assert.ok(await p.isEnabled("#f-save"), "Save is on"));
  await eventually(async () => assert.equal(await p.$$eval("#f-attachments .kb-none", (e) => e.filter((x) => /Uploading/.test(x.textContent)).length), 0, "upload finished"));
  await press(p, "#f-save");
  await eventually(async () => {
    const list = (await stored(p, "PH-20")).attachments;
    assert.deepEqual(list.slice(0, -1).map((a) => a.name), had, "the ones it had are kept");
    assert.deepEqual([list.at(-1).name, list.at(-1).contentType], ["walkthrough.mov", "video/quicktime"]);
  });
  assert.ok(Object.keys(await p.evaluate(() => globalThis.__fbStub.uploads || {})).some((k) => /^kanban\/PH-20\/.*walkthrough\.mov$/.test(k)), "held under the ticket");
  await p.done();
  // Settings: the Show box for Attachments is locked on.
  const s = await open(prof, "#staff-kanban/settings");
  await s.waitForSelector('[data-show="attachments"]');
  assert.equal(await s.$eval('[data-show="attachments"]', (e) => e.checked && e.disabled), true, "shown and can't be switched off");
  await s.done();
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
  pid, person: (id) => FULL[id] || id, rel: (id) => id.replace(".", "-"),
  hash: (route, q) => (route === "kanban" ? "#staff-kanban" : `#staff-kanban/${route}`) + (q ? "?" + q : ""),
  attachmentsAlwaysShown: true, // KB-SET-1: the console's Attachments can't be hidden
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
  photoDims: async (p, url) => { const r = await p.evaluate(async () => { const b = (globalThis.__fbStub.uploads || {})[`avatars/owner@example.com.jpg`] || {}; return { type: b.contentType || "", size: b.size || 0 }; }); assert.equal(r.type, "image/jpeg", "uploaded as a JPEG"); assert.ok(r.size > 0, "something was uploaded"); return { w: 1, h: 1 }; },
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
  // The console lists a column by priority, then rank (KB-BOARD-3a): the reorder cases give every ticket one
  // priority first, so they test the drag order itself (the prototype keeps plain rank order).
  samePriority: (p) => p.evaluate(() => {
    const b = globalThis.__fbStub;
    for (const c of ["kanbanTasks", "kanbanCards"]) for (const [id, t] of b.col(c)) b.col(c).set(id, { ...t, priority: "medium" });
    b.notify();
  }).then(() => sleep(250)),
  confirmDelete: async (p, accept) => {
    await press(p, "#f-delete");
    await p.waitForSelector("#dialog-backdrop:not([hidden])");
    const msg = await p.textContent("#dialog-message");
    await press(p, accept ? "#dialog-ok" : "#dialog-cancel"); await sleep(250);
    return msg;
  },
};
defineNewCases(E);

// ── Ticket view: read first, comment, history, voice (19 Nov 2026) ───────────
// These open a ticket as a person finds it (o.review: no edit icon is pressed for the case).
const REVIEW = { review: true };
const lockedFields = (p) => p.$$eval("#task-form .kb-lockable", (els) => els.map((e) => `${e.id === "kb-task-side" ? "details" : e.dataset.field}:${e.classList.contains("kb-locked") ? "locked" : "open"}`).join(" "));
const shown = (p, sel) => p.$eval(sel, (e) => !!e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").catch(() => false);
const commentWrites = async (p, key) => (await writes(p, new RegExp(`^kanbanTasks/${key}/comments/`))).filter((w) => w.data);

T("KB-C35", "an existing ticket opens for reading: title, description, criteria and links read-only with an edit icon each, the details column always its form (KB-VIEW-3), Comments first with the box to add one; a new task is the form it always was", { timeout: 120000 }, async (prof) => {
  const p = await open(prof, "#staff-kanban", { ...REVIEW, seed: kanbanSeed({ extra: { kanbanTasks: { "PH-20": { ...KB.kanbanTasks["PH-20"], acceptanceCriteria: ["aaaaaaaa\t0\tPreview shows the offer price", "bbbbbbbb\t1\tLive board unchanged"], acTotal: 2, acDone: 1 } } } }) });
  // New task: a form from the start, nothing to unlock.
  await openNewTask(p);
  assert.equal(await p.$$eval("#task-form .kb-lockable, #task-form [data-kb-edit], #task-form [role=tab]", (e) => e.length), 0, "a new task has no reading view and no tabs");
  assert.ok(await shown(p, "#f-title") && await shown(p, "#f-record"), "the creation form is unchanged");
  await press(p, "#f-cancel");
  // An existing ticket.
  await press(p, '.kb-card[data-key="PH-20"]');
  await p.waitForSelector("#f-title-ro");
  assert.equal((await lockedFields(p)).split(" ").sort().join(" "), "criteria:locked description:locked links:locked title:locked");
  assert.equal(await p.textContent("#f-title-ro"), "Menu board preview shows RRP instead of local offer price");
  assert.match(await p.textContent("#f-description-ro"), /products with an active local offer still show HQ RRP/);
  for (const sel of ["#f-title", "#f-description", "#f-ac-input", "#f-link-type"]) assert.equal(await shown(p, sel), false, `${sel} is not on show while the ticket is read`);
  // The details column is its form from the start (KB-VIEW-3): status, assignee and the rest change without an edit icon.
  for (const sel of ["#f-status", "#f-assignee", "#f-priority"]) assert.ok(await shown(p, sel), `${sel} is ready to change`);
  assert.equal(await p.$("#f-details-ro"), null, "no reading view of the details for an editor");
  assert.equal(await p.$eval("#f-assignee", (e) => e.value), HUY); assert.equal(await p.$eval("#f-status", (e) => e.value), "in-progress"); assert.equal(await p.$eval("#f-priority", (e) => e.value), "highest");
  assert.deepEqual((await p.$$eval("#task-form .kb-locked [data-kb-edit]", (b) => b.map((x) => x.getAttribute("aria-label")))).sort(), ["Edit acceptance criteria", "Edit description", "Edit linked tickets", "Edit title"]);
  assert.equal(await p.$('[data-kb-edit="details"]'), null, "the details column has no edit icon");
  // Comments is the tab that is open, with the box and its mic ready; History is one press away.
  assert.equal(await p.getAttribute("#f-tab-comments", "aria-selected"), "true"); assert.equal(await p.getAttribute("#f-tab-history", "aria-selected"), "false");
  await p.waitForSelector('[data-field="comments"] .ql-editor');
  assert.ok(await shown(p, "#f-comment-add") && await shown(p, "#f-comment-mic") && await shown(p, '[data-field="comments"] .ql-editor'), "the add-comment box is on show");
  assert.equal(await shown(p, "#f-history"), false);
  assert.equal(await p.$eval("#f-save", (e) => e.disabled), true, "nothing to save yet");
  // Read-only criteria can still be ticked (a tester's job) but not reworded.
  assert.equal(await p.$$eval("#f-ac .kb-ac-ro-text", (e) => e.map((x) => x.textContent).join("|")), "Preview shows the offer price|Live board unchanged");
  assert.equal(await p.$$eval("#f-ac input[type=text], #f-ac [data-ac-rm]", (e) => e.length), 0);
  await p.check('#f-ac [data-ac="aaaaaaaa"] [data-ac-tick]');
  await eventually(async () => assert.match((await stored(p, "PH-20")).acceptanceCriteria[0], /^aaaaaaaa\t1\t/, "the tick is saved at once"));
  // A comment, typed: the primary thing to do here.
  await p.click('[data-field="comments"] .ql-editor'); await p.keyboard.type("Looks right to me");
  await press(p, "#f-comment-add");
  await eventually(async () => assert.equal((await commentWrites(p, "PH-20")).at(-1).data.text, "Looks right to me"));
  assert.equal((await commentWrites(p, "PH-20")).at(-1).data.via, undefined, "a typed comment is not marked as dictated");
  // The edit icon on the title opens it; Save writes it.
  await press(p, '[data-kb-edit="title"]');
  assert.ok(await shown(p, "#f-title"), "the title field shows once its edit icon is pressed");
  assert.match(await lockedFields(p), /^title:open description:locked/);
  await p.fill("#f-title", "Menu board preview shows the offer price");
  // …and the one on the description expands it into the editor.
  await press(p, '[data-kb-edit="description"]');
  await p.waitForSelector('[data-field="description"] .ql-editor');
  assert.ok(await shown(p, '[data-field="description"] .ql-editor'));
  await p.click('[data-field="description"] .ql-editor'); await p.keyboard.press("Control+End"); await p.keyboard.type(" Checked on staging.");
  await press(p, '[data-kb-edit="criteria"]');
  assert.ok(await shown(p, "#f-ac-input"), "criteria can be added and reworded once opened");
  await p.selectOption("#f-priority", "high");
  await eventually(async () => assert.equal(await p.$eval("#f-save", (e) => e.disabled), false));
  await press(p, "#f-save");
  await eventually(async () => { const t = await stored(p, "PH-20"); assert.equal(t.title, "Menu board preview shows the offer price"); assert.match(t.description, /Checked on staging\./); assert.equal(t.priority, "high"); });
  // Opened again it is back to reading, with what was saved.
  await p.waitForFunction(() => document.getElementById("task-backdrop").hidden);
  await press(p, '.kb-card[data-key="PH-20"]');
  await p.waitForSelector("#f-title-ro");
  assert.equal(await p.textContent("#f-title-ro"), "Menu board preview shows the offer price");
  assert.match(await lockedFields(p), /^title:locked description:locked criteria:locked/);
  assert.equal(await p.$eval("#f-priority", (e) => e.value), "high", "and the details column is still its form, with what was saved");
  await p.done();
});

T("KB-C35", "a viewer reads the same view with no edit icons, and a long description is cut short behind Show more", { timeout: 60000 }, async (prof) => {
  const long = "<p>" + Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a long description.`).join("</p><p>") + "</p>";
  const seed = kanbanSeed({ user: { email: emailOf("Thảo"), role: "viewer" }, extra: { kanbanTasks: { "PH-20": { ...KB.kanbanTasks["PH-20"], description: long } } } });
  const p = await open(prof, "#staff-kanban", { ...REVIEW, seed });
  await press(p, '.kb-card[data-key="PH-20"]');
  await p.waitForSelector("#f-title-ro");
  assert.equal(await p.$$eval("#task-form [data-kb-edit]", (e) => e.length), 0, "a viewer has nothing to open for editing");
  assert.match(await p.textContent('#f-details-ro [data-ro="assignee"] dd'), new RegExp(`${FULL.huy}$`)); assert.match(await p.textContent('#f-details-ro [data-ro="status"]'), /In Progress/i);
  assert.equal(await shown(p, "#f-status"), false, "a viewer reads the details as text");
  assert.equal(await p.$("#f-save"), null);
  const h = () => p.$eval("#f-description-ro", (e) => e.clientHeight);
  const cut = await h();
  assert.ok(cut <= 180, `the description is cut short (${cut}px)`);
  assert.equal(await p.textContent('[data-ro-more="f-description-ro"]'), "Show more");
  await press(p, '[data-ro-more="f-description-ro"]');
  assert.ok(await h() > cut * 2, "Show more opens it in full");
  assert.equal(await p.getAttribute('[data-ro-more="f-description-ro"]', "aria-expanded"), "true");
  await p.done();
});

T("KB-C36", "History: who opened it, every move and hand-off newest first with local times, and the time open, time per column and handoff count", { timeout: 120000 }, async (prof) => {
  const day = 86400000, t0 = Date.now() - 10 * day;
  const at = (d) => ({ $ts: t0 + d * day });
  const seed = kanbanSeed({ extra: {
    kanbanTasks: { "PH-20": { ...KB.kanbanTasks["PH-20"], createdAt: at(0), createdBy: ROB, status: "in-progress", assignee: HUY } },
    "kanbanTasks/PH-20/activity": {
      a1: { who: ROB, at: at(2), text: "Backlog → Ready for Dev" },
      a2: { who: ROB, at: at(3), text: `assigned to ${FULL.huy}` },
      a3: { who: HUY, at: at(4), text: "Ready for Dev → In Progress" },
      a4: { who: HUY, at: at(5), text: "changed Priority from Medium to Highest" },
    },
  } });
  const p = await open(prof, "#staff-kanban", { ...REVIEW, seed });
  await press(p, '.kb-card[data-key="PH-20"]');
  await p.waitForSelector("#f-tab-history");
  await press(p, "#f-tab-history");
  assert.equal(await p.getAttribute("#f-tab-history", "aria-selected"), "true");
  assert.ok(await shown(p, "#f-history")); assert.equal(await shown(p, "#f-comment-add"), false, "the comment box belongs to the Comments tab");
  const lines = () => p.$$eval("#f-history .kb-activity", (li) => li.map((x) => ({ kind: x.dataset.hist, text: x.querySelector(".kb-hist-text").textContent, at: (x.querySelector("time") || {}).textContent || "", iso: x.querySelector("time") ? x.querySelector("time").getAttribute("datetime") : "" })));
  let ls = await eventually(async () => { const l = await lines(); assert.equal(l.length, 5); return l; });
  assert.deepEqual(ls.map((l) => l.kind), ["edit", "move", "assign", "move", "created"], "newest first, down to when it was opened");
  assert.equal(ls[4].text, "Rob opened this ticket"); assert.equal(ls[1].text, `${FULL.huy} Ready for Dev → In Progress`);
  // The time shown is the reader's own: the stored instant, written out in this browser's zone.
  const local = await p.evaluate((iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }), ls[4].iso);
  assert.equal(ls[4].at, local); assert.equal(new Date(ls[4].iso).getTime(), t0);
  const stat = (id) => p.textContent(`#f-history-stats [data-hist-stat="${id}"] dd`);
  assert.equal(await stat("open"), "10d"); assert.equal(await stat("handoffs"), "1"); assert.equal(await stat("moves"), "2"); assert.equal(await stat("edits"), "1");
  assert.deepEqual(await p.$$eval("#f-history-cols [data-hist-col]", (e) => e.map((x) => `${x.dataset.histCol}=${x.querySelector("b").textContent}`)), ["backlog=2d", "ready-for-dev=2d", "in-progress=6d"]);
  // Reassign it and move it, from the details column (its form from the start, KB-VIEW-3).
  await p.selectOption("#f-assignee", LINH); await p.selectOption("#f-status", "approved");
  await press(p, "#f-save");
  await p.waitForFunction(() => document.getElementById("task-backdrop").hidden);
  await press(p, '.kb-card[data-key="PH-20"]');
  await p.waitForSelector("#f-tab-history");
  assert.equal(await p.getAttribute("#f-tab-comments", "aria-selected"), "true", "a ticket always opens on Comments");
  // The tabs work from the keyboard too.
  await p.focus("#f-tab-comments"); await p.keyboard.press("ArrowRight");
  assert.equal(await p.getAttribute("#f-tab-history", "aria-selected"), "true");
  ls = await eventually(async () => { const l = await lines(); assert.equal(l.length, 7); return l; });
  const top = ls.slice(0, 2).map((l) => l.text).sort();
  assert.deepEqual(top, [`Rob In Progress → Approved for Deployment`, `Rob assigned to ${FULL.linh} (from ${FULL.huy})`].sort(), "the hand-off reads from → to, with who did it");
  assert.ok(ls[0].at && ls[1].at, "each with when");
  assert.equal(await stat("handoffs"), "2"); assert.equal(await stat("moves"), "3");
  assert.ok((await p.$$eval("#f-history-cols [data-hist-col]", (e) => e.map((x) => x.dataset.histCol))).includes("in-progress"));
  await p.done();
});

// One dictation: the recogniser says `said`, as a final, and ends when stopped.
const saidOnce = (said) => speechStub(said);
T("KB-C37", "a voice comment: the name said with its pronunciation becomes an @mention of the right person, an uncertain name is offered not tagged, and the transcript waits in the box to be checked", { timeout: 120000 }, async (prof) => {
  const said = "ask Zuong to check the preview and thanks Lin";
  const seed = kanbanSeed();
  // The server's answer (it alone holds the pronunciations): "Zuong" is Đức here; "Lin" is one letter from Linh.
  const DUC = emailOf("Đức");
  seed.voiceMentions = [{ text: "Ask Zuong to check the preview and thanks Lin", segments: [
    { t: "text", text: "Ask " }, { t: "mention", id: DUC, name: FULL.duc, said: "Zuong" }, { t: "text", text: " to check the preview and thanks " },
    { t: "unsure", text: "Lin", candidates: [{ id: LINH, name: FULL.linh }] },
  ] }];
  const p = await open(prof, "#staff-kanban", { ...REVIEW, seed, init: saidOnce(said) });
  const box = '[data-field="comments"] .ql-editor';
  await press(p, '.kb-card[data-key="PH-20"]');
  await p.waitForSelector(box);
  await press(p, "#f-comment-mic");
  await until(async () => /Zuong/.test(await p.textContent(box)), "the words to arrive in the box");
  await press(p, "#f-comment-mic");
  // The name becomes a chip; the transcript is in the box, not posted, with a line saying to check it.
  await until(async () => (await p.$$eval(`${box} .kb-mention`, (m) => m.map((x) => `${x.dataset.user}|${x.textContent.replace(/\uFEFF/g, "")}`).join())) === `${DUC}|@${FULL.duc}`, "Zuong to become an @mention");
  assert.deepEqual(p.voiceCalls, ["Ask Zuong to check the preview and thanks Lin"], "the words heard were sent to be matched, once");
  const boxText = async () => (await p.textContent(box)).replace(/\uFEFF/g, "");
  assert.equal(await boxText(), `Ask @${FULL.duc} to check the preview and thanks Lin`);
  assert.equal((await commentWrites(p, "PH-20")).length, 0, "nothing is posted until Add comment");
  assert.match(await p.textContent("#f-comment-review-text"), new RegExp(`Added by voice\\. Check the words before you add the comment · tagged ${FULL.duc}\\.`));
  // "Lin" was not certain: left as said, with the closest person offered.
  assert.equal(await p.$$eval(`${box} .kb-mention`, (m) => m.length), 1);
  assert.equal(await p.textContent("#f-comment-review .kb-voice-heard"), "“Lin”");
  assert.equal(await p.textContent("#f-comment-review [data-voice-pick]"), `Tag ${FULL.linh}`);
  await press(p, "#f-comment-review [data-voice-pick]");
  assert.equal(await boxText(), `Ask @${FULL.duc} to check the preview and thanks @${FULL.linh}`);
  assert.equal(await p.$("#f-comment-review [data-voice-pick]"), null);
  // It can be corrected by typing before it is added.
  // (focused, not clicked: on a narrow tablet the "will be notified" toast lies over the box for a moment)
  await p.focus(box); await p.keyboard.press("Control+End"); await p.keyboard.type(" please");
  await press(p, "#f-comment-add");
  const w = await eventually(async () => { const c = await commentWrites(p, "PH-20"); assert.equal(c.length, 1); return c[0].data; });
  assert.deepEqual([...w.mentions].sort(), [DUC, LINH].sort(), "both are on the comment's mentions, which is what notifies them");
  assert.equal(w.via, "voice"); assert.match(w.text, /please$/);
  assert.match(await toastText(p), new RegExp(`Comment added · .*${FULL.duc}.* notified`));
  assert.equal(await shown(p, "#f-comment-review"), false, "the check line goes once it is added");
  // Posted: marked as added by voice, with its author's Edit beside it.
  await eventually(async () => assert.equal(await p.$$eval("#f-comments .kb-comment:last-child .kb-comment-voice, #f-comments .kb-comment:last-child [data-comment-fix]", (e) => e.length), 2));
  await p.done();
});

T("KB-C37", "a voice comment when the server can't match: names the board shows are still tagged, an everyday word is not, and Add comment while still dictating tags first", { timeout: 120000 }, async (prof) => {
  const p = await open(prof, "#staff-kanban", { ...REVIEW, init: saidOnce("thanks Linh I took a look") });
  const box = '[data-field="comments"] .ql-editor';
  await press(p, '.kb-card[data-key="PH-20"]');
  await p.waitForSelector(box);
  await press(p, "#f-comment-mic");
  await until(async () => /took a look/.test(await p.textContent(box)), "the words to arrive in the box");
  // Add comment pressed with the mic still on.
  await press(p, "#f-comment-add");
  const w = await eventually(async () => { const c = await commentWrites(p, "PH-20"); assert.equal(c.length, 1); return c[0].data; });
  assert.deepEqual(w.mentions, [LINH]); assert.equal(w.via, "voice");
  assert.equal(w.text.replace(/\uFEFF/g, ""), `Thanks @${FULL.linh} I took a look`);
  assert.equal(await p.textContent("#f-comment-mic"), "mic", "the mic stopped");
  await p.done();
});

T("KB-C38", "the author edits a voice comment and a typed one: the text is saved, marked edited, and the edit is in History", { timeout: 120000 }, async (prof) => {
  const seed = kanbanSeed({ extra: { "kanbanTasks/PH-20/comments": {
    v1: { author: ROB, html: "<p>Menu bored preview is fixed</p>", text: "Menu bored preview is fixed", mentions: [], via: "voice", at: { $ts: Date.now() - 60000 } },
    t1: { author: ROB, html: "<p>Typed note</p>", text: "Typed note", mentions: [], at: { $ts: Date.now() - 50000 } },
    o1: { author: HUY, html: "<p>Someone else's</p>", text: "Someone else's", mentions: [], at: { $ts: Date.now() - 40000 } },
  } } });
  const p = await open(prof, "#staff-kanban", { ...REVIEW, seed });
  await press(p, '.kb-card[data-key="PH-20"]');
  await p.waitForSelector('#f-comments [data-comment="v1"]');
  const row = (id) => `#f-comments [data-comment="${id}"]`;
  assert.equal(await p.$$eval(`${row("v1")} .kb-comment-voice`, (e) => e.length), 1, "the voice comment says how it was added");
  assert.equal(await p.$$eval(`${row("t1")} .kb-comment-voice`, (e) => e.length), 0);
  assert.equal(await p.$$eval(`${row("o1")} [data-comment-fix], ${row("o1")} [data-comment-edit]`, (e) => e.length), 0, "nobody edits someone else's");
  for (const [id, fixed] of [["v1", "Menu board preview is fixed"], ["t1", "Typed note, corrected"]]) {
    await press(p, `${row(id)} [data-comment-fix]`);
    await p.waitForSelector("#f-comment-edit .ql-editor");
    assert.equal(await p.$eval(`${row(id)} [data-comment-save]`, (e) => e.disabled), true, "Save waits for a change");
    await p.click("#f-comment-edit .ql-editor"); await p.keyboard.press("Control+A"); await p.keyboard.type(fixed);
    await eventually(async () => assert.equal(await p.$eval(`${row(id)} [data-comment-save]`, (e) => e.disabled), false));
    await press(p, `${row(id)} [data-comment-save]`);
    await eventually(async () => { assert.equal(await p.textContent(`${row(id)} .kb-comment-text`), fixed); assert.equal(await p.$$eval(`${row(id)} .kb-comment-edited`, (e) => e.map((x) => x.textContent).join()), "edited"); });
    const saved = (await writes(p, new RegExp(`^kanbanTasks/PH-20/comments/${id}$`))).at(-1).data;
    assert.equal(saved.text, fixed); assert.ok(saved.editedAt, "stamped as edited");
  }
  assert.equal(await p.$$eval(`${row("v1")} .kb-comment-voice`, (e) => e.length), 1, "still marked as added by voice");
  await press(p, "#f-tab-history");
  await eventually(async () => assert.equal((await p.$$eval('#f-history [data-hist="comment"] .kb-hist-text', (e) => e.map((x) => x.textContent))).filter((t) => t === "Rob edited a comment").length, 2, "each edit is in History"));
  await p.done();
});

T("KB-C38", "a comment the owner's agent added under his first address can be edited signed in with his second (the reported bug)", { timeout: 60000 }, async (prof) => {
  const seed = kanbanSeed({ user: { email: "owner.alias@example.com", role: "admin" }, extra: { "kanbanTasks/PH-20/comments": {
    v1: { author: ROB, html: "<p>Said to my agent</p>", text: "Said to my agent", mentions: [], at: { $ts: Date.now() - 60000 } },
    o1: { author: HUY, html: "<p>Someone else's</p>", text: "Someone else's", mentions: [], at: { $ts: Date.now() - 40000 } },
  } } });
  const p = await open(prof, "#staff-kanban", { ...REVIEW, seed });
  await press(p, '.kb-card[data-key="PH-20"]');
  const row = (id) => `#f-comments [data-comment="${id}"]`;
  await p.waitForSelector(`${row("v1")} [data-comment-fix]`);
  await press(p, `${row("v1")} [data-comment-menu]`);
  assert.equal(await p.$$eval(`${row("v1")} .kb-comment-menu:not([hidden]) button`, (b) => b.map((x) => x.textContent.trim()).join()), "Edit,Delete");
  await press(p, `${row("v1")} [data-comment-edit]`);
  await p.waitForSelector("#f-comment-edit .ql-editor");
  await p.click("#f-comment-edit .ql-editor"); await p.keyboard.press("Control+End"); await p.keyboard.type(", corrected");
  await eventually(async () => assert.equal(await p.$eval(`${row("v1")} [data-comment-save]`, (e) => e.disabled), false));
  await press(p, `${row("v1")} [data-comment-save]`);
  await eventually(async () => assert.equal((await writes(p, /^kanbanTasks\/PH-20\/comments\/v1$/)).at(-1).data.text, "Said to my agent, corrected"));
  // As an admin he may delete Huy's, but still not edit it.
  assert.equal(await p.$$eval(`${row("o1")} [data-comment-fix], ${row("o1")} [data-comment-edit]`, (e) => e.length), 0);
  await p.done();
});


// A click outside the dialog never throws away what was typed (Backlog item A9gzWrnFX9AZGrtiuCen): a new ticket typed
// into, or an edit not saved, stays open with a toast saying to use Cancel or ×. A ticket with nothing changed still
// closes, and a press that starts inside the panel (a text selection dragged out) never counts as outside.
T("KB-C39", "a click outside the dialog keeps a new ticket or unsaved edit open; Cancel or × still closes; an unchanged ticket closes", { timeout: 60000 }, async (prof) => {
  const p = await open(prof);
  const closed = () => p.evaluate(() => document.querySelector("#task-backdrop").hidden);
  const outsidePoint = () => p.evaluate(() => {
    const bd = document.querySelector("#task-backdrop");
    for (const [x, y] of [[6, 6], [innerWidth - 6, 6], [6, innerHeight / 2], [innerWidth - 6, innerHeight / 2]]) if (document.elementFromPoint(x, y) === bd) return { x, y };
    return null;
  });
  const clickOutside = async () => { const at = await outsidePoint(); assert.ok(at, "a spot on the backdrop outside the panel"); await p.mouse.click(at.x, at.y); await p.waitForTimeout(120); };
  const setTitle = (v) => p.evaluate((v) => { const f = document.querySelector("#f-title"); f.value = v; f.dispatchEvent(new Event("input", { bubbles: true })); }, v);
  const openCard = async (k) => { await p.evaluate((k) => document.querySelector(`.kb-card[data-key="${k}"]`).click(), k); await until(() => p.$("#task-backdrop:not([hidden]) #f-title"), "the ticket's form"); await until(() => p.$("#f-description .ql-editor"), "the editor"); await p.waitForTimeout(150); };

  // 1. a new ticket with a title typed: the outside click keeps it, with what was typed, and says how to leave
  await openNewTask(p);
  await until(() => p.$("#f-description .ql-editor"), "the editor");
  await setTitle("Typed before clicking away");
  await clickOutside();
  assert.equal(await closed(), false, "the New task form is still open");
  assert.equal(await p.inputValue("#f-title"), "Typed before clicking away", "what was typed is still there");
  await until(async () => /Cancel or ×/.test(await toastText(p)), "the toast saying how to close it");
  // 2. Cancel still closes it
  await press(p, "#f-cancel");
  await eventually(async () => assert.equal(await closed(), true, "Cancel closes the form"));

  // 3. an existing ticket with nothing changed closes on an outside click, as before
  await openCard("PH-34");
  await clickOutside();
  await eventually(async () => assert.equal(await closed(), true, "an unchanged ticket closes on an outside click"));

  // 4. a press inside the panel released outside (a selection dragged past the edge) doesn't close it
  await openCard("PH-34");
  const box = await p.locator("#f-title").boundingBox();
  const at = await outsidePoint();
  await p.mouse.move(box.x + 4, box.y + box.height / 2); await p.mouse.down(); await p.mouse.move(at.x, at.y, { steps: 4 }); await p.mouse.up();
  await p.waitForTimeout(120);
  assert.equal(await closed(), false, "a press that started inside the panel is not an outside click");

  // 5. an unsaved edit: the outside click keeps it; × closes without saving
  await setTitle("Edited, not saved");
  await clickOutside();
  assert.equal(await closed(), false, "the edited ticket is still open");
  assert.equal(await p.inputValue("#f-title"), "Edited, not saved");
  await until(async () => /unsaved changes/.test(await toastText(p)), "the unsaved-changes toast");
  await press(p, "#task-close");
  await eventually(async () => assert.equal(await closed(), true, "× closes it"));
  assert.notEqual((await stored(p, "PH-34")).title, "Edited, not saved", "nothing was saved by clicking away");
  await p.done();
});
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
