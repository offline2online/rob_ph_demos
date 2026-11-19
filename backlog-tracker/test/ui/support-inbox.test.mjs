// Support › Support Inbox and Settings › Support inbox, in Chromium with the
// Firebase SDK stubbed and /supportMail/** answered by the harness. Checks at
// 390, 820 and 1280 px, light and dark: the menu item sits above Help Centre,
// the queues and their counts, a ticket's conversation, using the AI draft,
// inserting a Help Centre article, sending (what the server is asked to do),
// marking spam, the Stats tab's figures, the three inbox tabs (Support Inbox,
// Hello, Aidan) each with its own list, the Settings page, a viewer getting
// no write controls, no sideways scroll and 44px touch targets. Also the
// checkboxes on every list: select, select all, each inbox's bulk actions as
// one call with one result message, and what clears or keeps the selection.
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
const DRAFT = { text: "Hello Ann,\n\nOpen Displays and Devices, then choose Add display.", confidence: 0.86, confidenceSteps: [{ articles: 1, confidence: 0.62 }, { articles: 2, confidence: 0.86 }], answerable: true, articles: [{ id: "a1", title: "Add a display to a store", url: "https://personalisationhub.com/support-centre/article.html?id=a1" }] };
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
    t6: ticket(6, { subject: "Fixed by the team", status: "resolved", resolvedBy: "editor@ph.example", humanInvolved: true, firstResponseAt: t(T0 + 2 * H), resolvedAt: t(T0 + 6 * H), category: "bug" }),
    t7: ticket(7, { subject: "Waiting for their reply", status: "pending", humanInvolved: true, firstResponseAt: t(T0 + H) }),
    t8: ticket(8, { subject: "Buy cheap links", status: "spam" }),
  },
  "supportTickets/t1/messages": {
    m1: { direction: "in", from: "ann@shop.example", fromName: "Ann Lee", text: "Hi,\nHow do I add a display to my store?\n<script>alert(1)</script>", at: t(T0), attachments: [{ name: "photo.png" }] },
    e1: { direction: "event", text: "Raised for triage.", by: "system", at: t(T0 + 1000) },
    n1: { direction: "note", text: "Store 14, new starter.", by: "editor@ph.example", at: t(T0 + 2000) },
  },
  faqArticles: { a1: { status: "published", title: "Add a display to a store", directAnswer: "Open Displays and Devices, then choose Add display.", keywords: ["display"] }, a2: { status: "draft", title: "Draft about displays" } },
  memberDirectory: { "editor@ph.example": { email: "editor@ph.example", displayName: "Ed Itor" }, "admin@personalisationhub.com": { email: "admin@personalisationhub.com", displayName: "Ada Min" } },
};
const seedFor = (role, extra = {}) => ({ user: { email: `${role}@ph.example`, role }, docs, supportStatus: connected, ...extra });

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
    await run(`inbox and ticket ${theme} @${width}px`, { seed: seedFor("editor"), width, height: 900, hash: "#support" }, async (page, o) => {
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
      const draftText = await page.textContent(".support-draft");
      assert.ok(draftText.includes("High confidence · 86%"), "the confidence is shown beside the suggested reply");
      assert.ok(draftText.includes("Confidence 62% from 1 article, 86% with 2 combined"), "and what combining answers did to it");
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
      // The Stats and Try an email tabs are gone: three inbox tabs and the Test lab, and an old link to either opens the inbox.
      assert.deepStrictEqual(await page.$$eval("#support-page .support-tab", (els) => els.map((b) => b.textContent)), ["Support Inbox", "Hello", "Aidan", "Test lab"]);
      for (const old of ["#support/stats", "#support/try"]) {
        await page.evaluate((hash) => { location.hash = hash; }, old);
        await until(() => page.locator("#support-page .support-row").count(), `the inbox at ${old}`);
        assert.strictEqual(await page.locator('#support-page .support-tab[aria-selected="true"]').textContent(), "Support Inbox");
        assert.strictEqual(await page.locator(".support-tile, .support-try, .support-stats").count(), 0);
        await page.evaluate(() => { location.hash = "#support?queue=all"; });
        await until(async () => (await page.locator(".support-queue.active").getAttribute("data-support-queue")) === "all", "another queue");
      }
    });
  }

  // The small email icon: a new email from the support mailbox.
  for (const width of [390, 1280]) await run(`write a new email @${width}px`, { seed: seedFor("editor", { supportAnswer: { ok: true, newMessages: 0, newTickets: 0, to: "buyer@retailer.example", ticketId: "t7", key: "SUP-7" } }), width, height: 900, hash: "#support" }, async (page, o) => {
    await until(() => page.locator("#support-page .support-row").count(), "the ticket list", 15000);
    const btn = page.locator("#support-compose-btn");
    await until(() => btn.isVisible(), "the email icon");
    assert.deepStrictEqual([await btn.getAttribute("aria-label"), (await btn.textContent()).trim()], ["Write an email", "mail"], "an icon with a name, no text");
    const box = await btn.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44 && box.width <= 56, `a small icon button (${Math.round(box.width)}×${Math.round(box.height)})`);
    await btn.click();
    await until(async () => (await page.evaluate(() => location.hash)) === "#support/compose", "the compose route");
    await until(() => page.locator("#support-compose-to").count(), "the form");
    assert.deepStrictEqual(await page.$$eval(".support-compose label.field-label", (els) => els.map((l) => l.textContent)), ["To", "Subject", "Message"]);
    assert.strictEqual(await page.locator('#support-page .support-tab[aria-selected="true"]').textContent(), "Support Inbox");
    // Nothing is sent until it is complete: each gap is named.
    const refused = async (said) => { await page.click('[data-support-act="compose-send"]'); await until(async () => said.test((await page.locator("#support-compose-error").textContent().catch(() => "")) || ""), `"${said}"`); };
    await refused(/who the email is to/);
    await page.fill("#support-compose-to", "not an address");
    await refused(/isn't an email address/);
    await page.fill("#support-compose-to", "Buyer@Retailer.example");
    await refused(/subject/);
    await page.fill("#support-compose-subject", "Your demo");
    await refused(/Write the message/);
    assert.deepStrictEqual(o.supportCalls.filter((c) => c.path === "compose"), [], "nothing was sent while it was incomplete");
    assert.strictEqual(await page.inputValue("#support-compose-to"), "Buyer@Retailer.example", "what was typed is kept");
    await page.fill("#support-compose-text", "Hello,\n\nHere is the link we discussed.");
    let a = await audit(page, "#support-page");
    assert.ok(a.overflow <= 0, `no sideways scroll (${a.overflow}px)`);
    assert.deepStrictEqual(a.small, [], "touch targets under 44px");
    await shot(page, `compose-${width}`);
    await page.click('[data-support-act="compose-send"]');
    await until(() => page.locator(".support-compose-sent").count(), "the confirmation");
    const calls = o.supportCalls.filter((c) => c.path === "compose");
    assert.strictEqual(calls.length, 1, "sent once");
    assert.deepStrictEqual([calls[0].method, calls[0].body], ["POST", { to: "Buyer@Retailer.example", subject: "Your demo", text: "Hello,\n\nHere is the link we discussed." }]);
    const said = await page.textContent(".support-compose-sent");
    assert.ok(said.includes("Sent to buyer@retailer.example from support@ph.example"), said);
    assert.deepStrictEqual([await page.inputValue("#support-compose-to"), await page.inputValue("#support-compose-subject"), await page.inputValue("#support-compose-text")], ["", "", ""], "the form is cleared for the next one");
    await shot(page, `compose-sent-${width}`);
    // The confirmation opens the ticket it was filed as; Back from the form returns to the inbox.
    await page.click('[data-support-act="open-sent"]');
    await until(async () => (await page.evaluate(() => location.hash)) === "#support/ticket/t7", "the filed ticket");
    await page.evaluate(() => { location.hash = "#support/compose"; });
    await until(() => page.locator("#support-compose-to").count(), "the form again");
    await page.click('[data-support-act="back"]');
    await until(async () => (await page.evaluate(() => location.hash)) === "#support", "back in the inbox");
  });

  await run("a viewer reads but gets no write controls", { seed: seedFor("viewer"), width: 1280, hash: "#support/ticket/t1" }, async (page, o) => {
    await until(() => page.locator(".support-msg-in").count(), "the conversation", 15000);
    assert.strictEqual(await page.locator(".support-composer, .support-actions, #support-reply").count(), 0);
    assert.ok(await page.locator("#support-compose-btn").isHidden(), "a viewer has no email icon");
    await page.evaluate(() => { location.hash = "#support/compose"; });
    await until(() => page.locator("#support-view .interface-row-empty").count(), "the compose route as a viewer");
    assert.strictEqual(await page.locator("#support-compose-to, [data-support-act='compose-send']").count(), 0, "and no form by its address");
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
    // Every Save is disabled until one of its own fields differs from what is saved.
    const saveOff = (act) => page.isDisabled(`[data-ss-act="${act}"]`);
    assert.deepStrictEqual([await saveOff("save-client"), await saveOff("save-settings"), await saveOff("save-aidan")], [true, true, true], "nothing changed: every Save is disabled");
    await page.fill("#support-client-id", "abc.apps.googleusercontent.com");
    assert.deepStrictEqual([await saveOff("save-client"), await saveOff("save-settings"), await saveOff("save-aidan")], [false, true, true], "only the changed block's Save enables");
    await page.fill("#support-client-id", "");
    assert.strictEqual(await saveOff("save-client"), true, "cleared again: Save client is disabled");
    await page.check("#support-auto");
    assert.strictEqual(await saveOff("save-settings"), false, "a changed field enables Save settings");
    await page.uncheck("#support-auto");
    assert.strictEqual(await saveOff("save-settings"), true, "reverted: Save settings is disabled again");
    await page.selectOption("#support-assignee", "");
    assert.strictEqual(await saveOff("save-settings"), false, "a changed select enables it");
    await page.selectOption("#support-assignee", "admin@personalisationhub.com");
    assert.strictEqual(await saveOff("save-settings"), true, "and back to the saved choice disables it");
    await page.check("#support-auto");
    await page.fill("#support-threshold", "90");
    await page.click('[data-ss-act="save-settings"]');
    await until(() => o.supportCalls.some((c) => c.path === "settings"), "the settings call");
    await until(async () => (await page.textContent("#support-settings-status")) === "Saved.", "the save to finish");
    assert.strictEqual(await saveOff("save-settings"), true, "saved: Save settings is disabled again");
    const saved = o.supportCalls.find((c) => c.path === "settings").body;
    assert.deepStrictEqual([saved.autoReply, saved.autoReplyThreshold, saved.vipDomains, saved.escalationAssignee], [true, 0.9, "vip.example", "admin@personalisationhub.com"]);
    const a = await audit(page, "#support-settings");
    assert.ok(a.overflow <= 0, `no sideways scroll (${a.overflow}px)`);
    assert.deepStrictEqual(a.small, [], "touch targets under 44px");
    await shot(page, `settings-${width}`);
  });

  // Three inboxes, one tab each: the address an email was written to decides the tab.
  const inboxDocs = { ...docs, supportTickets: {
    s1: ticket(1, { subject: "Written to support", needsHuman: true, inboxes: ["support"] }),
    s2: ticket(2, { subject: "From before the tabs", needsHuman: true }),
    h1: ticket(3, { subject: "Written to hello", customerName: "Hattie Shaw", customerEmail: "hattie@shop.example", needsHuman: true, aiDraft: DRAFT, highValue: true, account: { kind: "prospect", id: "p1", name: "Big Retail", reason: "Prospects (TAM) company" }, kanbanKey: "PH-9", summary: "Wants a partnership.", lastInboundAt: t(T0 + 3 * 60000), inboxes: ["hello"] }),
    h2: ticket(4, { subject: "Hello, resolved", status: "resolved", resolvedBy: "ai", lastInboundAt: t(T0 + 60000), lastReplyAt: t(T0 + 4 * 60000), inboxes: ["hello"] }),
    h3: ticket(9, { subject: "Hello, junk", status: "spam", inboxes: ["hello"] }),
    a1: ticket(5, { subject: "Written to aidan", status: "resolved", resolvedBy: "aidan", lastInboundAt: t(T0 + 60000), lastReplyAt: t(T0 + 5 * 60000), aidan: { status: "replied", kind: "generate", skillName: "AWS onboarding pack", document: { name: "pack.md" }, recipients: 2 }, inboxes: ["aidan"] }),
    a2: ticket(7, { subject: "Refused by Aidan", aiDraft: DRAFT, aidan: { status: "ignored", reason: "The sender is not allowed to instruct Aidan." }, inboxes: ["aidan"] }),
    a3: ticket(8, { subject: "Queued for Aidan", aidan: { status: "queued", kind: "generate", instruction: "send the pack" }, inboxes: ["aidan"] }),
    sa: ticket(6, { subject: "Support with aidan in Cc", needsHuman: true, inboxes: ["support", "aidan"] }),
  }, "supportTickets/sa/messages": { m1: { direction: "in", from: "c6@shop.example", fromName: "Customer 6", text: "For you both.", at: t(T0) } },
  "supportTickets/h1/messages": {
    m1: { direction: "in", from: "hattie@shop.example", fromName: "Hattie Shaw", text: "Could we talk about a partnership?", at: t(T0) },
    e1: { direction: "event", text: "Raised on the Staff Kanban as PH-9.", by: "system", at: t(T0 + 1000) },
    n1: { direction: "note", text: "Met at the show.", by: "editor@ph.example", at: t(T0 + 2000) },
  },
  "supportTickets/a1/messages": {
    m1: { direction: "in", from: "owner@example.com", fromName: "Owner Person", text: "@Aidan, send the pack.", at: t(T0) },
    m2: { direction: "out", source: "aidan", sentBy: "aidan", to: ["owner@example.com"], cc: ["client@shop.example"], text: "Here is the pack.", attachments: [{ name: "pack.md" }], skillName: "AWS onboarding pack", at: t(T0 + 60000) },
  } };
  // What only the Support Inbox has: the queue strip, triage, the suggested reply and its confidence, Staff Kanban, assignment.
  const SUPPORT_ONLY = '.support-queue, .support-conf, .support-draft, .support-badge-hv, .support-account, .support-row-key, .support-event, #support-assign, #support-faq-search, [data-support-act="use-draft"], [data-support-act="redraft"], [data-support-act="escalate"], [data-support-act="open-kanban"], [data-support-act="send-resolve"], [data-support-status="resolved"]';
  for (const width of [390, 820, 1280]) await run(`three inboxes by alias: Support Inbox with queues, Hello and Aidan plain @${width}px`, { seed: { ...seedFor("editor"), docs: inboxDocs }, width, height: 900, hash: "#support" }, async (page, o) => {
    await until(() => page.locator("#support-page .support-row").count(), "the ticket list", 15000);
    const tabs = () => page.evaluate(() => [...document.querySelectorAll("#support-page .support-tab")].filter((b) => b.getClientRects().length).map((b) => [b.textContent, b.getAttribute("aria-selected")]));
    assert.deepStrictEqual((await tabs()).slice(0, 3), [["Support Inbox", "true"], ["Hello", "false"], ["Aidan", "false"]], "the tab names, exactly, Support Inbox first");
    const subjects = () => page.locator(".support-row-subject").allTextContents();
    const counts = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".support-queue")].map((b) => [b.dataset.supportQueue, b.querySelector(".support-queue-count").textContent])));
    const hashNow = () => page.evaluate(() => location.hash);
    const none = async (what) => assert.strictEqual(await page.locator(SUPPORT_ONLY).count(), 0, `${what}: a Support Inbox control is showing`);
    const fits = async (what) => {
      const a = await audit(page, "#support-page");
      assert.ok(a.overflow <= 0, `no sideways scroll on ${what} (${a.overflow}px)`);
      assert.deepStrictEqual(a.small, [], `touch targets under 44px on ${what}`);
    };
    // Support Inbox: mail to support@, mail from before the tabs, and the one that copied aidan@. Queues and triage as before.
    assert.deepStrictEqual(await subjects(), ["Support with aidan in Cc", "From before the tabs", "Written to support"]);
    assert.strictEqual(await page.locator(".support-queue").count(), 7, "the Support Inbox keeps its seven queues");
    assert.deepStrictEqual([(await counts())["needs-person"], (await counts()).all], ["3", "3"]);
    assert.ok((await page.textContent("#support-count")).startsWith("3 need a person · 0 AI drafts"));

    // Hello: a plain email list. Sender, subject, date and unread; nothing from the Support Inbox.
    await page.click('[data-support-tab="hello"]');
    await until(async () => (await hashNow()) === "#support/hello", "the Hello route");
    assert.deepStrictEqual((await tabs()).slice(0, 3).map((x) => x[1]), ["false", "true", "false"]);
    assert.deepStrictEqual(await subjects(), ["Hello, resolved", "Written to hello"], "every Hello email whatever its support status, newest first; spam apart");
    await none("the Hello list");
    assert.deepStrictEqual(await page.locator(".support-mail-row .support-row-from").allTextContents(), ["Customer 4", "Hattie Shaw"], "the sender");
    assert.strictEqual(await page.locator('[data-support-ticket="h1"] .support-row-when').count(), 1, "the date");
    assert.deepStrictEqual(await page.evaluate(() => [...document.querySelectorAll(".support-mail-row")].map((r) => [r.dataset.supportTicket, r.classList.contains("is-unread"), !!r.querySelector(".support-unread")])), [["h2", false, false], ["h1", true, true]], "unread is bold and says so; an answered email is read");
    assert.ok((await page.textContent("#support-count")).startsWith("1 unread ·"), "the header counts unread email");
    await fits("Hello");
    const strip = await page.evaluate(() => { const n = document.querySelector(".support-tabs"); return n.scrollWidth - n.clientWidth; });
    assert.ok(strip <= 0, `the tabs are not in a sideways-scrolling strip (${strip}px)`);
    await shot(page, `hello-${width}`);
    // An old link to one of its queues opens the emails; spam is one tap away and comes back.
    await page.evaluate(() => { location.hash = "#support/hello?queue=resolved"; });
    await page.waitForTimeout(150);
    assert.deepStrictEqual(await subjects(), ["Hello, resolved", "Written to hello"]);
    await page.click('[data-support-queue="spam"]');
    await until(async () => (await hashNow()) === "#support/hello?queue=spam", "Hello's spam");
    assert.deepStrictEqual(await subjects(), ["Hello, junk"]);
    await none("Hello's spam");
    await page.click('[data-support-act="back"]');
    await until(async () => (await hashNow()) === "#support/hello", "back in Hello");
    // The thread: the emails and notes, Reply, an internal note and Mark as spam. No draft, confidence, Kanban, resolve or history.
    await page.click('[data-support-ticket="h1"]');
    await until(() => page.locator(".support-msg-in").count(), "the Hello conversation");
    assert.strictEqual(await hashNow(), "#support/hello/ticket/h1");
    await none("the Hello thread");
    const head = await page.textContent(".support-ticket-head");
    assert.ok(head.includes("Written to hello") && head.includes("Hattie Shaw <hattie@shop.example>"), "the subject and who wrote");
    assert.ok(!/SUP-3|PH-9|Wants a partnership|High value|Answered by AI/i.test(await page.textContent("#support-view")), "no ticket key, Kanban link, AI summary or support badge");
    assert.strictEqual(await page.locator(".support-msg-note").count(), 1, "an internal note may stay");
    assert.deepStrictEqual(await page.locator(".support-actions button").allTextContents().then((x) => x.map((s) => s.replace("report", "").trim())), ["Mark as spam"]);
    assert.deepStrictEqual(await page.locator(".support-send button").allTextContents(), ["Reply", "Save as internal note"]);
    await fits("the Hello thread");
    await shot(page, `hello-thread-${width}`);
    await page.fill("#support-reply", "Thanks Hattie, I will call you tomorrow.");
    await page.click('[data-support-act="send"]');
    await until(() => o.supportCalls.some((c) => c.path === "tickets/h1/reply"), "the reply");
    assert.deepStrictEqual(o.supportCalls.find((c) => c.path === "tickets/h1/reply").body, { text: "Thanks Hattie, I will call you tomorrow.", resolve: false, draft: "manual" });
    await until(async () => (await page.inputValue("#support-reply")) === "", "the box to clear");
    await page.click('[data-support-act="back"]');
    await until(async () => (await hashNow()) === "#support/hello", "back in Hello again");
    assert.strictEqual(await page.locator(".support-mail-row.is-unread").count(), 0, "an opened email is no longer unread");

    // Aidan: a plain email list where every thread says what Aidan did.
    await page.click('[data-support-tab="aidan"]');
    await until(async () => (await hashNow()) === "#support/aidan", "the Aidan route");
    assert.deepStrictEqual(await subjects(), ["Queued for Aidan", "Refused by Aidan", "Support with aidan in Cc", "Written to aidan"]);
    await none("the Aidan list");
    assert.deepStrictEqual(await page.locator(".support-aidan-badge").allTextContents(), ["Aidan: queued", "Aidan: no action", "Aidan: no action", "Aidan replied"], "each thread carries Aidan's state");
    assert.ok((await page.textContent('[data-support-ticket="a2"] .support-row-snippet')).includes("The sender is not allowed to instruct Aidan."), "no action says why");
    assert.ok((await page.textContent('[data-support-ticket="sa"] .support-row-snippet')).includes("no @Aidan request"), "an email Aidan was never asked about says so");
    await fits("Aidan");
    await shot(page, `aidan-${width}`);
    // A replied thread shows his reply.
    await page.click('[data-support-ticket="a1"]');
    await until(() => page.locator(".support-msg-aidan").count(), "Aidan's reply on the thread");
    assert.strictEqual(await hashNow(), "#support/aidan/ticket/a1");
    await none("the Aidan thread");
    assert.ok((await page.textContent(".support-aidan-line")).includes("Aidan wrote pack.md with the AWS onboarding pack skill"));
    assert.ok((await page.textContent(".support-msg-aidan")).includes("Here is the pack."));
    await fits("the Aidan thread");
    await shot(page, `aidan-thread-${width}`);
    await page.click('[data-support-act="back"]');
    await until(async () => (await hashNow()) === "#support/aidan", "back in Aidan from the reply");
    // An email in two inboxes opens inside Aidan, says it is in both, and Back returns to Aidan.
    await page.click('[data-support-ticket="sa"]');
    await until(() => page.locator(".support-msg-in").count(), "the conversation");
    assert.strictEqual(await hashNow(), "#support/aidan/ticket/sa");
    assert.deepStrictEqual((await tabs()).slice(0, 3).map((x) => x[1]), ["false", "false", "true"]);
    assert.ok((await page.textContent(".support-ticket-meta")).includes("In Support Inbox, Aidan"));
    assert.strictEqual((await page.textContent(".support-back")).replace("arrow_back", "").trim(), "Aidan");
    await none("a shared email opened in Aidan");
    await page.click('[data-support-act="back"]');
    await until(async () => (await hashNow()) === "#support/aidan", "back in Aidan");
    // The same ticket by its old address opens under Support Inbox; a Hello ticket by that address opens under Hello.
    await page.evaluate(() => { location.hash = "#support/ticket/sa"; });
    await until(() => page.locator(".support-msg-in").count(), "the conversation again");
    assert.deepStrictEqual((await tabs()).slice(0, 3).map((x) => x[1]), ["true", "false", "false"]);
    assert.ok(await page.locator('[data-support-act="escalate"]').count() && await page.locator('[data-support-status="resolved"]').count() && await page.locator("#support-assign").count(), "in the Support Inbox the same email keeps its triage controls");
    await page.evaluate(() => { location.hash = "#support/ticket/h1"; });
    await until(async () => (await page.textContent(".support-ticket-head h3")).includes("Written to hello"), "the Hello ticket");
    assert.deepStrictEqual((await tabs()).slice(0, 3).map((x) => x[1]), ["false", "true", "false"]);
    assert.strictEqual((await page.textContent(".support-back")).replace("arrow_back", "").trim(), "Hello");
    await page.click('[data-support-tab="inbox"]');
    await until(async () => (await page.evaluate(() => location.hash)) === "#support", "the Support Inbox route");
    assert.strictEqual((await subjects()).length, 3);
    assert.strictEqual(await page.locator(".support-queue").count(), 7, "the Support Inbox still has its queues");
  });

  await run("settings as an editor: read-only", { seed: seedFor("editor"), width: 1280, hash: "#settings/support" }, async (page) => {
    await until(() => page.locator("#support-settings .docs-block").count(), "the settings pane", 15000);
    assert.strictEqual(await page.locator("[data-ss-act]").count(), 0);
    assert.ok(await page.locator("#support-auto").isDisabled());
  });
  // Aidan (EeAljfWIiY8SOPsKXlXD): the allowed senders are set here by an admin, shown masked, never in full.
  const aidanStatus = (aidan) => ({ ...connected, aidan });
  for (const width of [390, 1280]) await run(`Aidan's settings as an admin @${width}px`, { seed: seedFor("admin", { supportStatus: aidanStatus({ enabled: true, switchedOn: true, senderCount: 2, requireSenderAuth: true, fromName: "Aidan", sendersMasked: ["o***@example.com", "o***@example.com"] }) }), width, hash: "#settings/support" }, async (page, o) => {
    await until(() => page.locator("#support-aidan-settings").count(), "the Aidan block", 15000);
    const text = await page.textContent("#support-aidan-settings");
    assert.ok(text.includes("2 allowed senders: o***@example.com, o***@example.com"), text);
    assert.strictEqual(await page.inputValue("#support-aidan-senders"), "", "the addresses are never put back in the box");
    assert.strictEqual(await page.isChecked("#support-aidan-on"), true);
    assert.strictEqual(await page.isDisabled('[data-ss-act="save-aidan"]'), true, "nothing changed: Save Aidan is disabled");
    await page.uncheck("#support-aidan-on");
    assert.strictEqual(await page.isDisabled('[data-ss-act="save-aidan"]'), false, "the switch changed: Save Aidan enables");
    await page.check("#support-aidan-on");
    assert.strictEqual(await page.isDisabled('[data-ss-act="save-aidan"]'), true, "switched back: disabled again");
    // The signature line (SYkk20srKT7pIKM1HS8Z): off by default, and a change to it enables Save Aidan.
    assert.deepStrictEqual([await page.isChecked("#support-aidan-sigline-on"), await page.inputValue("#support-aidan-sigline")], [false, ""], "off by default");
    await page.check("#support-aidan-sigline-on");
    assert.strictEqual(await page.isDisabled('[data-ss-act="save-aidan"]'), false, "the signature switch changed: Save Aidan enables");
    await page.fill("#support-aidan-sigline", "PH's digital assistant");
    await page.fill("#support-aidan-senders", "owner@example.com, owner.alias@example.com");
    await page.click('[data-ss-act="save-aidan"]');
    await until(() => o.supportCalls.some((c) => c.path === "aidan"), "the Aidan call");
    await until(async () => (await page.textContent("#support-aidan-status")) === "Saved.", "the Aidan save to finish");
    assert.strictEqual(await page.isDisabled('[data-ss-act="save-aidan"]'), true, "saved: Save Aidan is disabled again");
    const saved = o.supportCalls.find((c) => c.path === "aidan").body;
    assert.deepStrictEqual([saved.enabled, saved.allowedSenders, saved.signatureLineOn, saved.signatureLine], [true, "owner@example.com, owner.alias@example.com", true, "PH's digital assistant"]);
    const a = await audit(page, "#support-settings");
    assert.ok(a.overflow <= 0, `no sideways scroll (${a.overflow}px)`);
    assert.deepStrictEqual(a.small, [], "touch targets under 44px");
    await shot(page, `aidan-settings-${width}`);
  });
  await run("Aidan's settings as an editor: a count, no addresses, no controls", { seed: seedFor("editor", { supportStatus: aidanStatus({ enabled: true, switchedOn: true, senderCount: 2, requireSenderAuth: true, fromName: "Aidan" }) }), width: 1280, hash: "#settings/support" }, async (page) => {
    await until(() => page.locator("#support-aidan-settings").count(), "the Aidan block", 15000);
    assert.ok((await page.textContent("#support-aidan-settings")).includes("2 allowed senders"));
    assert.strictEqual(await page.locator("#support-aidan-senders, [data-ss-act=save-aidan]").count(), 0);
    assert.ok(await page.locator("#support-aidan-on").isDisabled());
    assert.ok(await page.locator("#support-aidan-sigline-on").isDisabled() && await page.locator("#support-aidan-sigline").isDisabled(), "an editor sees the signature line and can't change it");
  });
  await run("Aidan's settings: a saved signature line is shown switched on", { seed: seedFor("admin", { supportStatus: aidanStatus({ enabled: true, switchedOn: true, senderCount: 1, requireSenderAuth: true, fromName: "Aidan", signatureLineOn: true, signatureLine: "PH's digital assistant", sendersMasked: ["o***@example.com"] }) }), width: 390, hash: "#settings/support" }, async (page) => {
    await until(() => page.locator("#support-aidan-settings").count(), "the Aidan block", 15000);
    assert.deepStrictEqual([await page.isChecked("#support-aidan-sigline-on"), await page.inputValue("#support-aidan-sigline")], [true, "PH's digital assistant"]);
    const a = await audit(page, "#support-settings");
    assert.ok(a.overflow <= 0, `no sideways scroll (${a.overflow}px)`);
    assert.deepStrictEqual(a.small, [], "touch targets under 44px");
    await shot(page, "aidan-settings-signature-390");
  });
  // Selecting several threads (b3NmU4mdmiGOZgHLURgK): a checkbox on every row and one above the list, in all
  // three inboxes; the selection bar's actions go to the server in one call, with one result message.
  const bulkDocs = { ...docs, supportTickets: {
    s1: ticket(1, { subject: "Support one", needsHuman: true }), s2: ticket(2, { subject: "Support two", needsHuman: true }), s3: ticket(3, { subject: "Support three", needsHuman: true }),
    s4: ticket(4, { subject: "Support junk", status: "spam" }),
    h1: ticket(11, { subject: "Hello one", lastInboundAt: t(T0 + 11 * 60000), inboxes: ["hello"] }), h2: ticket(12, { subject: "Hello two", inboxes: ["hello"] }),
    h3: ticket(13, { subject: "Hello three", inboxes: ["hello"] }), h4: ticket(14, { subject: "Hello four", lastInboundAt: t(T0 + 60000), lastReplyAt: t(T0 + 2 * 60000), inboxes: ["hello"] }),
    h5: ticket(15, { subject: "Hello archived", archived: true, inboxes: ["hello"] }),
    a1: ticket(21, { subject: "Aidan refused", aidan: { status: "ignored", reason: "The sender is not allowed to instruct Aidan." }, inboxes: ["aidan"] }),
    a2: ticket(22, { subject: "Aidan plain", inboxes: ["aidan"] }),
  }, "supportTickets/h1/messages": { m1: { direction: "in", from: "c11@shop.example", fromName: "Customer 11", text: "Hello there.", at: t(T0) } } };
  const setDocs = (page, changes) => page.evaluate((list) => window.__fbStub.commit(list.map(([id, data]) => ({ op: "set", merge: true, ref: { type: "doc", id, path: `supportTickets/${id}`, parentPath: "supportTickets" }, data }))), changes);
  for (const width of [390, 820, 1280]) await run(`selecting several threads @${width}px`, { seed: seedFor("editor", { docs: bulkDocs, supportAnswer: { ok: true, done: 3, failed: 0, skipped: 0, errors: [] } }), width, height: 900, hash: "#support/hello" }, async (page, o) => {
    const bulkCalls = () => o.supportCalls.filter((c) => c.path === "tickets/bulk");
    const subjects = () => page.locator(".support-row-subject").allTextContents();
    const picked = () => page.$$eval("[data-support-pick]:checked", (els) => els.map((e) => e.dataset.supportPick).sort());
    const count = async () => ((await page.locator("#support-bulk-count").count()) ? page.textContent("#support-bulk-count") : "");
    const barKeys = () => page.$$eval("#support-bulk [data-support-bulk], #support-bulk [data-support-bulk-pick]", (els) => els.map((e) => e.dataset.supportBulk || e.dataset.supportBulkPick));
    await until(() => page.locator('[data-support-ticket="h1"]').count(), "the Hello emails", 15000);

    // Every row has its own labelled checkbox; nothing is selected and no actions show yet.
    assert.deepStrictEqual(await page.$$eval("[data-support-pick]", (els) => els.map((e) => [e.type, e.getAttribute("aria-label"), e.closest("label") !== null, e.closest("button") === null])),
      [["checkbox", "Select Hello four", true, true], ["checkbox", "Select Hello three", true, true], ["checkbox", "Select Hello two", true, true], ["checkbox", "Select Hello one", true, true]]);
    assert.strictEqual(await page.getAttribute("#support-pick-all", "aria-label"), "Select all 4 shown");
    assert.deepStrictEqual([await barKeys(), await count()], [[], ""]);

    // A checkbox selects without opening the email; the row still opens it without ticking anything.
    await page.check('[data-support-pick="h1"]');
    assert.deepStrictEqual([await page.evaluate(() => location.hash), await count(), await picked()], ["#support/hello", "1 selected", ["h1"]]);
    await page.click('[data-support-ticket="h2"]');
    await until(() => page.evaluate(() => location.hash === "#support/hello/ticket/h2"), "the email opens from its row");
    await page.click('[data-support-act="back"]');
    await until(() => page.locator('[data-support-ticket="h1"]').count(), "back in Hello");
    assert.deepStrictEqual(await picked(), [], "leaving the list clears the selection");

    // Test step: select three emails in Hello, Mark as spam, confirm: all three gone, one result message.
    for (const id of ["h1", "h2", "h3"]) await page.check(`[data-support-pick="${id}"]`);
    assert.deepStrictEqual([await count(), await barKeys()], ["3 selected", ["spam", "read", "unread", "archive", "clear"]]);
    assert.strictEqual(await page.evaluate(() => document.getElementById("support-pick-all").indeterminate), true, "some, not all");
    const a0 = await audit(page, "#support-page");
    assert.ok(a0.overflow <= 0, `no sideways scroll with the selection bar open (${a0.overflow}px)`);
    assert.deepStrictEqual(a0.small, [], "touch targets under 44px");
    assert.deepStrictEqual(await page.$$eval(".support-pick", (els) => els.filter((e) => e.getBoundingClientRect().width < 44 || e.getBoundingClientRect().height < 44).length), 0, "each checkbox's label is a 44px target");
    await shot(page, `bulk-hello-${width}`);

    // New mail arriving mid-selection redraws the list and keeps the selection.
    await setDocs(page, [["h4", { snippet: "changed by a sync" }], ["h9", ticket(19, { subject: "Hello new", inboxes: ["hello"] })]]);
    await until(async () => (await subjects()).includes("Hello new"), "the new email");
    assert.deepStrictEqual([await picked(), await count()], [["h1", "h2", "h3"], "3 selected"], "a redraw from new data keeps the selection");

    await page.click('[data-support-bulk="spam"]');
    await until(() => page.evaluate(() => !document.getElementById("dialog-backdrop").hidden), "one confirmation for the batch");
    assert.ok((await page.textContent("#dialog-backdrop")).includes("Mark 3 emails as spam?"));
    assert.strictEqual(bulkCalls().length, 0, "nothing is sent before it is confirmed");
    await page.click("#dialog-ok");
    await until(() => bulkCalls().length === 1, "the bulk call");
    assert.deepStrictEqual(bulkCalls()[0].body, { ids: ["h3", "h2", "h1"], action: "status", status: "spam" }, "one call for all three");
    await until(() => page.locator("#support-bulk-result").count(), "the result message");
    assert.deepStrictEqual([await page.locator("#support-bulk-result").count(), await page.textContent("#support-bulk-result > span:last-child")].map(String), ["1", "3 emails marked as spam."]);
    assert.deepStrictEqual([await picked(), await count()], [[], ""], "the selection clears after the action");
    await setDocs(page, ["h1", "h2", "h3"].map((id) => [id, { status: "spam" }]));
    await until(async () => (await subjects()).join() === "Hello new,Hello four", "all three gone");
    assert.strictEqual(o.supportCalls.filter((c) => /\/status$/.test(c.path)).length, 0, "not three single calls");
    assert.ok((await page.textContent(".support-plain-foot")).includes("Spam (3)") && (await page.textContent(".support-plain-foot")).includes("Archived (1)"));

    // Read and unread are this browser's own state: no call, the row changes at once.
    await page.check('[data-support-pick="h4"]');
    await page.click('[data-support-bulk="unread"]');
    await until(() => page.locator('[data-support-ticket="h4"].is-unread .support-unread').count(), "Hello four reads Unread");
    assert.ok((await page.textContent("#support-bulk-result")).includes("1 email marked as unread."));
    await page.check("#support-pick-all");
    assert.deepStrictEqual(await picked(), ["h4", "h9"], "Select all ticks every row shown");
    await page.click('[data-support-bulk="read"]');
    await until(async () => (await page.locator(".support-mail-row.is-unread").count()) === 0, "nothing unread");
    assert.strictEqual(bulkCalls().length, 1, "read and unread send nothing");

    // Archive: one call; the Archived list has Move to inbox.
    await page.check('[data-support-pick="h4"]');
    await page.click('[data-support-bulk="archive"]');
    await until(() => bulkCalls().length === 2, "the archive call");
    assert.deepStrictEqual(bulkCalls()[1].body, { ids: ["h4"], action: "archive", archived: true });
    await setDocs(page, [["h4", { archived: true }]]);
    await until(async () => (await subjects()).join() === "Hello new", "the archived email leaves the list");
    await page.click('[data-support-queue="archived"]');
    await until(() => page.evaluate(() => location.hash === "#support/hello?queue=archived"), "the Archived list");
    await until(async () => (await subjects()).join() === "Hello archived,Hello four", "the archived emails");
    await page.check("#support-pick-all");
    assert.deepStrictEqual(await barKeys(), ["unarchive", "spam", "clear"]);
    await page.click('[data-support-bulk="clear"]');
    assert.deepStrictEqual([await picked(), await count()], [[], ""], "Clear unticks everything");

    // Test step: switching tab clears the selection. Aidan has its own extra action.
    await page.check("#support-pick-all");
    await page.click('[data-support-tab="aidan"]');
    await until(() => page.locator('[data-support-ticket="a1"]').count(), "the Aidan emails");
    assert.deepStrictEqual([await picked(), await count()], [[], ""], "another tab: nothing selected");
    await page.check('[data-support-pick="a1"]');
    await page.check('[data-support-pick="a2"]');
    assert.deepStrictEqual(await barKeys(), ["spam", "read", "unread", "archive", "aidan-dismiss", "clear"]);
    await page.click('[data-support-bulk="aidan-dismiss"]');
    await until(() => bulkCalls().length === 3, "the dismiss call");
    assert.deepStrictEqual(bulkCalls()[2].body, { ids: ["a2", "a1"], action: "aidan-dismiss" });

    // Test step: select all in the Support Inbox, assign to a member: all assigned, in one call.
    await page.click('[data-support-tab="inbox"]');
    await until(() => page.locator('[data-support-ticket="s1"]').count(), "the Support Inbox");
    await page.check("#support-pick-all");
    assert.deepStrictEqual([await picked(), await count()], [["s1", "s2", "s3"], "3 selected"]);
    assert.strictEqual(await page.isChecked("#support-pick-all"), true);
    await until(() => page.locator('[data-support-bulk-pick="assign"] option[value="editor@ph.example"]').count(), "the members to assign to");
    assert.deepStrictEqual(await barKeys(), ["spam", "read", "unread", "resolve", "assign", "move", "escalate", "clear"]);
    const a1 = await audit(page, "#support-page");
    assert.ok(a1.overflow <= 0, `no sideways scroll with the Support Inbox's actions (${a1.overflow}px)`);
    assert.deepStrictEqual(a1.small, [], "touch targets under 44px");
    await shot(page, `bulk-support-${width}`);
    await page.selectOption('[data-support-bulk-pick="assign"]', "editor@ph.example");
    await until(() => bulkCalls().length === 4, "the assign call");
    assert.deepStrictEqual(bulkCalls()[3].body, { ids: ["s3", "s2", "s1"], action: "assign", assignee: "editor@ph.example" });
    await until(() => page.locator("#support-bulk-result").count(), "the result message");
    assert.ok((await page.textContent("#support-bulk-result")).includes("3 tickets assigned to Ed Itor."));
    assert.deepStrictEqual(await picked(), []);

    // Move to a queue, and one Staff Kanban ticket per selected ticket (asked once).
    await page.check('[data-support-pick="s1"]');
    await page.check('[data-support-pick="s2"]');
    await page.selectOption('[data-support-bulk-pick="move"]', "pending");
    await until(() => bulkCalls().length === 5, "the move call");
    assert.deepStrictEqual(bulkCalls()[4].body, { ids: ["s2", "s1"], action: "status", status: "pending" });
    await until(() => page.locator('[data-support-pick="s1"]:not(:disabled)').count(), "the list again");
    await page.check('[data-support-pick="s1"]');
    await page.check('[data-support-pick="s2"]');
    await page.click('[data-support-bulk="escalate"]');
    await until(() => page.evaluate(() => !document.getElementById("dialog-backdrop").hidden), "the Staff Kanban confirmation");
    assert.ok((await page.textContent("#dialog-backdrop")).includes("2 Staff Kanban tickets, one for each selected support ticket"));
    await page.click("#dialog-ok");
    await until(() => bulkCalls().length === 6, "the escalate call");
    assert.deepStrictEqual(bulkCalls()[5].body, { ids: ["s2", "s1"], action: "escalate" });

    // Marked unread shows in the Support Inbox too, until the ticket is opened. Changing queue clears the selection.
    await until(() => page.locator('[data-support-pick="s3"]:not(:disabled)').count(), "the list again");
    await page.check('[data-support-pick="s3"]');
    await page.click('[data-support-bulk="unread"]');
    await until(() => page.locator('[data-support-ticket="s3"].is-unread .support-unread').count(), "Support three reads Unread");
    await page.check('[data-support-pick="s1"]');
    await page.click('[data-support-queue="spam"]');
    await until(() => page.locator('[data-support-ticket="s4"]').count(), "the Spam queue");
    assert.deepStrictEqual([await picked(), await count()], [[], ""], "another queue: nothing selected");
    await page.check('[data-support-pick="s4"]');
    assert.deepStrictEqual(await barKeys(), ["not-spam", "clear"]);
    await page.click('[data-support-bulk="not-spam"]');
    await until(() => bulkCalls().length === 7, "the not-spam call");
    assert.deepStrictEqual(bulkCalls()[6].body, { ids: ["s4"], action: "status", status: "open" });
    await page.click('[data-support-queue="needs-person"]');
    await page.click('[data-support-ticket="s3"]');
    await until(() => page.evaluate(() => location.hash === "#support/ticket/s3"), "the ticket");
    await page.click('[data-support-act="back"]');
    await until(() => page.locator('[data-support-ticket="s3"]').count(), "the list");
    assert.strictEqual(await page.locator('[data-support-ticket="s3"].is-unread').count(), 0, "opening it reads it");
  });
  // A failed batch says how many failed and why, once.
  await run("selecting several threads: a failure is counted in the one result", { seed: seedFor("editor", { docs: bulkDocs, supportAnswer: { ok: true, done: 1, failed: 1, skipped: 0, errors: [{ id: "h2", error: "no such ticket" }] } }), width: 1280, hash: "#support/hello" }, async (page) => {
    await until(() => page.locator('[data-support-ticket="h1"]').count(), "the Hello emails", 15000);
    await page.check('[data-support-pick="h1"]');
    await page.check('[data-support-pick="h2"]');
    await page.click('[data-support-bulk="archive"]');
    await until(() => page.locator("#support-bulk-result").count(), "the result message");
    assert.ok((await page.textContent("#support-bulk-result")).includes("1 email archived. 1 failed: no such ticket"));
  });
  await run("selecting several threads: a viewer has no checkboxes", { seed: seedFor("viewer", { docs: bulkDocs }), width: 1280, hash: "#support/hello" }, async (page) => {
    await until(() => page.locator('[data-support-ticket="h1"]').count(), "the Hello emails", 15000);
    assert.strictEqual(await page.locator("[data-support-pick], #support-pick-all, #support-bulk").count(), 0);
  });
  // The Test lab (x3MqwdJxQ0tJMGlcDi1Y): an answer, the rating controls, a run and a failing case fit
  // at every width, light and dark, with 44px touch targets and no sideways scroll.
  const labDocs = {
    ...docs,
    faqArticles: { ...docs.faqArticles, a3: { status: "published", title: "Pair a screen with a store", keywords: ["pair"] } },
    supportEvalCases: {
      c1: { subject: "A rather long subject line for a question about adding a display to a store, to see it wrap", text: "How?", expect: "articles", articleIds: ["a3"], rating: "wrong", source: "support", ticketKey: "SUP-1", createdAt: T0, updatedAt: T0, lastResult: { runId: "r1", passed: false, problems: ["no right article chosen"], chosen: ["a1"] } },
      c2: { text: "Waiting for review", needsReview: true, expect: "", source: "aidan", ticketKey: "SUP-9", createdAt: T0, updatedAt: T0 },
    },
    supportEvalRuns: { r1: { status: "done", startedAt: t(T0), finishedAt: t(T0 + 9000), total: 1, done: 1, passed: 0, failed: 1, accuracy: 0, results: { c1: { passed: false, problems: ["no right article chosen"], chosen: ["a1"] } } } },
  };
  const labAnswer = { ok: true, relevant: true, answerable: true, confidence: 0.62, confidenceSteps: [{ articles: 1, confidence: 0.5 }, { articles: 2, confidence: 0.62 }],
    matched: [{ id: "a1", title: "Add a display to a store" }], articles: [{ id: "a1", title: "Add a display to a store" }], draft: "Hi there,\n\nThanks for your email.\n\nOpen Displays.",
    decision: { action: "review", label: "Draft to approve", reason: "Sending by itself is switched off." } };
  for (const theme of ["light", "dark"]) for (const width of [390, 820, 1280]) {
    await run(`Test lab ${theme} @${width}px`, { seed: seedFor("editor", { docs: labDocs, supportAnswers: { "lab/ask": labAnswer } }), width, height: 900, hash: "#support/lab" }, async (page) => {
      if (theme === "dark") await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
      await until(() => page.locator(".support-lab-run").count(), "the run", 15000);
      await page.fill("#lab-text", "How do I add a display?");
      await page.click('[data-lab-act="ask"]');
      await until(() => page.locator("#lab-result").count(), "the answer");
      await page.click('[data-lab-rate="partly"]');
      await page.fill("#lab-rate-pick", "pair");
      await until(() => page.locator('[data-lab-pick="a3"]').count(), "the article search");
      await page.click('[data-lab-pick="a3"]');
      let a = await audit(page, "#support-page");
      assert.ok(a.overflow <= 0, `no sideways scroll on the Test lab (${a.overflow}px)`);
      assert.deepStrictEqual(a.small, [], "touch targets under 44px on the Test lab");
      if (theme === "light") await shot(page, `lab-${width}`);
      await page.click('[data-lab-case="c2"]');
      await until(() => page.locator("#lab-case-text").count(), "the case page");
      a = await audit(page, "#support-page");
      assert.ok(a.overflow <= 0, `no sideways scroll on a case (${a.overflow}px)`);
      assert.deepStrictEqual(a.small, [], "touch targets under 44px on a case");
    });
  }
} finally { await h.close(); }
process.exit(failed ? 1 : 0);
