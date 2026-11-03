// iPad sidebar taps (3 Nov 2026: Staff Kanban and Concepts dead on the iPad
// again, after the 21 Oct and 25 Oct fixes). Chromium is not WebKit, so each
// way iPad WebKit has been seen to lose a tap is reproduced on purpose, and
// every sidebar destination must still open, exactly once, by touch, at iPad
// sizes in both orientations and from every page:
//   - plain:     a real tap through Chromium's touch pipeline;
//   - noclick:   the browser drops the tap's native click (WebKit, 21 Oct);
//   - cancel:    the browser sends pointercancel instead of pointerup (a pan
//                starting inside the scrollable sidebar), and no click;
//   - noptr:     no pointer events at all, only Touch Events;
//   - late:      the native click arrives late and re-targeted at whatever is
//                now under the finger (the slide-over has already closed).
// See backlog-tracker/REQUIREMENTS.md → "iPad taps" and public/js/touch-click.js.
// Run with:  cd backlog-tracker/test && node ui/nav-touch.test.mjs
import assert from "node:assert";
import { startHarness, until } from "./harness.mjs";

const T = { $ts: 1_760_000_000_000 };
const seed = {
  user: { email: "editor@personalisationhub.com", role: "admin" },
  docs: {
    projects: { p1: { name: "Demo", createdAt: T } },
    backlogItems: { b1: { projectId: "p1", title: "Purple widget", desc: "x", type: "feature", category: "HQ Admin", status: "backlog", createdAt: T, updatedAt: T } },
    concepts: { c1: { name: "Alpha", type: "Platform", status: "active", description: "Alpha", createdAt: T, updatedAt: T } },
  },
};
// iPad landscape (persistent sidebar) and portrait (slide-over), plus the 1024 edge.
const SIZES = [[1180, 820], [1024, 768], [820, 1180]];
const STARTS = ["", "#staff-kanban", "#concept-incubator"];
const ITEMS = [["staff-kanban-btn", "#staff-kanban"], ["concept-incubator-btn", "#concept-incubator"], ["faq-articles-btn", "#faq-management"], ["nav-ph-console-btn", ""]];
const MODES = ["plain", "noclick", "cancel", "noptr", "late"];

// Installed before the app: counts the app's own handler runs per item, and
// simulates the WebKit behaviour the mode names.
function initMode(mode) {
  window.__navClicks = {};
  window.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".nav-drawer-item");
    if (!b) return;
    // noclick/cancel/noptr: the browser's own click for a tap never arrives.
    if (e.isTrusted && mode !== "plain" && mode !== "late") { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  // Counted in the bubble phase: only clicks that reach the app's own handlers.
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".nav-drawer-item");
    if (b) window.__navClicks[b.id] = (window.__navClicks[b.id] || 0) + 1;
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
let failures = 0;
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
    for (const start of STARTS) {
      for (const [id, want] of ITEMS) {
        await page.evaluate((s) => { if (location.hash !== s) location.hash = s; }, start);
        await page.waitForTimeout(250);
        if (w < 1024) {
          await page.evaluate(() => document.getElementById("nav-open-btn").click());
          await until(() => page.evaluate(() => getComputedStyle(document.getElementById("nav-drawer")).visibility === "visible"), "slide-over open");
          await page.waitForTimeout(260);
        }
        await page.evaluate(() => { window.__navClicks = {}; });
        const p = await page.evaluate((i) => { const r = document.getElementById(i).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, id);
        await tap(p.x, p.y);
        if (mode === "late") await page.mouse.click(p.x, p.y); // WebKit's late click, re-hit-tested
        let ok = true, why = "";
        try {
          await until(() => page.evaluate((h) => location.hash.split("?")[0] === h, want), `${id} opens`, 1500);
          await page.waitForTimeout(150);
          const n = await page.evaluate((i) => window.__navClicks[i] || 0, id);
          assert.strictEqual(n, 1, `${id} handler ran ${n} times`);
          const stray = await page.evaluate(() => [...document.querySelectorAll(".modal-backdrop, #task-backdrop")].filter((m) => !m.hidden && getComputedStyle(m).display !== "none").map((m) => m.id));
          assert.deepStrictEqual(stray, [], "a late click opened something under the finger");
          if (w < 1024) assert.strictEqual(await page.evaluate(() => document.getElementById("nav-drawer-backdrop").classList.contains("open")), false, "slide-over left open");
        } catch (e) { ok = false; why = e.message.split("\n")[0]; }
        if (!ok) { failures++; console.log(`FAIL ${mode} ${w}x${ht} from ${start || "board"} → ${id}: ${why}`); }
      }
    }
    assert.deepStrictEqual(o.problems.filter((x) => !/unrouted host/.test(x)), [], `${mode} ${w}: page problems`);
    console.log(`PASS-SET ${mode} ${w}x${ht}`);
    await o.close();
  }
} finally { await h.close(); }
if (failures) { console.error(`nav-touch: ${failures} failure(s)`); process.exit(1); }
console.log("nav-touch: ok");
