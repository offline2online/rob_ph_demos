// Support › Documentation (#documentation), in Chromium with the Firebase SDK
// stubbed: the menu item under Help Centre, the section tree nested three
// deep, a section's folders and documents, search across every document's
// text, opening a document read-only in the shared article editor with the
// website-only fields hidden, saving it back to docArticles (never
// faqArticles), the Help Centre editor still showing its own fields
// afterwards, a viewer getting no write controls, and no sideways scroll.
// Run with:  cd backlog-tracker/test && node ui/run-ui.mjs ui/documentation.test.mjs
import assert from "node:assert";
import { startHarness, until } from "./harness.mjs";

const t = (ms) => ({ $ts: ms });
const T0 = Date.now() - 86400000;
const docs = {
  projects: { p1: { name: "Demo Project", createdAt: t(T0) } },
  docCategories: {
    arch: { name: "Architecture & Solution Design", icon: "integration_instructions", order: 1, description: "How the platform fits together." },
    prod: { name: "Product & Roadmap", icon: "map", order: 0 },
    sdd: { name: "Solution Design Document", icon: "folder", parentId: "arch", order: 0 },
    app: { name: "Appendices", icon: "folder", parentId: "sdd", order: 0 },
    arc: { name: "Archive", icon: "inventory_2", order: 9 },
  },
  docArticles: {
    d1: { title: "Future release planning", categoryId: "prod", slug: "future", status: "published", order: 0, docType: "explanation", bodyMd: "<h2>2026 priorities</h2><p>Launch GenAI campaigns.</p>", source: { system: "confluence", path: "Personalisation Hub Platform", lastUpdated: "2026-03-20" } },
    d2: { title: "Solution design overview", categoryId: "sdd", slug: "sdd", status: "published", order: 0, docType: "reference", needsReview: true, bodyMd: "<p>EKS cluster in the client's VPC.</p><div class=\"faq-table\"><table><thead><tr><th>Service</th></tr></thead><tbody><tr><td>Redis</td></tr></tbody></table></div>" },
    d3: { title: "Appendix A - IP white-listing", categoryId: "app", slug: "app-a", status: "published", order: 0, bodyMd: "<pre class=\"ql-syntax\">allow 10.0.0.0/8</pre>" },
    d4: { title: "Optus deployment 2019", categoryId: "arc", slug: "optus", status: "published", order: 0, bodyMd: "<p>Legacy AEM screens.</p>", source: { archived: true, lastUpdated: "2019-03-18" } },
  },
  faqArticles: { f1: { status: "published", title: "Add a display", categoryId: "fc", slug: "add-display", bodyMd: "<p>Open Displays.</p>", order: 0, programId: "" } },
  faqCategories: { fc: { name: "Getting started", icon: "help", order: 0 } },
};
const seedFor = (role) => ({ user: { email: `${role}@ph.example`, role }, docs });
const writes = (page, re) => page.evaluate((src) => globalThis.__fbStub.writes.filter((w) => new RegExp(src).test(w.path)).map((w) => w.path), re.source);

const h = await startHarness();
let failed = 0;
const run = async (label, opts, fn) => {
  const o = await h.open(opts);
  try {
    await fn(o.page, o);
    assert.deepStrictEqual(o.problems.filter((p) => !/unrouted host/.test(p)), [], "page/console problems");
    console.log(`PASS documentation ${label}`);
  } catch (e) { failed++; console.log(`FAIL documentation ${label}: ${e.message}`); }
  await o.close();
};

try {
  for (const width of [390, 1280]) {
    await run(`browse, search, read and save @${width}px`, { seed: seedFor("editor"), width, height: 900, hash: "#documentation" }, async (page) => {
      await until(() => page.locator("#doc-tree .doc-tree-row").count(), "the section tree", 15000);
      const nav = await page.evaluate(() => [...document.querySelectorAll('[data-nav-group="publish"] .nav-drawer-item')].map((b) => [b.id, b.getAttribute("aria-current")]));
      assert.deepStrictEqual(nav, [["support-inbox-btn", null], ["faq-articles-btn", null], ["documentation-btn", "page"]]);
      // Top-level sections in order; the first is selected and shows its document.
      assert.deepStrictEqual((await page.locator("#doc-tree .doc-tree-row .faq-tree-name").allTextContents()), ["Product & Roadmap", "Architecture & Solution Design", "Archive"]);
      assert.deepStrictEqual(await page.locator("#doc-list .doc-row-title span:last-child").allTextContents(), ["Future release planning"]);
      assert.ok((await page.textContent("#doc-count")).startsWith("4 documents, 1 need review"));
      // A section holding only a folder lists the folder; three levels deep works.
      await page.click('#doc-tree [data-doc-cat="arch"]');
      await until(() => page.locator('#doc-list .doc-subfolder[data-doc-cat="sdd"]').count(), "the folder card");
      await page.click('#doc-list [data-doc-cat="sdd"]');
      await page.click('#doc-list [data-doc-cat="app"]');
      assert.deepStrictEqual(await page.locator("#doc-list .doc-row-title span:last-child").allTextContents(), ["Appendix A - IP white-listing"]);
      assert.strictEqual(await page.textContent("#doc-breadcrumb"), "Architecture & Solution Design › Solution Design Document › Appendices");
      assert.strictEqual(await page.locator('#doc-tree [data-doc-cat="app"]').count(), 1, "the tree opened down to it");
      // Search reaches body text in every section, and shows where each hit sits.
      await page.fill("#doc-search", "redis");
      assert.deepStrictEqual(await page.locator("#doc-list .doc-row-title span:last-child").allTextContents(), ["Solution design overview"]);
      assert.ok((await page.textContent("#doc-list .faq-article-row-meta")).includes("Architecture & Solution Design › Solution Design Document"));
      await page.fill("#doc-search", "");
      await page.selectOption("#doc-status-filter", "needs-review");
      assert.deepStrictEqual(await page.locator("#doc-list .doc-row-title span:last-child").allTextContents(), ["Solution design overview"]);
      await page.selectOption("#doc-status-filter", "all");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `no sideways scroll (${overflow}px)`);
      // Open a document: read mode, the Help Centre's editor, website-only fields hidden.
      await page.click('#doc-tree [data-doc-cat="prod"]');
      await page.click('[data-doc-open="d1"]');
      await until(() => page.evaluate(() => !document.getElementById("faq-article-editor-page").hidden && location.hash === "#doc/d1"), "the document");
      await until(() => page.evaluate(() => !document.getElementById("fa-body-viewer").hidden && document.getElementById("fa-body-viewer").textContent.includes("Launch GenAI")), "read mode");
      assert.strictEqual(await page.textContent("#fa-title"), "Edit document");
      assert.ok((await page.textContent("#fa-doc-source")).includes("last updated there 2026-03-20"));
      const hidden = await page.evaluate(() => [...document.querySelectorAll("#faq-article-editor-page [data-faq-only]")].every((el) => !el.getClientRects().length));
      assert.ok(hidden, "SEO and Hide from website are not offered on a document");
      const opts = await page.evaluate(() => [...document.querySelectorAll("#fa-category-select option")].map((o) => o.value));
      assert.deepStrictEqual(opts, ["prod", "arch", "sdd", "app", "arc"], "every section, nested, in tree order");
      // Edit and save: written to docArticles, no program required.
      await page.click("#fa-body-mode-edit");
      await page.fill("#fa-title-input", "Future release planning (2026)");
      await page.click("#fa-save-draft");
      await until(() => writes(page, /^docArticles\/d1$/).then((w) => w.length > 0), "the save");
      assert.deepStrictEqual(await writes(page, /^faqArticles\//), [], "nothing written to the Help Centre");
      // Cancel returns to Documentation, at the document's section.
      await page.click("#fa-cancel");
      await until(() => page.evaluate(() => location.hash === "#documentation" && !document.getElementById("documentation-page").hidden), "back to Documentation");
      // The Help Centre editor still has its own fields.
      await page.evaluate(() => { location.hash = "#faq-article/f1"; });
      await until(() => page.evaluate(() => !document.getElementById("faq-article-editor-page").hidden && document.getElementById("fa-title-input").value === "Add a display"), "the FAQ article");
      const faqVisible = await page.evaluate(() => [...document.querySelectorAll("#faq-article-editor-page .fa-group[data-faq-only]")].every((el) => el.getClientRects().length > 0));
      assert.ok(faqVisible, "SEO group back for a Help Centre article");
      assert.strictEqual(await page.textContent("#fa-title"), "Edit article");
    });
  }
  await run("cold load straight into a document", { seed: seedFor("editor"), width: 1280, height: 900, hash: "#doc/d3" }, async (page) => {
    await until(() => page.evaluate(() => !document.getElementById("faq-article-editor-page").hidden && document.getElementById("fa-title-input").value === "Appendix A - IP white-listing"), "the document", 15000);
  });
  await run("viewer: read only", { seed: seedFor("viewer"), width: 1280, height: 900, hash: "#documentation" }, async (page) => {
    await until(() => page.locator("#doc-tree .doc-tree-row").count(), "the section tree", 15000);
    const visibleWrites = await page.evaluate(() => [...document.querySelectorAll("#doc-new-category-btn, #doc-new-article-btn, [data-doc-edit], [data-doc-add-sub]")].filter((el) => el.getClientRects().length).length);
    assert.strictEqual(visibleWrites, 0, "no write controls for a viewer");
  });
} finally {
  await h.close();
}
if (failed) { console.log(`${failed} documentation case(s) failed`); process.exit(1); }
console.log("documentation: ok");
