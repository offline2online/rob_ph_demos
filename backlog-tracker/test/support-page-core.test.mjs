// public/js/support-core.js — the Support Inbox page's rules: queues, routes,
// the stats and what "Insert from the Help Centre" puts in a reply.
// Run: node test/support-page-core.test.mjs
import assert from "node:assert";
import {
  QUEUES, queueCounts, normaliseTicket, filterTickets, supportRoute, supportHash, supportStats, fmtDuration, fmtPct, toMs,
  searchArticles, articleSnippet, draftSource, confidenceBand, CONFIDENCE_LABEL, confidenceChange, INBOXES, inInbox, inboxOf,
} from "../public/js/support-core.js";
import { sectionForHash, SECTION_HASH, storedLevel, PERMISSION_GROUPS } from "../public/js/permissions.js";
import { settingsPageFromHash, SETTINGS_PAGES } from "../public/js/settings-section.js";

const H = 3600000, D = 24 * H, T0 = Date.UTC(2026, 10, 1, 9);
const tk = (id, d) => normaliseTicket(id, { key: `SUP-${id}`, subject: `Subject ${id}`, customerEmail: `${id}@shop.example`, createdAt: new Date(T0), lastMessageAt: new Date(T0), ...d });
const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check("every open, pending, resolved or spam ticket is in exactly one working queue", () => {
  const rows = [
    tk("a", { status: "open", needsHuman: true }),
    tk("b", { status: "open", aiDraft: { text: "Hi", confidence: 0.9 } }),
    tk("c", { status: "open", automated: "mailing list" }),
    tk("d", { status: "pending" }), tk("e", { status: "resolved" }), tk("f", { status: "spam" }),
    tk("g", { status: "open", needsHuman: true, aiDraft: { text: "Hi" } }),
  ];
  const working = QUEUES.filter((q) => q.key !== "all");
  for (const t of rows) assert.strictEqual(working.filter((q) => q.test(t)).length, 1, `${t.id} is in one queue`);
  const c = queueCounts(rows);
  assert.deepStrictEqual([c["needs-person"], c["ai-drafts"], c["to-sort"], c.pending, c.resolved, c.spam, c.all], [2, 1, 1, 1, 1, 1, 6]);
  assert.strictEqual(normaliseTicket("x", { status: "weird" }).status, "open");
});

check("the list: queue and search filter, high-value first where a person is needed, then newest", () => {
  const rows = [
    tk("old", { needsHuman: true, lastMessageAt: new Date(T0) }),
    tk("new", { needsHuman: true, lastMessageAt: new Date(T0 + H) }),
    tk("vip", { needsHuman: true, highValue: true, account: { name: "Big Retail" }, lastMessageAt: new Date(T0 - D) }),
    tk("done", { status: "resolved" }),
  ];
  assert.deepStrictEqual(filterTickets(rows, "needs-person", "").map((t) => t.id), ["vip", "new", "old"]);
  assert.deepStrictEqual(filterTickets(rows, "needs-person", "big retail").map((t) => t.id), ["vip"]);
  assert.deepStrictEqual(filterTickets(rows, "all", "SUP-done").map((t) => t.id), ["done"]);
  assert.deepStrictEqual(filterTickets(rows, "nonsense", "").map((t) => t.id), ["vip", "new", "old"], "an unknown queue is the default one");
});

check("routes round-trip and belong to the Support Inbox section", () => {
  assert.strictEqual(supportRoute("#promote/leads"), null);
  assert.strictEqual(supportRoute("#supporters"), null);
  assert.deepStrictEqual(supportRoute("#support"), { view: "inbox", inbox: "support", queue: "needs-person", ticketId: "" });
  assert.deepStrictEqual(supportRoute("#support?queue=spam"), { view: "inbox", inbox: "support", queue: "spam", ticketId: "" });
  assert.strictEqual(supportRoute("#support?queue=bogus").queue, "needs-person");
  assert.deepStrictEqual(supportRoute("#support/stats"), { view: "stats", inbox: "support", queue: "", ticketId: "" });
  assert.deepStrictEqual(supportRoute("#support/try"), { view: "try", inbox: "support", queue: "", ticketId: "" });
  assert.strictEqual(supportHash({ view: "try" }), "#support/try");
  assert.deepStrictEqual(supportRoute("#support/ticket/19a%2Fb"), { view: "ticket", inbox: "support", queue: "", ticketId: "19a/b" });
  for (const r of [{ view: "inbox", queue: "spam" }, { view: "stats" }, { view: "ticket", ticketId: "19a/b" }, {}]) {
    const back = supportRoute(supportHash(r));
    assert.strictEqual(back.view, r.view || "inbox");
    assert.strictEqual(back.ticketId, r.ticketId || "");
  }
  assert.strictEqual(sectionForHash("#support"), "support-inbox");
  assert.strictEqual(sectionForHash("#support/ticket/x"), "support-inbox");
  assert.strictEqual(SECTION_HASH["support-inbox"], "#support");
  assert.deepStrictEqual(PERMISSION_GROUPS.find((g) => g.label === "Support").keys, ["support-inbox", "faq"], "above Help Centre");
  assert.strictEqual(storedLevel({ name: "Agent", permissions: { faq: "view" } }, "support-inbox"), "view", "follows the Help Centre grant until set");
  assert.strictEqual(settingsPageFromHash("#settings/support?connected=1"), "support");
  assert.ok(SETTINGS_PAGES.some((p) => p.key === "support"));
});

check("three inboxes, each with its own route, list and counts; a ticket written to two aliases is in both", () => {
  assert.deepStrictEqual(INBOXES.map((i) => i.label), ["Support Inbox", "Hello", "Aidan"]);
  const rows = [
    tk("s1", { needsHuman: true, inboxes: ["support"] }),
    tk("old", { needsHuman: true }),
    tk("h1", { needsHuman: true, inboxes: ["hello"] }),
    tk("h2", { status: "resolved", inboxes: ["hello"] }),
    tk("a1", { aiDraft: { text: "Hi" }, inboxes: ["aidan"] }),
    tk("sa", { needsHuman: true, inboxes: ["support", "aidan"], lastMessageAt: new Date(T0 + H) }),
    tk("odd", { needsHuman: true, inboxes: ["bogus"] }),
  ];
  assert.deepStrictEqual(rows.find((t) => t.id === "old").inboxes, ["support"], "a ticket with none recorded is the Support Inbox's");
  assert.deepStrictEqual(rows.find((t) => t.id === "odd").inboxes, ["support"]);
  const ids = (inbox, queue = "all") => filterTickets(rows, queue, "", inbox).map((t) => t.id).sort();
  assert.deepStrictEqual(ids("support"), ["odd", "old", "s1", "sa"]);
  assert.deepStrictEqual(ids("hello"), ["h1", "h2"]);
  assert.deepStrictEqual(ids("aidan"), ["a1", "sa"]);
  assert.deepStrictEqual(ids("aidan", "needs-person"), ["sa"]);
  assert.deepStrictEqual(filterTickets(rows, "all", "").length, 7, "no inbox named: every ticket");
  const c = (inbox) => { const q = queueCounts(rows, inbox); return [q["needs-person"], q["ai-drafts"], q.resolved, q.all]; };
  assert.deepStrictEqual([c("support"), c("hello"), c("aidan"), c()], [[4, 0, 0, 4], [1, 0, 1, 2], [1, 1, 0, 2], [5, 1, 1, 7]]);
  assert.strictEqual(inInbox(rows[0], "nonsense"), true, "an unknown inbox is the Support Inbox");
  assert.strictEqual(inboxOf("aidan").label, "Aidan");
  // Routes: the Support Inbox keeps its old addresses; Hello and Aidan have their own.
  assert.deepStrictEqual(supportRoute("#support/hello"), { view: "inbox", inbox: "hello", queue: "needs-person", ticketId: "" });
  assert.deepStrictEqual(supportRoute("#support/aidan?queue=resolved"), { view: "inbox", inbox: "aidan", queue: "resolved", ticketId: "" });
  assert.deepStrictEqual(supportRoute("#support/aidan/ticket/19a%2Fb"), { view: "ticket", inbox: "aidan", queue: "", ticketId: "19a/b" });
  assert.strictEqual(supportRoute("#support/helloworld").inbox, "support");
  assert.deepStrictEqual([supportHash({ inbox: "support" }), supportHash({ inbox: "hello" }), supportHash({ inbox: "aidan", queue: "spam" }), supportHash({ view: "ticket", inbox: "hello", ticketId: "t1" }), supportHash({ view: "ticket", ticketId: "t1" }), supportHash({ inbox: "bogus" })],
    ["#support", "#support/hello", "#support/aidan?queue=spam", "#support/hello/ticket/t1", "#support/ticket/t1", "#support"]);
  for (const r of [{ inbox: "hello" }, { inbox: "aidan", queue: "pending" }, { view: "ticket", inbox: "aidan", ticketId: "x/y" }]) {
    const back = supportRoute(supportHash(r));
    assert.deepStrictEqual([back.inbox, back.view, back.ticketId], [r.inbox, r.view || "inbox", r.ticketId || ""]);
  }
  assert.strictEqual(sectionForHash("#support/hello"), "support-inbox");
  assert.strictEqual(sectionForHash("#support/aidan/ticket/x"), "support-inbox");
});

check("stats count the Support Inbox only: mail written to hello@ or aidan@ alone is not in them", () => {
  const rows = [tk("s", { status: "resolved", resolvedBy: "ai" }), tk("h", { status: "resolved", inboxes: ["hello"] }), tk("a", { inboxes: ["aidan"], needsHuman: true }), tk("sa", { inboxes: ["support", "aidan"], needsHuman: true })];
  const s = supportStats(rows, {});
  assert.deepStrictEqual([s.received, s.resolved, s.needsPerson], [2, 1, 1]);
});

check("stats: spam and machine mail are left out, AI-only resolutions are separated from people's, times are medians", () => {
  const rows = [
    tk("ai1", { status: "resolved", resolvedBy: "ai", firstResponseAt: new Date(T0 + 0.1 * H), resolvedAt: new Date(T0 + 0.1 * H), category: "how-to" }),
    tk("ai2", { status: "resolved", resolvedBy: "ai", humanInvolved: true, firstResponseAt: new Date(T0 + H), resolvedAt: new Date(T0 + 5 * H), reopenCount: 1, category: "how-to" }),
    tk("hum", { status: "resolved", resolvedBy: "ed@ph.example", humanInvolved: true, highValue: true, firstResponseAt: new Date(T0 + 3 * H), resolvedAt: new Date(T0 + 9 * H), category: "bug" }),
    tk("open", { status: "open", needsHuman: true, createdAt: new Date(T0 + D) }),
    tk("wait", { status: "pending", humanInvolved: true, firstResponseAt: new Date(T0 + 2 * H) }),
    tk("spam", { status: "spam" }), tk("news", { status: "open", automated: "mailing list" }),
    tk("seo", { status: "open", unrelated: true, category: "unrelated" }),
    tk("before", { status: "resolved", createdAt: new Date(T0 - 100 * D) }),
  ];
  const s = supportStats(rows, { from: T0 - D, to: T0 + 2 * D });
  assert.deepStrictEqual([s.received, s.spam, s.automated, s.unrelated], [5, 1, 1, 1], "mail that isn't about Personalisation Hub is counted on its own");
  assert.strictEqual(normaliseTicket("x", { category: "unrelated" }).unrelated, true);
  assert.deepStrictEqual([s.resolved, s.resolvedByAi, s.resolvedByPeople, s.open, s.pending, s.needsPerson], [3, 1, 2, 1, 1, 1]);
  assert.strictEqual(fmtPct(s.aiRate), "33%");
  assert.deepStrictEqual([s.humanInvolved, s.highValue, s.reopened], [3, 1, 1]);
  assert.strictEqual(s.medianFirstResponseMs, 1.5 * H, "median of 0.1h, 1h, 2h, 3h");
  assert.strictEqual(s.medianResolutionMs, 5 * H);
  assert.deepStrictEqual(s.byDay.map((d) => [d.ai, d.people, d.open]), [[1, 2, 1], [0, 0, 1]]);
  assert.deepStrictEqual(s.byCategory[0], { key: "how-to", label: "How-to", count: 2 });
  const none = supportStats([], {});
  assert.deepStrictEqual([none.received, none.aiRate, none.medianFirstResponseMs], [0, null, null]);
});

check("durations, percentages and timestamps read plainly", () => {
  assert.deepStrictEqual([fmtDuration(null), fmtDuration(20000), fmtDuration(95000), fmtDuration(7500000), fmtDuration(3 * D + 11 * H), fmtDuration(2 * D)], ["—", "under 1m", "2m", "2h 5m", "3d 11h", "2d"]);
  assert.deepStrictEqual([fmtPct(null), fmtPct(0.666)], ["—", "67%"]);
  assert.deepStrictEqual([toMs(null), toMs({ toMillis: () => 5 }), toMs({ $ts: 7 }), toMs({ seconds: 2 }), toMs("2026-11-01T09:00:00Z")], [0, 5, 7, 2000, T0]);
});

check("inserting a Help Centre article: every word must match, the snippet is the answer and the link", () => {
  const arts = [
    { id: "a1", title: "Add a display to a store", directAnswer: "Open Displays and Devices, then Add display.", keywords: ["pairing"] },
    { id: "a2", title: "Reset your password", summary: "Use the sign-in page" },
  ];
  assert.deepStrictEqual(searchArticles(arts, "display pairing").map((a) => a.id), ["a1"]);
  assert.deepStrictEqual(searchArticles(arts, "display password"), []);
  assert.deepStrictEqual(searchArticles(arts, " "), []);
  assert.strictEqual(articleSnippet(arts[0]), "Open Displays and Devices, then Add display.\n\nAdd a display to a store: https://personalisationhub.com/support-centre/article.html?id=a1");
  assert.strictEqual(draftSource("Hi ", { text: "Hi" }, true), "ai-draft");
  assert.strictEqual(draftSource("Hi there", { text: "Hi" }, true), "ai-draft-edited");
  assert.strictEqual(draftSource("Hi", { text: "Hi" }, false), "manual");
});

check("confidence reads as a word and a number, and shows what combining answers did", () => {
  assert.deepStrictEqual([confidenceBand(0.8), confidenceBand(0.79), confidenceBand(0.6), confidenceBand(0.2)], ["high", "medium", "medium", "low"]);
  assert.strictEqual(CONFIDENCE_LABEL.high, "High confidence");
  assert.strictEqual(confidenceChange([{ articles: 1, confidence: 0.55 }, { articles: 3, confidence: 0.82 }]), "55% from 1 article, 82% with 3 combined");
  assert.strictEqual(confidenceChange([{ articles: 1, confidence: 0.9 }]), "");
  assert.deepStrictEqual(normaliseTicket("x", { aiDraft: { text: "Hi", confidence: 0.8, confidenceSteps: [{ articles: 1, confidence: 0.5 }] } }).aiDraft.confidenceSteps, [{ articles: 1, confidence: 0.5 }]);
});

let failed = 0;
for (const [name, fn] of checks) {
  try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}
console.log(failed ? `\n${failed} of ${checks.length} failed` : `\nsupport-page-core: ${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
