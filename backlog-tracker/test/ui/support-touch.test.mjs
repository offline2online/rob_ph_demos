// The Support Inbox on the iPad, end to end, by touch.
//
// The console has been reported dead on the iPad five times (20 Oct to 6 Nov
// 2026: REQUIREMENTS.md → "iPad taps" and "Stale page after a release"). Two
// causes, both checked here for the Support Inbox:
//
//  A. iPad WebKit loses taps. Chromium is not WebKit, so each way it has been
//     seen to lose one is reproduced on purpose (the same five as
//     nav-touch.test.mjs): plain, noclick (the click never comes), cancel
//     (pointercancel instead of pointerup), noptr (Touch Events only) and late
//     (the click arrives late, aimed at whatever is now under the finger).
//     In every mode, at iPad landscape, the 1024 edge and portrait, one person's
//     whole journey is done with a finger: the menu item, every queue, a
//     ticket, the suggested reply, a Help Centre article, a note, Send, Raise
//     on Staff Kanban, Mark as spam and its confirmation, the Stats tab and its
//     controls, Sync now, and Settings › Support inbox (the switch and Save).
//     Each tap must do its job EXACTLY once: a dropped tap does nothing, a
//     doubled one sends a customer two emails.
//  B. A page kept from before this release, running this release's scripts,
//     must still start, with a working menu, without needing the self-reload.
//
// Also: typing a reply is not interrupted when the ticket list changes
// underneath (rebuilding the box closes the iPad keyboard).
//
// Run with:  cd backlog-tracker/test && node ui/support-touch.test.mjs
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { startHarness, until, publicDir } from "./harness.mjs";

const T0 = Date.now() - 2 * 86400000, t = (ms) => ({ $ts: ms });
const ticket = (n, d) => ({ key: `SUP-${n}`, number: n, threadId: `t${n}`, subject: `Subject ${n}`, customerEmail: `c${n}@shop.example`, customerName: `Customer ${n}`, status: "open",
  needsHuman: false, triagePending: false, automated: "", highValue: false, account: null, category: "question", summary: "", snippet: `Snippet ${n}`, createdAt: t(T0), lastMessageAt: t(T0 + n * 60000),
  messageCount: 1, humanInvolved: false, autoRepliesSent: 0, reopenCount: 0, firstResponseAt: null, resolvedAt: null, resolvedBy: "", assignee: "", kanbanKey: "", aiDraft: null, ...d });
const DRAFT = { text: "Hello Ann,\n\nOpen Displays and Devices, then choose Add display.", confidence: 0.86, answerable: true, articles: [{ id: "a1", title: "Add a display to a store" }] };
const supportStatus = { encryptionReady: true, aiReady: true, clientSet: true, clientId: "123-abc.apps.googleusercontent.com", connected: true, connectedEmail: "support@ph.example", connectedBy: "admin@personalisationhub.com",
  connectionError: "", lastSyncAt: new Date().toISOString(), lastSyncOk: true, lastSyncError: "", redirectUri: "https://console.example/supportMail/v1/oauth/callback",
  settings: { autoReply: false, autoReplyThreshold: 0.8, escalationAssignee: "", signature: "PH Support", fromName: "PH Support", vipDomains: [], importDays: 7 } };
const seed = { user: { email: "admin@personalisationhub.com", role: "admin" }, supportStatus, docs: {
  projects: { p1: { name: "Demo", createdAt: t(T0) } },
  backlogItems: { b1: { projectId: "p1", title: "Purple widget", desc: "x", type: "feature", category: "HQ Admin", status: "backlog", createdAt: t(T0), updatedAt: t(T0) } },
  supportTickets: {
    t1: ticket(1, { subject: "How do I add a display?", customerName: "Ann Lee", customerEmail: "ann@shop.example", aiDraft: DRAFT }),
    t2: ticket(2, { needsHuman: true }), t3: ticket(3, { needsHuman: true }), t4: ticket(4, { automated: "mailing list" }),
    t5: ticket(5, { status: "resolved", resolvedBy: "ai", firstResponseAt: t(T0 + 60000), resolvedAt: t(T0 + 60000) }),
    t6: ticket(6, { status: "pending", humanInvolved: true }), t7: ticket(7, { status: "spam" }),
  },
  "supportTickets/t1/messages": { m1: { direction: "in", from: "ann@shop.example", fromName: "Ann Lee", text: "How do I add a display?", at: t(T0) } },
  faqArticles: { a1: { status: "published", title: "Add a display to a store", directAnswer: "Open Displays and Devices, then choose Add display.", keywords: ["display"] } },
  memberDirectory: { "admin@personalisationhub.com": { email: "admin@personalisationhub.com", displayName: "Ada Min" } },
} };

// iPad landscape (persistent sidebar), the 1024 edge, and portrait (slide-over menu, stacked queues).
const SIZES = [[1180, 820], [1024, 768], [820, 1180]];
const MODES = ["plain", "noclick", "cancel", "noptr", "late"];

// The ways iPad WebKit loses a tap (as in nav-touch.test.mjs).
function initMode(mode) {
  const drops = mode !== "plain";
  window.__dropping = true;
  window.addEventListener("click", (e) => { if (drops && e.isTrusted && window.__dropping) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  const kill = (e) => { if (e.pointerType === "touch") e.stopImmediatePropagation(); };
  if (mode === "noptr") for (const type of ["pointerdown", "pointerup", "pointercancel"]) window.addEventListener(type, kill, true);
  if (mode === "cancel") {
    window.addEventListener("pointerup", (e) => {
      if (e.pointerType !== "touch" || !e.isTrusted) return;
      e.stopImmediatePropagation();
      e.target.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerType: "touch", isPrimary: true, pointerId: e.pointerId }));
    }, true);
  }
}

const h = await startHarness();
let failures = 0, taps = 0;
try {
  for (const mode of MODES) for (const [w, ht] of SIZES) {
    const o = await h.open({ seed, width: w, height: ht, contextOptions: { hasTouch: true, isMobile: true }, init: { fn: initMode, arg: mode } });
    const { page } = o;
    const label = `${mode} ${w}x${ht}`;
    const cdp = await o.context.newCDPSession(page);
    const tapSel = async (sel) => {
      const p = await page.evaluate((q) => {
        const b = document.querySelector(q);
        if (!b || !b.getClientRects().length || b.closest("[hidden]")) return null;
        b.scrollIntoView({ block: "center" });
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, sel);
      assert.ok(p, `${sel} is not on screen`);
      // A quick person: taps on different controls are at least a fifth of a second apart. (touch-click.js
      // treats a touchend within 120 ms of the last handled tap as that same tap's echo.)
      await page.waitForTimeout(220);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      taps++;
      if (mode === "late") { // WebKit's late click, hit-tested again after the page has changed
        await page.waitForTimeout(80);
        await page.evaluate(() => { window.__dropping = false; });
        await page.mouse.click(p.x, p.y);
        await page.evaluate(() => { window.__dropping = true; });
      }
    };
    const calls = (p) => o.supportCalls.filter((c) => c.path === p);
    const hash = () => page.evaluate(() => location.hash);
    // The server was asked exactly once more, and not a second time a moment later.
    const once = async (p, before, what) => {
      await until(() => calls(p).length > before, what, 4000);
      await page.waitForTimeout(450);
      assert.strictEqual(calls(p).length, before + 1, `${what}: the server was asked ${calls(p).length - before} times`);
      return calls(p)[before];
    };
    let at = "start";
    const step = async (name, fn) => { at = name; await fn(); };
    try {
      await until(() => page.locator(".project-options-btn").count(), "the board", 15000);

      await step("the menu item opens the Support Inbox", async () => {
        if (w < 1024) {
          await page.evaluate(() => document.getElementById("nav-open-btn").click());
          await until(() => page.evaluate(() => getComputedStyle(document.getElementById("nav-drawer")).visibility === "visible"), "the slide-over menu");
          await page.waitForTimeout(260);
        }
        await tapSel("#support-inbox-btn");
        await until(async () => (await hash()) === "#support", "the Support Inbox route", 4000);
        await until(() => page.locator("#support-page .support-row").count(), "the ticket list", 8000);
        if (w < 1024) assert.strictEqual(await page.evaluate(() => document.getElementById("nav-drawer-backdrop").classList.contains("open")), false, "the slide-over menu was left open");
        assert.strictEqual(await page.evaluate(() => document.getElementById("support-inbox-btn").getAttribute("aria-current")), "page");
        await page.waitForTimeout(1900); // the page's own first sync, so it isn't mistaken for a tap later
      });

      await step("every queue opens by tap", async () => {
        for (const q of ["ai-drafts", "to-sort", "pending", "resolved", "spam", "all", "needs-person"]) {
          await tapSel(`[data-support-queue="${q}"]`);
          await until(() => page.evaluate((k) => { const a = [...document.querySelectorAll(".support-queue.active")]; return a.length === 1 && a[0].dataset.supportQueue === k; }, q), `the ${q} queue`, 3000);
          assert.strictEqual(await hash(), q === "needs-person" ? "#support" : `#support?queue=${q}`);
        }
        assert.strictEqual(await page.evaluate(() => document.querySelector(".support-queues").scrollWidth - document.querySelector(".support-queues").clientWidth <= 1), true, "the queues must not be a sideways-scrolling strip");
      });

      await step("a ticket opens by tap, and nothing under the finger fires", async () => {
        await tapSel('[data-support-queue="ai-drafts"]');
        await until(() => page.locator('[data-support-ticket="t1"]').count(), "the drafted ticket");
        await tapSel('[data-support-ticket="t1"]');
        await until(async () => (await hash()) === "#support/ticket/t1", "the ticket route", 3000);
        await until(() => page.locator(".support-msg-in").count(), "the conversation");
        await page.waitForTimeout(500);
        assert.deepStrictEqual(o.supportCalls.filter((c) => c.path.startsWith("tickets/")), [], "opening a ticket must not act on it");
        assert.strictEqual(await page.evaluate(() => !document.getElementById("dialog-backdrop").hidden), false, "a late click opened a dialog");
      });

      await step("Use this reply fills the box once", async () => {
        await tapSel('[data-support-act="use-draft"]');
        await until(async () => (await page.inputValue("#support-reply")) === DRAFT.text, "the suggested reply in the box", 3000);
      });

      await step("a Help Centre article is inserted once", async () => {
        await page.fill("#support-faq-search", "display");
        await until(() => page.locator(".support-faq-hit").count(), "the Help Centre results");
        await tapSel(".support-faq-hit");
        const link = "https://personalisationhub.com/support-centre/article.html?id=a1";
        await until(async () => (await page.inputValue("#support-reply")).endsWith(link), "the article in the reply", 3000);
        await page.waitForTimeout(300);
        assert.strictEqual((await page.inputValue("#support-reply")).split(link).length - 1, 1, "the article was inserted more than once");
      });

      await step("typing is not interrupted when tickets change underneath", async () => {
        await page.evaluate(() => { const el = document.getElementById("support-reply"); el.__same = true; el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
        await page.keyboard.type(" abc");
        await page.evaluate(() => window.__fbStub.commit([{ op: "set", merge: true, ref: { type: "doc", id: "t3", path: "supportTickets/t3", parentPath: "supportTickets" }, data: { snippet: "changed while typing" } }]));
        await page.waitForTimeout(300);
        assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.id === "support-reply" && document.activeElement.__same === true), true, "the reply box was rebuilt while being typed in (closes the iPad keyboard)");
        await page.keyboard.type("def");
        assert.ok((await page.inputValue("#support-reply")).endsWith(" abcdef"), "typed text was lost");
      });

      await step("Save as internal note saves one note", async () => {
        const n = calls("tickets/t1/note").length;
        await tapSel('[data-support-act="note"]');
        const c = await once("tickets/t1/note", n, "the note");
        assert.ok(c.body.text.endsWith(" abcdef"));
        await until(async () => (await page.inputValue("#support-reply")) === "", "the box to clear");
      });

      await step("Send sends one email", async () => {
        await tapSel('[data-support-act="use-draft"]');
        await until(async () => (await page.inputValue("#support-reply")) === DRAFT.text, "the suggested reply in the box", 3000);
        const n = calls("tickets/t1/reply").length;
        await tapSel('[data-support-act="send"]');
        const c = await once("tickets/t1/reply", n, "the reply");
        assert.deepStrictEqual([c.body.text, c.body.resolve, c.body.draft], [DRAFT.text, false, "ai-draft"]);
      });

      await step("Raise on Staff Kanban raises one ticket", async () => {
        const n = calls("tickets/t1/escalate").length;
        await tapSel('[data-support-act="escalate"]');
        await once("tickets/t1/escalate", n, "the escalation");
      });

      await step("Mark as spam asks, and the confirmation works by tap", async () => {
        const n = calls("tickets/t1/status").length;
        await tapSel('[data-support-status="spam"]');
        await until(() => page.evaluate(() => !document.getElementById("dialog-backdrop").hidden), "the confirmation", 3000);
        await page.waitForTimeout(500);
        assert.strictEqual(await page.evaluate(() => !document.getElementById("dialog-backdrop").hidden), true, "the confirmation opened and shut at once");
        assert.strictEqual(calls("tickets/t1/status").length, n, "spam was sent before it was confirmed");
        await tapSel("#dialog-ok");
        const c = await once("tickets/t1/status", n, "the spam change");
        assert.strictEqual(c.body.status, "spam");
        await until(async () => (await hash()).startsWith("#support") && !(await hash()).includes("ticket"), "back at the inbox", 3000);
      });

      await step("the Back button returns to the inbox", async () => {
        await tapSel('[data-support-queue="all"]');
        await until(() => page.locator('[data-support-ticket="t2"]').count(), "the list");
        await tapSel('[data-support-ticket="t2"]');
        await until(async () => (await hash()) === "#support/ticket/t2", "the ticket route", 3000);
        await tapSel('[data-support-act="back"]');
        await until(async () => (await hash()) === "#support", "the inbox", 3000);
      });

      await step("the Stats tab, its period buttons and its table open by tap", async () => {
        await tapSel('[data-support-tab="stats"]');
        await until(async () => (await hash()) === "#support/stats", "the stats route", 3000);
        await until(() => page.locator(".support-tile").count(), "the stats");
        await tapSel('[data-support-range="7"]');
        await until(() => page.evaluate(() => document.querySelector('[data-support-range="7"]').getAttribute("aria-pressed") === "true"), "7 days selected", 3000);
        await tapSel(".support-table summary");
        await until(() => page.evaluate(() => document.querySelector(".support-table").open), "the table to open", 3000);
        await page.waitForTimeout(500);
        assert.strictEqual(await page.evaluate(() => document.querySelector(".support-table").open), true, "the table opened and shut again (the tap fired twice)");
        await tapSel('[data-support-tab="inbox"]');
        await until(async () => (await hash()) === "#support", "the inbox tab", 3000);
      });

      await step("Sync now syncs once", async () => {
        const n = calls("sync").length;
        await tapSel("#support-sync-btn");
        await once("sync", n, "the sync");
      });

      await step("Settings › Support inbox: the tab, the switch and Save work by tap", async () => {
        await page.evaluate(() => { location.hash = "#settings/projects"; });
        await until(() => page.locator('[data-settings-page="support"]').count(), "the Settings tabs");
        await page.waitForTimeout(300);
        await tapSel('[data-settings-page="support"]');
        await until(async () => (await hash()) === "#settings/support", "the Support inbox settings route", 3000);
        await until(() => page.locator("#support-auto").count(), "the settings");
        assert.strictEqual(await page.isChecked("#support-auto"), false);
        await tapSel(".support-check");
        await until(() => page.isChecked("#support-auto"), "the switch to turn on", 3000);
        await page.waitForTimeout(700);
        assert.strictEqual(await page.isChecked("#support-auto"), true, "the switch turned itself back off (the tap fired twice)");
        const n = calls("settings").length;
        await tapSel('[data-ss-act="save-settings"]');
        const c = await once("settings", n, "the settings save");
        assert.strictEqual(c.body.autoReply, true);
      });

      assert.deepStrictEqual(o.problems.filter((p) => !/unrouted host/.test(p)), [], "page/console problems");
      console.log(`PASS ${label}`);
    } catch (e) {
      failures++;
      console.log(`FAIL ${label} at "${at}": ${e.message.split("\n")[0]} (route: ${await hash().catch(() => "?")})`);
    }
    await o.close();
  }

  // B. A page from before this release (no Support Inbox in it) with this release's scripts.
  const fresh = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const old = fresh
    .replace(/<button[^>]*id="support-inbox-btn"[\s\S]*?<\/button>/, "")
    .replace(/<section class="faq-admin-page support-page"[\s\S]*?<\/section>/, "")
    .replace(/<button[^>]*data-settings-page="support"[\s\S]*?<\/button>/, "")
    .replace(/<div class="settings-pane" data-settings-pane="support" hidden>[\s\S]*?<\/div>\s*<\/div>/, "")
    .replace(/<link rel="stylesheet" href="css\/support\.css">/, "");
  assert.ok(!/support-inbox-btn|id="support-page"|id="support-settings"|data-settings-page="support"/.test(old), "the test must be able to make a page from before this release");
  for (const [w, ht] of [[1180, 820], [820, 1180]]) {
    const o = await h.open({ seed, width: w, height: ht, contextOptions: { hasTouch: true, isMobile: true }, init: { fn: () => {}, arg: null } });
    const { page } = o;
    let loads = 0;
    try {
      await page.route((u) => u.pathname === "/" || u.pathname === "/index.html", (route) => { loads++; return route.fulfill({ status: 200, contentType: "text/html", body: old }); });
      await page.reload();
      await until(() => page.locator(".project-options-btn").count(), "the board on a page from before this release", 15000);
      assert.strictEqual(loads, 1, `the console had to reload itself ${loads - 1} time(s) to start`);
      if (w < 1024) { await page.evaluate(() => document.getElementById("nav-open-btn").click()); await page.waitForTimeout(400); }
      const r = await page.evaluate(() => { const b = document.getElementById("staff-kanban-btn").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      await page.touchscreen.tap(r.x, r.y);
      await until(() => page.evaluate(() => location.hash === "#staff-kanban"), "Staff Kanban opens by tap", 4000);
      // An old link or bookmark to the new page must not break it either.
      await page.evaluate(() => { location.hash = "#support"; });
      await page.waitForTimeout(500);
      await page.evaluate(() => { location.hash = "#settings/support"; });
      await page.waitForTimeout(500);
      assert.deepStrictEqual(o.problems.filter((p) => !/unrouted host/.test(p)), [], "page/console problems");
      console.log(`PASS page from before this release ${w}x${ht}`);
    } catch (e) { failures++; console.log(`FAIL page from before this release ${w}x${ht}: ${e.message.split("\n")[0]}`); }
    await o.close();
  }
} finally { await h.close(); }
if (failures) { console.error(`support-touch: ${failures} failure(s) in ${taps} taps`); process.exit(1); }
console.log(`support-touch: ok (${taps} taps)`);
