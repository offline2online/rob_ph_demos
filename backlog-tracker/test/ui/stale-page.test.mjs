// A page cached from an earlier release, running today's scripts (6 Nov 2026).
// This is what left the iPad's left-hand menu dead after releases, four
// reports running: the console's page at "/" had no Cache-Control rule, so
// Firebase let the browser keep it for an hour, while the scripts are always
// fetched fresh. Today's app.js reached for a menu button the old page did not
// have, threw, and the menu (and most of the console) never wired up.
// Chromium tests always load fresh files, so nothing caught it.
//
// Checked here:
//   1. firebase.json sends no-cache for "/" (and any directory index), as well
//      as for .html/.js/.css;
//   2. with a stale page on first load, the console reloads once by itself and
//      the menu then works, by touch, at iPad landscape and portrait;
//   3. when the page is broken on every load, it shows the error after one
//      reload instead of reloading in a loop.
// See REQUIREMENTS.md → "Stale page after a release".
// Run with:  cd backlog-tracker/test && node ui/stale-page.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startHarness, until, publicDir } from "./harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// 1. Cache headers.
const fb = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "firebase.json"), "utf8"));
const consoleSite = (Array.isArray(fb.hosting) ? fb.hosting : [fb.hosting]).find((h) => h.target === "console");
const noCache = (src) => (consoleSite.headers || []).some((h) => h.source === src && h.headers.some((x) => x.key === "Cache-Control" && /no-cache/.test(x.value)));
for (const src of ["/", "**/", "**/*.@(html|js|css)"]) assert.ok(noCache(src), `firebase.json (console) must send Cache-Control: no-cache for "${src}"`);

// A stale page: today's index.html with the newest menu items missing, which is
// what a page from before a release that added menu items looks like.
const fresh = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
const stale = fresh.replace(/<button[^>]*id="promote-[a-z-]+-btn"[\s\S]*?<\/button>/g, "");
assert.notEqual(stale, fresh, "the test must be able to make a stale page (no promote-* menu buttons found)");

const T = { $ts: 1_760_000_000_000 };
const seed = { user: { email: "admin@personalisationhub.com", role: "admin" }, docs: { projects: { p1: { name: "Demo", createdAt: T } }, backlogItems: {} } };
const h = await startHarness();
let failures = 0;
const fail = (m) => { failures++; console.log("FAIL", m); };
try {
  for (const [mode, staleLoads] of [["recovers", 1], ["no loop", Infinity]]) {
    for (const [w, ht] of [[1180, 820], [820, 1180]]) {
      const o = await h.open({ seed, width: w, height: ht, contextOptions: { hasTouch: true, isMobile: true }, init: { fn: () => {}, arg: null } });
      const { page } = o;
      let docLoads = 0;
      await page.route((u) => u.pathname === "/" || u.pathname === "/index.html", async (route) => {
        docLoads++;
        return route.fulfill({ status: 200, contentType: "text/html", body: docLoads <= staleLoads ? stale : fresh });
      });
      await page.reload();
      if (mode === "recovers") {
        try { await until(() => page.locator(".project-options-btn").count(), "board after the self-reload", 15000); }
        catch { fail(`${w}x${ht}: the console did not recover from a stale page (page loads: ${docLoads})`); await o.close(); continue; }
        if (docLoads !== 2) fail(`${w}x${ht}: expected exactly one self-reload, saw ${docLoads} page loads`);
        if (w < 1024) { await page.evaluate(() => document.getElementById("nav-open-btn").click()); await page.waitForTimeout(400); }
        const r = await page.evaluate(() => { const b = document.getElementById("staff-kanban-btn").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
        await page.touchscreen.tap(r.x, r.y);
        try { await until(() => page.evaluate(() => location.hash === "#staff-kanban"), "Staff Kanban opens by tap", 4000); }
        catch { fail(`${w}x${ht}: after recovering, tapping Staff Kanban in the menu did nothing`); }
      } else {
        await page.waitForTimeout(6000);
        if (docLoads > 2) fail(`${w}x${ht}: a page broken on every load reloaded ${docLoads - 1} times (must stop after one)`);
        const msg = await page.evaluate(() => document.body.innerText);
        if (!/didn't finish loading/.test(msg)) fail(`${w}x${ht}: a page broken on every load should say the console didn't finish loading`);
      }
      console.log(`${failures ? "…" : "PASS"} ${mode} ${w}x${ht} (page loads: ${docLoads})`);
      await o.close();
    }
  }
} finally { await h.close(); }
if (failures) { console.error(`stale-page: ${failures} failure(s)`); process.exit(1); }
console.log("stale-page: ok");
