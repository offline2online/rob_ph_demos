// Click-through for the Concept Incubator, Releases and the system map, in the
// current console look, at desktop and phone width. A redesign had been
// reported as dropping these; this test is what stops that going unnoticed.
// Run with:  cd backlog-tracker/test && node ui/concepts-releases.test.mjs
import assert from "node:assert";
import { startHarness, until } from "./harness.mjs";

const WIDTHS = [1280, 390];
const T0 = 1_760_000_000_000;
const t = (ms) => ({ $ts: ms });
const seed = {
  user: { email: "editor@personalisationhub.com", role: "editor" },
  docs: {
    projects: { p1: { name: "Alpha", createdAt: t(T0) }, p2: { name: "Beta", createdAt: t(T0), releaseId: "r2" } },
    releases: {
      r1: { name: "October", version: "5.10", status: "draft", order: 1, conceptIds: ["c1"], createdAt: t(T0) },
      r2: { name: "Summer", version: "5.2", status: "draft", order: 2, conceptIds: [], createdAt: t(T0) },
    },
    concepts: {
      c1: { name: "Idea one", status: "active", description: "Short blurb for tooltips", createdAt: t(T0), updatedAt: t(T0 + 1) },
      c2: { name: "Idea two", status: "active", createdAt: t(T0), updatedAt: t(T0 + 2) },
      c3: { name: "Idea three", status: "active", createdAt: t(T0), updatedAt: t(T0 + 3) },
      c4: { name: "Already promoted", status: "promoted", promotedProjectId: "p2", createdAt: t(T0), updatedAt: t(T0 + 4) },
    },
    interfaces: { i1: { name: "Contract", projectIds: ["p1", "p2"], contentMd: "x", createdAt: t(T0), updatedAt: t(T0) } },
  },
};
// Release 5.2 holds idea two; 5.10 holds idea one (version order, not text order).
seed.docs.releases.r2.conceptIds = ["c2"];

const h = await startHarness();
let failed = 0;
const go = async (page, hash, sel) => {
  await page.evaluate((x) => { location.hash = x; }, hash);
  await page.waitForSelector(sel, { state: "visible" });
};
try {
  for (const width of WIDTHS) {
    const o = await h.open({ seed, width, height: width < 640 ? 800 : 900 });
    const { page } = o;
    try {
      // Concept Incubator: map, tiles, release numbers, promoted hidden.
      await go(page, "#concept-incubator", "#concept-incubator-page");
      await page.waitForSelector("#system-map-canvas svg", { state: "visible" });
      const tiles = await page.evaluate(() => [...document.querySelectorAll(".concept-card")].map((e) => ({ name: e.querySelector(".skill-card-name").textContent, num: (e.querySelector(".concept-release-num") || {}).textContent || "" })));
      assert.deepStrictEqual(tiles.map((x) => x.name), ["Idea two", "Idea one", "Idea three"], "earliest release first (5.2 before 5.10), unassigned last, promoted hidden");
      assert.deepStrictEqual(tiles.map((x) => x.num), ["5.2", "5.10", ""], "release number shown on the tile");
      const bigNum = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".concept-release-num")).fontSize));
      assert.ok(bigNum >= 28, `release number is large (${bigNum}px)`);

      // System map: nodes, release badge, Offsite/federation boxes, instant hover tip with the short description.
      const map = await page.evaluate(() => ({
        nodes: document.querySelectorAll("#system-map-canvas .sysmap-node").length,
        badges: [...document.querySelectorAll("#system-map-canvas .sysmap-node-release")].map((e) => e.textContent),
        names: [...document.querySelectorAll("#system-map-canvas .sysmap-node-name")].map((e) => e.textContent).join("|"),
      }));
      assert.ok(map.nodes > 10, "map draws the platform");
      assert.ok(/Offsite/.test(map.names) && /Federated PH/.test(map.names), "single Offsite box and Federated PH are on the map");
      assert.ok(map.badges.some((b) => b.includes("5.10")) && map.badges.some((b) => b.includes("5.2")), `release badges on the map: ${map.badges}`);
      const ideaNode = page.locator('#system-map-canvas [data-tip-node="c1"], #system-map-canvas [data-tip-node="concept:c1"]').first();
      await ideaNode.dispatchEvent("pointermove", { pointerType: "mouse", clientX: 200, clientY: 200 });
      await until(() => page.locator(".sysmap-tip:not([hidden])").count(), "hover tooltip appears with no delay", 1500);
      assert.ok((await page.locator(".sysmap-tip").innerText()).includes("Short blurb for tooltips"), "tooltip shows the concept's short description");
      for (const id of ["system-map-fit", "system-map-zoom-in", "system-map-zoom-out", "system-map-rearrange", "system-map-history-btn"]) {
        assert.ok(await page.locator(`#${id}`).count(), `map control #${id} present`);
      }

      // Short description is editable on the concept page and saved.
      await page.locator(".concept-card", { hasText: "Idea three" }).click();
      await page.waitForSelector("#concept-detail-page", { state: "visible" });
      await page.fill("#concept-description-input", "A fresh short description");
      await page.click("#concept-description-save");
      await until(async () => (await page.evaluate(() => window.__fbStub.writes)).some((w) => w.path === "concepts/c3" && JSON.stringify(w.data).includes("A fresh short description")), "description write");

      // Releases: open editor from the name, change, save, reopen; create new.
      await go(page, "#releases", "#releases-page");
      const order = await page.evaluate(() => [...document.querySelectorAll("#releases-table-body .release-edit-link")].map((e) => e.textContent));
      assert.deepStrictEqual(order, ["Summer", "October"], "releases listed in version order");
      await page.click('.release-edit-link[data-release-id="r1"]');
      await page.waitForSelector("#release-editor-backdrop", { state: "visible" });
      assert.strictEqual(await page.inputValue("#release-editor-version"), "5.10");
      await page.fill("#release-editor-version", "5.11");
      await page.check('#release-editor-projects input[value="p1"]');
      await page.check('#release-editor-concepts input[value="c3"]');
      await page.click("#release-editor-save");
      await page.waitForSelector("#release-editor-backdrop", { state: "hidden" });
      await page.click('.release-edit-link[data-release-id="r1"]');
      await page.waitForSelector("#release-editor-backdrop", { state: "visible" });
      assert.strictEqual(await page.inputValue("#release-editor-version"), "5.11", "version persisted");
      assert.ok(await page.isChecked('#release-editor-projects input[value="p1"]'), "project assignment persisted");
      assert.ok(await page.isChecked('#release-editor-concepts input[value="c3"]'), "concept assignment persisted");
      assert.ok(await page.isChecked('#release-editor-concepts input[value="c1"]'), "existing concept kept");
      await page.click("#release-editor-cancel");
      await page.click("#releases-add-btn");
      await page.waitForSelector("#release-editor-backdrop", { state: "visible" });
      assert.strictEqual(await page.textContent("#release-editor-title"), "New release");
      await page.fill("#release-editor-name", "Winter");
      await page.fill("#release-editor-version", "6.0");
      await page.click("#release-editor-save");
      await until(() => page.locator('#releases-table-body .release-edit-link', { hasText: "Winter" }).count(), "new release listed");

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `no sideways page scroll (${overflow}px)`);
      assert.deepStrictEqual(o.problems, [], "page/console problems");
      console.log(`PASS concepts-releases @${width}px`);
    } catch (err) {
      failed += 1;
      console.log(`FAIL concepts-releases @${width}px\n      ${err.message}`);
    }
    await o.close();
  }
} finally {
  await h.close();
}
process.exit(failed ? 1 : 0);
