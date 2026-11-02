#!/usr/bin/env node
// Live performance probe for the PH Agent Console (backlog-tracker-e4ed2.web.app).
// Runs on a GitHub runner (.github/workflows/console-perf-probe.yml), where the
// service account is. Read-only: it writes nothing to Firestore.
//
// 1. Data volume: for every collection the console reads at start-up, the
//    document count, total bytes and the five largest documents.
// 2. A real browser load: signs in as the board automation user with a custom
//    token carrying consoleRole "viewer" (no row is created, nothing written),
//    then times a cold load, a warm reload and each section, logging slow
//    requests, console errors and long main-thread tasks.
//
//   GOOGLE_APPLICATION_CREDENTIALS=sa.json node live-perf-probe.mjs [--out report.json]
import fs from "node:fs";
import admin from "firebase-admin";
import { chromium } from "playwright";

const SITE = process.env.PROBE_SITE || "https://backlog-tracker-e4ed2.web.app/";
const AUTOMATION_EMAIL = "board-automation@backlog-tracker-e4ed2.firebaseapp.com";
const outPath = (() => { const i = process.argv.indexOf("--out"); return i > 0 ? process.argv[i + 1] : "perf-report.json"; })();
admin.initializeApp({ projectId: "backlog-tracker-e4ed2" });
const db = admin.firestore();
const report = { at: new Date().toISOString(), site: SITE, collections: {}, loads: [] };
const log = (...a) => console.log(...a);

// ── 1. Data volume ─────────────────────────────────────────────────────────
const sizeOf = (d) => Buffer.byteLength(JSON.stringify(d.data()));
async function measure(name, q) {
  const t0 = Date.now();
  const snap = await q.get();
  const docs = snap.docs.map((d) => ({ id: d.ref.path, bytes: sizeOf(d), fields: Object.entries(d.data()).map(([k, v]) => [k, Buffer.byteLength(JSON.stringify(v) || "")]).sort((a, b) => b[1] - a[1]).slice(0, 4) }));
  const total = docs.reduce((s, d) => s + d.bytes, 0);
  report.collections[name] = { count: docs.length, kb: Math.round(total / 1024), ms: Date.now() - t0, largest: docs.sort((a, b) => b.bytes - a.bytes).slice(0, 5) };
  log(`${name.padEnd(34)} ${String(docs.length).padStart(6)} docs ${String(Math.round(total / 1024)).padStart(7)} KB`);
}
const C = (n) => db.collection(n);
await measure("backlogItems (live)", C("backlogItems").where("status", "!=", "archived"));
await measure("backlogItems (archived)", C("backlogItems").where("status", "==", "archived"));
for (const n of ["projects", "interfaces", "programs", "releases", "systemStatus", "systemMap", "roles", "consoleUsers", "projectDocs", "skills", "concepts", "conceptCritiques", "faqCategories", "faqArticles", "kanbanCards", "kanbanTickets", "kanbanPeople", "kanbanNotifications", "settings", "whiteboards"]) {
  try { await measure(n, C(n)); } catch (e) { log(n, "error", e.message); }
}
await measure("artifactVersions (group)", db.collectionGroup("artifactVersions"));
await measure("projects/*/docs (group)", db.collectionGroup("docs"));
for (const c of await db.listCollections()) if (!(c.id in report.collections)) {
  const agg = await c.count().get();
  log(`(other) ${c.id}: ${agg.data().count}`);
  (report.otherCollections ||= {})[c.id] = agg.data().count;
}

// ── 2. Browser ─────────────────────────────────────────────────────────────
const user = await admin.auth().getUserByEmail(AUTOMATION_EMAIL);
const token = await admin.auth().createCustomToken(user.uid, { consoleRole: "viewer" });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
let current = null;
const begin = (label) => { current = { label, requests: [], errors: [], longTasks: [] }; report.loads.push(current); return current; };
page.on("console", (m) => { if (current && (m.type() === "error" || m.type() === "warning")) current.errors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on("pageerror", (e) => current && current.errors.push(`pageerror: ${e.message}`));
const started = new Map();
page.on("request", (r) => started.set(r, Date.now()));
page.on("requestfinished", async (r) => {
  if (!current) return;
  const s = await r.sizes().catch(() => ({ responseBodySize: 0 }));
  const ms = Date.now() - (started.get(r) || Date.now());
  current.requests.push({ url: r.url().slice(0, 160), ms, kb: Math.round((s.responseBodySize || 0) / 1024), status: (await r.response())?.status() });
});
page.on("requestfailed", (r) => current && current.requests.push({ url: r.url().slice(0, 160), failed: r.failure()?.errorText }));
await page.addInitScript(() => {
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: true }); } catch {}
});

const ready = () => page.evaluate(() => {
  const app = document.querySelector(".app");
  return !!(app && !app.hidden && !document.documentElement.dataset.booting && document.querySelector(".project-section .card, .project-section"));
});
async function timed(label, fn, until, ms = 120000) {
  const rec = begin(label);
  const t0 = Date.now();
  await fn();
  let ok = false;
  while (Date.now() - t0 < ms) { if (await until().catch(() => false)) { ok = true; break; } await page.waitForTimeout(100); }
  rec.ms = Date.now() - t0; rec.ok = ok;
  rec.longTasks = await page.evaluate(() => { const v = window.__lt.slice(); window.__lt.length = 0; return v; }).catch(() => []);
  rec.bootStatus = await page.evaluate(() => (document.getElementById("boot-status") || {}).textContent || "").catch(() => "");
  await page.waitForTimeout(1500);
  const slow = rec.requests.filter((r) => r.failed || r.ms > 700 || r.kb > 200).sort((a, b) => (b.ms || 0) - (a.ms || 0)).slice(0, 15);
  log(`\n[${label}] ${ok ? "ready" : "NOT READY"} in ${rec.ms} ms; ${rec.requests.length} requests, ${rec.requests.reduce((s, r) => s + (r.kb || 0), 0)} KB; long tasks: ${JSON.stringify(rec.longTasks.slice(0, 20))}`);
  for (const r of slow) log(`   ${r.failed ? "FAILED " + r.failed : `${r.ms}ms ${r.kb}KB ${r.status}`}  ${r.url}`);
  for (const e of rec.errors.slice(0, 15)) log(`   ${e}`);
}

await page.goto(SITE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.getElementById("auth-gate-status"), null, { timeout: 60000 });
await page.evaluate(async (tok) => {
  const { getApp } = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js");
  const { getAuth, signInWithCustomToken } = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js");
  await signInWithCustomToken(getAuth(getApp()), tok);
}, token);
// First load after sign-in (empty Firestore cache).
await timed("first sign-in load", async () => {}, ready);
await timed("reload (warm cache)", () => page.reload({ waitUntil: "domcontentloaded" }), ready);
await timed("reload 2", () => page.reload({ waitUntil: "domcontentloaded" }), ready);
const sections = [
  ["#staff-kanban", () => !!document.querySelector(".kb-col, .kanban-col, [class*='kb-board']")],
  ["#concept-incubator", () => !document.getElementById("concept-incubator-page")?.hidden],
  ["#faq-management", () => !document.getElementById("faq-articles-page")?.hidden && !!document.querySelector("#faq-articles-page .fa-row, #faq-articles-page tr, #faq-articles-page li")],
  ["#settings/projects", () => !document.getElementById("faq-settings-page")?.hidden],
  ["#settings/releases", () => !document.getElementById("faq-settings-page")?.hidden],
  ["#user-management/users", () => true],
];
for (const [hash, check] of sections) {
  await timed(`navigate ${hash}`, () => page.evaluate((h) => { location.hash = h; }, hash), () => page.evaluate(check));
  await timed(`cold load ${hash}`, async () => { await page.goto(SITE + hash, { waitUntil: "domcontentloaded" }); }, () => page.evaluate(check));
}
const p = report.loads.find((l) => l.label === "reload (warm cache)");
await page.screenshot({ path: outPath.replace(/\.json$/, ".png"), fullPage: false });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
await browser.close();
log(`\nwrote ${outPath}`);
process.exit(0);
