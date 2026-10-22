// Live whiteboard on a tablet, end to end, by touch: the console's Whiteboard
// menu item and the board itself at iPad sizes (portrait and landscape) with
// real touch input (Chromium's touch channel), against the REAL public/ files
// with the Firebase SDK stubbed.
//
//   1. Console: tapping Whiteboard opens a new board; a tap whose click the
//      browser drops (as iPad WebKit did for Staff Kanban, 21 Oct 2026) still
//      opens it; coming Back to the console and tapping again opens another.
//   2. Board: every toolbar control is on screen without scrolling the bar;
//      share/copy, one-finger drawing, colour and size, undo, two-finger pinch,
//      the Move tool, reset, eraser, a dot, clear (with confirm), and toolbar
//      taps whose click is dropped.
// Run with:  cd backlog-tracker/test && node ui/whiteboard-tablet.test.mjs
import assert from "node:assert";
import { startHarness, until } from "./harness.mjs";
import { COLORS, SIZES } from "../../public/js/whiteboard-core.js";

const T0 = 1_760_000_000_000;
const t = (ms) => ({ $ts: ms });
const ID = "Ab3dEf6hIj9lMn2pQr5T";
const consoleSeed = {
  user: { email: "editor@personalisationhub.com", role: "editor" },
  docs: { projects: { p1: { name: "Demo Project", createdAt: t(T0), deployBranch: "deploy/demo", repoFolder: "demo" } } },
};
const boardSeed = { docs: { whiteboards: { [ID]: { shared: true, createdAt: t(T0) } } } };
const TABLETS = [[768, 1024], [820, 1180], [1180, 820], [1024, 1366], [1366, 1024]];
const touchCtx = { isMobile: true, hasTouch: true };
const BOARD_URL = /whiteboard\.html\?b=([A-Za-z0-9]{20})&new=1$/;

const writes = async (page) => (await page.evaluate(() => window.__fbStub.writes)).filter((w) => w.path.includes("/strokes/"));
const saved = async (page) => (await writes(page)).filter((w) => w.op !== "delete");
const deleted = async (page) => (await writes(page)).filter((w) => w.op === "delete");

// A tap the browser never turns into a click: pointer events only.
const droppedClickTap = (page, sel) => page.evaluate((s) => {
  const b = document.querySelector(s), r = b.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, pointerType: "touch", isPrimary: true, pointerId: 7, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  b.dispatchEvent(new PointerEvent("pointerdown", at));
  b.dispatchEvent(new PointerEvent("pointerup", at));
}, sel);

// Real touch through Chromium's input pipeline (pointer events, touch-action and all).
async function finger(cdp, paths, { hold = 0 } = {}) {
  const steps = paths[0].length;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: paths.map((p, id) => ({ x: p[0][0], y: p[0][1], id })) });
  if (hold) await new Promise((r) => setTimeout(r, hold));
  for (let i = 1; i < steps; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: paths.map((p, id) => ({ x: p[i][0], y: p[i][1], id })) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const line = (x0, y0, x1, y1, n = 14) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1)]);

const h = await startHarness();
let failed = 0, passed = 0;
async function scenario(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${String(e && e.message).split("\n").join("\n      ")}`); }
}

try {
  // ── 1. Console → board ──────────────────────────────────────────────────
  for (const [w, ht] of TABLETS) {
    await scenario(`console ${w}x${ht}: tapping Whiteboard opens a new board`, async () => {
      const o = await h.open({ seed: consoleSeed, width: w, height: ht, contextOptions: touchCtx });
      const { page } = o;
      try {
        await page.waitForSelector("#total-summary", { state: "attached" });
        await page.waitForTimeout(500);
        if (await page.locator("#nav-open-btn").isVisible()) { await page.tap("#nav-open-btn"); await page.waitForTimeout(450); }
        await page.tap("#whiteboard-btn");
        await page.waitForURL(BOARD_URL, { timeout: 8000 });
        assert.deepStrictEqual(o.problems, []);
      } finally { await o.close(); }
    });
  }

  await scenario("console 1180x820: a tap whose click is dropped still opens a board", async () => {
    const o = await h.open({ seed: consoleSeed, width: 1180, height: 820, contextOptions: touchCtx });
    try {
      await o.page.waitForSelector("#total-summary", { state: "attached" });
      await o.page.waitForTimeout(500);
      await droppedClickTap(o.page, "#whiteboard-btn");
      await o.page.waitForURL(BOARD_URL, { timeout: 8000 });
      assert.deepStrictEqual(o.problems, []);
    } finally { await o.close(); }
  });

  await scenario("console 1180x820: after Back from a board, tapping Whiteboard opens another board", async () => {
    const o = await h.open({ seed: consoleSeed, width: 1180, height: 820, contextOptions: touchCtx });
    const { page } = o;
    try {
      await page.waitForSelector("#total-summary", { state: "attached" });
      await page.waitForTimeout(500);
      await page.tap("#whiteboard-btn");
      await page.waitForURL(BOARD_URL);
      const first = page.url().match(BOARD_URL)[1];
      await page.goBack();
      await page.waitForSelector("#whiteboard-btn", { state: "visible" });
      await page.waitForTimeout(500);
      await page.tap("#whiteboard-btn");
      await page.waitForURL(BOARD_URL, { timeout: 8000 });
      assert.notStrictEqual(page.url().match(BOARD_URL)[1], first, "a new board, not the first one");
    } finally { await o.close(); }
  });

  await scenario("console: a page restored from the back-forward cache re-enables Whiteboard", async () => {
    // iPad browsers restore the console exactly as it was left, mid-tap state and all.
    const o = await h.open({ seed: consoleSeed, width: 1180, height: 820, contextOptions: touchCtx });
    try {
      await o.page.waitForSelector("#total-summary", { state: "attached" });
      // app.js boots after sign-in; its project list rendering means its listeners are in place.
      await until(() => o.page.locator("#projects-root .project-section, #projects-root [data-project-id]").count(), "the console booted", 15000);
      const enabled = await o.page.evaluate(() => {
        const b = document.getElementById("whiteboard-btn");
        b.disabled = true;
        dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
        return !b.disabled;
      });
      assert.strictEqual(enabled, true, "Whiteboard is usable again after Back");
    } finally { await o.close(); }
  });

  // ── 2. The board ────────────────────────────────────────────────────────
  for (const [w, ht] of TABLETS) {
    await scenario(`board ${w}x${ht}: share, draw, colour, size, undo, pinch, move, reset, erase, dot, clear — by touch`, async () => {
      const o = await h.open({ seed: boardSeed, width: w, height: ht, hash: `whiteboard.html?b=${ID}&new=1`, contextOptions: { ...touchCtx, permissions: ["clipboard-read", "clipboard-write"] } });
      const { page } = o;
      try {
        await page.waitForSelector("#wb-share", { state: "visible" });
        // The sandbox has no Material Symbols font, so an icon would render as its
        // name ("center_focus_strong"); give each icon the glyph's real 22px box.
        await page.addStyleTag({ content: ".material-symbols-outlined{display:inline-block;width:1em;overflow:hidden;white-space:nowrap;color:transparent!important}" });

        // Every toolbar control fully on screen, without scrolling the bar.
        const off = await page.evaluate(() => [...document.querySelectorAll("#wb-toolbar button")].map((b) => {
          const r = b.getBoundingClientRect();
          return r.left < 0 || r.right > innerWidth || r.width < 40 || r.height < 40 ? `${b.id || b.title || b.dataset.tool} ${Math.round(r.left)}–${Math.round(r.right)} (${Math.round(r.width)}×${Math.round(r.height)})` : null;
        }).filter(Boolean));
        assert.deepStrictEqual(off, [], "toolbar controls off screen or under 40px");
        // The share panel sits below the bar and inside the window.
        const share = await page.evaluate(() => { const s = document.getElementById("wb-share").getBoundingClientRect(), b = document.getElementById("wb-toolbar").getBoundingClientRect(); return { below: s.top >= b.bottom, inside: s.left >= 0 && s.right <= innerWidth && s.bottom <= innerHeight }; });
        assert.deepStrictEqual(share, { below: true, inside: true }, "share panel placement");

        await page.tap("#wb-copy");
        await until(async () => /copied/i.test(await page.innerText("#wb-copy-msg")), "Link copied.");
        await page.tap("#wb-share-close");
        await page.waitForSelector("#wb-share", { state: "hidden" });

        // Auto-fit rescales the view as strokes land, and strokes store their size in world units;
        // switch it off so this scenario checks the stored size at a 1:1 view.
        await page.tap("#wb-fit");
        assert.strictEqual(await page.getAttribute("#wb-fit", "aria-pressed"), "false", "fit button toggles auto-fit off by touch");
        const cdp = await page.context().newCDPSession(page);
        const cx = w / 2, cy = ht / 2 + 40;

        // One finger draws a stroke in the default colour and size.
        await finger(cdp, [line(cx - 120, cy, cx + 120, cy + 30)]);
        await until(async () => (await saved(page)).length === 1, "one stroke saved");
        let s = (await saved(page))[0].data;
        assert.ok(s.pts.length >= 10, `stroke has its points (${s.pts.length})`);
        assert.strictEqual(s.color, COLORS[0]);

        // Colour 3 and the thick pen, chosen by tap, are what the next stroke uses.
        await page.tap("#wb-colors button:nth-child(3)");
        await page.tap("#wb-sizes button:nth-child(3)");
        await finger(cdp, [line(cx - 120, cy + 120, cx + 120, cy + 120)]);
        await until(async () => (await saved(page)).length === 2, "second stroke saved");
        s = (await saved(page))[1].data;
        assert.deepStrictEqual([s.color, s.size], [COLORS[2], SIZES[2]], "colour and size by tap");

        // Undo removes it.
        await page.tap("#wb-undo");
        await until(async () => (await deleted(page)).length === 1, "undo deletes the last stroke");

        // Two fingers pinch-zoom: no stroke, and the view zooms.
        const before = await page.$eval("#wb-canvas", (c) => c.style.backgroundSize);
        await finger(cdp, [line(cx - 40, cy, cx - 160, cy, 8), line(cx + 40, cy, cx + 160, cy, 8)]);
        await page.waitForTimeout(300);
        assert.strictEqual((await saved(page)).length, 2, "a pinch draws nothing");
        assert.notStrictEqual(await page.$eval("#wb-canvas", (c) => c.style.backgroundSize), before, "the pinch zoomed the view");

        // Move tool: a drag pans and draws nothing.
        await page.tap('.wb-tool[data-tool="pan"]');
        const pos = await page.$eval("#wb-canvas", (c) => c.style.backgroundPosition);
        await finger(cdp, [line(cx, cy, cx + 100, cy + 60, 8)]);
        await page.waitForTimeout(200);
        assert.strictEqual((await saved(page)).length, 2, "a Move drag draws nothing");
        assert.notStrictEqual(await page.$eval("#wb-canvas", (c) => c.style.backgroundPosition), pos, "the drag moved the view");

        // Reset view brings the drawing back into view at a sensible zoom.
        await page.tap("#wb-reset");
        await page.waitForTimeout(200);

        // Eraser: a finger drag across the first stroke removes it.
        await page.tap('.wb-tool[data-tool="eraser"]');
        const at = await page.evaluate(() => {
          const c = document.getElementById("wb-canvas");
          const m = getComputedStyle(c); // the view is in the grid offset/size the page sets
          const k = parseFloat(c.style.backgroundSize) / 24, [x, y] = c.style.backgroundPosition.split(" ").map(parseFloat);
          return { k, x, y, m: !!m };
        });
        const first = (await saved(page))[0].data.pts;
        const midX = first[Math.floor(first.length / 4) * 2] * at.k + at.x, midY = first[Math.floor(first.length / 4) * 2 + 1] * at.k + at.y;
        await finger(cdp, [line(midX, midY - 30, midX, midY + 30, 10)]);
        await until(async () => (await deleted(page)).length === 2, "the eraser deletes the stroke");

        // Pen again; a single tap leaves a dot.
        await page.tap('.wb-tool[data-tool="pen"]');
        await finger(cdp, [[[cx, cy - 150]]]);
        await until(async () => (await saved(page)).length === 3, "a tap saves a dot");

        // Clear asks first, then removes everything.
        await page.tap("#wb-clear");
        await page.waitForSelector("#wb-confirm", { state: "visible" });
        await page.tap("#wb-confirm-yes");
        await page.waitForSelector("#wb-confirm", { state: "hidden" });
        await until(async () => (await deleted(page)).length === 3, "clear deletes the rest");

        // Toolbar taps whose click the browser drops still work.
        await droppedClickTap(page, '.wb-tool[data-tool="eraser"]');
        await until(async () => (await page.getAttribute('.wb-tool[data-tool="eraser"]', "aria-pressed")) === "true", "dropped-click tap picks the eraser", 2000);
        await droppedClickTap(page, "#wb-share-open");
        await until(async () => page.locator("#wb-share").isVisible(), "dropped-click tap opens Share", 2000);

        assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true, "the page never scrolls");
        assert.deepStrictEqual(o.problems, []);
      } finally { await o.close(); }
    });
  }

  // ── 3. Toolbar layout at every width, desktop and phone too ──────────────
  for (const [w, ht, touch] of [[390, 844, true], [600, 900, true], [1024, 768, false], [1180, 800, false], [1280, 800, false], [1440, 900, false], [1920, 1080, false]]) {
    await scenario(`toolbar ${w}x${ht}: fits the window with no sideways scrolling; Share panel under it`, async () => {
      const o = await h.open({ seed: boardSeed, width: w, height: ht, hash: `whiteboard.html?b=${ID}&new=1`, contextOptions: touch ? touchCtx : {} });
      const { page } = o;
      try {
        await page.waitForSelector("#wb-share", { state: "visible" });
        await page.addStyleTag({ content: ".material-symbols-outlined{display:inline-block;width:1em;overflow:hidden;white-space:nowrap;color:transparent!important}" });
        await page.waitForTimeout(150);
        const r = await page.evaluate(() => {
          const bar = document.getElementById("wb-toolbar"), b = bar.getBoundingClientRect();
          const off = [...bar.querySelectorAll("button")].filter((x) => { const q = x.getBoundingClientRect(); return q.left < 0 || q.right > innerWidth || q.width < 40 || q.height < 40; }).map((x) => x.id || x.title);
          const s = document.getElementById("wb-share").getBoundingClientRect();
          const phone = innerWidth <= 640;
          return { off, scrolls: bar.scrollWidth > bar.clientWidth + 1, inside: b.left >= 0 && b.right <= innerWidth, share: phone ? s.bottom <= innerHeight + 1 : s.top >= b.bottom && s.right <= innerWidth };
        });
        assert.deepStrictEqual(r, { off: [], scrolls: false, inside: true, share: true });
        assert.deepStrictEqual(o.problems, []);
      } finally { await o.close(); }
    });
  }
} finally { await h.close(); }
console.log(`\nwhiteboard on tablets: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
