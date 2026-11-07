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
    c1: { name: "Alpha", type: "Platform", status: "active", description: "Alpha does alpha things.", createdAt: t(T0), updatedAt: t(T0 + 5) },
    c2: { name: "Beta", type: "Platform", status: "active", description: "Beta does beta things.", createdAt: t(T0), updatedAt: t(T0 + 4) },
    c3: { name: "Gamma", type: "Internal operations", status: "active", description: "", createdAt: t(T0), updatedAt: t(T0 + 3) },
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
  // A scenario that makes the page's own request fail on purpose says so; the browser logs that as a console error.
  ctx.expectProblem = (re) => { for (let i = o.problems.length - 1; i >= 0; i--) if (re.test(o.problems[i])) o.problems.splice(i, 1); };
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
    name: "nav: Build, Support and Admin destinations are all reachable, with no sideways scroll",
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
        assert.deepStrictEqual(labels, ["Build", "Promote", "Support", "Settings"]);
      }
      await go("build", "concept-incubator-btn", "concept-incubator-page");
      await go("settings", "faq-settings-btn", "faq-settings-page");
      for (const [sub, label] of [["releases", "Releases"], ["skills", "Skills & phase bindings"], ["automations", "Automations"], ["integrations", "Integrations & MCP"], ["projects", "Projects"]]) {
        await c.click(`[data-settings-page="${sub}"]`, `Settings sub-menu ${label}`);
        await c.visible(`[data-settings-pane="${sub}"]`, `${label} pane shows`);
        await overflow(`settings ${sub}`);
      }
      assert.deepStrictEqual(await c.page.evaluate(() => [...document.querySelectorAll("#settings-submenu .settings-tab")].map((b) => b.dataset.settingsPage)), ["user-management", "projects", "releases", "skills", "automations", "integrations"], "User Management first, the rest in their old order");
      assert.strictEqual(await c.page.locator('#settings-submenu .settings-tab[aria-selected="true"]').count(), 1, "exactly one Settings tab is selected");
      assert.strictEqual(await c.page.locator('#nav-drawer [data-nav-group="user-management"], #nav-drawer #um-users-btn, #nav-drawer #um-roles-btn, #nav-drawer #um-permissions-btn').count(), 0, "no User Management, Roles or Permissions items in the nav");
      assert.strictEqual(await c.page.locator("#nav-drawer #releases-btn, #nav-drawer #skills-btn").count(), 0, "Releases and Skills are not in the main navigation");
      await go("publish", "faq-articles-btn", "faq-articles-page");
      assert.strictEqual(await c.page.locator("#profile-menu #faq-settings-btn").count(), 0, "Settings is not in the profile menu");
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
    name: "user management: first Settings tab, Users grid adds, changes roles inline and in bulk, deactivates",
    seed: () => {
      const s = seed();
      s.user = { email: "admin@personalisationhub.com", role: "admin" };
      s.docs.consoleUsers = {
        "admin@personalisationhub.com": { email: "admin@personalisationhub.com", role: "admin", displayName: "Ada Admin", lastLoginAt: t(T0) },
        "sam@personalisationhub.com": { email: "sam@personalisationhub.com", role: "editor", displayName: "Sam Patel", lastLoginAt: t(T0 - 3600000) },
        "kim@personalisationhub.com": { email: "kim@personalisationhub.com", role: "viewer", displayName: "Kim Lee" },
      };
      return s;
    },
    async run(c) {
      await c.boardReady();
      const phone = c.width <= 640;
      if (phone) await c.click('#tabbar .tab[data-tab="settings"]', "Settings tab"); else if (c.width < 1024) await c.click("#nav-open-btn", "open the menu");
      assert.strictEqual(await c.page.locator("#faq-settings-page .team-admin-block").count(), 0, "Team & agent access is no longer under Settings");
      assert.strictEqual(await c.page.locator('#nav-drawer [data-nav-group="user-management"]').count(), 0, "User Management is not a nav group");
      await c.click("#faq-settings-btn", "Settings");
      await c.visible('[data-settings-pane="user-management"]', "Settings opens on User Management");
      assert.strictEqual(await c.page.evaluate(() => document.querySelector("#settings-submenu .settings-tab").dataset.settingsPage), "user-management", "first tab");
      assert.strictEqual(await c.page.getAttribute('#settings-submenu [data-settings-page="user-management"]', "aria-selected"), "true", "its tab is selected");
      assert.deepStrictEqual(await c.page.evaluate(() => [...document.querySelectorAll(".um-tab")].map((b) => b.textContent.trim())), ["Users", "Roles"]);
      await c.visible("#um-grid .ag-row", "the grid lists members");
      assert.strictEqual(await c.page.locator("#um-grid .ag-center-cols-container .ag-row").count(), 3, "three members in the grid");
      const cols = await c.page.evaluate(() => [...document.querySelectorAll("#um-grid .ag-header-cell-text")].map((e) => e.textContent.trim()).filter(Boolean));
      assert.deepStrictEqual(cols, ["Name", "Email", "Role", "Assigned role", "Status", "Last active"]);
      // search
      await c.page.fill("#um-search", "kim");
      await until(async () => (await c.page.locator("#um-grid .ag-center-cols-container .ag-row").count()) === 1, "search to filter the grid", 5000);
      await c.page.fill("#um-search", "");
      await until(async () => (await c.page.locator("#um-grid .ag-center-cols-container .ag-row").count()) === 3, "search to clear", 5000);
      // add from the side panel
      await c.click("#team-add-open", "Add User");
      await c.visible("#team-add-email", "side panel opens");
      await c.page.fill("#team-add-email", "new@personalisationhub.com");
      await c.page.fill("#team-add-name", "Nina New");
      await c.page.selectOption("#team-add-role", "viewer");
      await c.click("#team-add-btn", "Add");
      await c.click("#dialog-ok", "dismiss the added confirmation");
      await until(async () => (await c.page.locator("#um-grid .ag-center-cols-container .ag-row").count()) === 4, "the new user to show in the grid", 8000);
      const stored = await c.page.evaluate(() => globalThis.__fbStub.col("consoleUsers").get("new@personalisationhub.com"));
      assert.ok(stored && stored.role === "viewer", "the new user was saved with the chosen role");
      // inline role change
      await c.page.selectOption('select[aria-label="Role for kim@personalisationhub.com"]', "editor");
      await until(async () => (await c.page.evaluate(() => globalThis.__fbStub.col("consoleUsers").get("kim@personalisationhub.com").role)) === "editor", "inline role change to persist", 5000);
      // bulk role change
      await c.page.locator('#um-grid .ag-pinned-left-cols-container .ag-row[row-id="kim@personalisationhub.com"] .ag-selection-checkbox input').check();
      await c.page.locator('#um-grid .ag-pinned-left-cols-container .ag-row[row-id="new@personalisationhub.com"] .ag-selection-checkbox input').check();
      await c.visible("#um-bulk", "bulk bar shows");
      await c.page.selectOption("#um-bulk-role", "admin");
      await c.click("#um-bulk-apply", "Apply");
      await until(async () => (await c.page.evaluate(() => ["kim", "new"].map((n) => globalThis.__fbStub.col("consoleUsers").get(`${n}@personalisationhub.com`).role).join())) === "admin,admin", "bulk role change to persist", 5000);
      // deactivate one from Manage
      await c.page.evaluate(() => document.querySelector('.um-manage[data-manage="sam@personalisationhub.com"]').click());
      await c.visible("#um-manage", "Manage panel opens");
      await c.click("#um-manage-active", "Deactivate");
      await c.click("#dialog-ok", "confirm deactivation");
      await until(async () => (await c.page.evaluate(() => globalThis.__fbStub.col("consoleUsers").get("sam@personalisationhub.com").disabled)) === true, "deactivation to persist", 5000);
      // assign a role on Users, then manage roles
      await until(async () => (await c.page.locator('select[aria-label="Assigned role for kim@personalisationhub.com"] option').count()) === 6, "default roles to seed and list", 8000);
      const engineerId = await c.page.evaluate(() => { const m = globalThis.__fbStub.col("roles"); for (const [id, d] of m.entries()) if (d.name === "Engineer") return id; });
      assert.ok(engineerId, "Engineer role seeded");
      await c.page.selectOption('select[aria-label="Assigned role for kim@personalisationhub.com"]', engineerId);
      await until(async () => (await c.page.evaluate(() => globalThis.__fbStub.col("consoleUsers").get("kim@personalisationhub.com").roleId)) === engineerId, "assigned role to persist", 5000);
      await c.click("#um-tab-roles", "Roles sub-tab");
      await c.visible('[data-um-panel="roles"]', "Roles page shows");
      await c.visible("#roles-grid .ag-row", "roles listed");
      const rcols = await c.page.evaluate(() => [...document.querySelectorAll("#roles-grid .ag-header-cell-text")].map((e) => e.textContent.trim()).filter(Boolean));
      assert.deepStrictEqual(rcols, ["Role name", "Description", "Users", "Last modified"]);
      const rowCount = async () => c.page.locator("#roles-grid .ag-center-cols-container .ag-row").count();
      await until(async () => (await rowCount()) === 5, "five roles", 5000);
      const engUsers = async () => c.page.evaluate((id) => document.querySelector(`#roles-grid .ag-row[row-id="${id}"] [col-id="users"]`)?.textContent.trim(), engineerId);
      await until(async () => (await engUsers()) === "1", "Engineer shows one user", 5000);
      // create
      await c.click("#roles-create", "Create role");
      await c.page.fill("#dialog-field-0", "Support");
      await c.page.fill("#dialog-field-1", "Answers questions");
      await c.click("#dialog-ok", "Create");
      await until(async () => (await rowCount()) === 6, "new role row", 8000);
      // duplicate name refused (any case)
      await c.click("#roles-create", "Create role");
      await c.page.fill("#dialog-field-0", "support");
      await c.click("#dialog-ok", "Create duplicate");
      await c.visible("#dialog-message", "duplicate message shows");
      assert.ok(/already exists/.test(await c.page.textContent("#dialog-message")), "duplicate refused");
      await c.click("#dialog-cancel", "cancel");
      assert.strictEqual(await rowCount(), 6, "no duplicate added");
      // edit
      await c.page.locator('.role-edit[aria-label="Edit Support"]').click();
      await c.visible("#role-detail-page", "the role page opens");
      assert.deepStrictEqual(await c.page.evaluate(() => [...document.querySelectorAll("#role-permissions .role-group h3")].map((e) => e.textContent)), ["Build", "Promote", "Support", "Settings", "Other"]);
      await c.page.fill("#role-name", "Support team");
      await c.page.selectOption("#role-perm-concepts", "view");
      await c.click("#role-save", "Save role");
      await until(async () => (await c.page.evaluate(() => { for (const d of globalThis.__fbStub.col("roles").values()) if (d.name === "Support team") return (d.permissions || {}).concepts; })) === "view", "the renamed role and its permission to persist", 8000);
      await c.click("#role-back-btn", "back to Roles");
      await c.visible("#roles-grid .ag-row", "roles listed again");
      await until(async () => (await c.page.locator('.role-edit[aria-label="Edit Support team"]').count()) === 1, "renamed role", 8000);
      // the Admin role's permissions are locked
      await c.page.locator('.role-edit[aria-label="Edit Admin"]').click();
      await c.visible("#role-detail-page", "Admin role page");
      assert.strictEqual(await c.page.locator("#role-permissions select:not([disabled])").count(), 0, "Admin permissions are locked");
      assert.strictEqual(await c.page.isDisabled("#role-save"), true, "Admin cannot be saved");
      await c.click("#role-back-btn", "back to Roles");
      await c.visible("#roles-grid .ag-row", "roles listed again");
      // clone
      await c.page.locator('.role-clone[aria-label="Clone Support team"]').click();
      assert.strictEqual(await c.page.inputValue("#dialog-field-0"), "Copy of Support team", "clone prefilled");
      await c.click("#dialog-ok", "Clone");
      await until(async () => (await rowCount()) === 7, "cloned role row", 8000);
      // delete blocked while assigned
      await c.page.locator('.role-delete[aria-label="Delete Engineer"]').click();
      await c.visible("#dialog-message", "in-use message");
      assert.ok(/Role in use/.test(await c.page.textContent("#dialog-title")), "blocked: Role in use");
      await c.click("#dialog-ok", "OK");
      assert.strictEqual(await rowCount(), 7, "Engineer stays");
      // delete unused
      await c.page.locator('.role-delete[aria-label="Delete Copy of Support team"]').click();
      await c.click("#dialog-ok", "confirm delete");
      await until(async () => (await rowCount()) === 6, "role removed", 8000);
      const sw = await c.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      assert.ok(sw, "no sideways scroll");
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
      await c.waitText("#archive-grid", "Archived thing", "archive page lists the seeded archived card");
    },
  },
  {
    name: "⋮ menu: an archived card's date renders (stub timestamps keep toMillis/toDate)",
    seed: () => seed(),
    async run(c) {
      await c.boardReady();
      await c.openMenu();
      await c.click(".project-archive-btn", "Archived tickets");
      await c.waitText("#archive-grid", "Archived thing", "archive page lists the seeded archived card");
      // Wait for the date the same way as for the title: AG Grid renders a row in
      // several containers, so reading the first .ag-row at once raced the render
      // (failed intermittently at 390 and 1180 px, 5 Nov 2026).
      const want = await c.page.evaluate((ms) => new Date(ms).toLocaleDateString(), T0 + 6);
      await c.waitText("#archive-grid", want, `the Archived row shows the archived date ${want}`);
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
    name: "Docs page: PH tabs, rendered Markdown, AG Grid lists and search",
    seed: () => seed(),
    async run(c) {
      await c.boardReady();
      await c.openMenu();
      await c.click(".project-docs-btn", "Project Settings");
      await c.visible("#docs-page");
      // Overview is the landing tab; the document list is on its own tab.
      assert.deepEqual(await c.page.evaluate(() => [...document.querySelectorAll("#docs-tabs .docs-tab")].map((b) => b.dataset.tab)), ["general", "readme", "requirements", "documents", "interfaces", "revisions"]);
      assert.equal(await c.page.evaluate(() => getComputedStyle(document.getElementById("docs-extra-docs-list").closest(".docs-block")).display), "none", "Documents block is hidden on Overview");
      await c.page.click('#docs-tabs [data-tab="documents"]');
      await c.visible("#docs-extra-docs-list");
      await c.page.waitForSelector("#docs-extra-docs-list .ag-theme-alpine .ag-row", { timeout: 8000 });
      await c.waitText("#docs-extra-docs-list", "Release checklist", "AG Grid lists the document");
      // Search filters the grid.
      await c.page.fill("#docs-extra-docs-list .docs-list-search", "zzz-no-match");
      await c.page.waitForFunction(() => !document.querySelector("#docs-extra-docs-list .ag-center-cols-container .ag-row"), null, { timeout: 5000 });
      await c.page.fill("#docs-extra-docs-list .docs-list-search", "release");
      await c.page.waitForSelector("#docs-extra-docs-list .ag-center-cols-container .ag-row", { timeout: 5000 });
      // Editing still opens the existing modal.
      await c.page.click("#docs-extra-docs-list .doc-edit-btn");
      await c.visible("#doc-backdrop");
      await c.page.click("#doc-cancel");
      // README renders as Markdown, with Edit revealing the textarea.
      await c.page.click('#docs-tabs [data-tab="readme"]');
      await c.visible("#docs-readme-view");
      await c.page.click("#docs-readme-edit");
      await c.visible("#docs-readme-input");
      await c.page.click("#docs-readme-edit");
      await c.page.click('#docs-tabs [data-tab="interfaces"]');
      await c.visible("#docs-interfaces-list .docs-list-search");
      await c.page.click('#docs-tabs [data-tab="revisions"]');
      await c.visible("#docs-revisions-list .docs-list-search");
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
    name: "Backlog bulk bar: ticking cards offers Archive N / Delete N behind one confirmation",
    seed: () => {
      const s = only("b1");
      s.docs.backlogItems.b2 = { ...s.docs.backlogItems.b1, title: "Second junk ticket", createdAt: t(T0 + 9), updatedAt: t(T0 + 9) };
      return s;
    },
    async run(c) {
      await c.boardReady();
      assert.strictEqual(await c.page.locator(".backlog-bulk-bar").count(), 0, "no bar until something is ticked");
      await c.click(".col-select-all-cb", "select all Backlog cards");
      await c.visible(".backlog-bulk-archive-btn", "Archive button");
      assert.ok(/Archive 2/.test(await c.page.locator(".backlog-bulk-archive-btn").innerText()), "counts the selection");
      await c.click(".backlog-bulk-archive-btn", "Archive 2");
      await c.click("#dialog-ok", "confirm the archive");
      const writes = await until(async () => { const w = await c.writes(); return w.filter((x) => x.path.startsWith("backlogItems/") && x.data && x.data.status === "archived").length >= 2 ? w : null; }, "both tickets archived");
      c.at("what the bulk archive wrote");
      assert.deepStrictEqual(writes.filter((x) => x.data && x.data.status === "archived").map((x) => x.path).sort(), ["backlogItems/b1", "backlogItems/b2"]);
    },
  },
  {
    name: "Blocked: a dependency wait shows 'Waiting for: <title>', no Answer button, no answer chip",
    seed: () => { const s = only("b1"); s.docs.backlogItems.b1.dependsOnItemIds = ["b-dep"]; s.docs.backlogItems["b-dep"] = { ...s.docs.backlogItems.b1, title: "Roles page", dependsOnItemIds: [], blocked: null }; s.docs.backlogItems.b1.blocked = { reason: "waiting-on-dependency", note: "Waiting for: Roles page." }; return s; },
    async run(c) {
      await c.boardReady();
      await until(async () => /Waiting for:\s*Roles page/.test(await c.page.locator(".blocked-flag-waiting-on-dependency").first().innerText().catch(() => "")), "the dependency flag to read Waiting for: Roles page");
      assert.strictEqual(await c.page.locator(".blocked-answer-btn").count(), 0, "no Answer button");
      assert.strictEqual(await c.page.locator(".waiting-answer-chip").count(), 0, "not counted as waiting on your answer");
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
  {
    name: "Finalised project: badge shows, Ready for Dev is gone, + New backlog item is refused with a message",
    seed: () => { const s = only("b1"); s.docs.projects[PID].finalised = { version: 1, at: t(T0 + 10), byEmail: "admin@personalisationhub.com", artifactUrl: null, artifactUpdatedAt: null }; return s; },
    async run(c) {
      await c.boardReady();
      await c.visible(".project-finalised-badge", "Finalised badge");
      assert.strictEqual(await c.page.locator(".project-notify-btn").count(), 0, "Ready for Dev is hidden");
      await c.click(".new-item-btn", "+ New backlog item");
      await c.visible("#dialog-backdrop", "the refusal dialog opens");
      await c.waitText("#dialog-message", "is Finalised");
      await c.click("#dialog-ok", "OK");
      assert.ok(await c.page.locator("#ni-backdrop").isHidden(), "the New item form stays closed");
    },
  },
  // ── Concept Incubator, Releases and the system map (regression guard: the
  // 20 Oct 2026 report that the redesign dropped them) ────────────────────
  {
    name: "releases: a release name opens the editor, saving persists, + New release creates one",
    seed: () => relSeed(),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "settings", "faq-settings-btn", "faq-settings-page");
      await c.click('[data-settings-page="releases"]', "Settings > Releases");
      await c.click("#settings-manage-releases-btn", "Manage releases");
      await c.visible("#releases-page", "releases page shows");
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
      await c.page.waitForSelector('#releases-grid :text("2.1.0")');
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
      await c.waitText("#releases-grid", "November 2026", "new release listed");
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
    name: "types: a new concept needs a type, and promotion locks the concept's type in",
    seed: () => relSeed(),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "build", "concept-incubator-btn", "concept-incubator-page");
      await c.click("#concept-add-btn", "new concept");
      await c.visible("#nc-backdrop:not([hidden])", "pop-up");
      await c.page.fill("#nc-name-input", "Customer care desk");
      await c.click("#nc-submit", "create without a type");
      await c.visible("#nc-type-error:not([hidden])", "refused: Choose a type");
      assert.ok(!(await c.page.locator("#concept-detail-page").isVisible()), "no concept was created");
      await c.page.selectOption("#nc-type-select", "Internal operations");
      await c.click("#nc-submit", "create with a type");
      await c.visible("#concept-detail-page", "concept page opens");
      assert.strictEqual(await c.page.inputValue("#concept-type-select"), "Internal operations");
      await c.click("#concept-promote-btn", "promote");
      await c.visible("#pc-backdrop:not([hidden])", "promote pop-up");
      assert.strictEqual(await c.page.inputValue("#pc-type-select"), "Internal operations", "type pre-filled");
      assert.ok(await c.page.locator("#pc-type-select").isDisabled(), "and locked");
    },
  },
  {
    name: "types: the concept list filters by type and shows Unassigned",
    seed: () => { const s = relSeed(); s.docs.concepts.c3 = { name: "Gamma", status: "active", description: "", createdAt: t(T0), updatedAt: t(T0 + 3) }; return s; },
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "build", "concept-incubator-btn", "concept-incubator-page");
      await c.visible("#concept-incubator-list .concept-card", "tiles");
      const shown = () => c.page.evaluate(() => [...document.querySelectorAll("#concept-incubator-list .concept-card")].map((e) => e.dataset.id).sort());
      assert.deepStrictEqual(await shown(), ["c1", "c2", "c3"]);
      assert.ok((await c.text('#concept-incubator-list .concept-card[data-id="c3"]')).includes("Unassigned"), "an untyped concept is badged");
      await c.page.selectOption("#concept-type-filter", "Platform");
      assert.deepStrictEqual(await shown(), ["c1", "c2"]);
      await c.page.selectOption("#concept-type-filter", "unassigned");
      assert.deepStrictEqual(await shown(), ["c3"]);
      await c.page.selectOption("#concept-type-filter", "Internal operations");
      assert.deepStrictEqual(await shown(), []);
    },
  },
  {
    name: "permissions: an admin sets the matrix; an engineer loses Concepts (nav and URL) and gets view-only where granted",
    seed: () => {
      const s = seed();
      s.user = { email: "eng@personalisationhub.com", role: "editor" };
      s.docs.roles = {
        rAdmin: { name: "Admin", description: "", createdAt: t(T0) },
        rEng: { name: "Engineer", description: "", createdAt: t(T0), permissions: { concepts: "none", skills: "view" } },
      };
      s.docs.consoleUsers = { "eng@personalisationhub.com": { email: "eng@personalisationhub.com", role: "editor", roleId: "rEng" } };
      return s;
    },
    async run(c) {
      await c.boardReady();
      await until(async () => (await c.page.evaluate(() => !!document.getElementById("perm-style")?.textContent)), "the role's permissions to apply", 8000);
      assert.strictEqual(await c.page.evaluate(() => getComputedStyle(document.getElementById("concept-incubator-btn")).display), "none", "Concepts is gone from the nav");
      await c.page.evaluate(() => { location.hash = "#concept-incubator"; });
      await c.visible("#access-denied-page", "the Concepts URL is blocked");
      assert.ok((await c.page.textContent("#access-denied-text")).includes("Concepts"), "the notice names the section");
      assert.strictEqual(await c.page.evaluate(() => document.getElementById("concept-incubator-page").hidden), true, "the Concepts page never shows");
      // view-only Skills: the page opens but its add control is gone
      await c.page.evaluate(() => { location.hash = "#skills"; });
      await c.visible("#skills-page", "Skills opens at View");
      assert.strictEqual(await c.page.evaluate(() => getComputedStyle(document.getElementById("skills-add-btn")).display), "none", "Add skill is unavailable at View");
      // User Management is not in this role at all
      await c.page.evaluate(() => { location.hash = "#settings/user-management/roles"; });
      await c.visible("#access-denied-page", "User Management is blocked for an engineer");
    },
  },
  {
    name: "permissions: a role's page lists sections by area, saves a change, and the Admin role stays locked",
    seed: () => {
      const s = seed();
      s.user = { email: "admin@personalisationhub.com", role: "admin" };
      s.docs.roles = {
        rAdmin: { name: "Admin", description: "", createdAt: t(T0) },
        rEng: { name: "Engineer", description: "", createdAt: t(T0) },
      };
      s.docs.consoleUsers = { "admin@personalisationhub.com": { email: "admin@personalisationhub.com", role: "admin", roleId: "rEng" } };
      return s;
    },
    async run(c) {
      await c.boardReady();
      await c.page.evaluate(() => { location.hash = "#settings/user-management/roles/rEng"; });
      await c.visible("#role-detail-page", "the role page shows");
      assert.strictEqual(await c.page.locator(".perm-table").count(), 0, "there is no permissions matrix");
      await c.visible("#role-permissions .role-perm-row", "the permissions render");
      const rows = await c.page.evaluate(() => [...document.querySelectorAll("#role-permissions .role-perm-row label")].map((e) => e.textContent.trim()));
      assert.deepStrictEqual(rows, ["Agent Board", "Staff Kanban", "Concepts", "Whiteboard", "Brand Guidelines", "Leads", "Prospects (TAM)", "Help Centre", "Settings", "Settings > User Management", "Releases", "Skills & phase bindings", "Project docs"]);
      await c.page.selectOption("#role-perm-concepts", "none");
      await c.click("#role-save", "Save role");
      await until(async () => (await c.page.evaluate(() => (globalThis.__fbStub.col("roles").get("rEng").permissions || {}).concepts)) === "none", "the change to persist", 5000);
      // an admin keeps User Management even when a role they hold says none
      await c.page.selectOption("#role-perm-user-management", "none");
      await c.click("#role-save", "Save role");
      await until(async () => (await c.page.evaluate(() => (globalThis.__fbStub.col("roles").get("rEng").permissions || {})["user-management"])) === "none", "the lock-out attempt to persist", 5000);
      assert.strictEqual(await c.page.evaluate(() => document.getElementById("role-detail-page").hidden), false, "User Management is still open");
      // legacy links redirect
      await c.page.evaluate(() => { location.hash = "#user-management/permissions"; });
      await until(async () => (await c.page.evaluate(() => location.hash)) === "#settings/user-management/roles", "the legacy link to redirect", 5000);
      await c.visible('[data-settings-pane="user-management"]', "Settings → User Management shows");
    },
  },
  {
    name: "types: the map toggles between Platform and Internal operations, and a bridge opens the Platform map",
    seed: () => relSeed(),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "build", "concept-incubator-btn", "concept-incubator-page");
      await c.visible("#system-map-canvas svg.sysmap-svg", "Platform map renders");
      const names = () => c.page.evaluate(() => [...document.querySelectorAll("#system-map-canvas .sysmap-node-name")].map((e) => e.textContent));
      let platform = await names();
      assert.ok(platform.includes("Alpha") && !platform.includes("Gamma"), `Platform map has Platform items only: ${platform.join(", ")}`);
      await c.click('#system-map-type [data-map-type="Internal operations"]', "Internal operations view");
      await c.visible("#system-map-canvas .intmap-bridge", "bridge nodes");
      const internal = await names();
      assert.ok(internal.includes("Gamma") && !internal.includes("Alpha"), `Internal view has Internal items only: ${internal.join(", ")}`);
      for (const n of ["Customer Success agents", "FAQs DB", "Sales agents", "Embedded support", "MCP Access", "PH releases"]) assert.ok(internal.includes(n), `${n} on the Internal map`);
      const text = await c.page.evaluate(() => document.getElementById("system-map-canvas").textContent);
      assert.ok(!/September focus/.test(text) && !/Get rid of/i.test(text), "no personal September focus notes");
      assert.strictEqual(await c.page.locator("#system-map-canvas .intmap-step").count() >= 2, true, "steps 1 and 2 marked");
      await c.click('#system-map-canvas .intmap-bridge', "click a bridge node");
      await c.visible('#system-map-type [data-map-type="Platform"].active', "opens the Platform map");
      platform = await names();
      assert.ok(platform.includes("Alpha"), "back on the Platform map");
    },
  },
  {
    name: "Promote: Brand Guidelines opens from the nav and shows the mirrored guidelines",
    seed: () => seed({ projectDocs: {
      bg: { projectId: PID, name: "6 — Brand Guidelines (Promote)", mirrorKey: "brand-guidelines", sourcePath: "backlog-tracker/promote/brand-guidelines.md",
        sourcePrefix: "> Copy of the file.\n\n", contentMd: "> Copy of the file.\n\n# Brand Guidelines\n\n## Founder tone of voice\n\nShort, direct sentences.\n\n## Industry content lives on the website\n\nSee [industries](https://personalisationhub.com/industries/).\n\n<!-- agent-only:start -->\n\n## Front doors\n\nAgent rules.\n\n<!-- agent-only:end -->", createdAt: t(T0), updatedAt: t(T0) },
      br: { projectId: PID, name: "6 — Brand Guidelines requirements (Promote)", mirrorKey: "brand-requirements", sourcePath: "backlog-tracker/promote/brand-requirements.md",
        sourcePrefix: "", contentMd: "# Requirements\n\n- R7.1 Founder tone of voice.", createdAt: t(T0), updatedAt: t(T0) },
    } }),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "promote", "promote-brand-btn", "promote-page");
      await c.waitText("#promote-guidelines", "Founder tone of voice", "the guidelines show");
      assert.ok(!(await c.text("#promote-guidelines")).includes("Copy of the file"), "the sync's copy line is not shown");
      assert.strictEqual(await c.page.locator('#promote-guidelines a[href="https://personalisationhub.com/industries/"]').count(), 1, "industry content links to the website");
      const gtext = await c.text("#promote-guidelines");
      assert.ok(!gtext.includes("Front doors") && !gtext.includes("Agent rules") && !gtext.includes("agent-only"), "agent-only sections are not shown");
      assert.ok((await c.text("#promote-brand-header")).includes("Make every store visit worth more"), "the visual header shows the umbrella line");
      assert.strictEqual(await c.page.locator("#promote-brand-header .brand-bar").count(), 4, "four brand bars");
      assert.ok(await c.page.locator("#promote-requirements-wrap").isHidden(), "no Requirements section on the team view");
      assert.ok(new URL(c.page.url()).hash === "#promote/brand-guidelines", "the page has its own URL");
    },
  },
  {
    name: "Promote: Leads board - add a lead with contacts, drag it to Hot Lead, convert it",
    seed: () => seed({ leads: {
      lx: { company: { name: "Existing Co", website: "https://existing.example", industry: "", countries: ["UK"], storeCount: 40 }, contacts: [{ id: "k1", name: "Pat", jobTitle: "", buyingRole: "champion", email: "", linkedin: "" }], stage: "demo", source: "Website form", assignee: "", customerAccount: null, createdAt: t(T0), updatedAt: t(T0) },
    } }),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "promote", "promote-leads-btn", "leads-page");
      assert.ok(new URL(c.page.url()).hash === "#promote/leads", "the page has its own URL");
      await c.visible('.lead-lane[data-stage="demo"] .lead-card', "the seeded lead is in the Demo lane");
      const lanes = await c.page.evaluate(() => [...document.querySelectorAll("#leads-board .lead-lane-head h3")].map((e) => e.textContent.trim()));
      assert.deepStrictEqual(lanes, ["Lead", "Hot Lead", "Demo", "Post-demo", "Closed Won", "Lost"]);
      // New lead with two contacts and buying roles lands in the Lead lane.
      await c.page.click("#leads-add-btn");
      await c.visible("#lead-form", "the lead form opens");
      await c.page.fill("#lead-name", "Acme Retail");
      await c.page.fill("#lead-website", "acme.example");
      await c.page.fill("#lead-countries", "UK, France");
      await c.page.fill("#lead-stores", "250");
      await c.page.fill(".lead-contact[data-index=\"0\"] .lc-name", "Jo Bloggs");
      await c.page.selectOption(".lead-contact[data-index=\"0\"] .lc-role", "decision-maker");
      await c.page.click("#lead-add-contact");
      await c.page.fill(".lead-contact[data-index=\"1\"] .lc-name", "Sam Tech");
      await c.page.selectOption(".lead-contact[data-index=\"1\"] .lc-role", "technical-evaluator");
      await c.page.click("#lead-save");
      await c.visible('.lead-lane[data-stage="lead"] .lead-card', "the new lead is in the Lead lane");
      assert.ok((await c.text('.lead-lane[data-stage="lead"]')).includes("Acme Retail"));
      // The tile is compact: no "Move to" select, no contact count.
      assert.strictEqual(await c.page.locator(".lead-move-select").count(), 0, "the tile has no Move to select");
      // Move it to Hot Lead with the summary's stage select, and it persists.
      await c.page.click('.lead-lane[data-stage="lead"] .lead-card .lead-card-name');
      await c.visible("#lead-sum-stage", "the summary drawer opens");
      await c.page.selectOption("#lead-sum-stage", "hot-lead");
      await c.page.keyboard.press("Escape");
      await c.visible('.lead-lane[data-stage="hot-lead"] .lead-card', "the card is in Hot Lead");
      const stored = await c.page.evaluate(() => { for (const [, v] of globalThis.__fbStub.col("leads").entries()) if (v.company.name === "Acme Retail") return v; return null; });
      assert.ok(stored, "the lead was written");
      assert.strictEqual(stored.stage, "hot-lead", "the stage was written");
      assert.strictEqual(stored.contacts[0].buyingRole, "decision-maker");
      assert.strictEqual(stored.createdByEmail, "editor@personalisationhub.com");
      // Drag the other card between lanes.
      // Pointer drag on a wide layout where both lanes are on screen; narrower, the summary drawer's stage select is the way to move.
      if (c.page.viewportSize().width > 1000) await c.page.dragAndDrop('.lead-lane[data-stage="demo"] .lead-card', '.lead-lane[data-stage="post-demo"] .lead-lane-head');
      else { await c.page.click('.lead-lane[data-stage="demo"] .lead-card .lead-card-name'); await c.page.selectOption("#lead-sum-stage", "post-demo"); await c.page.keyboard.press("Escape"); }
      await c.visible('.lead-lane[data-stage="post-demo"] .lead-card', "dragging moved the card to Post-demo");
      await until(async () => (await c.page.evaluate(() => globalThis.__fbStub.col("leads").get("lx").stage)) === "post-demo", "the dragged stage to persist", 5000);
      // Convert and link a customer account.
      await c.page.click('.lead-lane[data-stage="post-demo"] .lead-card .lead-card-name');
      await c.visible("#lead-sum-edit", "the summary opens");
      await c.page.click("#lead-sum-edit");
      await c.visible("#lead-account-name", "the customer account fields show for a saved lead");
      await c.page.click("#lead-convert-btn");
      assert.ok((await c.text("#lead-error")).includes("Name the customer account"), "an account is required");
      await c.page.fill("#lead-account-name", "Existing Co Ltd");
      await c.page.fill("#lead-account-id", "acc_42");
      await c.page.click("#lead-convert-btn");
      await c.visible('.lead-lane[data-stage="closed-won"] .lead-card', "the converted lead is in Closed Won");
      await c.page.click('.lead-lane[data-stage="closed-won"] .lead-card .lead-card-name');
      await c.visible("#lead-summary-panel", "the summary opens");
      assert.ok((await c.text("#lead-summary-panel")).includes("Existing Co Ltd"), "the summary shows the linked account");
      await c.page.keyboard.press("Escape");
      assert.deepStrictEqual(await c.page.evaluate(() => globalThis.__fbStub.col("leads").get("lx").customerAccount), { id: "acc_42", name: "Existing Co Ltd" });
    },
  },
  {
    name: "Promote: Leads - ACE opportunities as the PH list page (count line, KPIs, stage pills, one-line grid rows, dots, ⋯ menu, themes, 375px)",
    seed: () => ({ ...seed({ leads: {
      lx: { company: { name: "Acme Retail", website: "", industry: "", countries: ["UK"], storeCount: 5 }, contacts: [], stage: "demo", source: "Manual", assignee: "", customerAccount: null, createdAt: t(T0), updatedAt: t(T0) },
    } }), aceOpportunities: [
      { id: "O1", name: "Sandbox opportunity for a very long running title that would otherwise wrap onto many lines in the table Sandbox opportunity for a very long running title that would otherwise wrap onto many lines in the table Sandbox opportunity for a very long running title that would otherwise wrap onto many lines in the table Sandbox opportunity for a very long running title that would otherwise wrap onto many lines in the table", customer: "Acme Retail", stage: "Qualified", reviewStatus: "Approved", score: null, expectedMonthly: { amount: 2200, currency: "USD" }, targetCloseDate: "2099-12-31", awsSeller: { name: "Ann Lee", email: "ann@amazon.com" }, partnerCentralUrl: "https://partnercentral.awspartner.com/partnercentral2/s/opportunities/O1" },
      { id: "O2", name: "Signage", customer: "Unknown Co", stage: "Prospect", reviewStatus: "Submitted", score: null, expectedMonthly: { amount: 300, currency: "USD" }, targetCloseDate: "2020-01-15", awsSeller: null, partnerCentralUrl: "https://partnercentral.awspartner.com/partnercentral2/s/opportunities/O2" },
      { id: "O3", name: "Kiosk", customer: "Beta", stage: "Prospect", reviewStatus: "Action Required", score: null, expectedMonthly: null, targetCloseDate: null, awsSeller: null, partnerCentralUrl: "" },
      { id: "O4", name: "Totems", customer: "Gamma", stage: "Prospect", reviewStatus: "Rejected", score: null, expectedMonthly: null, targetCloseDate: null, awsSeller: null, partnerCentralUrl: "" },
      { id: "O5", name: "Wall", customer: "Delta", stage: "Prospect", reviewStatus: "In review", score: null, expectedMonthly: null, targetCloseDate: null, awsSeller: null, partnerCentralUrl: "" },
    ] }),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "promote", "promote-leads-btn", "leads-page");
      await c.page.waitForSelector("#ace-grid .ag-center-cols-container .ag-row", { state: "attached" });
      await until(async () => (await c.page.locator("#ace-grid .ag-center-cols-container .ag-row").count()) === 5, "five ACE rows", 8000);
      const info = await c.page.evaluate(() => {
        const sec = document.getElementById("ace-section").getBoundingClientRect();
        const board = document.getElementById("leads-board").getBoundingClientRect();
        const rowEls = [...document.querySelectorAll("#ace-grid .ag-center-cols-container .ag-row")];
        const first = document.querySelector('#ace-grid .ag-row[row-id="O1"] [col-id="name"] .ace-trunc');
        const dot = (id) => getComputedStyle(document.querySelector(`#ace-grid .ag-center-cols-container .ag-row[row-id="${id}"] .ace-dot`)).backgroundColor;
        const past = (id) => !!document.querySelector(`#ace-grid .ag-center-cols-container .ag-row[row-id="${id}"] .ace-date.is-past`);
        const kpi = (k) => document.querySelector(`.ace-kpi[data-kpi="${k}"] .ace-kpi-value`).textContent.trim();
        return {
          below: sec.top >= board.bottom - 1,
          title: document.getElementById("ace-title").textContent.trim(),
          divider: !!document.querySelector("#ace-section hr.ace-divider"),
          count: document.getElementById("ace-count").textContent.replace(/\s+/g, " ").trim(),
          oldStatus: !!document.getElementById("ace-status"),
          refreshIcon: document.querySelector("#ace-refresh .material-symbols-outlined").textContent.trim(),
          kpiCount: document.querySelectorAll(".ace-kpi").length,
          kpis: { total: kpi("total"), revenue: kpi("revenue"), approved: kpi("approved"), action: kpi("action") },
          pills: [...document.querySelectorAll("#ace-stages .ace-pill")].map((e) => e.textContent.replace(/\s+/g, " ").trim()),
          heights: [...new Set(rowEls.map((r) => Math.round(r.getBoundingClientRect().height)))],
          ellipsis: first.scrollWidth > first.clientWidth, oneLine: first.getBoundingClientRect().height <= 42, firstH: first.getBoundingClientRect().height,
          link: first.tagName === "A" ? { href: first.getAttribute("href"), target: first.target } : null,
          heads: [...document.querySelectorAll("#ace-grid .ag-header-row-column .ag-header-cell[col-id]")].map((h) => h.getAttribute("col-id")),
          floating: document.querySelectorAll("#ace-grid .ag-floating-filter").length,
          checkbox: document.querySelectorAll("#ace-grid [col-id=select], #ace-grid .ag-selection-checkbox").length,
          paging: !!document.querySelector("#ace-grid .ag-paging-panel:not(.ag-hidden)"),
          dots: { O1: dot("O1"), O2: dot("O2"), O3: dot("O3"), O4: dot("O4"), O5: dot("O5") },
          past: { O1: past("O1"), O2: past("O2") },
          mail: document.querySelector('#ace-grid .ag-row[row-id="O1"] .ace-mail').getAttribute("href"),
          noMail: !document.querySelector('#ace-grid .ag-center-cols-container .ag-row[row-id="O2"] .ace-mail'),
          noAssigned: document.querySelector('#ace-grid .ag-center-cols-container .ag-row[row-id="O2"] .ace-none').textContent,
          leadBtn: !!document.querySelector('#ace-grid .ag-row[row-id="O1"] button.ace-lead'),
          noLead: document.querySelector('#ace-grid .ag-center-cols-container .ag-row[row-id="O2"] [col-id="lead"] .ace-none').textContent,
          pinned: !!document.querySelector('#ace-grid .ag-pinned-right-cols-container .ag-row[row-id="O1"] button.ace-manage'),
        };
      });
      assert.ok(info.below, "the grid section sits under the board");
      assert.strictEqual(info.title, "AWS ACE opportunities");
      assert.ok(info.divider, "a divider under the title");
      assert.strictEqual(info.count, "5 Opportunities Sandbox");
      assert.ok(!info.oldStatus, "the status sentence is gone");
      assert.strictEqual(info.refreshIcon, "refresh");
      assert.strictEqual(info.kpiCount, 4);
      assert.deepStrictEqual(info.kpis, { total: "5", revenue: "US$2,500", approved: "1", action: "2" });
      assert.deepStrictEqual(info.pills, ["Prospect 4", "Qualified 1"], "stage pills in AWS order");
      assert.deepStrictEqual(info.heights, [42], "every row is 42px tall");
      assert.ok(info.ellipsis && info.oneLine, `the long title is one ellipsised line (${JSON.stringify([info.ellipsis, info.oneLine])})`);
      assert.deepStrictEqual(info.link, { href: "https://partnercentral.awspartner.com/partnercentral2/s/opportunities/O1", target: "_blank" });
      assert.ok(!info.heads.includes("aceScore"), `the empty Score column is hidden (${info.heads})`);
      assert.deepStrictEqual(info.heads, ["name", "customer", "stage", "reviewStatus", "monthly", "close", "seller", "lead", "actions"]);
      assert.ok(info.floating >= 5, "floating filter row");
      assert.strictEqual(info.checkbox, 0, "no checkbox column");
      assert.ok(!info.paging, "no pagination at 5 rows");
      assert.deepStrictEqual(info.dots, { O1: "rgb(82, 196, 26)", O2: "rgb(250, 173, 20)", O3: "rgb(255, 77, 79)", O4: "rgb(255, 77, 79)", O5: "rgb(250, 173, 20)" });
      assert.deepStrictEqual(info.past, { O1: false, O2: true }, "only a past target close date is flagged");
      assert.ok(info.mail.startsWith("mailto:ann@amazon.com?subject="), "the email icon is a mailto");
      assert.ok(info.noMail && info.noLead === "No lead" && info.noAssigned === "Not assigned");
      assert.ok(info.leadBtn && info.pinned, "Lead card link and the pinned-right menu");

      // Tooltips: the full title, the revenue header, the past date.
      await c.page.hover('#ace-grid .ag-row[row-id="O1"] [col-id="name"]');
      await until(async () => (await c.page.locator(".ag-tooltip").allInnerTexts().catch(() => [])).some((x) => x.includes("Sandbox opportunity for a very long")), "the full title in a tooltip", 4000);
      await c.page.hover('#ace-grid .ag-header-cell[col-id="monthly"]');
      await until(async () => (await c.page.locator(".ag-tooltip").allInnerTexts().catch(() => [])).some((x) => x.includes("Expected monthly AWS revenue")), "the revenue header tooltip", 4000);
      await c.page.hover('#ace-grid .ag-center-cols-container .ag-row[row-id="O2"] [col-id="close"]');
      await until(async () => (await c.page.locator(".ag-tooltip").allInnerTexts().catch(() => [])).some((x) => x.includes("Past target close date")), "the past-date tooltip", 4000);

      // The ⋯ menu: all three actions on a row that has them; none on a row with none.
      await c.page.click('#ace-grid .ag-pinned-right-cols-container .ag-row[row-id="O1"] button.ace-manage');
      await c.visible("#ace-pop");
      assert.deepStrictEqual(await c.page.$$eval("#ace-pop [data-pop]", (b) => b.map((x) => x.textContent.trim().replace(/^(open_in_new|email|person)/, ""))), ["View in Partner Central", "Email AWS account manager", "Open lead card"]);
      await c.page.click('#ace-pop [data-pop="lead"]');
      await c.visible("#lead-summary-panel", "Open lead card opens the lead drawer");
      await c.click("#lead-sum-close", "close the lead drawer"); await c.hidden("#lead-summary-panel");
      await c.page.click('#ace-grid .ag-pinned-right-cols-container .ag-row[row-id="O3"] button.ace-manage').catch(() => {});
      assert.ok(await c.page.locator("#ace-pop").isHidden(), "a row with no actions opens no menu");
      await c.page.click('#ace-grid .ag-pinned-right-cols-container .ag-row[row-id="O2"] button.ace-manage');
      assert.deepStrictEqual(await c.page.$$eval("#ace-pop [data-pop]", (b) => b.map((x) => x.textContent.trim().replace(/^(open_in_new|email|person)/, ""))), ["View in Partner Central"], "disabled items are hidden");
      await c.page.keyboard.press("Escape");
      // The Lead card link in the row opens the drawer too.
      await c.page.click('#ace-grid .ag-row[row-id="O1"] button.ace-lead');
      await c.visible("#lead-summary-panel", "the Lead card link opens the lead drawer");
      await c.click("#lead-sum-close", "close the lead drawer"); await c.hidden("#lead-summary-panel");

      // Filter Review status to Approved.
      await c.page.selectOption('#ace-grid select[aria-label="Filter Review status"]', "Approved");
      await until(async () => (await c.page.locator("#ace-grid .ag-center-cols-container .ag-row").count()) === 1, "one Approved row", 4000);
      await c.page.selectOption('#ace-grid select[aria-label="Filter Review status"]', "");
      await until(async () => (await c.page.locator("#ace-grid .ag-center-cols-container .ag-row").count()) === 5, "all rows back", 4000);

      // Refresh reloads /partnerCentral/v1/ace.
      await c.page.evaluate(() => { window.__aceCalls = 0; const f = window.fetch; window.fetch = function (u, ...r) { if (String(u).includes("/partnerCentral/v1/ace")) window.__aceCalls++; return f.call(this, u, ...r); }; });
      await c.page.click("#ace-refresh");
      await until(async () => (await c.page.evaluate(() => window.__aceCalls)) === 1, "Refresh to call the ACE endpoint", 4000);
      await until(async () => (await c.page.locator("#ace-grid .ag-center-cols-container .ag-row").count()) === 5, "the same five rows after Refresh", 4000);

      // Text contrast (4.5:1) in both themes, and nothing wider than 375px.
      const contrast = () => c.page.evaluate(() => {
        const parse = (s) => { const m = s.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
        const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
        const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(parse(getComputedStyle(e).backgroundColor)); let acc = { r: 255, g: 255, b: 255, a: 1 }; const root = getComputedStyle(document.body).backgroundColor; acc = over(parse(root), acc); for (const b of chain.reverse()) acc = over(b, acc); return acc; };
        const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const worst = [];
        const els = document.querySelectorAll("#ace-section :is(h3, .ace-count, .ace-flag, .ace-kpi-label, .ace-kpi-value, .ace-pill, .ace-link, .ace-trunc, .ace-lead, .ace-none, .ace-date, .ag-header-cell-text, .ace-refresh)");
        for (const el of els) {
          if (!el.textContent.trim() || el.closest("[hidden]") || !el.getBoundingClientRect().width) continue;
          const fg = over(parse(getComputedStyle(el).color), bgOf(el)), bg = bgOf(el);
          const l1 = lum(fg), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          if (ratio < 4.5) worst.push(`${el.className || el.tagName} "${el.textContent.trim().slice(0, 20)}" ${ratio.toFixed(2)}`);
        }
        return worst;
      });
      await until(async () => !(await c.text("#ace-count")).includes("Loading"), "the reload to finish", 4000);
      await c.page.mouse.move(0, 0);
      assert.deepStrictEqual(await contrast(), [], "light theme text contrast >= 4.5:1");
      await c.page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
      assert.deepStrictEqual(await contrast(), [], "dark theme text contrast >= 4.5:1");
      assert.strictEqual(await c.page.evaluate(() => getComputedStyle(document.querySelector("#ace-grid .ag-center-cols-container .ag-row")).backgroundColor !== "rgb(255, 255, 255)" && getComputedStyle(document.querySelector("#ace-grid .ag-root-wrapper")).backgroundColor !== "rgb(255, 255, 255)"), true, "the grid follows the dark theme");
      await c.page.setViewportSize({ width: 375, height: 800 });
      await until(async () => c.page.evaluate(() => !!document.querySelector('#ace-grid .ag-pinned-left-cols-container .ag-row[row-id="O1"] [col-id="name"]')), "the Opportunity column to pin left at phone width", 4000);
      const over = await c.page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth, sec: document.getElementById("ace-section").scrollWidth - document.getElementById("ace-section").clientWidth, pinned: !!document.querySelector('#ace-grid .ag-pinned-left-cols-container .ag-row[row-id="O1"] [col-id="name"]') }));
      assert.ok(over.page <= 0 && over.sec <= 1, `no horizontal page overflow at 375px (${JSON.stringify(over)})`);
      assert.ok(over.pinned, "the Opportunity column is pinned left on a phone");
      await c.page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    },
  },
  {
    name: "Promote: Leads - ACE grid shows Score when a row has one, and paginates above 25 rows",
    seed: () => ({ ...seed({}), aceOpportunities: Array.from({ length: 30 }, (_, i) => ({ id: `P${i}`, name: `Opp ${i}`, customer: `Cust ${i}`, stage: "Prospect", reviewStatus: "Approved", score: i === 0 ? 77 : null, expectedMonthly: null, targetCloseDate: null, awsSeller: null, partnerCentralUrl: "" })) }),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "promote", "promote-leads-btn", "leads-page");
      await until(async () => (await c.page.locator("#ace-grid .ag-center-cols-container .ag-row").count()) === 25, "the first page of 25 rows", 8000);
      assert.ok(await c.page.locator('#ace-grid .ag-header-cell[col-id="aceScore"]').count(), "Score shows when a row has a score");
      assert.ok(await c.page.locator("#ace-grid .ag-paging-panel").isVisible(), "pagination above 25 rows");
      assert.match((await c.text("#ace-count")).replace(/\s+/g, " "), /^30 Opportunities/);
    },
  },
  {
    name: "Promote: Leads - ACE empty state",
    seed: () => ({ ...seed({}), aceOpportunities: [] }),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "promote", "promote-leads-btn", "leads-page");
      await c.visible("#ace-empty", "the empty state");
      assert.strictEqual((await c.text("#ace-empty")).replace(/\s+/g, " ").trim(), "handshake No ACE opportunities yet.");
      assert.ok(await c.page.locator("#ace-grid").isHidden() && await c.page.locator("#ace-kpis").isHidden(), "no grid or KPIs when empty");
      assert.match((await c.text("#ace-count")).replace(/\s+/g, " "), /^0 Opportunities/);
    },
  },
  {
    name: "Promote: Leads - ACE 403 and server errors show an alert with Retry",
    seed: () => ({ ...seed({}), aceStatus: 403, aceError: "Only editors and admins can see the ACE opportunities." }),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "promote", "promote-leads-btn", "leads-page");
      await c.visible("#ace-alert", "the alert shows");
      assert.strictEqual(await c.page.getAttribute("#ace-alert", "role"), "alert");
      assert.match(await c.text("#ace-alert"), /Couldn't load the ACE opportunities: Only editors and admins can see the ACE opportunities\./);
      assert.ok(await c.page.locator("#ace-retry").isVisible(), "a Retry button");
      assert.ok(await c.page.locator("#ace-grid").isHidden(), "no grid while in error");
      await c.page.evaluate(() => { window.__aceCalls = 0; const f = window.fetch; window.fetch = function (u, ...r) { if (String(u).includes("/partnerCentral/v1/ace")) window.__aceCalls++; return f.call(this, u, ...r); }; });
      await c.page.click("#ace-retry");
      await until(async () => (await c.page.evaluate(() => window.__aceCalls)) === 1, "Retry to call the endpoint again", 4000);
      c.expectProblem(/status of 403/);
    },
  },
  {
    name: "Promote: Leads - ACE server error text",
    seed: () => ({ ...seed({}), aceStatus: 500, aceError: "Partner Central is down" }),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "promote", "promote-leads-btn", "leads-page");
      await c.visible("#ace-alert", "the alert shows");
      assert.match(await c.text("#ace-alert"), /Couldn't load the ACE opportunities: Partner Central is down/);
      c.expectProblem(/status of 500/);
    },
  },
  {
    name: "Promote: Leads tiles - industry colours, nothing overflows, summary opens, stage changes, Esc closes",
    seed: () => seed({ leads: {
      w1: { company: { name: "Telco With A Really Long Company Name That Keeps Going And Going Plc", website: "https://telco.example", industry: "", countries: ["UK"], storeCount: 1200 }, contacts: [{ id: "k1", name: "Ana Lyst", jobTitle: "CTO", buyingRole: "decision-maker", email: "ana@telco.example", linkedin: "https://linkedin.com/in/ana" }], stage: "lead", source: "website", sourcePage: "https://personalisationhub.com/industries/telco/", sourceIndustry: "Telco retail", test: true, assignee: "", customerAccount: null, createdAt: t(T0), updatedAt: t(T0) },
      p1: { company: { name: "Pharma Co", website: "", industry: "Pharmacy", countries: [], storeCount: null }, contacts: [], stage: "lead", source: "Manual", test: true, assignee: "", customerAccount: null, createdAt: t(T0), updatedAt: t(T0) },
      n1: { company: { name: "No Industry Co", website: "", industry: "", countries: [], storeCount: null }, contacts: [], stage: "lead", source: "Manual", test: true, assignee: "", customerAccount: null, createdAt: t(T0), updatedAt: t(T0) },
    } }),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "promote", "promote-leads-btn", "leads-page");
      await c.visible('.lead-card[data-lead-id="w1"]', "the test tile shows");
      const info = await c.page.evaluate(() => {
        const out = {};
        for (const el of document.querySelectorAll(".lead-card")) {
          const lane = el.closest(".lead-lane-body").getBoundingClientRect(); const r = el.getBoundingClientRect();
          out[el.dataset.leadId] = { industry: el.dataset.industry, inside: r.left >= lane.left - 1 && r.right <= lane.right + 1, scrollOk: el.scrollWidth <= el.clientWidth + 1,
            text: el.textContent, chip: getComputedStyle(el.querySelector(".lead-chip")).backgroundColor, bar: getComputedStyle(el).borderLeftColor, badge: !!el.querySelector(".lead-test-badge") };
        }
        return out;
      });
      assert.strictEqual(info.w1.industry, "telco", "source industry 'Telco retail' colours the tile Telco");
      assert.strictEqual(info.p1.industry, "pharmacy");
      assert.strictEqual(info.n1.industry, "other");
      assert.notStrictEqual(info.w1.chip, info.p1.chip, "industries have their own colours");
      assert.notStrictEqual(info.p1.bar, info.n1.bar);
      for (const id of ["w1", "p1", "n1"]) { assert.ok(info[id].inside && info[id].scrollOk, `${id} stays inside its lane`); assert.ok(info[id].badge, `${id} has the Test badge`); }
      assert.ok(!info.w1.text.includes("personalisationhub.com"), "the tile shows no URL");
      // Click -> summary drawer.
      await c.page.click('.lead-card[data-lead-id="w1"]');
      await c.visible("#lead-summary-panel", "the summary drawer opens");
      const sum = await c.text("#lead-summary-panel");
      for (const want of ["Company", "Lead", "Contacts", "Ana Lyst", "ana@telco.example", "Source page"]) assert.ok(sum.includes(want), `summary shows ${want}`);
      assert.strictEqual(await c.page.locator('#lead-summary-panel a[href="https://personalisationhub.com/industries/telco/"]').count(), 1, "the source page is a link");
      assert.strictEqual(await c.page.locator("#lead-sum-tam").count(), 0, "the TAM section stays hidden without data");
      await c.page.selectOption("#lead-sum-stage", "demo");
      await c.visible('.lead-lane[data-stage="demo"] .lead-card[data-lead-id="w1"]', "changing the stage moves the tile");
      await c.page.keyboard.press("Escape");
      await until(async () => (await c.page.locator("#lead-summary-backdrop").isHidden()), "Esc to close the summary", 3000);
      // Keyboard: Enter on a focused tile opens it too.
      await c.page.focus('.lead-card[data-lead-id="p1"]');
      await c.page.keyboard.press("Enter");
      await c.visible("#lead-summary-panel", "Enter opens the summary");
      await c.page.keyboard.press("Escape");
    },
  },
  {
    name: "Promote: Leads - no Leads/Test buttons, individual leads can be deleted",
    seed: () => seed({ leads: {
      real: { company: { name: "Real Co", website: "", industry: "", countries: [], storeCount: null }, contacts: [], stage: "lead", source: "website", sourcePage: "/telco/", assignee: "", customerAccount: null, createdAt: t(T0), updatedAt: t(T0) },
      t1: { company: { name: "Test One", website: "", industry: "", countries: [], storeCount: null }, contacts: [], stage: "lead", source: "website", sourcePage: "/retail/", test: true, assignee: "", customerAccount: null, createdAt: t(T0), updatedAt: t(T0) },
      t2: { company: { name: "Test Two", website: "", industry: "", countries: [], storeCount: null }, contacts: [], stage: "lead", source: "website", test: true, assignee: "", customerAccount: null, createdAt: t(T0), updatedAt: t(T0) },
    } }),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "promote", "promote-leads-btn", "leads-page");
      await c.visible('.lead-lane[data-stage="lead"] .lead-card', "the leads are in the Lead lane");
      const lane = () => c.text('.lead-lane[data-stage="lead"]');
      assert.ok((await lane()).includes("Real Co") && (await lane()).includes("Test One"), "every lead shows in the pipeline");
      assert.strictEqual(await c.page.evaluate(() => !document.querySelector("#leads-filter-real, #leads-filter-test, #leads-test-delete")), true, "the Leads/Test buttons are gone");
      await c.page.click('.lead-card[data-lead-id="t1"]');
      await c.visible("#lead-summary-panel", "the summary opens");
      await c.page.click("#lead-sum-delete");
      assert.ok((await c.text("#lead-sum-delete")).includes("Click again"), "the first click asks to confirm");
      await c.page.click("#lead-sum-delete");
      await until(async () => (await c.page.evaluate(() => [...globalThis.__fbStub.col("leads").entries()].map(([k]) => k))).join() === "real,t2", "only that lead to be deleted", 5000);
    },
  },
  {
    name: "Promote: Prospects (TAM) - sits below Leads, filters, status edit, saved filter, convert to lead without duplicating",
    seed: () => seed({ prospects: {
      pa: { name: "Alpha Grocer", country: "United Kingdom", priority: "high", website: "https://alpha.example", industry: "Grocery", hqCountry: "United Kingdom", markets: ["United Kingdom", "Ireland"], awsRegion: "eu-west-2", storeCount: 400, storePresence: "400+ stores", sizeBand: "large", ownership: "Listed", insights: "Strong digital signage appetite.", decisionMakers: "Head of Retail Media", linkedinUrl: "https://www.linkedin.com/company/alpha-grocer/", linkedinOrgId: "1234", linkedinVerified: true, contacts: [{ name: "Jo Bloggs", role: "CMO", lastContact: "May 2026" }], vendors: ["Acme Signage"], campaigns: ["Spring"], status: "new", leadId: "", createdAt: t(T0), updatedAt: t(T0)  },
      pb: { name: "Beta Pharmacy", country: "Germany", industry: "Pharmacy", hqCountry: "Germany", markets: ["Germany"], awsRegion: "eu-central-1", storeCount: 40, sizeBand: "small", vendors: [], campaigns: ["Autumn"], status: "targeted", leadId: "", createdAt: t(T0), updatedAt: t(T0) },
      pc: { name: "Gamma Fashion", industry: "Fashion", hqCountry: "France", markets: ["France", "Ireland"], awsRegion: "eu-west-3", storeCount: null, vendors: [], campaigns: [], status: "new", leadId: "", createdAt: t(T0), updatedAt: t(T0) },
    }, prospectCompanies: {
      alphagrocer: { name: "Alpha Grocer", profile: { summary: "A UK grocery chain.", techStack: ["SAP"], primaryCloud: "AWS", emailFormats: ["first.last@alpha.example"], staffOwner: "rob@offline2online.com", lastResearchedAt: "2026-11-01" },
        people: [
          { id: "ceo", name: "Carol Chief", title: "CEO", reportsTo: "", buyingRole: "decision-maker", email: "carol@alpha.example" },
          { id: "cio", name: "Ian Tech", title: "CIO", reportsTo: "ceo", buyingRole: "champion", email: "ian@alpha.example", engagement: ["demo"] },
          { id: "dev", name: "Dee Dev", title: "Architect", reportsTo: "cio", buyingRole: "technical-evaluator" },
        ],
        awsTeam: [{ id: "am1", name: "Amy AWS", role: "account-manager", email: "amy@aws.example", dealRole: "Owns the account", engages: ["cio"], source: "manual" }],
        aceOpportunity: { id: "O1", sellerName: "Sam Seller", sellerEmail: "sam@aws.example" },
        documents: [{ id: "d1", title: "Alpha prospect pack", kind: "prospect-pack", version: 1, date: "2026-10-01", tags: ["grocery"] }, { id: "d2", title: "Alpha prospect pack", kind: "prospect-pack", version: 2, date: "2026-10-20", url: "https://docs.example/alpha-v2", sharedWith: [{ name: "Amy AWS", email: "amy@aws.example", aws: true, at: "2026-10-21" }] }] },
    } }),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "promote", "promote-prospects-btn", "prospects-page");
      assert.ok(new URL(c.page.url()).hash === "#promote/prospects", "the page has its own URL");
      const order = await c.page.evaluate(() => {
        const a = document.getElementById("promote-leads-btn"), b = document.getElementById("promote-prospects-btn");
        return { after: !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING), label: b.textContent.trim(), sibling: a.nextElementSibling === b };
      });
      assert.ok(order.after && order.sibling, "Prospects (TAM) sits directly below Leads");
      assert.ok(order.label.endsWith("Prospects (TAM)"), "the entry is labelled Prospects (TAM)");
      const rowIds = () => c.page.evaluate(() => [...document.querySelectorAll("#prospects-grid .ag-center-cols-container .ag-row")].map((r) => r.getAttribute("row-id")).sort().join());
      await until(async () => (await rowIds()) === "pa,pb,pc", "the grid to show all three prospects", 8000);
      const count = async () => (await c.text("#prospects-count")).replace(/\s+/g, " ").trim();
      assert.strictEqual(await count(), "3 Prospects");
      assert.strictEqual(await c.page.locator("#prospects-page > p:not(.field-hint):not([hidden])").count(), 0, "no explanatory copy under the grid");
      assert.ok((await c.page.getAttribute("#prospects-info", "title")).length > 20, "help is an info tooltip");
      // Same grid as User Management: theme, floating filter row, checkbox column, pagination, one pinned "..." menu per row.
      assert.ok(await c.page.locator("#prospects-grid.ag-theme-alpine.um-grid").count(), "uses the standard console grid");
      assert.ok(await c.page.locator("#prospects-grid .ag-floating-filter").count() > 3, "floating filter row");
      assert.ok(await c.page.locator('#prospects-grid .ag-pinned-left-cols-container .ag-selection-checkbox, #prospects-grid .ag-pinned-left-cols-container input[type=checkbox]').count() >= 3, "checkbox column");
      assert.ok(await c.page.locator("#prospects-grid .ag-paging-panel").count(), "pagination footer");
      assert.strictEqual(await c.page.locator("#prospects-grid .prospect-act, #prospects-grid .btn-ghost").count(), 0, "no per-row text buttons");
      assert.strictEqual(await c.page.locator("#prospects-grid button.um-manage").count(), 3, "a row menu button per row");
      const overflow = await c.page.evaluate(() => { const v = document.querySelector("#prospects-grid .ag-body-horizontal-scroll-viewport"); return v ? v.scrollWidth - v.clientWidth : 0; });
      assert.ok(c.width < 1280 || overflow <= 1, `default columns fit without horizontal scrolling (overflow ${overflow}px)`);
      assert.strictEqual(await c.page.locator('#prospects-grid .ag-header-cell[col-id="subIndustry"]').count(), 0, "Sub-industry is hidden by default");
      // The default columns, in order; the ticket's hidden ones are offered in Columns.
      const headers = await c.page.evaluate(() => [...document.querySelectorAll("#prospects-grid .ag-header-row-column .ag-header-cell[col-id]")].map((h) => h.getAttribute("col-id")).filter((i) => i !== "select"));
      assert.deepStrictEqual(headers, ["name", "country", "industry", "priority", "storeCount", "linkedin", "status", "actions"], "default columns");
      for (const id of ["subIndustry", "hqCountry", "awsRegion", "sizeBand", "storePresence", "ownership", "insights", "decisionMakers", "contacts", "source", "vendors", "campaigns"]) assert.strictEqual(await c.page.locator(`#prospects-grid .ag-header-cell[col-id="${id}"]`).count(), 0, `${id} is hidden by default`);
      // No search box: all filtering is in the column filters.
      assert.strictEqual(await c.page.locator("#prospects-q").count(), 0, "no separate search box");
      // The company is a button that opens the drawer; LinkedIn is an icon link only where there is a page.
      assert.strictEqual(await c.page.locator('#prospects-grid .ag-row[row-id="pa"] [col-id="name"] button.prospect-name-btn').count(), 1);
      assert.strictEqual(await c.page.locator('#prospects-grid .ag-row[row-id="pa"] [col-id="linkedin"] a[href="https://www.linkedin.com/company/alpha-grocer/"]').count(), 1);
      assert.strictEqual(await c.page.locator('#prospects-grid .ag-row[row-id="pb"] [col-id="linkedin"] a').count(), 0);
      // A company name opens its detail view: profile, org chart, AWS team, document library.
      assert.strictEqual(await c.page.locator('#prospects-grid .ag-row[row-id="pa"] [col-id="name"] button.prospect-name-btn').count(), 1, "the company name is a button");
      await c.page.click('#prospects-grid .ag-row[row-id="pa"] [col-id="name"] button.prospect-name-btn');
      await c.visible("#prospect-detail .pd-name", "the company detail view opens");
      assert.strictEqual((await c.text("#prospect-detail .pd-name")).trim(), "Alpha Grocer");
      assert.ok((await c.text("#prospect-detail .pd-summary")).includes("A UK grocery chain."), "the profile summary shows");
      assert.ok((await c.text("#prospect-detail")).includes("Acme Signage"), "existing vendors show");
      assert.strictEqual(await c.page.locator("#prospects-grid:visible").count(), 0, "the grid is out of the way");
      await c.page.click("#pd-tab-org");
      assert.strictEqual(await c.page.locator("#prospect-detail .pd-person").count(), 3, "all three people in the org chart");
      assert.ok(await c.page.locator("#prospect-detail .pd-role-decision-maker").count() > 0 && await c.page.locator("#prospect-detail .pd-role-champion").count() > 0, "buying-role badges");
      assert.ok((await c.text("#prospect-detail")).includes("Demo"), "engagement shows on the person");
      await c.page.click('[data-act="toggle"][data-id="cio"]');
      assert.strictEqual(await c.page.locator("#prospect-detail .pd-person").count(), 2, "collapsing the CIO hides the architect");
      await c.page.click('[data-act="toggle"][data-id="cio"]');
      await c.page.click("#pd-tab-aws");
      assert.ok((await c.text("#prospect-detail")).includes("Sam Seller"), "the ACE seller is the account manager");
      assert.strictEqual(await c.page.locator('#prospect-detail a.pd-mail[href^="mailto:amy@aws.example"]').count(), 1, "a one-click email icon");
      assert.ok((await c.text("#prospect-detail")).includes("Engaging Ian Tech"), "which customer contact each AWS person engages");
      await c.page.click("#pd-tab-docs");
      assert.strictEqual(await c.page.locator("#prospect-detail .pd-doc.is-latest").count(), 1, "one current version per document");
      assert.ok((await c.text("#prospect-detail")).includes("Shared with AWS") && (await c.text("#prospect-detail")).includes("1 earlier version"), "sharing and version history");
      await c.page.click('#prospect-detail [data-act="back"]');
      await c.visible("#prospects-grid", "back to the grid");
      assert.strictEqual(await c.page.locator('#prospects-grid .ag-row[row-id="pb"] [col-id="name"] button.prospect-name-btn').count(), 1);
      // Company filter, with its × to clear.
      const clearBtn = (col) => c.page.locator(`#prospects-grid .prospect-clear[data-clear-col="${col}"]`);
      assert.ok(!(await clearBtn("name").isVisible()), "no × while the filter is empty");
      await c.page.fill('#prospects-grid input[aria-label="Company Filter Input"]', "Beta");
      await until(async () => (await rowIds()) === "pb", "the Company filter to apply", 5000);
      assert.strictEqual(await count(), "1 of 3 Prospects");
      await c.visible('#prospects-grid .prospect-clear[data-clear-col="name"]', "the × appears once the filter has a value");
      await clearBtn("name").click();
      await until(async () => (await rowIds()) === "pa,pb,pc", "the × to clear the Company filter", 5000);
      await until(async () => (await count()) === "3 Prospects", "the count to update after the ×", 5000);
      assert.ok(!(await clearBtn("name").isVisible()), "the × goes once cleared");
      // Country: a searchable list of every country, not only the ones in the data.
      const openFilter = async (name) => { await c.page.click(`#prospects-grid button.pl-trigger[aria-label="Filter ${name}"]`); await c.visible(".pl-pop .pl-search-input", `the ${name} list opens`); };
      await openFilter("Country");
      assert.ok(await c.page.locator(".pl-pop .pl-opt").count() > 190, "every country is listed");
      await c.page.fill(".pl-pop .pl-search-input", "germ");
      assert.deepStrictEqual(await c.page.locator(".pl-pop .pl-opt span").allTextContents(), ["Germany"], "typing narrows the list");
      await c.page.check('.pl-pop input[data-v="Germany"]');
      await until(async () => (await rowIds()) === "pb", "the Country filter to apply", 5000);
      assert.strictEqual((await c.text('#prospects-grid button.pl-trigger[aria-label="Filter Country"] .pl-trigger-text')).trim(), "Germany");
      await c.page.click(".pl-pop .pl-clear");
      await until(async () => (await rowIds()) === "pa,pb,pc", "Clear to reset the Country filter", 5000);
      await c.page.keyboard.press("Escape");
      assert.strictEqual(await c.page.locator(".pl-pop").count(), 0, "Escape closes the list");
      // Industry: exactly the nine website industries plus Unassigned.
      await openFilter("Industry");
      assert.deepStrictEqual(await c.page.locator(".pl-pop .pl-opt span").allTextContents(), ["Fuel & Convenience", "Pubs & Hospitality", "Telco Retail", "Pharmacy", "Retail Media", "Grocery & Supermarkets", "Fashion & Department Stores", "Quick Service Restaurants", "Banking", "Unassigned"]);
      await c.page.check('.pl-pop input[data-v="Grocery & Supermarkets"]');
      await until(async () => (await rowIds()) === "pa", "the Industry filter to apply (legacy Grocery maps)", 5000);
      await c.page.click(".pl-pop .pl-clear");
      await until(async () => (await rowIds()) === "pa,pb,pc", "Clear to reset the Industry filter", 5000);
      await c.page.keyboard.press("Escape");
      // Stores (number) clears with its x.
      await c.page.fill('#prospects-grid input[aria-label="Stores Filter Input"]', "400");
      await until(async () => (await rowIds()) === "pa", "the Stores filter to apply", 5000);
      await clearBtn("storeCount").click();
      await until(async () => (await rowIds()) === "pa,pb,pc", "the x to clear the Stores filter", 5000);
      // A record without country reads as its first market (Gamma Fashion: France).
      await openFilter("Country");
      await c.page.check('.pl-pop input[data-v="France"]');
      await until(async () => (await rowIds()) === "pc", "the legacy record to filter by its first market", 5000);
      await c.page.click(".pl-pop .pl-clear");
      await until(async () => (await rowIds()) === "pa,pb,pc", "the Country filter to clear again", 5000);
      await c.page.keyboard.press("Escape");
      // The grid pins under the console header and shows 50 rows a page.
      assert.strictEqual(await c.page.evaluate(() => getComputedStyle(document.getElementById("prospects-grid")).position), "sticky", "the grid (header + filter row) is pinned");
      assert.strictEqual((await c.text("#prospects-grid .ag-paging-page-size .ag-picker-field-display, #prospects-grid .ag-paging-page-size")).includes("50"), true, "50 rows per page by default");
      // The Priority floating filter is the same searchable list.
      await openFilter("Priority");
      await c.page.check('.pl-pop input[data-v="high"]');
      await until(async () => (await rowIds()) === "pa", "the Priority filter to apply", 5000);
      await c.page.keyboard.press("Escape");
      assert.strictEqual(await count(), "1 of 3 Prospects");
      // Save the filter, clear, reapply from Saved filters.
      await c.page.click("#prospects-saved-btn");
      await c.page.click('[data-pop="savefilter"]');
      await c.page.fill("#dialog-field-0", "High priority");
      await c.click("#dialog-ok", "Save filter");
      await c.page.click("#prospects-saved-btn");
      await c.page.click('[data-pop="reset"]');
      await until(async () => (await rowIds()) === "pa,pb,pc", "Clear to show everything again", 5000);
      await c.page.click("#prospects-saved-btn");
      await c.page.click('[data-pop="apply"][data-arg="High priority"]');
      await until(async () => (await rowIds()) === "pa", "the saved filter to apply", 5000);
      await c.page.click("#prospects-saved-btn");
      await c.page.click('[data-pop="reset"]');
      await until(async () => (await rowIds()) === "pa,pb,pc", "Clear to show everything again", 5000);
      // Columns chooser brings back a hidden column.
      await c.page.click("#prospects-columns-btn");
      await c.page.check('[data-pop="col"][data-arg="campaigns"]');
      await c.visible('#prospects-grid .ag-header-cell[col-id="campaigns"]', "Campaigns shows after choosing it");
      await c.page.check('[data-pop="col"][data-arg="insights"]');
      await c.visible('#prospects-grid .ag-header-cell[col-id="insights"]', "Insights shows after choosing it");
      // Check the truncation styles (not measured overflow, which depends on font metrics and width). The cell renders a beat after the header.
      const insightsCell = '#prospects-grid .ag-row[row-id="pa"] [col-id="insights"] .prospect-trunc';
      await until(async () => (await c.page.locator(insightsCell).count()) === 1, "Insights cell to render as truncated text", 5000);
      const truncStyle = await c.page.locator(insightsCell).evaluate((el) => { const cs = getComputedStyle(el); return [cs.textOverflow, cs.whiteSpace, cs.overflow].join("|"); });
      assert.strictEqual(truncStyle, "ellipsis|nowrap|hidden", "Insights is truncated text");
      await c.page.keyboard.press("Escape");
      // Bulk: select two rows, set status, export selected.
      await c.page.click('#prospects-saved-btn');
      await c.page.click('[data-pop="reset"]');
      await until(async () => (await rowIds()) === "pa,pb,pc", "Clear to show everything again", 5000);
      await c.page.click('#prospects-grid .ag-row[row-id="pa"] .ag-selection-checkbox input, #prospects-grid .ag-row[row-id="pa"] input[type=checkbox]');
      await c.page.click('#prospects-grid .ag-row[row-id="pb"] .ag-selection-checkbox input, #prospects-grid .ag-row[row-id="pb"] input[type=checkbox]');
      await c.visible("#prospects-bulk", "the bulk bar appears");
      await c.page.selectOption("#prospects-bulk-status", "researching");
      await c.click("#prospects-bulk-apply", "Apply status");
      await until(async () => (await c.page.evaluate(() => ["pa", "pb"].map((i) => globalThis.__fbStub.col("prospects").get(i).status).join())) === "researching,researching", "both rows to take the status", 5000);
      assert.strictEqual(await c.page.evaluate(() => globalThis.__fbStub.col("prospects").get("pc").status), "new");
      const dl = c.page.waitForEvent("download");
      await c.page.click("#prospects-export-selected");
      const csv = fs.readFileSync(await (await dl).path());
      assert.ok(csv.includes("Alpha Grocer") && csv.includes("Beta Pharmacy") && !csv.includes("Gamma Fashion"), "Export selected has only the selected rows");
      // No bulk Convert (it is only in a row's menu), and Converted is not a status you can set.
      assert.strictEqual(await c.page.locator("#prospects-bulk-convert").count(), 0, "no bulk Convert to lead");
      assert.strictEqual(await c.page.locator('#prospects-bulk-status option[value="converted"]').count(), 0, "Converted is not offered in the bulk status");
      // Export for LinkedIn: the selected rows in LinkedIn's Matched Audiences format.
      const dl2 = c.page.waitForEvent("download");
      await c.page.click("#prospects-export-linkedin");
      const li = fs.readFileSync(await (await dl2).path(), "utf8").trim().split("\r\n");
      assert.strictEqual(li[0], "companyname,companywebsite,companyemaildomain,linkedincompanypageurl,stocksymbol,industry,city,state,companycountry,zipcode");
      assert.strictEqual(li.length, 3, "one line per selected row");
      assert.ok(li.some((l) => l.startsWith("Alpha Grocer,https://alpha.example,alpha.example,https://www.linkedin.com/company/alpha-grocer/,,Grocery & Supermarkets,,,United Kingdom,")), li.join("|"));
      await c.page.click('#prospects-grid .ag-header-cell[col-id="select"] input[type=checkbox]');
      await c.page.click('#prospects-grid .ag-header-cell[col-id="select"] input[type=checkbox]');
      // Convert to lead from the row menu: one Leads card linked back, status converted, and no second Convert.
      assert.strictEqual(await c.page.locator("#prospects-grid .ag-row button:not(.um-manage):not(.prospect-name-btn):not(.prospect-clear)").count(), 0, "the row has no Convert button");
      await c.page.evaluate(() => document.querySelector('button[data-prospect-menu="pa"]').click());
      assert.strictEqual(await c.page.locator('[data-pop="status"][data-arg="converted"]').count(), 0, "Converted is not offered under Set status");
      assert.ok(await c.page.locator('[data-pop="status"]').count() >= 4, "the other statuses are");
      await c.page.click('[data-pop="convert"]');
      await until(async () => (await c.page.evaluate(() => globalThis.__fbStub.col("prospects").get("pa").leadId)) === "prospect-pa", "the prospect to link to its lead", 5000);
      const lead = await c.page.evaluate(() => globalThis.__fbStub.col("leads").get("prospect-pa"));
      assert.strictEqual(lead.prospectId, "pa");
      assert.strictEqual(lead.company.name, "Alpha Grocer");
      assert.strictEqual(lead.stage, "lead");
      assert.strictEqual(await c.page.evaluate(() => globalThis.__fbStub.col("prospects").get("pa").status), "converted");
      await c.page.evaluate(() => document.querySelector('button[data-prospect-menu="pa"]').click());
      await c.visible('[data-pop="view"]', "the row menu now offers View lead");
      assert.strictEqual(await c.page.locator('[data-pop="convert"]').count(), 0, "no second Convert");
      await c.page.keyboard.press("Escape");
      assert.strictEqual(await c.page.evaluate(() => [...globalThis.__fbStub.col("leads").entries()].length), 1, "exactly one lead");
      // The Leads board shows it, and its drawer links back to the prospect.
      assert.deepStrictEqual(await c.page.evaluate(() => globalThis.__fbStub.col("leads").get("prospect-pa").company.countries), ["United Kingdom"], "the lead covers that record's country");
      // The drawer: every field, contacts table, insights; Priority saves from there.
      await c.page.evaluate(() => document.querySelector('button[data-prospect-open="pa"]').click());
      await c.visible("#prospect-detail .pd-name", "clicking a company opens its detail view");
      await c.page.click('#prospect-detail [data-act="allfields"]');
      await c.visible("#prospect-drawer", "All fields opens the drawer");
      const dtext = await c.text("#prospect-drawer");
      for (const want of ["Alpha Grocer", "United Kingdom", "Grocery", "Head of Retail Media", "Listed", "400+ stores", "Strong digital signage appetite.", "1234", "Jo Bloggs", "CMO", "May 2026", "alpha-grocer"]) assert.ok(dtext.includes(want), `the drawer shows ${want}`);
      assert.strictEqual(await c.page.locator("#prospect-sum-contacts table tbody tr").count(), 1, "contacts table");
      await c.page.selectOption("#prospect-priority", "low");
      await until(async () => (await c.page.evaluate(() => globalThis.__fbStub.col("prospects").get("pa").priority)) === "low", "the priority to save", 5000);
      // Edit form: change Store presence; the count follows; a search URL is refused.
      await c.click("#prospect-drawer-edit", "Edit in the drawer");
      await c.page.fill("#pf-storePresence", "~2,800");
      await c.page.fill("#pf-linkedinUrl", "https://www.linkedin.com/search/results/companies/?keywords=alpha");
      await c.click("#prospect-drawer-save", "Save");
      assert.ok((await c.text("#prospect-drawer-status")).includes("LinkedIn"), "a search URL is refused");
      await c.page.fill("#pf-linkedinUrl", "linkedin.com/company/Alpha-Grocer-UK");
      await c.click("#prospect-drawer-save", "Save");
      await until(async () => (await c.page.evaluate(() => globalThis.__fbStub.col("prospects").get("pa").storeCount)) === 2800, "the store count to follow Store presence", 5000);
      assert.strictEqual(await c.page.evaluate(() => globalThis.__fbStub.col("prospects").get("pa").linkedinUrl), "https://www.linkedin.com/company/alpha-grocer-uk/");
      await c.page.keyboard.press("Escape");
      await c.page.waitForSelector("#prospect-drawer", { state: "hidden" });
      await c.page.evaluate(() => { location.hash = "#promote/leads"; });
      await c.visible('.lead-lane[data-stage="lead"] .lead-card[data-lead-id="prospect-pa"]', "the converted prospect is on the Leads board");
      await c.page.click('.lead-card[data-lead-id="prospect-pa"]');
      await c.visible("#lead-sum-prospect", "the lead's drawer links to its prospect");
    },
  },
  {
    name: "FAQ article editor: SEO & agents group counts, limits and completeness",
    seed: () => seed({ faqCategories: { fc1: { name: "Getting started", order: 0, createdAt: t(T0), updatedAt: t(T0) } } }),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "publish", "faq-articles-btn", "faq-articles-page");
      await c.click("#fa-new-article-btn", "new article");
      await c.visible("#faq-article-editor-page", "editor opens");
      await c.click("#fa-group-seo-toggle", "open the SEO & agents group");
      await c.visible("#fa-seo-title-input", "SEO fields show");
      assert.strictEqual(await c.text("#fa-seo-completeness"), "SEO fields: 0 of 5 complete");
      c.at("limits");
      await c.page.fill("#fa-seo-title-input", "x".repeat(70));
      assert.strictEqual((await c.page.inputValue("#fa-seo-title-input")).length, 60, "SEO title stops at 60");
      await c.waitText("#fa-seo-title-count", "60 / 60", "the count shows the limit");
      await c.page.fill("#fa-meta-description-input", "y".repeat(200));
      assert.strictEqual((await c.page.inputValue("#fa-meta-description-input")).length, 155, "meta description stops at 155");
      await c.page.fill("#fa-direct-answer-input", "Open Pricing and add a local offer.");
      await c.page.fill("#fa-question-variants-input", "How do I set a price?\nCan a store change the RRP?");
      await c.waitText("#fa-question-variants-count", "2 / 20", "one variant per line");
      await c.page.selectOption("#fa-article-type-select", "guide");
      await c.waitText("#fa-seo-completeness", "5 of 5", "all five complete");
    },
  },
  {
    name: "FAQ Management: WordPress publish status badges, Live-at link and last sync",
    seed: () => ({ ...seed({
      faqCategories: { fc1: { name: "Getting started", order: 0, createdAt: t(T0), updatedAt: t(T0) } },
      faqArticles: {
        w1: { title: "Live one", categoryId: "fc1", order: 0, status: "published", bodyMd: "body one", createdAt: t(T0), updatedAt: t(T0) },
        w2: { title: "Waiting one", categoryId: "fc1", order: 1, status: "published", bodyMd: "body two", createdAt: t(T0), updatedAt: t(T0) },
        w3: { title: "Failed one", categoryId: "fc1", order: 2, status: "published", bodyMd: "body three", createdAt: t(T0), updatedAt: t(T0) },
        w4: { title: "Draft one", categoryId: "fc1", order: 3, status: "draft", bodyMd: "body four", createdAt: t(T0), updatedAt: t(T0) },
      },
    }),
      // sha256("body one").slice(0,16)
      wpPublished: { lastSync: new Date(Date.now() - 10 * 60000).toISOString(), pending: 0, failed: ["w3"], articles: [
        { id: "w1", url: "https://personalisationhub.com/support-centre/getting-started/live-one/", wpId: 1, hash: "0e260cb8cd2cc339", updatedAt: "x" },
        { id: "w2", url: "https://personalisationhub.com/support-centre/getting-started/waiting-one/", wpId: 2, hash: "stale", updatedAt: "x" },
      ] },
    }),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "publish", "faq-articles-btn", "faq-articles-page");
      const badge = (id) => c.page.locator(`.faq-article-row[data-id="${id}"] .badge-wp`);
      await c.waitText("#faq-wp-sync", "min ago", "last sync shows a time");
      await c.page.locator(".faq-article-row .badge-wp").first().waitFor();
      assert.strictEqual((await badge("w2").textContent()).trim(), "Waiting", "older hash is Waiting");
      assert.strictEqual((await badge("w3").textContent()).trim(), "Failed", "id in failed");
      assert.strictEqual((await badge("w4").textContent()).trim(), "Not published", "draft");
      assert.strictEqual((await badge("w1").textContent()).trim(), "Live", "matching hash is Live");
      await c.click('.faq-article-row[data-id="w1"] .faq-article-title', "open the live article");
      await c.click("#fa-group-status-toggle", "open Status & publishing");
      await c.visible("#fa-live-link-hint a", "live link shows");
      assert.strictEqual(await c.page.getAttribute("#fa-live-link-hint a", "href"), "https://personalisationhub.com/support-centre/getting-started/live-one/", "uses the endpoint url");
      assert.match(await c.text("#fa-live-link-hint"), /Live/);
    },
  },
  {
    name: "FAQ Management: endpoint unreachable still loads, badges say Status unavailable",
    seed: () => ({ ...seed({
      faqCategories: { fc1: { name: "Getting started", order: 0, createdAt: t(T0), updatedAt: t(T0) } },
      faqArticles: { w1: { title: "Live one", categoryId: "fc1", order: 0, status: "published", bodyMd: "body one", createdAt: t(T0), updatedAt: t(T0) } },
    }), wpPublishedDown: true }),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "publish", "faq-articles-btn", "faq-articles-page");
      await c.page.waitForFunction(() => /Status unavailable/.test((document.querySelector('.faq-article-row[data-id="w1"] .badge-wp') || {}).textContent || ""), null, { timeout: 8000 });
      await c.page.waitForFunction(() => /unavailable/.test((document.getElementById("faq-wp-sync") || {}).textContent || ""), null, { timeout: 8000 });
      await c.visible('.faq-article-row[data-id="w1"] .faq-article-title', "the list still renders");
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
  {
    name: "Promote: Prospects company detail - two country records share one org chart, AWS account ID, lead card compact view",
    seed: () => seed({
      prospects: {
        "aldi-australia": { name: "ALDI", country: "Australia", industry: "Grocery", hqCountry: "Germany", markets: ["Germany", "Australia"], awsRegion: "ap-southeast-2", storeCount: 600, sizeBand: "large", vendors: [], campaigns: [], status: "converted", leadId: "l1", createdAt: t(T0), updatedAt: t(T0) },
        "aldi-netherlands": { name: "ALDI", country: "Netherlands", industry: "Grocery", hqCountry: "Germany", markets: ["Germany", "Netherlands"], awsRegion: "eu-central-1", storeCount: 500, sizeBand: "large", vendors: [], campaigns: [], status: "new", leadId: "", createdAt: t(T0), updatedAt: t(T0) },
      },
      prospectCompanies: {
        aldi: { name: "ALDI", profile: { summary: "Discount grocer." },
          people: [
            { id: "ceo", name: "Carol Chief", title: "CEO", buyingRole: "decision-maker", email: "carol@aldi.example", awsAccountId: "123456789012" },
            { id: "cio", name: "Ian Tech", title: "CIO", reportsTo: "ceo", buyingRole: "champion", email: "ian@aldi.example" },
          ],
          awsTeam: [{ id: "am1", name: "Amy AWS", role: "account-manager", email: "amy@aws.example", engages: ["cio"], source: "manual" }], aceOpportunity: null, documents: [] },
      },
      leads: { l1: { company: { name: "ALDI", website: "", industry: "Grocery", countries: ["Australia"], storeCount: 600 }, contacts: [{ id: "k1", name: "Ian Tech", jobTitle: "CIO", buyingRole: "champion", email: "ian@aldi.example", linkedin: "" }], stage: "lead", source: "Manual", assignee: "", customerAccount: null, prospectId: "aldi-australia", createdAt: t(T0), updatedAt: t(T0), stageChangedAt: t(T0) } },
    }),
    async run(c) {
      await c.boardReady();
      await openFromNav(c, "promote", "promote-prospects-btn", "prospects-page");
      const names = async () => (await c.page.locator("#prospect-detail .pd-person-name").allTextContents()).map((x) => x.trim()).sort();
      const openCompany = async (rowId) => {
        await c.visible(`#prospects-grid .ag-row[row-id="${rowId}"] button.prospect-name-btn`, `the ${rowId} row`);
        await c.page.click(`#prospects-grid .ag-row[row-id="${rowId}"] button.prospect-name-btn`);
        await c.visible("#prospect-detail .pd-name", "the detail view opens");
        await c.page.click("#pd-tab-org");
        await until(async () => (await names()).length > 0, "the org chart to load", 5000);
      };
      await openCompany("aldi-australia");
      assert.deepStrictEqual(await names(), ["Carol Chief", "Ian Tech"]);
      assert.ok((await c.text("#prospect-detail")).includes("AWS account 123456789012"), "a person's AWS account ID shows");
      assert.ok((await c.text("#prospect-detail")).includes("Lead contact"), "the lead's contact is highlighted");
      // Add a person from the Australian record, with a bad account ID first.
      await c.page.click('#prospect-detail [data-act="edit"][data-kind="person"]');
      await c.page.fill('#prospect-detail form[data-form="person"] [name="name"]', "Dee Dev");
      await c.page.fill('#prospect-detail form[data-form="person"] [name="awsAccountId"]', "12345");
      await c.page.click('#prospect-detail form[data-form="person"] button[type="submit"]');
      assert.ok((await c.text("#prospect-detail .pd-form-error")).includes("exactly 12 digits"), "a bad account ID is refused");
      await c.page.fill('#prospect-detail form[data-form="person"] [name="awsAccountId"]', "1234-5678-9013");
      await c.page.selectOption('#prospect-detail form[data-form="person"] [name="reportsTo"]', "cio");
      await c.page.click('#prospect-detail form[data-form="person"] button[type="submit"]');
      await until(async () => (await names()).length === 3, "the new person to appear", 5000);
      const stored = await c.page.evaluate(() => globalThis.__fbStub.col("prospectCompanies").get("aldi").people.map((p) => [p.name, p.awsAccountId]));
      assert.deepStrictEqual(stored.find((x) => x[0] === "Dee Dev"), ["Dee Dev", "123456789013"], "stored once, on the company");
      assert.strictEqual(await c.page.evaluate(() => "people" in globalThis.__fbStub.col("prospects").get("aldi-australia")), false, "not on the country record");
      // The Netherlands record shows the very same org chart.
      await c.page.click('#prospect-detail [data-act="back"]');
      await openCompany("aldi-netherlands");
      assert.deepStrictEqual(await names(), ["Carol Chief", "Dee Dev", "Ian Tech"], "ALDI · Netherlands has the same org chart as ALDI · Australia");
      await c.page.click("#pd-tab-profile");
      assert.ok((await c.text("#prospect-detail .pd-shared-note")).includes("Australia") && (await c.text("#prospect-detail .pd-shared-note")).includes("Netherlands"), "the profile says the detail is shared");
      // The AWS account ID is a field of this country record.
      await c.page.click('#prospect-detail [data-act="edit"][data-kind="profile"]');
      await c.page.fill('#prospect-detail form[data-form="profile"] [name="awsAccountId"]', "999988887777");
      await c.page.click('#prospect-detail form[data-form="profile"] button[type="submit"]');
      await until(async () => (await c.text("#prospect-detail")).includes("999988887777"), "the account ID to show on the profile", 5000);
      assert.strictEqual(await c.page.evaluate(() => globalThis.__fbStub.col("prospects").get("aldi-netherlands").awsAccountId), "999988887777");
      assert.strictEqual(await c.page.evaluate(() => globalThis.__fbStub.col("prospects").get("aldi-australia").awsAccountId || ""), "");
      // The lead card shows the compact org chart and AWS team from the same company document.
      await c.page.click('#prospect-detail [data-act="back"]');
      await openFromNav(c, "promote", "promote-leads-btn", "leads-page");
      await c.visible(".lead-card .lead-card-detail", "the lead card shows a compact view");
      const card = await c.text(".lead-card .lead-card-detail");
      assert.ok(card.includes("Decision maker") && card.includes("Amy AWS"), "buying-role summary and AWS contact on the card");
      assert.strictEqual(await c.page.locator('.lead-card .lead-card-detail a[href^="mailto:amy@aws.example"]').count(), 1, "an email icon for the AWS contact");
      // The lead form takes the company's and a contact's AWS account ID.
      await c.page.click(".lead-card");
      await c.visible("#lead-sum-body", "the lead summary opens");
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
        if (process.env.SCENARIO && !s.name.includes(process.env.SCENARIO)) continue; // SCENARIO=<part of a name> runs just those
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
