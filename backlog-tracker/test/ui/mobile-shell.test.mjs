// Mobile shell regression (ticket e4WY9Nb4KClSoewNx13H): at 360, 390 and 820 px,
// on every page, the topbar stays pinned after a scroll, the phone tab bar (or
// the hamburger at 820) is on screen and works, nothing scrolls sideways, no
// control overlaps another, and core actions are clickable (hit-tested by
// Playwright). Run with:  cd backlog-tracker/test && node ui/mobile-shell.test.mjs
import assert from "node:assert";
import { startHarness, until } from "./harness.mjs";

const WIDTHS = [360, 390, 820];
const T0 = 1_760_000_000_000;
const t = (ms) => ({ $ts: ms });
const items = {};
const STATUSES = ["backlog", "ready-for-testing", "ready-to-publish", "published-live"];
for (let i = 0; i < 24; i++) items["i" + i] = { projectId: "p1", title: "Ticket " + i, desc: "A fairly long description of the ticket. ".repeat(6), type: i % 2 ? "bug" : "feature", category: "HQ Admin", status: STATUSES[i % 4], deployCommit: i % 4 === 1 || i % 4 === 2 ? "abc" + i : undefined, createdAt: t(T0 + i), updatedAt: t(T0 + i) };
const seed = {
  user: { email: "editor@personalisationhub.com", role: "editor" },
  docs: {
    projects: { p1: { name: "Demo Project", createdAt: t(T0), deployBranch: "deploy/demo", repoFolder: "demo" } },
    backlogItems: items,
    projectDocs: { d1: { projectId: "p1", name: "Release checklist", contentMd: "1. Ship it", createdAt: t(T0), updatedAt: t(T0) } },
  },
};

// [label, how to reach it]. Build/Publish pages are reached through the nav (tab sheet on a phone, hamburger on a tablet).
const PAGES = [
  ["board", { nav: "nav-ph-console-btn", group: "build" }],
  ["concepts + system map", { nav: "concept-incubator-btn", group: "build" }],
  ["help centre", { nav: "faq-articles-btn", group: "publish" }],
  ["settings", { nav: "faq-settings-btn", group: "settings" }],
];

async function go(page, width, how) {
  if (how.profile) {
    if (width <= 640) await page.click('.tab[data-tab="profile"]'); else await page.click("#profile-btn");
    await page.click(`#${how.profile}`);
  } else if (width <= 640) {
    await page.click(`.tab[data-tab="${how.group}"]`);
    await page.click(`#${how.nav}`);
  } else {
    await page.click("#nav-open-btn");
    await page.click(`#${how.nav}`);
  }
}

const h = await startHarness();
let failed = 0;
try {
  for (const width of WIDTHS) {
    const o = await h.open({ seed, width, height: 780 });
    const { page } = o;
    await until(() => page.locator("#total-summary").count(), "board header");
    for (const [label, how] of PAGES) {
      try {
        await go(page, width, how);
        await page.waitForTimeout(350);
        await page.evaluate(() => window.scrollTo(0, 100000));
        await page.waitForTimeout(250);
        const m = await page.evaluate(() => {
          const vh = innerHeight, vw = innerWidth;
          const box = (s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
          const top = document.elementFromPoint(vw / 2, 4);
          const tab = document.elementFromPoint(vw / 2, vh - 6);
          return {
            scrolled: scrollY, topbar: box(".topbar"), tabbar: box("#tabbar"), hamburger: box("#nav-open-btn"), vw, vh,
            topbarOnTop: !!(top && top.closest(".topbar, .mobile-action-bar")),
            tabbarOnTop: !!(tab && tab.closest("#tabbar")),
            overflow: document.documentElement.scrollWidth - vw,
            small: [...document.querySelectorAll(".tab, #nav-open-btn, #profile-btn")].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect()).filter((r) => r.height < 44 && r.width < 44).length,
          };
        });
        assert.ok(m.topbar && m.topbar.top >= 0 && m.topbar.top < 2, `topbar not pinned after scroll (top=${m.topbar && m.topbar.top}, scrollY=${m.scrolled})`);
        assert.ok(m.topbarOnTop, "topbar is covered at the top of the screen");
        if (width <= 640) {
          assert.ok(m.tabbar && Math.abs(m.tabbar.bottom - m.vh) < 2, "tab bar not pinned to the bottom");
          assert.ok(m.tabbarOnTop, "tab bar is covered");
          const tabs = await page.locator(".tab").count();
          assert.strictEqual(tabs, 5, "five tabs: Build, Publish, Settings, Search, Profile");
        } else assert.ok(m.hamburger && m.hamburger.top >= 0 && m.hamburger.bottom <= m.vh, "hamburger not reachable");
        assert.ok(m.overflow <= 0, `scrolls sideways by ${m.overflow}px`);
        assert.strictEqual(m.small, 0, "nav controls under 44px");
        // The page header's CTA must not hide under the tab bar when it pins.
        if (width <= 640) {
          const cta = await page.evaluate(() => { const b = document.querySelector(".page-header .btn-primary"); if (!b || !b.getClientRects().length) return null; const r = b.getBoundingClientRect(), tb = document.querySelector("#tabbar").getBoundingClientRect(); return r.bottom <= tb.top + 1; });
          assert.ok(cta !== false, "page CTA hides under the tab bar");
        }
        // Every nav control is hit-testable (nothing overlaps it).
        const covered = await page.evaluate(() => [...document.querySelectorAll(".tab, #nav-open-btn, #profile-btn")].filter((e) => e.getClientRects().length).filter((e) => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !(hit && e.contains(hit)); }).map((e) => e.id || e.dataset.tab));
        assert.deepStrictEqual(covered, [], "nav controls covered by another element");
        console.log(`PASS mobile-shell ${label} @${width}px`);
      } catch (e) { failed++; console.log(`FAIL mobile-shell ${label} @${width}px: ${e.message}`); }
    }
    // Board actions: open a ticket and reach its actions.
    try {
      await go(page, width, PAGES[0][1]);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForSelector(".project-options-btn", { state: "visible" });
      for (const sel of [".project-options-btn", ".new-item-btn", ".notify-claude-btn"]) await page.locator(`${sel}:visible`).first().click({ trial: true });
      console.log(`PASS mobile-shell board actions @${width}px`);
    } catch (e) { failed++; console.log(`FAIL mobile-shell board actions @${width}px: ${e.message}`); }
    await o.close();
  }
} finally { await h.close(); }
process.exit(failed ? 1 : 0);
