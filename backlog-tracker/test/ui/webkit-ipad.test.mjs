// The console's menu and the Support Inbox in a real WebKit engine, as an iPad.
//
// Every other browser test here runs in Chromium, and the iPad failures the
// console has had are WebKit's (root CLAUDE.md → "iPad taps"). Chromium with
// touch emulation only imitates them. This test drives Playwright's WebKit
// build with an iPad profile (viewport, touch, the iPad user agent), which is
// the same engine family as iPad Safari though not iPad Safari itself.
//
// It needs the WebKit engine (`npx playwright-core install --with-deps webkit`),
// which .github/workflows/console-webkit.yml installs. Without it the test
// says NOT RUN and passes, unless REQUIRE_WEBKIT=1.
//
// Checked, in landscape and portrait:
//   1. the console starts with no page or console error;
//   2. every sidebar item opens its page by a finger tap (the route changes and
//      the page's own section is on screen);
//   3. the Support Inbox journey: a queue, a ticket, the suggested reply, Send,
//      the email icon, and Settings › Support inbox.
// Run with:  cd backlog-tracker/test && node ui/webkit-ipad.test.mjs
import assert from "node:assert";
import { devices } from "playwright-core";
import { startHarness, until } from "./harness.mjs";

const T0 = Date.now() - 2 * 86400000, t = (ms) => ({ $ts: ms });
const ticket = (n, d) => ({ key: `SUP-${n}`, number: n, threadId: `t${n}`, subject: `Subject ${n}`, customerEmail: `c${n}@shop.example`, customerName: `Customer ${n}`, status: "open",
  needsHuman: false, triagePending: false, automated: "", highValue: false, account: null, category: "question", summary: "", snippet: `Snippet ${n}`, createdAt: t(T0), lastMessageAt: t(T0 + n * 60000),
  messageCount: 1, humanInvolved: false, autoRepliesSent: 0, reopenCount: 0, firstResponseAt: null, resolvedAt: null, resolvedBy: "", assignee: "", kanbanKey: "", aiDraft: null, ...d });
const DRAFT = { text: "Hello Ann,\n\nOpen Displays and Devices, then choose Add display.", confidence: 0.86, answerable: true, articles: [{ id: "a1", title: "Add a display to a store" }] };
const seed = { user: { email: "admin@personalisationhub.com", role: "admin" },
  supportStatus: { encryptionReady: true, aiReady: true, clientSet: true, clientId: "123-abc.apps.googleusercontent.com", connected: true, connectedEmail: "support@ph.example", connectedBy: "admin@personalisationhub.com",
    connectionError: "", lastSyncAt: new Date().toISOString(), lastSyncOk: true, lastSyncError: "", redirectUri: "https://console.example/supportMail/v1/oauth/callback",
    settings: { autoReply: false, autoReplyThreshold: 0.8, escalationAssignee: "", signature: "PH Support", fromName: "PH Support", vipDomains: [], importDays: 7 } },
  docs: {
    projects: { p1: { name: "Demo", createdAt: t(T0) } },
    backlogItems: { b1: { projectId: "p1", title: "Purple widget", desc: "x", type: "feature", category: "HQ Admin", status: "backlog", createdAt: t(T0), updatedAt: t(T0) } },
    concepts: { c1: { name: "Alpha", type: "Platform", status: "active", description: "Alpha", createdAt: t(T0), updatedAt: t(T0) } },
    supportTickets: { t1: ticket(1, { subject: "How do I add a display?", customerName: "Ann Lee", customerEmail: "ann@shop.example", aiDraft: DRAFT }), t2: ticket(2, { needsHuman: true }), t3: ticket(3, { status: "resolved", resolvedBy: "ai" }) },
    "supportTickets/t1/messages": { m1: { direction: "in", from: "ann@shop.example", fromName: "Ann Lee", text: "How do I add a display?", at: t(T0) } },
    faqArticles: { a1: { status: "published", title: "Add a display to a store", directAnswer: "Open Displays and Devices, then choose Add display.", keywords: ["display"] } },
    memberDirectory: { "admin@personalisationhub.com": { email: "admin@personalisationhub.com", displayName: "Ada Min" } },
  } };

// Sidebar item → the route it must reach and the section that must be on screen.
const MENU = [
  ["staff-kanban-btn", "#staff-kanban", "#staff-kanban-page"],
  ["concept-incubator-btn", "#concept-incubator", "#concept-incubator-page"],
  ["dashboard-btn", "#dashboard", "#dashboard-page"],
  ["promote-brand-btn", "#promote/brand-guidelines", "#promote-page"],
  ["promote-leads-btn", "#promote/leads", "#leads-page"],
  ["promote-prospects-btn", "#promote/prospects", "#prospects-page"],
  ["promote-funnel-btn", "#promote/conversion-funnel", "#funnel-page"],
  ["support-inbox-btn", "#support", "#support-page"],
  ["faq-articles-btn", "#faq-management", "#faq-articles-page"],
  ["faq-settings-btn", "#settings", "#faq-settings-page"],
  // The Agent Board's own address is #board since the Dashboard became the landing page (17 Nov 2026).
  ["nav-ph-console-btn", "#board", "#projects-root"],
];

const h = await startHarness();
const webkit = await h.engine("webkit");
if (!webkit) {
  await h.close();
  const why = h.missing.get("webkit") || "not installed";
  if (process.env.REQUIRE_WEBKIT) { console.error(`webkit-ipad: WebKit is required here and is not available: ${why}`); process.exit(1); }
  console.log(`webkit-ipad: NOT RUN — WebKit is not available here (${why})`);
  process.exit(0);
}
console.log(`webkit-ipad: WebKit ${webkit.version()}`);

let failures = 0;
try {
  for (const name of ["iPad Pro 11 landscape", "iPad Pro 11", "iPad (gen 7) landscape", "iPad Mini"]) {
    const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices[name];
    const o = await h.open({ seed, width: viewport.width, height: viewport.height, engine: "webkit", contextOptions: { userAgent, deviceScaleFactor, isMobile, hasTouch } });
    const { page } = o;
    const slideOver = viewport.width < 1024;
    const hash = () => page.evaluate(() => location.hash);
    const problems = () => o.problems.filter((p) => !/unrouted host/.test(p));
    // What a finger would meet: where things are, how the page is scrolled and zoomed.
    const geometry = (sel) => page.evaluate((q) => {
      const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
      const d = document.getElementById("nav-drawer"), v = window.visualViewport;
      return { target: rect(document.querySelector(q)), drawer: rect(d), drawerClass: d.className, drawerTransform: getComputedStyle(d).transform, drawerPosition: getComputedStyle(d).position,
        inner: [innerWidth, innerHeight], scroll: [Math.round(scrollX), Math.round(scrollY)], doc: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        visual: v ? { left: Math.round(v.offsetLeft), top: Math.round(v.offsetTop), width: Math.round(v.width), height: Math.round(v.height), scale: v.scale } : null,
        backdropOpen: document.getElementById("nav-drawer-backdrop").classList.contains("open") };
    }, sel);
    // `scroll: false` for sidebar items: a person never scrolls the menu to reach them, and the test must not either.
    const tap = async (sel, { scroll = true } = {}) => {
      const p = await page.evaluate(([q, scroll]) => {
        const b = document.querySelector(q);
        if (!b || !b.getClientRects().length || b.closest("[hidden]")) return null;
        if (scroll) b.scrollIntoView({ block: "center" });
        const r = b.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, under: top ? (top.id || String(top.className).slice(0, 40) || top.tagName) : "nothing" };
      }, [sel, scroll]);
      assert.ok(p, `${sel} is not on screen`);
      await page.waitForTimeout(220);
      await page.touchscreen.tap(p.x, p.y);
      return p;
    };
    const openMenu = async () => {
      if (!slideOver) return;
      await page.evaluate(() => document.getElementById("nav-open-btn").click());
      await until(() => page.evaluate(() => getComputedStyle(document.getElementById("nav-drawer")).visibility === "visible"), "the slide-over menu");
      // The menu slides in over 220 ms. In WebKit its position can read as "open" for a moment before the
      // slide has even started, so one reading is not enough: it has arrived when it sits at the left edge
      // on several readings in a row, a frame apart, with its first item really under a finger.
      const settled = () => page.evaluate(async () => {
        const d = document.getElementById("nav-drawer"), b = document.getElementById("nav-ph-console-btn");
        for (let i = 0; i < 6; i++) {
          if (Math.round(d.getBoundingClientRect().left) !== 0) return false;
          await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 40)));
        }
        const r = b.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!top && (top === b || b.contains(top));
      });
      await until(settled, "the slide-over menu to finish opening", 6000);
    };
    let at = "start";
    try {
      at = "the console starts";
      await until(() => page.locator(".project-options-btn").count(), "the board", 20000);
      assert.deepStrictEqual(problems(), [], "errors while the console started");

      // Three times round the menu: a tap that is lost one time in five must not slip through.
      for (let round = 1; round <= 3; round++) for (const [id, wantHash, section] of MENU) {
        at = `menu → ${id} (round ${round})`;
        // Start each item from a different page, so "nothing happened" can't pass by accident.
        await page.evaluate((s) => { location.hash = s; }, id === "staff-kanban-btn" ? "#concept-incubator" : "#staff-kanban");
        await page.waitForTimeout(500);
        await openMenu();
        const before = await geometry(`#${id}`);
        const p = await tap(`#${id}`, { scroll: false });
        try {
          // Settings opens on its first tab, so its route is "#settings/…".
          await until(async () => { const got = (await hash()).split("?")[0]; return got === wantHash || (wantHash === "#settings" && got.startsWith("#settings/")); }, `the route ${wantHash}`, 5000);
          // And the page it came from is gone: "nothing happened" and "both pages showing" both fail here.
          const others = await page.evaluate((q) => ["#staff-kanban-page", "#concept-incubator-page", "#leads-page", "#support-page", "#faq-articles-page", "#faq-settings-page"].filter((x) => x !== q && !document.querySelector(x).hidden), section);
          assert.deepStrictEqual(others, [], "another page is still on screen");
          await until(() => page.evaluate((q) => { const el = document.querySelector(q); return !!el && !el.hidden && el.getClientRects().length > 0; }, section), `${section} on screen`, 8000);
        } catch (e) {
          throw new Error(`${e.message}; the tap at ${Math.round(p.x)},${Math.round(p.y)} landed on "${p.under}", the route is "${await hash()}", errors: ${JSON.stringify(problems())}; before the tap: ${JSON.stringify(before)}; now: ${JSON.stringify(await geometry(`#${id}`))}`);
        }
        assert.deepStrictEqual(problems(), [], `errors after opening ${id}`);
      }

      at = "Support Inbox: the list";
      await page.evaluate(() => { location.hash = "#staff-kanban"; });
      await page.waitForTimeout(400);
      await openMenu();
      await tap("#support-inbox-btn", { scroll: false });
      await until(() => page.locator("#support-page .support-row").count(), "the ticket list", 10000);
      at = "Support Inbox: a queue";
      await tap('[data-support-queue="ai-drafts"]');
      await until(() => page.locator('[data-support-ticket="t1"]').count(), "the drafted ticket", 5000);
      at = "Support Inbox: a ticket";
      await tap('[data-support-ticket="t1"]');
      await until(async () => (await hash()) === "#support/ticket/t1", "the ticket route", 5000);
      await until(() => page.locator(".support-msg-in").count(), "the conversation", 8000);
      at = "Support Inbox: the suggested reply";
      await tap('[data-support-act="use-draft"]');
      await until(async () => (await page.inputValue("#support-reply")) === DRAFT.text, "the suggested reply in the box", 5000);
      at = "Support Inbox: Send";
      await tap('[data-support-act="send"]');
      await until(() => o.supportCalls.some((c) => c.path === "tickets/t1/reply"), "the reply call", 5000);
      await page.waitForTimeout(500);
      assert.strictEqual(o.supportCalls.filter((c) => c.path === "tickets/t1/reply").length, 1, "Send fired more than once");
      at = "Support Inbox: the email icon";
      await page.evaluate(() => { location.hash = "#support"; });
      await until(() => page.locator("#support-compose-btn").isVisible(), "the email icon", 5000);
      await tap("#support-compose-btn");
      await until(() => page.locator("#support-compose-to").count(), "the new email form", 5000);
      at = "Settings › Support inbox";
      await page.evaluate(() => { location.hash = "#settings/projects"; });
      await until(() => page.locator('[data-settings-page="support"]').count(), "the Settings tabs", 8000);
      await page.waitForTimeout(300);
      await tap('[data-settings-page="support"]');
      await until(() => page.locator("#support-auto").count(), "the support inbox settings", 8000);
      await tap(".support-check");
      await until(() => page.isChecked("#support-auto"), "the switch to turn on", 4000);
      assert.deepStrictEqual(problems(), [], "page/console problems");
      console.log(`PASS ${name} (${viewport.width}x${viewport.height})`);
    } catch (e) {
      failures++;
      console.log(`FAIL ${name} (${viewport.width}x${viewport.height}) at "${at}": ${String(e.message).split("\n")[0].slice(0, 2500)}`);
      if (problems().length) console.log(`     errors: ${JSON.stringify(problems()).slice(0, 1500)}`);
    }
    await o.close();
  }
} finally { await h.close(); }
if (failures) { console.error(`webkit-ipad: ${failures} failure(s)`); process.exit(1); }
console.log("webkit-ipad: ok");
