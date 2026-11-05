// iPad taps across the console (3 Nov 2026: Staff Kanban and Concepts dead in
// the sidebar; 5 Nov 2026: "many of the links" dead again, after new Settings
// tabs, User Management tabs and the Promote section were added). Chromium is
// not WebKit, so each way iPad WebKit has been seen to lose a tap is
// reproduced on purpose:
//   - plain:     a real tap through Chromium's touch pipeline;
//   - noclick:   the browser drops the tap's native click — ANYWHERE, not only
//                in the sidebar (WebKit, 21 Oct and 5 Nov);
//   - cancel:    pointercancel instead of pointerup, and no click;
//   - noptr:     no pointer events at all, only Touch Events, and no click;
//   - late:      the native click arrives late and re-targeted at whatever is
//                now under the finger (the slide-over has already closed).
//
// The targets are FOUND, not listed: every visible sidebar item, and every
// visible tab on the Settings and User Management pages, so a control added
// later is tested without anyone editing this file. Each tap must leave the
// console in the same state a real click does (route + selected tabs) and run
// the control's handler exactly once.
// See backlog-tracker/REQUIREMENTS.md → "iPad taps" and public/js/touch-click.js.
// Run with:  cd backlog-tracker/test && node ui/nav-touch.test.mjs
import assert from "node:assert";
import { startHarness, until } from "./harness.mjs";

const T = { $ts: 1_760_000_000_000 };
const seed = {
  user: { email: "admin@personalisationhub.com", role: "admin" },
  docs: {
    projects: { p1: { name: "Demo", createdAt: T } },
    backlogItems: { b1: { projectId: "p1", title: "Purple widget", desc: "x", type: "feature", category: "HQ Admin", status: "backlog", createdAt: T, updatedAt: T } },
    concepts: { c1: { name: "Alpha", type: "Platform", status: "active", description: "Alpha", createdAt: T, updatedAt: T } },
  },
};
// iPad landscape (persistent sidebar) and portrait (slide-over), plus the 1024 edge.
const SIZES = [[1180, 820], [1024, 768], [820, 1180]];
const MODES = ["plain", "noclick", "cancel", "noptr", "late"];
// Sidebar items that leave the page or open an overlay are checked elsewhere
// (whiteboard.test.mjs, console-click.test.mjs).
const SIDEBAR_SKIP = ["whiteboard-btn", "cmdk-open-btn"];
// [start page, which controls to find there]
const PLAN = [
  ["", "sidebar"],
  ["#staff-kanban", "sidebar"],
  ["#settings", "sidebar"],
  ["#settings", "tabs"],
  ["#settings/user-management/users", "tabs"],
];

function initMode(mode) {
  window.__taps = {};
  const keyOf = (b) => b.id || b.dataset.settingsPage || b.dataset.umTab || b.textContent.trim();
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !el.closest("[hidden]"); };
  // Every visible sidebar item, or every visible tab in the page.
  window.__targets = (kind, skip) => {
    const els = kind === "sidebar"
      ? [...document.querySelectorAll("#nav-drawer .nav-drawer-item")].filter((b) => !skip.includes(b.id) && !b.closest("[hidden]") && getComputedStyle(b).display !== "none")
      : [...document.querySelectorAll("[role=tab]")].filter((b) => !b.closest("#nav-drawer, #tabbar") && vis(b));
    return [...new Set(els.map(keyOf))];
  };
  window.__locate = (key) => [...document.querySelectorAll("#nav-drawer .nav-drawer-item, [role=tab]")].find((b) => keyOf(b) === key && b.getClientRects().length) || null;
  // Route plus whichever tabs are selected: what a click changes.
  window.__sig = () => location.hash.split("?")[0] + " | " + [...document.querySelectorAll("[role=tab][aria-selected=true]")].filter((b) => b.getClientRects().length).map(keyOf).sort().join(",");
  const drops = mode === "noclick" || mode === "cancel" || mode === "noptr";
  window.addEventListener("click", (e) => {
    if (drops && e.isTrusted) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  // Counted in the bubble phase: only clicks that reach the app's own handlers.
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".nav-drawer-item, [role=tab]");
    if (b) window.__taps[keyOf(b)] = (window.__taps[keyOf(b)] || 0) + 1;
  });
  const kill = (e) => { if (e.pointerType === "touch") e.stopImmediatePropagation(); };
  if (mode === "noptr") for (const t of ["pointerdown", "pointerup", "pointercancel"]) window.addEventListener(t, kill, true);
  if (mode === "cancel") {
    window.addEventListener("pointerup", (e) => {
      if (e.pointerType !== "touch" || !e.isTrusted) return;
      e.stopImmediatePropagation();
      e.target.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerType: "touch", isPrimary: true, pointerId: e.pointerId }));
    }, true);
  }
}

const h = await startHarness();
let failures = 0, taps = 0;
const expectedCache = new Map(); // `${w}|${start}|${key}` → state a real click leaves
try {
  for (const mode of MODES) for (const [w, ht] of SIZES) {
    const o = await h.open({ seed, width: w, height: ht, contextOptions: { hasTouch: true, isMobile: true }, init: { fn: initMode, arg: mode } });
    const { page } = o;
    await until(() => page.locator(".project-options-btn").count(), "board");
    const cdp = await o.context.newCDPSession(page);
    const tap = async (x, y) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    const go = async (start, kind) => {
      await page.evaluate((s) => { if (location.hash !== s) location.hash = s; }, start);
      await page.waitForTimeout(120);
      await page.evaluate(() => window.scrollTo(0, 0));
      if (kind === "sidebar" && w < 1024) {
        await page.evaluate(() => document.getElementById("nav-open-btn").click());
        await until(() => page.evaluate(() => getComputedStyle(document.getElementById("nav-drawer")).visibility === "visible"), "slide-over open");
        await page.waitForTimeout(260);
      }
    };
    for (const [start, kind] of PLAN) {
      await go(start, kind);
      const keys = await page.evaluate(([k, sk]) => window.__targets(k, sk), [kind, SIDEBAR_SKIP]);
      assert.ok(keys.length >= (kind === "sidebar" ? 6 : 2), `${mode} ${w}: found only ${keys.length} ${kind} targets on ${start || "board"}`);
      for (const key of keys) {
        // What a real click does, from the same starting point (once per size).
        const ck = `${w}|${start}|${key}`;
        if (!expectedCache.has(ck)) {
          await go(start, kind);
          await page.evaluate((k) => { const b = window.__locate(k); if (b) b.click(); }, key);
          await page.waitForTimeout(250);
          expectedCache.set(ck, await page.evaluate(() => window.__sig()));
        }
        const expected = expectedCache.get(ck);
        // The tap, from the same starting point.
        await go(start, kind);
        const p = await page.evaluate((k) => { const b = window.__locate(k); if (!b) return null; b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, key);
        if (!p) { failures++; console.log(`FAIL ${mode} ${w}x${ht} ${start || "board"} → ${key}: not on screen`); continue; }
        await page.evaluate(() => { window.__taps = {}; });
        await tap(p.x, p.y);
        if (mode === "late") await page.mouse.click(p.x, p.y); // WebKit's late click, re-hit-tested
        taps++;
        try {
          await until(() => page.evaluate((e) => window.__sig() === e, expected), `${key} → ${expected}`, 1500);
          await page.waitForTimeout(60);
          const n = await page.evaluate((k) => window.__taps[k] || 0, key);
          assert.strictEqual(n, 1, `handler ran ${n} times`);
          const stray = await page.evaluate(() => [...document.querySelectorAll(".modal-backdrop, #task-backdrop")].filter((m) => !m.hidden && getComputedStyle(m).display !== "none").map((m) => m.id));
          assert.deepStrictEqual(stray, [], "a late click opened something under the finger");
          if (kind === "sidebar" && w < 1024) assert.strictEqual(await page.evaluate(() => document.getElementById("nav-drawer-backdrop").classList.contains("open")), false, "slide-over left open");
          // The late-click guard must not eat the NEXT tap's click on an element that is
          // not a tap target (a Staff Kanban card is an <article>): 5 Nov 2026.
          if (mode === "plain") {
            await page.evaluate(({ x, y }) => {
              const d = document.createElement("div");
              d.id = "__next-tap"; d.style.cssText = `position:fixed;left:${x - 20}px;top:${y - 20}px;width:40px;height:40px;z-index:2147483647;background:transparent`;
              d.addEventListener("click", () => { d.dataset.clicked = "1"; });
              document.body.appendChild(d);
            }, p);
            await tap(p.x, p.y);
            const ok = await page.evaluate(() => { const d = document.getElementById("__next-tap"); const r = d.dataset.clicked === "1"; d.remove(); return r; });
            assert.ok(ok, "the next tap's own click was swallowed by the late-click guard");
          }
        } catch (e) {
          failures++;
          const got = await page.evaluate(() => window.__sig());
          console.log(`FAIL ${mode} ${w}x${ht} ${start || "board"} → ${key}: ${e.message.split("\n")[0]} (state: ${got})`);
        }
      }
    }
    assert.deepStrictEqual(o.problems.filter((x) => !/unrouted host/.test(x)), [], `${mode} ${w}: page problems`);
    console.log(`PASS-SET ${mode} ${w}x${ht}`);
    await o.close();
  }
} finally { await h.close(); }
if (failures) { console.error(`nav-touch: ${failures} failure(s) of ${taps} taps`); process.exit(1); }
console.log(`nav-touch: ok (${taps} taps)`);
