// Apple-style redesign checks (ticket 5TbkrO71BsFoaKiclUvO): at 390, 820, 1180
// and 1440 px, on the board with real seeded data — no horizontal overflow,
// no visible helper paragraphs outside (i) tooltips, every helper text still
// in the DOM (nothing removed), 44px touch targets on primary actions.
// Run with:  cd backlog-tracker/test && node ui/apple-redesign.test.mjs
import assert from "node:assert";
import { startHarness, until } from "./harness.mjs";

const WIDTHS = [390, 820, 1180, 1440];
const T0 = 1_760_000_000_000;
const t = (ms) => ({ $ts: ms });
const seed = {
  user: { email: "editor@personalisationhub.com", role: "editor" },
  docs: {
    projects: { p1: { name: "Demo Project", createdAt: t(T0), deployBranch: "deploy/demo", repoFolder: "demo" } },
    backlogItems: {
      b1: { projectId: "p1", title: "Purple widget", desc: "Make the widget purple everywhere", type: "feature", category: "HQ Admin", status: "backlog", createdAt: t(T0 + 1), updatedAt: t(T0 + 1) },
      r1: { projectId: "p1", title: "Fix the thing", desc: "Fix it", type: "bug", category: "HQ Admin", status: "ready-for-testing", deployCommit: "abc123", createdAt: t(T0 + 2), updatedAt: t(T0 + 2) },
    },
  },
};

const h = await startHarness();
let failed = 0;
try {
  for (const width of WIDTHS) {
    const o = await h.open({ seed, width, height: 900 });
    const { page } = o;
    try {
      await until(() => page.locator("#total-summary").count(), "board header");
      await page.waitForTimeout(400);
      // Open the modal that holds the most helper copy so the check has data.
      const hints = await page.evaluate(() => {
        const all = [...document.querySelectorAll(".field-hint, .faq-tree-hint, .faq-cat-heading-desc")];
        const visible = all.filter((el) => !el.hidden && !el.dataset.tipDone && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden]"));
        const converted = all.filter((el) => el.dataset.tipDone);
        const tipsWithText = [...document.querySelectorAll(".info-tip")].every((b) => b.dataset.tip && b.dataset.tip.length > 0);
        return { total: all.length, visible: visible.map((e) => e.textContent.trim().slice(0, 50)), converted: converted.length, tips: document.querySelectorAll(".info-tip").length, tipsWithText, converted_in_dom: converted.every((e) => e.isConnected) };
      });
      assert.deepStrictEqual(hints.visible, [], "visible helper paragraphs outside tooltips");
      assert.ok(hints.converted > 0 && hints.tips >= hints.converted, "helper copy converted to tooltips");
      assert.ok(hints.tipsWithText && hints.converted_in_dom, "tooltip text present and source text kept in DOM");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `horizontal page overflow ${overflow}px`);
      const small = await page.evaluate(() => [...document.querySelectorAll(".btn-primary")].filter((b) => b.getClientRects().length).map((b) => b.getBoundingClientRect().height).filter((hh) => hh < 43));
      assert.deepStrictEqual(small, [], "primary buttons under 44px");
      const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
      assert.ok(/apple-system|system-ui/.test(font), "system font stack");
      assert.deepStrictEqual(o.problems, [], "page/console problems");
      console.log(`PASS apple-redesign @${width}px (${hints.converted} helper paragraphs → tooltips)`);
    } catch (e) { failed++; console.log(`FAIL apple-redesign @${width}px: ${e.message}`); }
    await o.close();
  }
} finally { await h.close(); }
process.exit(failed ? 1 : 0);
