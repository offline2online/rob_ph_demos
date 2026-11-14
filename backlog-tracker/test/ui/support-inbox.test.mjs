// Support › Support Inbox and Settings › Support inbox, in Chromium with the
// Firebase SDK stubbed and /supportMail/** answered by the harness. Checks at
// 390, 820 and 1280 px, light and dark: the menu item sits above Help Centre,
// the queues and their counts, a ticket's conversation, using the AI draft,
// inserting a Help Centre article, sending (what the server is asked to do),
// marking spam, the Stats tab's figures, the Settings page, a viewer getting
// no write controls, no sideways scroll and 44px touch targets.
// Run with:  cd backlog-tracker/test && node ui/support-inbox.test.mjs
// SHOTS=1 also saves screenshots to ui/out/.
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { startHarness, until, outDir } from "./harness.mjs";

const T0 = Date.now() - 3 * 86400000, H = 3600000, t = (ms) => ({ $ts: ms });
const ticket = (n, d) => ({ key: `SUP-${n}`, number: n, threadId: `t${n}`, subject: `Subject ${n}`, customerEmail: `c${n}@shop.example`, customerName: `Customer ${n}`, status: "open",
  needsHuman: false, triagePending: false, automated: "", highValue: false, account: null, category: "question", summary: "", snippet: `Snippet ${n}`, createdAt: t(T0), lastMessageAt: t(T0 + n * 60000),
  messageCount: 1, humanInvolved: false, autoRepliesSent: 0, reopenCount: 0, firstResponseAt: null, resolvedAt: null, resolvedBy: "", assignee: "", kanbanKey: "", aiDraft: null, ...d });
const DRAFT = { text: "Hello Ann,\n\nOpen Displays and Devices, then choose Add display.", confidence: 0.86, answerable: true, articles: [{ id: "a1", title: "Add a display to a store", url: "https://personalisationhub.com/support-centre/article.html?id=a1" }] };
const connected = { encryptionReady: true, aiReady: true, clientSet: true, clientId: "123-abc.apps.googleusercontent.com", connected: true, connectedEmail: "support@ph.example", connectedBy: "admin@personalisationhub.com",
  connectedAt: new Date(T0).toISOString(), connectionError: "", lastSyncAt: new Date().toISOString(), lastSyncOk: true, lastSyncError: "", redirectUri: "https://console.example/supportMail/v1/oauth/callback",
  settings: { autoReply: false, autoReplyThreshold: 0.8, escalationAssignee: "admin@personalisationhub.com", signature: "Personalisation Hub Support", fromName: "Personalisation Hub Support", vipDomains: ["vip.example"], importDays: 7 } };
const docs = {
  projects: { p1: { name: "Demo Project", createdAt: t(T0) } },
  supportTickets: {
    t1: ticket(1, { subject: "How do I add a display to my store?", customerName: "Ann Lee", customerEmail: "ann@shop.example", aiDraft: DRAFT, summary: "Wants to add a display.", category: "how-to" }),
    t2: ticket(2, { subject: "Screens offline across the estate", needsHuman: true, highValue: true, account: { kind: "prospect", id: "p1", name: "Big Retail", reason: "Prospects (TAM) company" }, kanbanKey: "PH-7", category: "bug" }),
    t3: ticket(3, { subject: "Invoice query", needsHuman: true, category: "billing" }),
    t4: ticket(4, { subject: "Weekly deals", automated: "mailing list", category: "automated" }),
    t5: ticket(5, { subject: "Thanks, sorted", status: "resolved", resolvedBy: "ai", firstResponseAt: t(T0 + 0.05 * H), resolvedAt: t(T0 + 0.05 * H), category: "how-to" }),
    t6: ticket(6, { subject: "Fixed by the team", status: "resolved", resolvedBy: "editor@personalisationhub.com", humanInvolved: true, firstResponseAt: t(T0 + 2 * H), resolvedAt: t(T0 + 6 * H), category: "bug" }),
    t7: ticket(7, { subject: "Waiting for their reply", status: "pending", humanInvolved: true, firstResponseAt: t(T0 + H) }),
    t8: ticket(8, { subject: "Buy cheap links", status: "spam" }),
  },
  "supportTickets/t1/messages": {
    m1: { direction: "in", from: "ann@shop.example", fromName: "Ann Lee", text: "Hi,\nHow do I add a display to my store?\n<script>alert(1)</script>", at: t(T0), attachments: [{ name: "photo.png" }] },
    e1: { direction: "event", text: "Raised for triage.", by: "system", at: t(T0 + 1000) },
    n1: { direction: "note", text: "Store 14, new starter.", by: "editor@personalisationhub.com", at: t(T0 + 2000) },
  },
  faqArticles: { a1: { status: "published", title: "Add a display to a store", directAnswer: "Open Displays and Devices, then choose Add display.", keywords: ["display"] }, a2: { status: "draft", title: "Draft about displays" } },
  memberDirectory: { "editor@personalisationhub.com": { email: "editor@personalisationhub.com", displayName: "Ed Itor" }, "admin@personalisationhub.com": { email: "admin@personalisationhub.com", displayName: "Ada Min" } },
};
const seedFor = (role, extra = {}) => ({ user: { email: `${role}@personalisationhub.com`, role }, docs, supportStatus: connected, ...extra });

const audit = (page, sel) => page.evaluate((sel) => {
  const scope = document.querySelector(sel);
  const vis = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden]");
  const small = [...scope.querySelectorAll("button:not(.info-tip), select, input:not([type=checkbox]), textarea, summary")].filter(vis)
    .map((b) => ({ what: b.id || b.textContent.trim().slice(0, 30) || b.tagName, h: Math.round(b.getBoundingClientRect().height) })).filter((x) => x.h < 44);
  return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, small };
}, sel);
const shot = async (page, name) => { if (process.env.SHOTS) { fs.mkdirSync(outDir, { recursive: true }); await page.screenshot({ path: path.join(outDir, `support-${name}.png`), fullPage: true }); } };

const h = await startHarness();
let failed = 0;
const run = async (label, opts, fn) => {
  const o = await h.open(opts);
  try {
    await fn(o.page, o);
    assert.deepStrictEqual(o.problems.filter((p) => !/unrouted host/.test(p)), [], "page/console problems");
    console.log(`PASS support-inbox ${label}`);
  } catch (e) { failed++; console.log(`FAIL support-inbox ${label}: ${e.message}`); }
  await o.close();
};
try {
  for (const theme of ["light", "dark"]) for (const width of [390, 820, 1280]) {
    await run(`inbox, ticket and stats ${theme} @${width}px`, { seed: seedFor("editor"), width, height: 900, hash: "#support" }, async (page, o) => {
      if (theme === "dark") await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
      await until(() => page.locator("#support-page .support-row").count(), "the ticket list", 15000);
      // The menu: Support Inbox directly above Help Centre, marked as the current page.
      const nav = await page.evaluate(() => [...document.querySelectorAll('[data-nav-group="publish"] .nav-drawer-item')].map((b) => [b.id, b.getAttribute("aria-current")]));
      assert.deepStrictEqual(nav, [["support-inbox-btn", "page"], ["faq-articles-btn", null]]);
      // Queues and counts; the default queue shows who needs a person, high value first.
      const counts = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".support-queue")].map((b) => [b.dataset.supportQueue, b.querySelector(".support-queue-count").textContent])));
      assert.deepStrictEqual(counts, { "needs-person": "2", "ai-drafts": "1", "to-sort": "1", pending: "1", resolved: "2", spam: "1", all: "7" });
      assert.deepStrictEqual(await page.locator(".support-row-subject").allTextContents(), ["Screens offline across the estate", "Invoice query"]);
      assert.ok((await page.textContent(".support-row >> nth=0")).includes("High value"));
      assert.ok((await page.textContent("#support-count")).includes("support@ph.example"));
      let a = await audit(page, "#support-page");
      assert.ok(a.overflow <= 0, `no sideways scroll on the inbox (${a.overflow}px)`);
      assert.deepStrictEqual(a.small, [], "touch targets under 44px on the inbox");
      if (theme === "light") await shot(page, `inbox-${width}`);
      // Search narrows the list and keeps the caret in the box.
      await page.fill("#support-search", "invoice");
      assert.deepStrictEqual(await page.locator(".support-row-subject").allTextContents(), ["Invoice query"]);
      assert.strictEqual(await page.evaluate(() => document.activeElement.id), "support-search");
      await page.fill("#support-search", "");
      // The AI drafts queue, then the ticket.
      await page.click('[data-support-queue="ai-drafts"]');
      assert.strictEqual(await page.evaluate(() => location.hash), "#support?queue=ai-drafts");
      await page.click('[data-support-ticket="t1"]');
      await until(() => page.locator(".support-msg-in").count(), "the conversation");
      assert.strictEqual(await page.evaluate(() => location.hash), "#support/ticket/t1");
      assert.strictEqual(await page.locator("#support-thread script").count(), 0, "customer text is shown as text, never as markup");
      assert.ok((await page.textContent(".support-msg-in")).includes("<script>alert(1)</script>"));
      assert.ok((await page.textContent(".support-msg-note")).includes("Store 14"));
      assert.ok((await page.textContent(".support-draft")).includes("86% confidence"));
      await until(() => page.locator("#support-assign option").count().then((n) => n >= 3), "the member list");
      // Use the draft, add an article, send and resolve.
      await page.click('[data-support-act="use-draft"]');
      assert.strictEqual(await page.inputValue("#support-reply"), DRAFT.text);
      await page.fill("#support-faq-search", "display");
      await until(() => page.locator(".support-faq-hit").count(), "the Help Centre results");
      assert.strictEqual(await page.locator(".support-faq-hit").count(), 1, "published articles only");
      await page.click(".support-faq-hit");
      assert.ok((await page.inputValue("#support-reply")).endsWith("Add a display to a store: https://personalisationhub.com/support-centre/article.html?id=a1"));
      a = await audit(page, "#support-page");
      assert.ok(a.overflow <= 0, `no sideways scroll on a ticket (${a.overflow}px)`);
      assert.deepStrictEqual(a.small, [], "touch targets under 44px on a ticket");
      if (theme === "light") await shot(page, `ticket-${width}`);
      await page.click('[data-support-act="send-resolve"]');
      await until(() => o.supportCalls.some((c) => c.path === "tickets/t1/reply"), "the reply call");
      const sent = o.supportCalls.find((c) => c.path === "tickets/t1/reply");
      assert.deepStrictEqual([sent.method, sent.body.resolve, sent.body.draft], ["POST", true, "ai-draft-edited"]);
      assert.ok(sent.body.text.startsWith("Hello Ann,"));
      await until(async () => (await page.inputValue("#support-reply")) === "", "the reply box to clear");
      // Spam asks first, then tells the server.
      await page.click('[data-support-status="spam"]');
      await until(() => page.locator("#dialog-backdrop.open, .modal-backdrop.open, [role=dialog]:not([hidden])").count(), "the confirmation");
      await page.keyboard.press("Enter");
      await until(() => o.supportCalls.some((c) => c.path === "tickets/t1/status"), "the spam call");
      assert.strictEqual(o.supportCalls.find((c) => c.path === "tickets/t1/status").body.status, "spam");
      // Stats.
      await page.click('[data-support-tab="stats"]');
      await until(() => page.locator(".support-tile").count(), "the stats");
      const tiles = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".support-tile")].map((x) => [x.querySelector(".support-tile-label").textContent, x.querySelector(".support-tile-value").textContent])));
      assert.deepStrictEqual(tiles, { "Tickets received": "6", Resolved: "2", "Answered by AI alone": "50%", "Needed a person": "2", "Median first response": "1h", "Median time to resolution": "3h 2m", "High-value senders": "1", Reopened: "0" });
      assert.strictEqual(await page.locator(".support-bar-seg").count(), 3, "one day, three segments");
      assert.strictEqual(await page.locator(".support-legend li").count(), 3);
      a = await audit(page, "#support-page");
      assert.ok(a.overflow <= 0, `no sideways scroll on stats (${a.overflow}px)`);
      assert.deepStrictEqual(a.small, [], "touch targets under 44px on stats");
      if (theme === "light") await shot(page, `stats-${width}`);
    });
  }

  await run("a viewer reads but gets no write controls", { seed: seedFor("viewer"), width: 1280, hash: "#support/ticket/t1" }, async (page, o) => {
    await until(() => page.locator(".support-msg-in").count(), "the conversation", 15000);
    assert.strictEqual(await page.locator(".support-composer, .support-actions, #support-reply").count(), 0);
    assert.ok(await page.locator("#support-sync-btn").isHidden());
    await page.waitForTimeout(1800);
    assert.deepStrictEqual(o.supportCalls, [], "no sync or write is attempted for a viewer");
  });

  await run("not connected: the page points to Settings", { seed: { user: { email: "admin@personalisationhub.com", role: "admin" }, docs: { projects: docs.projects } }, width: 1280, hash: "#support" }, async (page) => {
    await until(() => page.locator('[data-support-act="open-settings"]').count(), "the empty state", 15000);
    await page.click('[data-support-act="open-settings"]');
    await until(() => page.locator("#support-settings .docs-block").count(), "the settings pane");
    assert.strictEqual(await page.evaluate(() => location.hash), "#settings/support");
    assert.ok(await page.locator('[data-ss-act="connect"]').isDisabled(), "Connect is off until a client is saved");
    assert.ok((await page.textContent("#support-redirect")).endsWith("/supportMail/v1/oauth/callback"));
  });

  for (const width of [390, 1280]) await run(`settings as an admin @${width}px`, { seed: seedFor("admin"), width, hash: "#settings/support?connected=1" }, async (page, o) => {
    await until(() => page.locator("#support-settings .docs-block").count(), "the settings pane", 15000);
    assert.ok((await page.textContent("#support-settings")).includes("Connected to support@ph.example"));
    await until(async () => (await page.textContent("#support-settings")).includes("Mailbox connected."), "the result of Google's sign-in");
    assert.strictEqual(await page.isChecked("#support-auto"), false, "sending by itself is off by default");
    assert.strictEqual(await page.inputValue("#support-client-secret"), "", "no secret is ever shown");
    await page.check("#support-auto");
    await page.fill("#support-threshold", "90");
    await page.click('[data-ss-act="save-settings"]');
    await until(() => o.supportCalls.some((c) => c.path === "settings"), "the settings call");
    const saved = o.supportCalls.find((c) => c.path === "settings").body;
    assert.deepStrictEqual([saved.autoReply, saved.autoReplyThreshold, saved.vipDomains, saved.escalationAssignee], [true, 0.9, "vip.example", "admin@personalisationhub.com"]);
    const a = await audit(page, "#support-settings");
    assert.ok(a.overflow <= 0, `no sideways scroll (${a.overflow}px)`);
    assert.deepStrictEqual(a.small, [], "touch targets under 44px");
    await shot(page, `settings-${width}`);
  });

  await run("settings as an editor: read-only", { seed: seedFor("editor"), width: 1280, hash: "#settings/support" }, async (page) => {
    await until(() => page.locator("#support-settings .docs-block").count(), "the settings pane", 15000);
    assert.strictEqual(await page.locator("[data-ss-act]").count(), 0);
    assert.ok(await page.locator("#support-auto").isDisabled());
  });
} finally { await h.close(); }
process.exit(failed ? 1 : 0);
