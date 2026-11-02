import fs from "node:fs";
import { startHarness, until } from "./harness.mjs";
const t = (ms) => ({ $ts: ms });
const T0 = 1_760_000_000_000;
const P = ["oTcLAbnhUUO2S7NkbsuV", "mIPdOCAWevhrgD8g2tCZ", "EywksAFxCSfDRdsRvofM", "New5VKTF2QBqT3T4YEla"];
const big = (n) => "Lorem ipsum dolor sit amet. ".repeat(Math.ceil(n / 28)).slice(0, n);
const items = {};
let k = 0;
const counts = [334, 564, 90, 62];
P.forEach((pid, pi) => {
  for (let i = 0; i < counts[pi]; i++) items[`a${k++}`] = { projectId: pid, title: `Archived ${k}`, desc: big(600), type: "bug", category: "HQ Admin", status: "archived", createdAt: t(T0 + k), updatedAt: t(T0 + k), archivedAt: t(T0 + k), notes: Array.from({ length: 6 }, (_, j) => ({ text: big(300), at: t(T0 + j), by: "x@y" })), testVersion: `1.5.${k % 300}` };
  for (let i = 0; i < 8; i++) items[`l${k++}`] = { projectId: pid, title: `Live ${k}`, desc: big(800), type: "feature", category: "HQ Admin", status: ["backlog", "ready-for-testing", "published-live"][i % 3], createdAt: t(T0 + k), updatedAt: t(T0 + k), notes: Array.from({ length: 10 }, (_, j) => ({ text: big(300), at: t(T0 + j), by: "x@y" })) };
});
const projects = Object.fromEntries(P.map((id, i) => [id, { name: `Project ${i}`, createdAt: t(T0 + i), deployBranch: `deploy/p${i}`, repoFolder: `p${i}`, description: big(200) }]));
const kanbanCards = {};
for (let i = 0; i < 400; i++) kanbanCards[`k${i}`] = { title: `Task ${i}`, status: ["todo", "in-progress", "done"][i % 3], createdAt: t(T0 + i), updatedAt: t(T0 + i), order: i, key: `PH-${i}` };
const seed = { user: { email: "rob@offline2online.com", role: "admin" }, docs: {
  projects, backlogItems: items, kanbanCards,
  roles: { r1: { name: "Admin" }, r2: { name: "Editor" } },
  consoleUsers: { "rob@offline2online.com": { email: "rob@offline2online.com", role: "admin", roleId: "r1" } },
} };
const h = await startHarness();
const routes = (process.env.ROUTES || "#,#staff-kanban,#concept-incubator,#faq-management,#settings,#user-management/users").split(",");
for (const hash of routes) {
  const o = await h.open({ seed, hash: hash === "#" ? "" : hash });
  const t0 = Date.now();
  if (process.env.PROFILE && hash === "#") { const cdp = await o.context.newCDPSession(o.page); await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); o.cdp = cdp; }
  let ok = true;
  try {
    await until(() => o.page.evaluate(() => {
      const app = document.querySelector(".app"); if (!app || app.hidden) return false;
      const vis = [...document.querySelectorAll("main > section, .page, [id$='-page']")].filter((e) => !e.hidden && e.offsetParent !== null);
      return document.querySelector(".project-section, .kanban-col, .ag-root, table, .concept-card, .faq") ? true : false;
    }), `render ${hash}`, 30000);
  } catch (e) { ok = false; }
  const ms = Date.now() - t0;
  const perf = await o.page.evaluate(() => { const lt = performance.getEntriesByType("longtask"); return { heap: Math.round(performance.memory.usedJSHeapSize / 1e6), domNodes: document.getElementsByTagName("*").length }; });
  if (o.cdp) { const { profile } = await o.cdp.send("Profiler.stop"); fs.writeFileSync(process.env.PROFILE, JSON.stringify(profile)); }
  // keep it idle for 3s and measure CPU busy
  const busy = await o.page.evaluate(() => new Promise((res) => { let n = 0, last = performance.now(), worst = 0; const end = last + 3000; (function tick() { const now = performance.now(); worst = Math.max(worst, now - last); last = now; n++; if (now < end) setTimeout(tick, 0); else res({ ticks: n, worstGapMs: Math.round(worst) }); })(); }));
  console.log(hash, ok ? "OK" : "TIMEOUT", `${ms}ms`, JSON.stringify(perf), JSON.stringify(busy), o.problems.slice(0, 3).join(" | "));
  await o.close();
}
await h.close();
