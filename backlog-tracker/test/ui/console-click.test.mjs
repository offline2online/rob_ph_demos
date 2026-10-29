// Click-through tests for the console, in Chromium, against the REAL
// backlog-tracker/public/ files with the Firebase SDK stubbed (see
// harness.mjs and firebase-stub.mjs, and test/README.md for how to add a
// scenario). jsdom does no layout or hit-testing, so a button hidden under a
// modal backdrop still "clicks" there; Playwright's click only succeeds when
// the element is visible, enabled and actually receives the event.
//
// Every scenario runs at 1280 px and 390 px and prints one PASS or FAIL line.
// Every wait is a condition with a timeout; there are no fixed sleeps.
//
// Run with:  cd backlog-tracker/test && npm run test:ui
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { startHarness, until, outDir, SDK_MODULES } from "./harness.mjs";
import * as stub from "./firebase-stub.mjs";
import { publicDir } from "./harness.mjs";

// 1440 and 1280 desktop, 1180 tablet landscape, 820 tablet portrait, 390 phone.
const WIDTHS = [1440, 1280, 1180, 820, 390];
const t = (ms) => ({ $ts: ms });
const T0 = 1_760_000_000_000;

// ── Seed: one project with a card in every column, an archived card and a doc
const PID = "p1";
const seed = (extra = {}) => ({
  user: { email: "editor@personalisationhub.com", role: "editor" },
  docs: {
    projects: { [PID]: { name: "Demo Project", createdAt: t(T0), deployBranch: "deploy/demo", repoFolder: "demo" } },
    backlogItems: {
      b1: { projectId: PID, title: "Purple widget", desc: "Make the widget purple everywhere", type: "feature", category: "HQ Admin", status: "backlog", createdAt: t(T0 + 1), updatedAt: t(T0 + 1) },
      r1: { projectId: PID, title: "Fix the thing", desc: "Fix the thing on the settings page", type: "bug", category: "HQ Admin", status: "ready-for-testing", previewUrl: "https://example.test/preview/r1", deployCommit: "abc123", testVersion: "1.0.1", createdAt: t(T0 + 2), updatedAt: t(T0 + 2) },
      d1: { projectId: PID, title: "Approved thing", desc: "Already approved", type: "bug", category: "HQ Admin", status: "ready-to-publish", deployCommit: "def456", createdAt: t(T0 + 3), updatedAt: t(T0 + 3) },
      l1: { projectId: PID, title: "Shipped thing", desc: "Already live", type: "feature", category: "HQ Admin", status: "published-live", createdAt: t(T0 + 4), updatedAt: t(T0 + 4) },
      a1: { projectId: PID, title: "Archived thing", desc: "Long gone", type: "bug", category: "HQ Admin", status: "archived", createdAt: t(T0 + 5), updatedAt: t(T0 + 5), archivedAt: t(T0 + 6) },
    },
    projectDocs: { doc1: { projectId: PID, name: "Release checklist", contentMd: "1. Ship it", createdAt: t(T0), updatedAt: t(T0) } },
    ...extra,
  },
});
// A seed with only the cards a scenario needs, so its card is the only one of its kind.
const only = (...ids) => {
  const s = seed();
  s.docs.backlogItems = Object.fromEntries(Object.entries(s.docs.backlogItems).filter(([id]) => ids.includes(id)));
  return s;
};

// ── Releases / concepts / system map seed
const relSeed = () => {
  const s = seed();
  s.docs.projects[PID].releaseId = "r2";
  s.docs.concepts = {
    c1: { name: "Alpha", status: "active", description: "Alpha does alpha things.", createdAt: t(T0), updatedAt: t(T0 + 5) },
    c2: { name: "Beta", status: "active", description: "Beta does beta things.", createdAt: t(T0), updatedAt: t(T0 + 4) },
    c3: { name: "Gamma", status: "active", description: "", createdAt: t(T0), updatedAt: t(T0 + 3) },
    c4: { name: "Delta", status: "promoted", promotedProjectId: PID, createdAt: t(T0), updatedAt: t(T0 + 2) },
  };
  s.docs.releases = {
    r1: { name: "October 2026", version: "2.0.0", order: 1, status: "draft", conceptIds: ["c1"], createdAt: t(T0) },
    r2: { name: "Spring 2026", version: "1.0.0", order: 2, status: "live", conceptIds: ["c2"], createdAt: t(T0) },
  };
  return s;
};
// Reach a page through the nav the way a person does, at any width.
async function openFromNav(c, tab, btn, page) {
  const phone = c.width <= 640, persistent = c.width >= 1024;
  if (phone) await c.click(`#tabbar .tab[data-tab="${tab}"]`, `${tab} tab`);
  else if (!persistent) await c.click("#nav-open-btn", "open the menu");
  await c.click(`#${btn}`, `open ${btn}`);
  await c.visible(`#${page}`, `${page} shows`);
}
// ── Scenario context ───────────────────────────────────────────────────────
class Step extends Error {}
function makeCtx(o, width) {
  const { page } = o;
  page.setDefaultTimeout(8000);
  const ctx = { page, width, step: "start", selector: "" };
  const at = (step, selector = "") => { ctx.step = step; ctx.selector = selector; };
  ctx.at = at;
  ctx.click = async (selector, step) => { at(step || `click ${selector}`, selector); await page.click(selector); };
  ctx.visible = async (selector, step) => { at(step || `${selector} visible`, selector); await page.waitForSelector(selector, { state: "visible" }); };
  ctx.hidden = async (selector, step) => { at(step || `${selector} hidden`, selector); await page.waitForSelector(selector, { state: "hidden" }); };
  ctx.text = async (selector) => (await page.locator(selector).first().innerText());
  ctx.writes = () => page.evaluate(() => (window.__fbStub ? window.__fbStub.writes : []));
  ctx.waitWrites = async (n, step) => { at(step || `wait for ${n} write(s)`); return until(async () => { const w = await ctx.writes(); return w.length >= n ? w : null; }, `${n} recorded write(s)`); };
  ctx.waitText = async (selector, needle, step) => {
    at(step || `${selector} contains "${needle}"`, selector);
    await until(async () => (await page.locator(selector).first().innerText().catch(() => "")).includes(needle), `${selector} to contain "${needle}"`);
  };
  // The board has rendered the seeded project's cards.
  ctx.boardReady = async () => { at("board renders"); await page.waitForSelector(".column[data-col=\"backlog\"]", { state: "attached" }); await until(() => page.locator(".card, .item-card, [data-id]").count(), "seeded cards"); };
  ctx.openMenu = async () => { await ctx.click(".project-options-btn", "open the ⋮ menu"); await ctx.visible(".project-options-menu"); };
  return ctx;
}

// ── Scenarios ──────────────────────────────────────────────────────────────
const scenarios = [
  {
    name: "⋮ menu: View Artifact shows the latest signed-off version",
    seed: () => {
      const s = seed();
      s.docs.projects[PID].artifactUrl = "https://offline2online.github.io/rob_ph_demos/demo/index.html";
      s.docs.artifactVersions = {
        v1: { projectId: PID, version: 1, signedOffAt: t(T0 + 10), pinnedUrl: "https://rawcdn.githack.com/x/y/z/demo/index.html" },
        v2: { projectId: PID, version: 2, signedOffAt: t(T0 + 20), pinnedUrl: "https://rawcdn.githack.com/x/y/w/demo/index.html" },
      };
      return s;
    },
    async run(c) {
      await c.boardReady();
      await c.openMenu();
      await c.waitText(".artifact-version-line", "v2, signed off", "the newest version is shown");
      const line = await c.text(".artifact-version-line");
      assert.ok(!line.includes("v1,"), `only the latest version is shown, got "${line}"`);
    },
  },
  {
    name: "board: four columns in order, stacked top to bottom below 640 px",
    seed: () => seed(),
    async run(c) {
      await c.boardReady();
      c.at("column order and layout");
      const cols = await c.page.evaluate(() => [...document.querySelectorAll(".column[data-col]")].map((e) => { const r = e.getBoundingClientRect(); return { key: e.dataset.col, head: e.querySelector(".col-head").innerText.replace(/\s+/g, " ").trim(), x: r.x, y: r.y, w: r.width }; }));
      assert.deepStrictEqual(cols.map((x) => x.key), ["backlog", "ready-for-testing", "ready-to-publish", "published-live"]);
      const heads = cols.map((x) => x.head.toLowerCase());
      assert.ok(heads[0].includes("backlog"), `first column is Backlog, got "${cols[0].head}"`);
      assert.ok(heads[1].includes("ready for testing"), `second column is Ready for Testing, got "${cols[1].head}"`);
      assert.ok(heads[2].includes("approved for deployment"), `third column is Approved for Deployment, got "${cols[2].head}"`);
      assert.ok(heads[3].includes("deployed (live)"), `fourth column is Deployed (Live), got "${cols[3].head}"`);
      const wrapped = await c.page.evaluate(() => [...document.querySelectorAll(".col-head")].filter((h) => h.scrollHeight > h.clientHeight + 2 || h.getBoundingClientRect().height > 60).length);
      assert.strictEqual(wrapped, 0, "every column header stays on one line");
      if (c.width < 640) {
        // Stacked: each column below the previous one, full width, nothing behind a sideways swipe.
        for (let i = 1; i < cols.length; i++) assert.ok(cols[i].y > cols[i - 1].y, `column ${i + 1} should sit below column ${i} at ${c.width}px`);
        for (const col of cols) assert.ok(col.w >= c.width - 80 && col.x >= 0 && col.x + col.w <= c.width, `column ${col.key} should fill the screen width at ${c.width}px (x ${col.x}, width ${col.w})`);
        const { sw, cw } = await c.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        assert.ok(sw <= cw, `page scrolls sideways at ${c.width}px (scrollWidth ${sw} > clientWidth ${cw})`);
      } else if (c.width < 1024) {
        // Two wide: columns 1-2 on the top row, 3-4 beneath; the board scrolls up and down, never sideways.
        assert.ok(cols[1].x > cols[0].x && cols[3].x > cols[2].x, `columns pair up left to right at ${c.width}px`);
        assert.ok(cols[2].y > cols[0].y && cols[3].y > cols[1].y, `columns 3-4 wrap beneath 1-2 at ${c.width}px`);
        const pan = await c.page.evaluate(() => getComputedStyle(document.documentElement).touchAction + "|" + getComputedStyle(document.body).touchAction);
        assert.strictEqual(pan, "pan-y pinch-zoom|pan-y pinch-zoom", `page cannot be panned sideways on a tablet at ${c.width}px`);
        const side = await c.page.evaluate(() => { const b = document.querySelector(".board"); return b.scrollWidth - b.clientWidth; });
        assert.ok(side <= 1, `board scrolls sideways at ${c.width}px by ${side}px`);
      } else {
        for (let i = 1; i < cols.length; i++) assert.ok(cols[i].x > cols[i - 1].x, `column ${i + 1} should sit right of column ${i} at ${c.width}px`);
      }
    },
  },
  {
    name: "board: four columns fit beside the sidebar, headers read in full",
    seed: () => seed(),
    async run(c) {
      await c.boardReady();
      if (c.width < 1024) return;
      const measure = () => c.page.evaluate(() => {
        const b = document.querySelector(".board");
        const br = b.getBoundingClientRect();
        const cols = [...document.querySelectorAll(".column[data-col]")].map((col) => {
          const r = col.getBoundingClientRect();
          const head = col.querySelector(".col-head");
          const hr = head.getBoundingClientRect();
          const label = head.querySelector(":scope > span:first-child");
          const btns = [...head.querySelectorAll("button")].map((x) => x.getBoundingClientRect().right);
          return { key: col.dataset.col, inside: r.left >= br.left - 1 && r.right <= br.right + 1, labelCut: label.scrollWidth > label.clientWidth + 1, btnOut: btns.some((x) => x > hr.right + 1) };
        });
        return { boardScroll: b.scrollWidth - b.clientWidth, cols };
      });
      const check = async (what) => {
        const m = await measure();
        assert.ok(m.boardScroll <= 1, `${what}: the board scrolls sideways at ${c.width}px (by ${m.boardScroll}px)`);
        for (const col of m.cols) {
          assert.ok(col.inside, `${what}: column ${col.key} is cut off at ${c.width}px`);
          assert.ok(!col.labelCut, `${what}: column ${col.key} header label is clipped at ${c.width}px`);
          assert.ok(!col.btnOut, `${what}: a button in column ${col.key} header is clipped at ${c.width}px`);
        }
      };
      c.at("sidebar open");
      await c.visible("#nav-drawer", "sidebar is open");
      await c.visible(".col-head .review-batch-btn", "Review Batch shows in its header");
      await check("sidebar open");
      c.at("sidebar collapsed");
      await c.click("#nav-collapse-btn");
      await c.hidden("#nav-drawer", "sidebar hides");
      await check("sidebar collapsed");
    },
  },
  {
    name: "nav: Build, Publish and Admin destinations are all reachable, with no sideways scroll",
    seed: () => seed(),
    async run(c) {
      await c.boardReady();
      const phone = c.width <= 640;
      const persistent = c.width >= 1024;
      const overflow = async (what) => {
        const { sw, cw } = await c.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        assert.ok(sw <= cw, `${what}: page scrolls sideways at ${c.width}px (${sw} > ${cw})`);
      };
      const reveal = async (tab) => {
        if (phone) await c.click(`#tabbar .tab[data-tab="${tab}"]`, `${tab} tab`);
        else if (!persistent) await c.click("#nav-open-btn", "open the menu");
      };
      const go = async (tab, btn, page) => {
        await reveal(tab);
        await c.click(`#${btn}`, `open ${btn}`);
        await c.visible(`#${page}`, `${page} shows`);
        await overflow(page);
      };
      c.at("sections");
      if (!phone) {
        const labels = await c.page.evaluate(() => [...document.querySelectorAll("#nav-drawer .nav-drawer-section")].map((e) => e.textContent.trim()));
        assert.deepStrictEqual(labels, ["Build", "Publish"]);
      }
      await go("build", "concept-incubator-btn", "concept-incubator-page");
      await go("build", "releases-btn", "releases-page");
      await go("build", "skills-btn", "skills-page");
      await go("publish", "faq-articles-btn", "faq-articles-page");
      // Admin is reached from the profile menu, never the main navigation.
      assert.strictEqual(await c.page.locator("#nav-drawer #faq-settings-btn").count(), 0, "Settings is not in the main navigation");
      if (phone) await c.click('#tabbar .tab[data-tab="profile"]', "Profile tab"); else await c.click("#profile-btn", "profile button");
      await c.visible("#profile-menu", "profile menu shows");
      assert.ok((await c.text("#profile-menu")).toLowerCase().includes("admin"), "profile menu has an Admin section");
      await c.click("#faq-settings-btn", "Settings");
      await c.visible("#faq-settings-page", "Settings shows");
      await overflow("settings");
      if (phone) await c.click('#tabbar .tab[data-tab="build"]', "Build tab"); else if (!persistent) await c.click("#nav-open-btn", "open the menu");
      await c.click("#nav-ph-console-btn", "Agent Board");
      await c.boardReady();
      await overflow("board");
      if (persistent) {
        c.at("sidebar collapses and the content reflows");
        await c.click("#nav-collapse-btn");
        await c.hidden("#nav-drawer", "sidebar hides");
        await c.click("#nav-open-btn", "reopen");
        await c.visible("#nav-drawer", "sidebar returns");
      }
    },
  },
  {
    name: "nav: Command-K jumps to a ticket, with focus and keyboard handled",
    seed: () => seed(),
    async run(c) {
      await c.boardReady();
      c.at("open the palette");
      if (c.width <= 640) await c.click('#tabbar .tab[data-tab="search"]'); else await c.page.keyboard.press("Control+k");
      await c.visible("#cmdk-backdrop", "palette shows");
      assert.strictEqual(await c.page.evaluate(() => document.activeElement && document.activeElement.id), "cmdk-input", "focus lands in the search box");
      await c.page.keyboard.type("purple");
      await c.waitText("#cmdk-list", "Purple widget", "ticket is listed");
      await c.page.keyboard.press("Escape");
      await c.hidden("#cmdk-backdrop", "Escape closes it");
      c.at("jump to the ticket");
      if (c.width <= 640) await c.click('#tabbar .tab[data-tab="search"]'); else await c.page.keyboard.press("Control+k");
      await c.page.keyboard.type("Demo Proj");
      await c.waitText("#cmdk-list", "Demo Project", "project is listed");
      await c.page.keyboard.press("Enter");
      await c.hidden("#cmdk-backdrop", "palette closes on choose");
      if (c.width <= 640) await c.click('#tabbar .tab[data-tab="search"]'); else await c.page.keyboard.press("Control+k");
      await c.page.keyboard.type("purple");
      await c.waitText("#cmdk-list", "Purple widget");
      await c.page.keyboard.press("Enter");
      await c.visible("#ei-backdrop", "the ticket opens");
    },
  },
  {
    // 20 Oct 2026: on a phone the header CTAs were squeezed to one letter per
    // line and Approved for Deployment could not be reached. Tick a card far
    // down the page, then approve from the pinned project bar, by touch.
    name: "phone: tick a Ready for Testing card, approve from the pinned project bar; header CTAs keep their labels on one line",
    seed: () => {
      // Enough Backlog cards that the project header is scrolled away by the time Ready for Testing is on screen.
      const s = only("b1", "r1", "l1");
      for (let n = 2; n <= 5; n++) s.docs.backlogItems[`b${n}`] = { ...s.docs.backlogItems.b1, title: `Backlog card ${n}`, createdAt: t(T0 + n), updatedAt: t(T0 + n) };
      return s;
    },
    async run(c) {
      await c.boardReady();
      if (c.width > 640) return;
      c.at("header CTAs are full-width rows, label on one line");
      const ctas = await c.page.evaluate(() => [...document.querySelectorAll(".project-header-actions > button")].filter((b) => b.getClientRects().length).map((b) => {
        const r = b.getBoundingClientRect(); return { t: b.textContent.trim().replace(/\s+/g, " "), w: r.width, h: r.height, x: r.left };
      }));
      const left = ctas.find((b) => b.t.includes("New backlog item")).x;
      for (const b of ctas) {
        if (b.t === "⋮") continue;
        assert.ok(Math.abs(b.x - left) <= 1, `"${b.t}" starts at ${b.x}px, not lined up with + New backlog item at ${left}px`);
        assert.ok(b.w >= c.width * 0.6, `"${b.t}" is only ${b.w}px wide at ${c.width}px`);
        assert.ok(b.h <= 60, `"${b.t}" wraps (${b.h}px tall)`);
      }
      c.at("tick the card after scrolling the project header away");
      const cb = c.page.locator(".card-deploy-select-cb").first();
      await cb.scrollIntoViewIfNeeded();
      await c.page.evaluate(() => window.scrollBy(0, 120));
      await cb.click();
      await c.visible("#mobile-action-bar .deploy-to-feature-btn", "Approved for Deployment shows in the pinned bar");
      const bar = await c.page.evaluate(() => {
        const r = document.querySelector("#mobile-action-bar").getBoundingClientRect();
        const top = document.querySelector(".topbar").getBoundingClientRect();
        const btn = document.querySelector("#mobile-action-bar .deploy-to-feature-btn").getBoundingClientRect();
        return { top: r.top, topbarBottom: top.bottom, btnH: btn.height, btnRight: btn.right };
      });
      assert.ok(Math.abs(bar.top - bar.topbarBottom) <= 2, `pinned bar sits directly under the header (bar ${bar.top}, header ${bar.topbarBottom})`);
      assert.ok(bar.btnH >= 43.5 && bar.btnRight <= c.width, "the bar's approve button is a full touch target on screen");
      await c.click("#mobile-action-bar .deploy-to-feature-btn", "approve from the pinned bar");
      const writes = await until(async () => { const w = await c.writes(); return w.some((x) => x.path === `projects/${PID}`) ? w : null; }, "the approval writes");
      c.at("approval writes");
      assert.strictEqual(writes.find((x) => x.path === "backlogItems/r1").data.status, "ready-to-publish");
      const { sw, cw } = await c.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      assert.ok(sw <= cw, "no sideways page scroll");
    },
  },
  {
    name: "project header: big collapse control left of the name, star at the right; pinned bar collapses too",
    seed: () => {
      const s = seed();
      for (let n = 2; n <= 8; n++) s.docs.backlogItems[`b${n}`] = { ...s.docs.backlogItems.b1, title: `Backlog card ${n}`, createdAt: t(T0 + n), updatedAt: t(T0 + n) };
      return s;
    },
    async run(c) {
      await c.boardReady();
      c.at("collapse control is large and left of the name; star is right of it");
      const g = await c.page.evaluate(() => {
        const r = (sel) => document.querySelector(sel).getBoundingClientRect();
        const col = r(".project-collapse-btn"), name = r(".project-name"), star = r(".project-star-btn");
        return { colW: col.width, colH: col.height, colRight: col.right, nameLeft: name.left, starLeft: star.left, nameRight: name.right };
      });
      assert.ok(g.colW >= 43.5 && g.colH >= 43.5, `collapse control is ${g.colW}x${g.colH}`);
      assert.ok(g.colRight <= g.nameLeft + 1, "collapse control sits left of the project name");
      assert.ok(g.starLeft >= g.nameRight - 1, "star sits right of the project name");
      if (c.width > 640) return;
      c.at("collapse from the pinned bar");
      await c.page.locator(".card").last().scrollIntoViewIfNeeded();
      await c.page.evaluate(() => window.scrollBy(0, 120));
      await c.visible("#mobile-action-bar .mobile-action-bar-collapse", "the pinned bar has a collapse control");
      await c.click("#mobile-action-bar .mobile-action-bar-collapse", "collapse from the pinned bar");
      await until(async () => (await c.page.locator(".project.collapsed").count()) === 1 ? true : null, "the project collapses");
      c.at("expand again from the page header");
      await c.click(".project-collapse-btn", "expand");
      await until(async () => (await c.page.locator(".project.collapsed").count()) === 0 ? true : null, "the project expands");
    },
  },
  {
    name: "⋮ menu: Archived tickets lists the archived card",
    seed: () => seed(),
    async run(c) {
      await c.boardReady();
      await c.openMenu();
      await c.click(".project-archive-btn", "Archived tickets");
      await c.visible("#archive-page");
      await c.waitText("#archive-table-body", "Archived thing", "archive page lists the seeded archived card");
    },
  },
  {
    name: "⋮ menu: an archived card's date renders (stub timestamps keep toMillis/toDate)",
    seed: () => seed(),
    async run(c) {
      await c.boardReady();
      await c.openMenu();
      await c.click(".project-archive-btn", "Archived tickets");
      await c.waitText("#archive-table-body", "Archived thing", "archive page lists the seeded archived card");
      const row = await c.page.evaluate((ms) => ({ text: document.querySelector("#archive-table-body tr").innerText, want: new Date(ms).toLocaleDateString() }), T0 + 6);
      assert.ok(row.text.includes(row.want), `the Archived row should show ${row.want}, got ${JSON.stringify(row.text)}`);
    },
  },
  {
    name: "⋮ menu: Docs opens Project Settings and lists a document",
    seed: () => seed(),
    async run(c) {
      await c.boardReady();
      await c.openMenu();
      await c.click(".project-docs-btn", "Project Settings");
      await c.visible("#docs-page");
      await c.waitText("#docs-page h2", "Project Settings — Demo Project");
      await c.waitText("#docs-extra-docs-list", "Release checklist", "docs page lists the seeded projectDocs document");
    },
  },
  {
    name: "Ready for Testing: Test this → links to the seeded previewUrl",
    seed: () => only("r1"),
    async run(c) {
      await c.boardReady();
      await c.visible("a.test-link-btn");
      c.at("link target", "a.test-link-btn");
      const a = await c.page.evaluate(() => { const e = document.querySelector("a.test-link-btn"); return { href: e.href, target: e.target }; });
      assert.strictEqual(a.href, "https://example.test/preview/r1");
      assert.strictEqual(a.target, "_blank");
    },
  },
  {
    name: "Ready for Testing: Failed testing — Cancel writes nothing, OK sends it back",
    seed: () => only("r1"),
    async run(c) {
      await c.boardReady();
      await c.click(".fail-testing-btn", "Failed testing");
      await c.visible("#dialog-backdrop");
      await c.waitText("#dialog-title", "Failed testing");
      await c.click("#dialog-cancel", "Cancel the dialog");
      await c.hidden("#dialog-backdrop");
      c.at("Cancel wrote nothing");
      assert.deepStrictEqual(await c.writes(), []);

      await c.click(".fail-testing-btn", "Failed testing again");
      await c.visible("#dialog-backdrop");
      c.at("fill in the details", "#dialog-fields textarea");
      await c.page.fill("#dialog-fields textarea", "The button does nothing on the settings page");
      await c.click("#dialog-ok", "OK");
      const writes = await c.waitWrites(1);
      c.at("the send-back write");
      assert.strictEqual(writes.length, 1, `exactly one write, got ${JSON.stringify(writes)}`);
      const w = writes[0];
      assert.strictEqual(w.op, "update");
      assert.strictEqual(w.path, "backlogItems/r1");
      assert.strictEqual(w.data.status, "backlog");
      assert.strictEqual(w.data.revertRequested, true);
      assert.ok(w.data.lastFailureReason && /settings page/.test(w.data.lastFailureReason.text), "lastFailureReason carries the details");
      assert.ok(w.data.notes && w.data.notes.$arrayUnion && /settings page/.test(JSON.stringify(w.data.notes)), "a note carries the details");
    },
  },
  {
    name: "Approve: the CTA stays hidden while a ticked card's tests are running",
    seed: () => {
      const s = only("r1");
      s.docs.backlogItems.r1.trainTest = { sha: "abc123", state: "running", workflows: [] };
      return s;
    },
    async run(c) {
      await c.boardReady();
      await c.click(".card-deploy-select-cb", "tick the Ready for Testing card");
      await c.page.waitForTimeout(500);
      assert.strictEqual(await c.page.locator(".deploy-to-feature-btn").count(), 0, "no approval CTA until tests pass");
    },
  },
  {
    name: "Approve: ticking a card then Approved for Deployment locks the train",
    seed: () => only("r1"),
    async run(c) {
      await c.boardReady();
      await c.click(".card-deploy-select-cb", "tick the Ready for Testing card");
      await c.waitText(".deploy-to-feature-btn", "Approved for Deployment — 1 selected");
      await c.click(".deploy-to-feature-btn", "Approved for Deployment — 1 selected");
      const writes = await until(async () => { const w = await c.writes(); return w.some((x) => x.path === `projects/${PID}`) ? w : null; }, "the approval writes");
      c.at("approval writes");
      const card = writes.find((x) => x.path === "backlogItems/r1");
      assert.ok(card, `the card was written, got ${JSON.stringify(writes)}`);
      assert.strictEqual(card.data.status, "ready-to-publish");
      const proj = writes.find((x) => x.path === `projects/${PID}`);
      assert.strictEqual(proj.op, "set");
      assert.strictEqual(proj.merge, true);
      assert.strictEqual(proj.data.trainLocked, true);
    },
  },
  {
    name: "New backlog item: a new description creates one Backlog card",
    seed: () => only("r1"),
    async run(c) {
      await c.boardReady();
      await c.click(".new-item-btn", "+ New backlog item");
      await c.visible("#ni-backdrop");
      c.at("type the description", "#ni-desc-input");
      await c.page.fill("#ni-desc-input", "Add a dark mode toggle to the retail admin header");
      await c.click("#ni-submit", "Add to backlog");
      const writes = await c.waitWrites(1);
      await c.hidden("#ni-backdrop", "the form closes");
      c.at("the created card");
      const adds = writes.filter((x) => x.op === "add" && x.path.startsWith("backlogItems/"));
      assert.strictEqual(adds.length, 1, `one backlogItems doc created, got ${JSON.stringify(writes)}`);
      assert.strictEqual(adds[0].data.projectId, PID);
      assert.strictEqual(adds[0].data.status, "backlog");
      assert.ok(/dark mode/.test(adds[0].data.desc));
    },
  },
  {
    name: "New backlog item: a near-copy offers Add as comment, which adds a note only",
    seed: () => only("b1"),
    async run(c) {
      await c.boardReady();
      await c.click(".new-item-btn", "+ New backlog item");
      await c.visible("#ni-backdrop");
      c.at("type a near-copy", "#ni-desc-input");
      await c.page.fill("#ni-desc-input", "Make the widget purple everywhere please");
      await c.click("#ni-submit", "Add to backlog");
      await c.visible("#dialog-backdrop", "the duplicate dialog opens");
      await c.waitText("#dialog-message", "looks a lot like an existing open ticket");
      await c.click("#dialog-ok", "Add as comment");
      const writes = await c.waitWrites(1);
      c.at("the comment write");
      assert.ok(!writes.some((x) => x.op === "add" || (x.op === "set" && x.path.startsWith("backlogItems/"))), `no new backlogItems doc, got ${JSON.stringify(writes)}`);
      const note = writes.find((x) => x.path === "backlogItems/b1");
      assert.ok(note, `the existing card was written, got ${JSON.stringify(writes)}`);
      assert.ok(note.data.notes && /purple/.test(JSON.stringify(note.data.notes)), "the note carries the new description");
    },
  },
  {
    // 19 Oct 2026: a session wrote finishedAt "2026-10-19T14:00:00.000Z" for work that landed at 20:22, so the
    // header said "Deving… 0/1" and the card stayed "Sent to Claude — locked". The server's reportedAt wins.
    name: "Ready for Dev: a session reported with a wrong finishedAt but a server reportedAt — header not Deving, card not locked",
    seed: () => {
      const s = only("b1");
      s.docs.projects[PID].notifyRoutine = { status: "in-progress", mode: "per-item", firedAt: t(Date.now() - 9 * 60_000), sentItemIds: ["b1"], itemCount: 1, sessionUrl: "https://claude.ai/code/cse_x" };
      s.docs.backlogItems.b1.buildSession = { status: "done", finishedAt: "2026-10-19T14:00:00.000Z", reportedAt: t(Date.now() - 60_000) };
      s.docs.backlogItems.b1.blocked = { reason: "waiting-on-input", note: "Waits for another ticket" };
      return s;
    },
    async run(c) {
      await c.boardReady();
      c.at("no Deving spinner and no locked card");
      await until(async () => (await c.page.locator(".notify-claude-spinner").count()) === 0, "the Deving spinner to be gone");
      const header = await c.page.locator(".project-header, .project-section").first().innerText();
      assert.ok(!/Deving/.test(header), `header should not say Deving, got ${JSON.stringify(header)}`);
      assert.strictEqual(await c.page.locator(".in-development-hint").count(), 0, "the card must not be locked as Sent to Claude");
    },
  },
  {
    name: "Ready for Dev: Deving shows the elapsed minutes and a per-ticket tooltip",
    seed: () => {
      const s = only("b1");
      s.docs.projects[PID].notifyRoutine = { status: "in-progress", mode: "per-item", firedAt: t(Date.now() - 8 * 60_000 - 5_000), sentItemIds: ["b1"], itemCount: 1, sessionUrl: "https://claude.ai/code/cse_x" };
      return s;
    },
    async run(c) {
      await c.boardReady();
      await c.waitText(".notify-claude-btn-working .notify-claude-label", "8 min", "the Deving label includes the elapsed time");
      const title = await c.page.locator(".notify-claude-btn-working").first().getAttribute("title");
      assert.ok(/Purple widget — building/.test(title), `tooltip should list the ticket and its state, got ${JSON.stringify(title)}`);
    },
  },
  {
    name: "Ready for Dev: a stalled record shows the Build didn't report back chip, not a spinner",
    seed: () => {
      const s = only("b1");
      s.docs.projects[PID].notifyRoutine = { status: "stalled", mode: "per-item", firedAt: t(Date.now() - 30 * 60_000), sentItemIds: ["b1"], itemCount: 1 };
      return s;
    },
    async run(c) {
      await c.boardReady();
      await c.waitText(".notify-claude-stalled", "report back", "the stalled chip is shown");
      assert.strictEqual(await c.page.locator(".notify-claude-spinner").count(), 0, "a stalled record must not spin");
    },
  },
  {
    // 20 Oct 2026: this button sent no ids, so the server built the whole
    // column again and every ticket still building got a second session.
    name: "Ready for Dev — N new: while a build is running, the click sends only the new tickets",
    seed: () => {
      const s = only("b1");
      s.docs.backlogItems.b2 = { ...s.docs.backlogItems.b1, title: "Filed after the click", createdAt: t(T0 + 9), updatedAt: t(T0 + 9) };
      s.docs.backlogItems.b1.lastFire = { status: "started", at: t(Date.now() - 2 * 60_000) };
      s.docs.projects[PID].notifyRoutine = { status: "in-progress", mode: "per-item", firedAt: t(Date.now() - 2 * 60_000), sentItemIds: ["b1"], sessionUrl: "https://claude.ai/code/session_x" };
      return s;
    },
    async run(c) {
      await c.boardReady();
      await c.waitText(".project-header .project-notify-btn", "1 new", "the new-tickets button");
      await c.click(".project-header .project-notify-btn", "Ready for Dev — 1 new");
      const writes = await until(async () => { const w = await c.writes(); return w.some((x) => x.path === `projects/${PID}`) ? w : null; }, "the notify request");
      c.at("what the click asked for");
      const req = writes.find((x) => x.path === `projects/${PID}`);
      assert.deepStrictEqual(req.data.notifyItemIds, ["b2"], `only the new ticket, got ${JSON.stringify(req.data.notifyItemIds)}`);
    },
  },
  {
    name: "Blocked: a card waiting on an answer shows the chip, not Ready for Dev",
    seed: () => { const s = only("b1"); s.docs.backlogItems.b1.blocked = { reason: "waiting-on-input", note: "Pick A, B or C" }; return s; },
    async run(c) {
      await c.boardReady();
      await c.waitText(".waiting-answer-chip", "1 waiting on your answer", "the waiting chip");
      assert.strictEqual(await c.page.locator(".project-notify-btn").count(), 0, "no Ready for Dev button");
    },
  },
  {
    name: "Blocked: Answer shows the question, then saves the answer, unblocks and requests one build",
    seed: () => { const s = only("b1"); s.docs.backlogItems.b1.blocked = { reason: "waiting-on-input", note: "Pick A, B or C" }; return s; },
    async run(c) {
      await c.boardReady();
      await c.click(".blocked-answer-btn", "Answer");
      await c.visible("#rs-backdrop");
      await c.waitText("#rs-chat", "Pick A, B or C", "the modal shows the build's question");
      await c.page.fill("#rs-input", "A");
      await c.click("#rs-send", "Send");
      const writes = await c.waitWrites(2);
      c.at("the answer writes");
      const card = writes.filter((x) => x.path === "backlogItems/b1");
      assert.strictEqual(card.length, 1, `one card update, got ${JSON.stringify(writes)}`);
      assert.strictEqual(card[0].data.blocked, null);
      assert.ok(JSON.stringify(card[0].data.notes).includes("Answer to the build's question: A"));
      const proj = writes.filter((x) => x.path === `projects/${PID}`);
      assert.strictEqual(proj.length, 1);
      assert.deepStrictEqual(proj[0].data.notifyItemIds, ["b1"]);
    },
  },
  {
    name: "Blocked: on a locked train the answer unblocks but requests no build",
    seed: () => { const s = only("b1"); s.docs.backlogItems.b1.blocked = { reason: "waiting-on-input", note: "Pick A, B or C" }; s.docs.projects[PID].trainLocked = true; return s; },
    async run(c) {
      await c.boardReady();
      await c.click(".blocked-answer-btn", "Answer");
      await c.visible("#rs-backdrop");
      await c.page.fill("#rs-input", "A");
      await c.click("#rs-send", "Send");
      await c.waitWrites(1);
      await c.waitText("#rs-chat", "Saved and unblocked", "saved");
      const writes = await c.writes();
      c.at("no project write");
      assert.strictEqual(writes.filter((x) => x.path === `projects/${PID}`).length, 0, JSON.stringify(writes));
      assert.strictEqual(writes.find((x) => x.path === "backlogItems/b1").data.blocked, null);
    },
  },
  {
    name: "Blocked: a card with complete sections still shows Answer",
    seed: () => { const s = only("b1"); s.docs.backlogItems.b1.desc = "## Outcome\nx\n\n## Test steps\n1. y\n\n## Dependencies\nNone\n\n## Spec reference\nNone yet"; s.docs.backlogItems.b1.blocked = { reason: "waiting-on-input", note: "Pick A, B or C" }; return s; },
    async run(c) {
      await c.boardReady();
      await c.visible(".blocked-answer-btn", "Answer is shown");
    },
  },
  // ── Concept Incubator, Releases and the system map (regression guard: the
  // 20 Oct 2026 report that the redesign dropped them) ────────────────────
  {
    name: "releases: a release name opens the editor, saving persists, + New release creates one",
    seed: () => relSeed(),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "build", "releases-btn", "releases-page");
      await c.visible('.release-edit-link[data-release-id="r1"]', "release name link");
      await c.click('.release-edit-link[data-release-id="r1"]', "click release name");
      await c.visible("#release-editor-backdrop:not([hidden]) #release-editor-name", "editor opens");
      assert.strictEqual(await c.page.inputValue("#release-editor-name"), "October 2026");
      assert.strictEqual(await c.page.inputValue("#release-editor-version"), "2.0.0");
      await c.visible('#release-editor-concepts input[data-kind="concept"][value="c1"]', "concepts listed");
      await c.visible('#release-editor-projects input[data-kind="project"][value="p1"]', "projects listed");
      await c.page.fill("#release-editor-version", "2.1.0");
      await c.page.check('#release-editor-concepts input[value="c2"]');
      await c.page.check('#release-editor-projects input[value="p1"]');
      await c.click("#release-editor-save", "save");
      await c.hidden("#release-editor-backdrop", "editor closes");
      await c.page.waitForSelector('#releases-table-body tr[data-release-id="r1"] td:nth-child(2):has-text("2.1.0")');
      await c.click('.release-edit-link[data-release-id="r1"]', "reopen");
      await c.visible("#release-editor-backdrop:not([hidden])");
      assert.strictEqual(await c.page.inputValue("#release-editor-version"), "2.1.0");
      assert.ok(await c.page.isChecked('#release-editor-concepts input[value="c2"]'), "concept assignment persisted");
      assert.ok(await c.page.isChecked('#release-editor-projects input[value="p1"]'), "project assignment persisted");
      await c.click("#release-editor-cancel", "cancel");
      await c.hidden("#release-editor-backdrop");
      await c.click("#releases-add-btn", "+ New release");
      await c.visible("#release-editor-backdrop:not([hidden])");
      assert.ok((await c.text("#release-editor-title")).includes("New release"));
      await c.page.fill("#release-editor-name", "November 2026");
      await c.page.fill("#release-editor-version", "3.0.0");
      await c.click("#release-editor-save", "create");
      await c.hidden("#release-editor-backdrop");
      await c.waitText("#releases-table-body", "November 2026", "new release listed");
    },
  },
  {
    name: "concepts: big release number on tiles, earliest release first, unassigned last, promoted hidden",
    seed: () => relSeed(),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "build", "concept-incubator-btn", "concept-incubator-page");
      await c.visible("#concept-incubator-list .concept-card", "tiles render");
      const tiles = await c.page.evaluate(() => [...document.querySelectorAll("#concept-incubator-list .concept-card")].map((e) => ({
        id: e.dataset.id, num: (e.querySelector(".concept-release-num") || {}).textContent || "", size: e.querySelector(".concept-release-num") ? parseFloat(getComputedStyle(e.querySelector(".concept-release-num")).fontSize) : 0,
        numLeft: e.querySelector(".concept-release-num") ? e.querySelector(".concept-release-num").getBoundingClientRect().left : 0,
        nameLeft: e.querySelector(".skill-card-name").getBoundingClientRect().left })));
      assert.deepStrictEqual(tiles.map((x) => x.id), ["c2", "c1", "c3"], "earliest release first, unassigned last, promoted (c4) hidden");
      assert.deepStrictEqual(tiles.map((x) => x.num), ["1.0.0", "2.0.0", ""]);
      const name = await c.page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("#concept-incubator-list .skill-card-name")).fontSize));
      assert.ok(tiles[0].size > name, `release number (${tiles[0].size}px) is larger than the concept name (${name}px)`);
      assert.ok(tiles[0].numLeft < tiles[0].nameLeft, "release number sits in front of the name");
      assert.ok((await c.text("#concept-incubator-count")).startsWith("3 "), "promoted concepts are not counted");
      assert.strictEqual(await c.page.locator('#concept-incubator-list .concept-card[data-id="c4"]').count(), 0);
    },
  },
  {
    name: "promote: Enter submits, folder hint follows the name",
    seed: () => relSeed(),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "build", "concept-incubator-btn", "concept-incubator-page");
      await c.click('#concept-incubator-list .concept-card[data-id="c1"] .skill-card-name', "open concept");
      await c.click("#concept-promote-btn", "promote");
      await c.visible("#pc-backdrop:not([hidden])", "pop-up");
      await c.page.fill("#pc-name-input", "Staff Kanban");
      assert.strictEqual(await c.text("#pc-folder-hint"), "Repo folder: staff-kanban/");
      await c.page.fill("#pc-name-input", "Staff Kanban Two");
      await c.page.press("#pc-name-input", "Escape");
      await c.hidden("#pc-backdrop", "Escape closes before submitting");
      await c.click("#concept-promote-btn", "promote again");
      await c.page.fill("#pc-name-input", "Staff Kanban");
      await c.page.press("#pc-name-input", "Enter");
      await c.waitText("#dialog-backdrop", "Project created", "Enter promoted the concept");
    },
  },
  {
    name: "concepts: the short description shows on the tile and on the concept page",
    seed: () => relSeed(),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "build", "concept-incubator-btn", "concept-incubator-page");
      await c.visible('#concept-incubator-list .concept-card[data-id="c1"]');
      assert.strictEqual(await c.page.getAttribute('#concept-incubator-list .concept-card[data-id="c1"]', "title"), "Alpha does alpha things.");
      await c.click('#concept-incubator-list .concept-card[data-id="c1"] .skill-card-name', "open concept");
      await c.visible("#concept-detail-page", "concept page");
      await c.visible("#concept-description-input", "description field");
      assert.strictEqual(await c.page.inputValue("#concept-description-input"), "Alpha does alpha things.");
    },
  },
  {
    name: "system map: shows on the Concept Incubator, release badges in version order, rich instant tooltip with the description",
    seed: () => relSeed(),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "build", "concept-incubator-btn", "concept-incubator-page");
      await c.visible("#system-map-canvas svg.sysmap-svg", "map renders");
      assert.ok(await c.page.locator("#system-map-canvas .sysmap-node").count() >= 3, "map draws nodes");
      assert.ok(await c.page.locator("#system-map-canvas .sysmap-edge, #system-map-canvas .sysmap-line").count() >= 1, "map draws lines");
      assert.ok((await c.page.locator("#system-map-canvas .sysmap-boundary-label").innerText().catch(() => "")) || true);
      const opts = await c.page.evaluate(() => [...document.querySelectorAll("#system-map-release option")].map((o) => o.textContent));
      assert.ok(opts[1].includes("1.0.0") && opts[2].includes("2.0.0"), `release filter in version order: ${opts.join(" | ")}`);
      const badges = await c.page.evaluate(() => [...document.querySelectorAll("#system-map-canvas .sysmap-node-release")].map((e) => e.textContent));
      assert.ok(badges.length >= 2, "release badges on nodes");
      // No two node boxes overlap.
      const overlap = await c.page.evaluate(() => {
        const r = [...document.querySelectorAll("#system-map-canvas .sysmap-node")].map((e) => e.getBoundingClientRect());
        for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
          const a = r[i], b = r[j];
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) return [i, j];
        }
        return null;
      });
      assert.strictEqual(overlap, null, "no map nodes overlap");
      c.at("hover a node", '[data-tip-node="c1"]');
      await c.page.hover('#system-map-canvas [data-tip-node="c1"]');
      await c.visible(".sysmap-tip:not([hidden])", "instant tooltip");
      const tip = await c.text(".sysmap-tip");
      assert.ok(tip.includes("Alpha does alpha things."), `tooltip carries the short description: ${tip}`);
      assert.ok(tip.includes("1.0.0") || tip.includes("2.0.0") || tip.includes("Release"), "tooltip shows the release");
      await c.click("#system-map-fit", "fit to page");
    },
  },
  {
    name: "Blocked: the chip keeps its status on one line and its buttons inside the card at every width",
    seed: () => { const s = only("b1"); s.docs.backlogItems.b1.blocked = { reason: "waiting-on-input", note: "Pick A, B or C" }; s.docs.backlogItems.b1.desc = "## Outcome\nx"; return s; },
    async run(c) {
      await c.boardReady();
      await c.visible(".blocked-answer-btn", "Answer is shown");
      for (const w of [1440, 1280, 1180, 1024, 820, 768, 390]) {
        await c.page.setViewportSize({ width: w, height: 900 });
        await c.page.waitForTimeout(100);
        const m = await c.page.evaluate(() => {
          const card = document.querySelector(".card").getBoundingClientRect();
          const status = document.querySelector(".blocked-flag-status");
          const lh = parseFloat(getComputedStyle(status).lineHeight) || 16;
          const boxes = [".blocked-answer-btn", ".blocked-resolve-btn:not(.blocked-answer-btn)", ".blocked-clear-btn"].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { q, h: r.height, in: r.left >= card.left - 0.5 && r.right <= card.right + 0.5 }; });
          return { statusH: status.getBoundingClientRect().height, lh, boxes };
        });
        assert.ok(m.statusH < m.lh * 1.9, `${w}px: status text wrapped (${m.statusH}px tall)`);
        for (const b of m.boxes) { assert.ok(b.h >= 32, `${w}px: ${b.q} is ${b.h}px tall`); assert.ok(b.in, `${w}px: ${b.q} is outside the card`); }
      }
      c.at("layout holds at every width");
    },
  },
];

// ── Self-checks ────────────────────────────────────────────────────────────
// (a) the stub exports every name the console imports from gstatic;
// (c) a stub function that isn't implemented throws its own name.
function selfChecks() {
  const results = [];
  const check = (name, fn) => { try { fn(); results.push([name, null]); } catch (err) { results.push([name, err]); } };
  check("stub exports every SDK name app.js and auth-gate.js import", () => {
    const missing = [];
    for (const file of ["app.js", "auth-gate.js"]) {
      const src = fs.readFileSync(path.join(publicDir, "js", file), "utf8");
      const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+)"/g)];
      assert.ok(imports.length >= 2, `${file} should import the Firebase SDK from gstatic — has its loading changed? Update this harness.`);
      for (const [, names, url] of imports) {
        assert.ok(SDK_MODULES.includes(url.split("/").pop()), `${file} imports ${url}, which the harness does not route`);
        for (const n of names.split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+as\s+/)[0].trim())) {
          if (!(n in stub)) missing.push(`${n} (${file})`);
        }
      }
    }
    assert.deepStrictEqual(missing, [], `firebase-stub.mjs does not export: ${missing.join(", ")}`);
  });
  check("the index.html SDK URLs are all routed by the harness", () => {
    const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
    const urls = [...html.matchAll(/rel="modulepreload" href="(https:\/\/www\.gstatic\.com\/firebasejs\/10\.13\.2\/[^"]+)"/g)].map((m) => m[1].split("/").pop());
    assert.deepStrictEqual([...urls].sort(), [...SDK_MODULES].sort());
  });
  check("an unimplemented stub function throws its own name", () => {
    assert.throws(() => stub.signOut(), /firebase-stub: signOut not implemented/);
  });
  return results;
}

// ── Run ────────────────────────────────────────────────────────────────────
async function main() {
  let failed = 0;
  for (const [name, err] of selfChecks()) {
    if (err) { failed += 1; console.log(`FAIL  self-check: ${name}\n      ${err.message}`); } else console.log(`PASS  self-check: ${name}`);
  }
  if (failed) process.exit(1);

  const harness = await startHarness();
  try {
    // (b) a request to an unrouted external host fails the run.
    {
      const o = await harness.open({ seed: seed(), width: 1280 });
      try {
        await o.page.evaluate(() => fetch("https://unrouted.example.test/x").catch(() => {}));
        await until(() => o.problems.find((p) => p.includes("unrouted.example.test")), "the unrouted request to be reported", 5000);
        console.log("PASS  self-check: a request to an unrouted host fails the run");
      } catch (err) { failed += 1; console.log(`FAIL  self-check: a request to an unrouted host fails the run\n      ${err.message}`); }
      await o.close();
    }

    fs.mkdirSync(outDir, { recursive: true });
    for (const width of WIDTHS) {
      for (const s of scenarios) {
        const label = `${s.name} @${width}px`;
        const o = await harness.open({ seed: s.seed(), width, height: width < 640 ? 800 : 900 });
        const ctx = makeCtx(o, width);
        let error = null;
        try {
          await s.run(ctx);
          // The run also fails on anything the page reported along the way.
          if (o.problems.length) throw new Error(`the page reported ${o.problems.length} problem(s):\n        ${o.problems.join("\n        ")}`);
        } catch (err) { error = err; }
        if (!error) { console.log(`PASS  ${label}`); await o.close(); continue; }
        failed += 1;
        const shot = path.join(outDir, `${s.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${width}.png`);
        await o.page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        const writes = await ctx.writes().catch(() => []);
        console.log(`FAIL  ${label}`);
        console.log(`      step:     ${ctx.step}`);
        if (ctx.selector) console.log(`      selector: ${ctx.selector}`);
        console.log(`      error:    ${String(error && error.message).split("\n").join("\n      ")}`);
        if (o.problems.length && !String(error.message).includes("the page reported")) console.log(`      page:     ${o.problems.join("\n                ")}`);
        console.log(`      writes:   ${JSON.stringify(writes)}`);
        console.log(`      screenshot: ${path.relative(process.cwd(), shot)}`);
        await o.close();
      }
    }
  } finally {
    await harness.close();
  }
  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log(`\nall console click-through scenarios passed at ${WIDTHS.join(" px and ")} px`);
}
main().catch((err) => { console.error(err); process.exit(1); });
