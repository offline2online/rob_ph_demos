// Staff Kanban: how long each thing a person does takes, on a board the size
// of a busy year. Not a test (nothing fails): it prints timings, so a change
// can be measured before and after.
//   cd backlog-tracker/test && node ui/kanban-perf-probe.mjs
//   KB_OPEN=1200 KB_CLOSED=300 node ui/kanban-perf-probe.mjs
//   KB_LATENCY=150 …   every server round trip (a read from the server, a
//                      count, a commit) takes this many ms, as it does on a
//                      real connection; listeners still answer from the cache
//   HARNESS_PUBLIC_DIR=../console-dist …   the minified Hosting copy
// The Firebase SDK is the suite's stub, so without KB_LATENCY the numbers are
// the page's own work (script, layout) and no network.
import { startHarness, until } from "./harness.mjs";
import { kanbanSeed, cardOfTask, KB } from "./kanban-seed.mjs";
import { searchTokens } from "../../public/js/kanban/kanban-core.js";

const OPEN = +(process.env.KB_OPEN || 600), CLOSED = +(process.env.KB_CLOSED || 300), LATENCY = +(process.env.KB_LATENCY || 0);
const base = Object.values(KB.kanbanTasks);
const people = Object.keys(KB.memberDirectory);
const open = base.filter((t) => t.status !== "done"), done = base.filter((t) => t.status === "done");
const tasks = {}, cards = {};
let n = 1000;
const add = (src, i) => {
  const key = `PH-${n++}`;
  const t = { ...src, key, number: n, title: `${src.title} ${i}`, assignee: people[i % people.length], rank: i, links: [], epic: "" };
  tasks[key] = { searchTokens: searchTokens({ key, title: t.title, labels: t.labels, descriptionText: t.descriptionText }), ...t };
  cards[key] = cardOfTask(t);
};
for (let i = 0; i < OPEN; i++) add(open[i % open.length], i);
for (let i = 0; i < CLOSED; i++) add(done[i % done.length], i);
const firstKey = "PH-1000";
const comments = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`c${i}`, { author: people[i % people.length], html: `<p>Comment ${i} with some words in it, as a real one has.</p>`, text: `Comment ${i} with some words in it, as a real one has.`, at: { $ts: 1_760_000_000_000 + i * 60000 } }]));
const seed = kanbanSeed({ extra: { kanbanTasks: tasks, kanbanCards: cards, [`kanbanTasks/${firstKey}/comments`]: comments } });

const h = await startHarness();
const o = await h.open({
  seed, hash: "#staff-kanban", width: 1440, height: 900, waitForApp: false,
  init: { arg: LATENCY, fn: (ms) => { window.__FB_LATENCY = ms; window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: true }); } catch (e) { /* no long task API */ } } },
});
const p = o.page;
const row = (name, ms, note = "") => console.log(`${name.padEnd(44)} ${String(Math.round(ms)).padStart(6)} ms  ${note}`);
// The time from an action to the next frame after `done()` first holds, measured in the page.
const timed = (act, done, arg) => p.evaluate(async ({ act, done, arg }) => {
  const check = new Function("arg", `return (${done})(arg)`), run = new Function("arg", `return (${act})(arg)`);
  const t0 = performance.now();
  await run(arg);
  const sync = performance.now() - t0;
  await new Promise((ok, no) => { const end = t0 + 20000; (function tick() { if (check(arg)) requestAnimationFrame(() => ok()); else if (performance.now() > end) no(new Error("timed out: " + done)); else setTimeout(tick, 4); })(); });
  return { sync, total: performance.now() - t0 };
}, { act: String(act), done: String(done), arg });

console.log(`Staff Kanban — ${OPEN} open, ${CLOSED} closed, round trip ${LATENCY} ms${process.env.HARNESS_PUBLIC_DIR ? ", minified copy" : ""}`);
await until(() => p.evaluate(() => document.querySelectorAll(".kb-card").length > 0), "first cards", 60000);
const nav = await p.evaluate(() => ({ cards: Math.round(performance.now()), dom: document.getElementsByTagName("*").length, shown: document.querySelectorAll(".kb-card").length, lt: window.__lt.slice() }));
row("open the board: first cards", nav.cards, `${nav.shown} cards in the page, ${nav.dom} elements`);
await p.waitForTimeout(1500);
const lt = await p.evaluate(() => window.__lt.slice());
row("  long tasks while loading (sum)", lt.reduce((a, b) => a + b, 0), `[${lt.join(", ")}]`);
const mark = () => p.evaluate(() => { window.__lt.length = 0; });
const longest = async () => { const l = await p.evaluate(() => window.__lt.slice()); return l.length ? `longest task ${Math.max(...l)} ms` : ""; };

await mark();
let r = await timed(() => { document.querySelector("#kb-mine").click(); }, () => document.querySelector("#kb-mine").getAttribute("aria-pressed") === "true" || document.querySelector("#kb-mine").classList.contains("on"));
row("filter: My tasks on", r.total, `handler ${Math.round(r.sync)} ms`);
r = await timed(() => { document.querySelector("#kb-mine").click(); }, () => true);
row("filter: My tasks off", r.total, `handler ${Math.round(r.sync)} ms`);
r = await timed(() => { document.querySelector(".kb-person-chip").click(); }, () => true);
row("filter: a person chip on", r.total, `handler ${Math.round(r.sync)} ms`);
r = await timed(() => { document.querySelector(".kb-person-chip.on, .kb-person-chip[aria-pressed='true'], .kb-person-chip").click(); }, () => true);
row("filter: a person chip off", r.total, `handler ${Math.round(r.sync)} ms`);

// Typing in the search box: each key, to the board showing its result.
await p.click("#kb-q");
const t0 = Date.now();
await p.keyboard.type("price", { delay: 60 });
await p.waitForTimeout(700);
row("search: type 5 letters, board settled", Date.now() - t0 - 700 - 300, `(typing itself takes 300 ms) ${await longest()}`);
await mark();
await p.fill("#kb-q", "");
await p.waitForTimeout(500);
row("search: cleared", 0, await longest());

// Open a ticket: click to the form being there, and to its comments being there.
await mark();
r = await timed((key) => { document.querySelector(`.kb-card[data-key="${key}"]`).click(); }, () => !document.querySelector("#task-backdrop").hidden, firstKey);
row("open a ticket: something on screen", r.total, `handler ${Math.round(r.sync)} ms`);
r.total += (await timed(() => {}, () => !!document.querySelector("#f-title"))).total;
row("open a ticket: form shown", r.total);
const t1 = Date.now();
await until(() => p.evaluate(() => document.querySelectorAll(".kb-comment").length >= 40), "comments", 20000);
await until(() => p.evaluate(() => !!document.querySelector('[data-field="comments"] .ql-editor')), "comment editor", 20000);
row("open a ticket: comments + editor ready", r.total + (Date.now() - t1), await longest());

// Comment: Add comment to the comment being in the thread.
await p.click('[data-field="comments"] .ql-editor');
await p.keyboard.type("Looks right to me now.");
await mark();
r = await timed(() => { document.querySelector("#f-comment-add").click(); }, () => document.querySelectorAll(".kb-comment").length >= 41);
row("comment: Add comment → in the thread", r.total, `handler ${Math.round(r.sync)} ms`);

// Close, open the same ticket again, then a new ticket: the form, then Create to the form gone and to the ticket made.
r = await timed(() => { document.querySelector("#task-close").click(); }, () => document.querySelector("#task-backdrop").hidden);
row("close the ticket", r.total, `handler ${Math.round(r.sync)} ms`);
await p.waitForTimeout(LATENCY * 3 + 300);
r = await timed((key) => { document.querySelector(`.kb-card[data-key="${key}"]`).click(); }, () => !document.querySelector("#task-backdrop").hidden && !!document.querySelector("#f-title"), firstKey);
row("open the same ticket again: form shown", r.total, `handler ${Math.round(r.sync)} ms`);
await p.waitForTimeout(LATENCY * 2 + 300);
await timed(() => { document.querySelector("#task-close").click(); }, () => document.querySelector("#task-backdrop").hidden);
r = await timed(() => { document.querySelector("#kb-new-btn").click(); }, () => !document.querySelector("#task-backdrop").hidden && !!document.querySelector("#f-title"));
row("new task: form shown", r.total, `handler ${Math.round(r.sync)} ms`);
await until(() => p.evaluate(() => !!document.querySelector("#f-description .ql-editor")), "description editor", 20000);
await p.fill("#f-title", "Perf probe ticket zzqx");
await mark();
r = await timed(() => { document.querySelector("#f-save").click(); }, () => document.querySelector("#task-backdrop").hidden);
row("new task: Create → form closed", r.total, `handler ${Math.round(r.sync)} ms ${await longest()}`);
r.total += (await timed(() => {}, () => /created in Backlog/.test(document.querySelector("#kb-toast").textContent))).total;
row("new task: Create → ticket made", r.total);

// A status change from the ticket (what a drag also does): Save to the form closed.
r = await timed((key) => { document.querySelector(`.kb-card[data-key="${key}"]`).click(); }, () => !document.querySelector("#task-backdrop").hidden && !!document.querySelector("#f-status"), "PH-1001");
row("open a second ticket: form shown", r.total, `handler ${Math.round(r.sync)} ms`);
await until(() => p.evaluate(() => !!document.querySelector("#f-description .ql-editor")), "description editor", 20000);
await p.fill("#f-title", "Renamed by the probe zzqy");
await p.waitForTimeout(100);
await mark();
r = await timed(() => { document.querySelector("#f-save").click(); }, () => document.querySelector("#task-backdrop").hidden && [...document.querySelectorAll(".kb-card")].some((c) => c.textContent.includes("zzqy")));
row("edit a title: Save → form closed, card updated", r.total, `handler ${Math.round(r.sync)} ms ${await longest()}`);

// A ticket read a moment ago and not changed since: open, close, open again.
await p.waitForTimeout(LATENCY * 3 + 300);
await timed((key) => { document.querySelector(`.kb-card[data-key="${key}"]`).click(); }, () => !!document.querySelector("#f-title"), "PH-1003");
await p.waitForTimeout(LATENCY * 2 + 300);
await timed(() => { document.querySelector("#task-close").click(); }, () => document.querySelector("#task-backdrop").hidden);
r = await timed((key) => { document.querySelector(`.kb-card[data-key="${key}"]`).click(); }, () => !document.querySelector("#task-backdrop").hidden && !!document.querySelector("#f-title"), "PH-1003");
row("open an unchanged ticket again: form shown", r.total, `handler ${Math.round(r.sync)} ms`);
await p.waitForTimeout(LATENCY * 2 + 300);
await timed(() => { document.querySelector("#task-close").click(); }, () => document.querySelector("#task-backdrop").hidden);

// A flag from the card: click to the card showing it.
await p.waitForTimeout(LATENCY * 3 + 300);
r = await timed(() => { const b = document.querySelector('.kb-card[data-key="PH-1002"] [data-flag]'); if (b) b.click(); }, () => { const c = document.querySelector('.kb-card[data-key="PH-1002"]'); return !c.querySelector("[data-flag]") || c.classList.contains("kb-flagged") || !!c.querySelector(".kb-flag.on, [data-flag].on, [data-flag][aria-pressed='true']"); });
row("flag a card: click → card shows it", r.total, `handler ${Math.round(r.sync)} ms`);

if (o.problems.length) console.log("problems:", o.problems.slice(0, 5).join(" | "));
await o.close();
await h.close();
