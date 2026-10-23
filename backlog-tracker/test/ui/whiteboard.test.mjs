// Live whiteboard in Chromium against the REAL public/ files with the Firebase SDK stubbed:
// the Build menu's Whiteboard item (last, desktop sidebar and phone tab sheet) starts a board at
// whiteboard.html?b=<20-character id>; the board opens full screen with the Share panel showing and
// a working Copy link; drawing saves a stroke, the eraser and undo remove it, clear asks first; and
// a link that isn't a board id shows a message, not a blank canvas. Two windows syncing is the
// Firestore listener's job and is covered by the rules test, not here (the stub has one backend per page).
// Run with:  cd backlog-tracker/test && node ui/whiteboard.test.mjs
import assert from "node:assert";
import { startHarness, until } from "./harness.mjs";

const T0 = 1_760_000_000_000;
const t = (ms) => ({ $ts: ms });
const ID = "Ab3dEf6hIj9lMn2pQr5T";
const consoleSeed = {
  user: { email: "editor@personalisationhub.com", role: "editor" },
  docs: { projects: { p1: { name: "Demo Project", createdAt: t(T0), deployBranch: "deploy/demo", repoFolder: "demo" } } },
};
const boardSeed = { docs: { whiteboards: { [ID]: { shared: true, createdAt: t(T0) } } } };
const strokeWrites = async (page) => (await page.evaluate(() => window.__fbStub.writes)).filter((w) => w.path.includes("/strokes/"));

const h = await startHarness();
let failed = 0;
const fail = (what, err) => { failed++; console.error(`FAIL ${what}: ${err && err.message ? err.message : err}`); };
try {
  // 1. The Build menu, then the new board's address.
  for (const width of [1280, 390]) {
    const o = await h.open({ seed: consoleSeed, width, height: 800 });
    const { page } = o;
    try {
      await page.waitForSelector("#total-summary", { state: "attached" });
      if (width <= 640) await page.click('#tabbar .tab[data-tab="build"]');
      const last = await page.evaluate(() => [...document.querySelectorAll('[data-nav-group="build"] .nav-drawer-item')].pop().id);
      assert.strictEqual(last, "whiteboard-btn", "Whiteboard is the last Build item");
      const [board] = await Promise.all([page.context().waitForEvent("page"), page.click("#whiteboard-btn")]);
      await board.waitForURL(/whiteboard\.html\?b=[A-Za-z0-9]{20}&new=1$/);
      assert.ok(!/whiteboard\.html/.test(page.url()), "the console stays where it was; the board opens in a new tab");
      assert.deepStrictEqual(o.problems, [], `no problems at ${width}px`);
    } catch (e) { fail(`console nav at ${width}px`, e); }
    await o.close();
  }

  // 2. The board itself, desktop and phone.
  for (const width of [1280, 390]) {
    const o = await h.open({ seed: boardSeed, width, height: 800, hash: `whiteboard.html?b=${ID}&new=1`, contextOptions: { permissions: ["clipboard-read", "clipboard-write"] } });
    const { page } = o;
    try {
      await page.waitForSelector("#wb-share", { state: "visible" });
      const link = await page.inputValue("#wb-link");
      assert.ok(link.endsWith(`/whiteboard.html?b=${ID}`), `share link is the board's own address, got ${link}`);
      await page.click("#wb-copy");
      await until(async () => /copied/i.test(await page.innerText("#wb-copy-msg")), "Link copied.");
      if (width === 1280) assert.strictEqual(await page.evaluate(() => navigator.clipboard.readText()), link, "clipboard holds the link");
      // The logo is top left, links back to the console, and never overlaps the tool bar.
      assert.strictEqual(await page.getAttribute("#wb-home", "href"), "./", "logo links to the console");
      const logo = await page.locator("#wb-home").boundingBox(), bar = await page.locator("#wb-toolbar").boundingBox();
      assert.ok(logo.x < 40 && logo.y < 40, "logo is in the top left corner");
      assert.ok(logo.x + logo.width <= bar.x || logo.y + logo.height <= bar.y, "logo does not overlap the tool bar");
      await page.click("#wb-share-close");
      await page.waitForSelector("#wb-share", { state: "hidden" });
      await page.click("#wb-share-open");
      await page.waitForSelector("#wb-share", { state: "visible" });
      await page.click("#wb-share-close");

      // Draw: a stroke is saved. Auto-fit would rescale the view under the pointer as strokes land, so switch it off.
      await page.click("#wb-fit");
      const box = await page.locator("#wb-canvas").boundingBox();
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2 + 60;
      await page.mouse.move(cx - 60, cy); await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(cx - 60 + i * 10, cy + (i % 3) * 8);
      await page.mouse.up();
      await until(async () => (await strokeWrites(page)).length === 1, "one saved stroke");
      const saved = (await strokeWrites(page))[0].data;
      assert.ok(saved.pts.length >= 6 && saved.color === "#232628", "stroke has points and the default colour");

      // Undo removes it.
      await page.click("#wb-undo");
      await until(async () => (await strokeWrites(page)).some((w) => w.op === "delete"), "undo deletes the stroke");

      // Draw again, erase it by dragging across.
      await page.mouse.move(cx - 60, cy); await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(cx - 60 + i * 10, cy);
      await page.mouse.up();
      await until(async () => (await strokeWrites(page)).filter((w) => w.op !== "delete").length === 2, "second stroke");
      await page.click('.wb-tool[data-tool="eraser"]');
      await page.mouse.move(cx, cy - 20); await page.mouse.down(); await page.mouse.move(cx, cy + 20, { steps: 5 }); await page.mouse.up();
      await until(async () => (await strokeWrites(page)).filter((w) => w.op === "delete").length === 2, "eraser deletes the stroke");

      // Clear asks first.
      await page.click("#wb-clear");
      await page.waitForSelector("#wb-confirm", { state: "visible" });
      await page.click("#wb-confirm-no");
      await page.waitForSelector("#wb-confirm", { state: "hidden" });

      // Zoom and reset do not throw.
      await page.mouse.move(cx, cy);
      await page.keyboard.down("Control"); await page.mouse.wheel(0, -200); await page.keyboard.up("Control");
      // Zoom buttons switch auto-fit off; Reset view and the fit button switch it back on.
      await page.click("#wb-reset");
      assert.strictEqual(await page.getAttribute("#wb-fit", "aria-pressed"), "true", "Reset view turns auto-fit on");
      await page.click("#wb-zoom-in");
      assert.strictEqual(await page.getAttribute("#wb-fit", "aria-pressed"), "false", "zoom in turns auto-fit off");
      await page.click("#wb-zoom-out");
      await page.click("#wb-fit");
      assert.strictEqual(await page.getAttribute("#wb-fit", "aria-pressed"), "true", "fit button turns auto-fit on");
      await page.click("#wb-zoom-out");
      await page.click("#wb-reset");
      assert.strictEqual(await page.getAttribute("#wb-fit", "aria-pressed"), "true", "Reset view turns auto-fit on");
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways scroll");
      assert.deepStrictEqual(o.problems, [], `no problems on the board at ${width}px`);
    } catch (e) { fail(`board at ${width}px`, e); }
    await o.close();
  }

  // 3. Links that are not boards.
  for (const bad of ["whiteboard.html?b=nonsense", "whiteboard.html", `whiteboard.html?b=${"Z".repeat(20)}`]) {
    const o = await h.open({ seed: boardSeed, width: 1280, height: 800, hash: bad });
    try {
      await o.page.waitForSelector("#wb-error", { state: "visible" });
      assert.match(await o.page.innerText("#wb-error"), /isn't valid/);
      assert.strictEqual(await o.page.locator("#wb-ui").isVisible(), false, "no tools on a bad link");
      assert.deepStrictEqual(o.problems, []);
    } catch (e) { fail(`bad link ${bad}`, e); }
    await o.close();
  }
} finally { await h.close(); }
if (failed) { console.error(`${failed} whiteboard scenario(s) failed`); process.exit(1); }
console.log("whiteboard: all scenarios passed");
