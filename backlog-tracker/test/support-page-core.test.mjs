// public/js/support-core.js — the Support Inbox page's rules: queues, routes,
// writing a new email and what "Insert from the Help Centre" puts in a reply.
// Run: node test/support-page-core.test.mjs
import assert from "node:assert";
import {
  QUEUES, queueCounts, normaliseTicket, filterTickets, supportRoute, supportHash, composeProblem, COMPOSE_MAX, toMs,
  searchArticles, articleSnippet, draftSource, confidenceBand, CONFIDENCE_LABEL, confidenceChange, INBOXES, inInbox, inboxOf,
} from "../public/js/support-core.js";
import { aidanView, aidanThreadState, aidanCollateral, aidanRequestWaiting, spamConfirmText, isPlainInbox, isUnread, plainInboxRows, plainInboxCounts } from "../public/js/support-core.js";
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
  // Stats and Try an email were tabs once: an old link to either opens the inbox.
  const inbox = { view: "inbox", inbox: "support", queue: "needs-person", ticketId: "" };
  assert.deepStrictEqual(supportRoute("#support/stats"), inbox);
  assert.deepStrictEqual(supportRoute("#support/try"), inbox);
  assert.strictEqual(supportHash({ view: "stats" }), "#support");
  assert.deepStrictEqual(supportRoute("#support/compose"), { view: "compose", inbox: "support", queue: "", ticketId: "" });
  assert.strictEqual(supportHash({ view: "compose" }), "#support/compose");
  assert.deepStrictEqual(supportRoute("#support/ticket/19a%2Fb"), { view: "ticket", inbox: "support", queue: "", ticketId: "19a/b" });
  for (const r of [{ view: "inbox", queue: "spam" }, { view: "compose" }, { view: "ticket", ticketId: "19a/b" }, {}]) {
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
  // Hello and Aidan have no queues: their route's queue is "" (the emails) or "spam".
  assert.deepStrictEqual(supportRoute("#support/hello"), { view: "inbox", inbox: "hello", queue: "", ticketId: "" });
  assert.deepStrictEqual(supportRoute("#support/aidan?queue=resolved"), { view: "inbox", inbox: "aidan", queue: "", ticketId: "" }, "an old link to a queue opens the emails");
  assert.deepStrictEqual(supportRoute("#support/aidan?queue=spam"), { view: "inbox", inbox: "aidan", queue: "spam", ticketId: "" });
  assert.deepStrictEqual(supportRoute("#support?queue=resolved").queue, "resolved", "the Support Inbox keeps its queues");
  assert.strictEqual(supportHash({ inbox: "hello", queue: "resolved" }), "#support/hello", "no queue is written into a plain inbox's address");
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

check("a new email needs one address, a subject and a message", () => {
  const ok = { to: " ann@shop.example ", subject: "Hello", text: "Hi Ann" };
  assert.strictEqual(composeProblem(ok), "");
  assert.ok(/who the email is to/.test(composeProblem({ ...ok, to: " " })));
  for (const to of ["ann", "ann@shop", "ann@shop.example, bo@shop.example", "Ann <ann@shop.example>", "ann@shop.example\nBcc: x@y.example", "ann @shop.example"]) assert.ok(/isn't an email address/.test(composeProblem({ ...ok, to })), to);
  assert.ok(/subject/.test(composeProblem({ ...ok, subject: "" })));
  assert.ok(/Write the message/.test(composeProblem({ ...ok, text: "\n " })));
  assert.strictEqual(composeProblem({ ...ok, text: "x".repeat(COMPOSE_MAX) }), "");
  assert.ok(/at most 8000/.test(composeProblem({ ...ok, text: "x".repeat(COMPOSE_MAX + 1) })));
  assert.ok(composeProblem(), "nothing given");
});

check("a ticket carries when the customer last wrote and when they were last replied to", () => {
  const t = normaliseTicket("x", { lastInboundAt: new Date(T0), lastReplyAt: new Date(T0 + H) });
  assert.deepStrictEqual([t.lastInboundAt, t.lastReplyAt], [T0, T0 + H]);
  const old = normaliseTicket("y", {});
  assert.deepStrictEqual([old.lastInboundAt, old.lastReplyAt], [0, 0], "unset on a ticket filed before they were recorded");
});

check("timestamps read plainly", () => {
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

check("Aidan's state on a ticket reads as a badge and one line; nothing when Aidan has nothing to say", () => {
  assert.strictEqual(normaliseTicket("x", {}).aidan, null);
  assert.strictEqual(normaliseTicket("x", { aidan: { status: "made-up" } }).aidan, null, "an unknown state is not shown");
  const replied = aidanView(normaliseTicket("x", { aidan: { status: "replied", skillName: "AWS onboarding pack", document: { name: "pack.md" }, recipients: 3 } }).aidan);
  assert.deepStrictEqual([replied.badge, replied.tone, replied.line], ["Aidan replied", "done", "Aidan wrote pack.md with the AWS onboarding pack skill and replied to 3 people on this email."]);
  const ingested = aidanView({ status: "ingested", skillName: "AWS onboarding pack", files: [{ name: "a.pdf" }] });
  assert.deepStrictEqual([ingested.badge, ingested.line], ["Ingested", "Ingested: kept as reference material for the AWS onboarding pack skill (1 attachment)."]);
  assert.strictEqual(aidanView({ status: "ignored", reason: "The sender is not allowed to instruct Aidan." }).tone, "attention");
  assert.ok(aidanView({ status: "queued", kind: "generate", instruction: "send the pack" }).line.includes("next scheduled sync"));
  assert.strictEqual(aidanView(null), null);
  // The kind: Answer, Write or Store; none on a tag that was refused.
  assert.deepStrictEqual([replied.kind, ingested.kind, aidanView({ status: "ignored", reason: "x" }).kind], ["", "", ""], "a ticket with no kind recorded shows none");
  assert.deepStrictEqual(["answer", "generate", "store"].map((kind) => aidanView({ status: "queued", kind, instruction: "x" }).kind), ["Answer", "Write", "Store"]);
  const answered = aidanView({ status: "replied", kind: "answer", recipients: 3 });
  assert.deepStrictEqual([answered.badge, answered.kind, answered.line], ["Aidan replied", "Answer", "Aidan answered in the email itself, to 3 people on this email. Nothing was attached."]);
  assert.strictEqual(aidanView({ status: "replied", kind: "answer", recipients: 1 }).line, "Aidan answered in the email itself, to 1 person on this email. Nothing was attached.");
  assert.ok(aidanView({ status: "queued", kind: "answer", instruction: "please confirm you received this" }).line.startsWith('Aidan was asked to answer on the email: "please confirm you received this".'));
});

check("an answer Aidan took from the Help Centre carries its matched articles and confidence; any other run carries none", () => {
  const hc = { confidence: 0.62, confidenceSteps: [{ articles: 1, confidence: 0.5 }, { articles: 2, confidence: 0.62 }], articles: [{ id: "a1", title: "Set up targeting", url: "https://x.example/a1" }, { id: "h1", title: "Hidden one", url: "" }, { id: "bad" }] };
  const v = aidanView(normaliseTicket("x", { aidan: { status: "replied", kind: "answer", recipients: 2, helpCentre: hc } }).aidan);
  assert.strictEqual(v.line, "Aidan answered from the Help Centre, in the email itself, to 2 people on this email. Nothing was attached.");
  assert.deepStrictEqual(v.helpCentre, { confidence: 0.62, confidenceSteps: hc.confidenceSteps, articles: [{ id: "a1", title: "Set up targeting", url: "https://x.example/a1" }, { id: "h1", title: "Hidden one", url: "" }] });
  assert.strictEqual(aidanView({ status: "replied", kind: "answer", recipients: 2 }).helpCentre, null, "an answer from the email or the console");
  assert.strictEqual(aidanView({ status: "replied", kind: "answer", recipients: 2, helpCentre: { confidence: 0.9, articles: [] } }).helpCentre, null, "no article, nothing to show");
  assert.strictEqual(aidanView({ status: "replied", kind: "generate", recipients: 2, helpCentre: hc }).helpCentre, null, "only an answer");
  assert.strictEqual(aidanView({ status: "needs-person", kind: "answer", helpCentre: hc }).helpCentre, null, "only one that was sent");
  assert.strictEqual(aidanView({ status: "replied", kind: "answer", recipients: 1, helpCentre: { confidence: 7, articles: [{ id: "a", title: "T" }] } }).helpCentre.confidence, 1);
  assert.ok(!aidanThreadState(null).helpCentre, "a thread Aidan never ran has none");
});

check("Hello and Aidan are plain inboxes: an email list with unread and spam, no queues", () => {
  assert.deepStrictEqual(INBOXES.map((i) => isPlainInbox(i.key)), [false, true, true], "only the Support Inbox is worked as tickets");
  assert.strictEqual(isPlainInbox("nonsense"), false, "an unknown inbox is the Support Inbox");
  const at = (h) => new Date(T0 + h * H);
  const rows = [
    tk("new", { inboxes: ["hello"], customerName: "Nia", lastInboundAt: at(5), lastMessageAt: at(5), needsHuman: true, aiDraft: { text: "Hi" } }),
    tk("answered", { inboxes: ["hello"], status: "pending", lastInboundAt: at(2), lastReplyAt: at(3), lastMessageAt: at(3) }),
    tk("resolved", { inboxes: ["hello"], status: "resolved", lastInboundAt: at(1), lastMessageAt: at(1) }),
    tk("junk", { inboxes: ["hello"], status: "spam", lastInboundAt: at(6), lastMessageAt: at(6) }),
    tk("both", { inboxes: ["support", "hello"], lastInboundAt: at(4), lastMessageAt: at(4) }),
    tk("sup", { inboxes: ["support"], lastInboundAt: at(7), lastMessageAt: at(7) }),
    tk("aid", { inboxes: ["aidan"], lastInboundAt: at(7), lastMessageAt: at(7) }),
  ];
  // Every email of the inbox whatever its support status, newest first; spam apart.
  assert.deepStrictEqual(plainInboxRows(rows, "hello", "").map((t) => t.id), ["new", "both", "answered", "resolved"]);
  assert.deepStrictEqual(plainInboxRows(rows, "hello", "", true).map((t) => t.id), ["junk"]);
  assert.deepStrictEqual(plainInboxRows(rows, "aidan", "").map((t) => t.id), ["aid"]);
  assert.deepStrictEqual(plainInboxRows(rows, "hello", "nia").map((t) => t.id), ["new"], "search reads the sender");
  // Unread: the sender's latest email is newer than our last reply and than the last time it was opened here.
  const by = Object.fromEntries(rows.map((t) => [t.id, t]));
  assert.deepStrictEqual([isUnread(by.new), isUnread(by.answered), isUnread(by.junk)], [true, false, false]);
  assert.strictEqual(isUnread(by.new, T0 + 5 * H), false, "opened since it arrived");
  assert.strictEqual(isUnread(by.new, T0 + 4 * H), true, "a newer email than the last look");
  assert.strictEqual(isUnread(tk("old", { inboxes: ["hello"] })), false, "filed before arrival times were kept");
  assert.deepStrictEqual(plainInboxCounts(rows, "hello"), { emails: 4, unread: 3, spam: 1 });
  assert.deepStrictEqual(plainInboxCounts(rows, "hello", { new: T0 + 5 * H, resolved: T0 + D }), { emails: 4, unread: 1, spam: 1 });
  // The Aidan tab always says what Aidan did, "no action" included.
  assert.deepStrictEqual(aidanThreadState(null), { badge: "Aidan: no action", tone: "none", line: "Aidan did nothing: this email has no @Aidan request.", kind: "" });
  assert.strictEqual(aidanThreadState({ status: "ignored", reason: "The sender is not allowed to instruct Aidan." }).line, "Aidan did nothing: The sender is not allowed to instruct Aidan.");
  assert.strictEqual(aidanThreadState({ status: "working", instruction: "send the pack" }).badge, "Aidan: working");
});

check("Aidan's branded collateral (JtkLrEG0aTnC5JfkdPA1): what was written and for whom, the PDF and its Markdown, kept for the skill, what was removed", () => {
  const a = { status: "replied", kind: "generate", skillName: "PH Brand", recipients: 2, document: { name: "cp-group.md" },
    collateral: { format: "one-pager", formatLabel: "One-pager", industry: "Grocery & Supermarkets", prospect: { name: "CP Group", source: "prospect" },
      pdf: { name: "cp-group.pdf", pages: 1, size: 48000 }, markdown: { name: "cp-group.md", size: 2100 }, referenceId: "ref-1",
      removed: [{ rule: "australia", count: 2 }, { rule: "internal", count: 1 }, { rule: "made-up", count: 4 }, { rule: "dashes", count: 0 }] } };
  const c = aidanCollateral(a);
  assert.strictEqual(c.about, "One-pager · Grocery & Supermarkets · for CP Group (industry and country from Prospects (TAM))");
  assert.deepStrictEqual(c.files, [{ name: "cp-group.pdf", detail: "Branded PDF, 1 page, 47 KB" }, { name: "cp-group.md", detail: "Markdown source, 2 KB" }]);
  assert.deepStrictEqual([c.kept, c.unsent], [true, false]);
  assert.deepStrictEqual(c.removed, ["2 sentences placing Personalisation Hub in Australia", "1 sentence naming an internal project"], "known rules with a count only");
  assert.strictEqual(aidanView(a).line, "Aidan wrote the branded one-pager with the PH Brand skill and replied to 2 people on this email with the PDF and its Markdown source attached.");
  const unsent = aidanCollateral({ status: "needs-person", collateral: { formatLabel: "Platform overview", industry: "", prospect: null, pdf: null, markdown: { name: "x.md", size: 10 } } });
  assert.deepStrictEqual([unsent.about, unsent.unsent, unsent.kept, unsent.files.length], ["Platform overview", true, false, 1]);
  assert.strictEqual(aidanCollateral({ status: "replied", kind: "generate" }), null, "an ordinary write");
  assert.strictEqual(aidanCollateral(null), null);
  assert.ok(aidanView({ status: "replied", kind: "generate", document: { name: "pack.md" }, recipients: 1 }).line.startsWith("Aidan wrote pack.md"), "an ordinary write reads as before");
});

check("Mark as spam (mMQ4yBYu4uwvOSHK9WlA): the confirmation in each tab, and what a spam thread reads in Aidan", () => {
  const t = tk("s", { inboxes: ["support", "aidan"] });
  assert.strictEqual(spamConfirmText(t, { plain: true }), "Mark this email as spam? It moves to Spam here and in the mailbox.");
  assert.strictEqual(spamConfirmText(t), `Mark ${t.key} as spam? It moves to Spam here and in the mailbox, and is left out of the Dashboard's figures.`);
  // A request Aidan has waiting is cancelled, and the confirmation says so first, in every tab.
  for (const status of ["queued", "working"]) {
    const waiting = tk("w", { inboxes: ["aidan"], aidan: { status, kind: "answer", instruction: "confirm" } });
    assert.strictEqual(aidanRequestWaiting(waiting.aidan), true);
    assert.strictEqual(spamConfirmText(waiting, { plain: true }), "Mark this email as spam? It moves to Spam here and in the mailbox. Aidan's request on it is cancelled.");
    assert.ok(spamConfirmText(waiting).endsWith("the Dashboard's figures. Aidan's request on it is cancelled."));
  }
  assert.deepStrictEqual([null, { status: "replied" }, { status: "ignored", spam: true, cancelled: true }].map(aidanRequestWaiting), [false, false, false]);
  // What the server records (functions/aidan.js → markSpam).
  const cancelled = aidanView({ status: "ignored", spam: true, cancelled: true, reason: "spam" });
  assert.deepStrictEqual([cancelled.badge, cancelled.tone, cancelled.kind, cancelled.line], ["Aidan: no action", "none", "", "Aidan: no action — spam. The request waiting on this thread was cancelled."]);
  assert.strictEqual(aidanView({ status: "ignored", spam: true, cancelled: false, reason: "spam", before: { status: "replied", kind: "answer" } }).line, "Aidan: no action — spam.");
  // A spam thread in the Aidan tab says so even with no record (marked before Aidan kept one).
  assert.strictEqual(aidanThreadState(null, { spam: true }).line, "Aidan: no action — spam.");
  assert.strictEqual(aidanThreadState({ status: "replied", kind: "answer", recipients: 1 }, { spam: true }).line, "Aidan: no action — spam.");
  // After Not spam a cancelled request reads as an ordinary refusal.
  assert.strictEqual(aidanThreadState({ status: "ignored", cancelled: true, reason: "The request was cancelled when this thread was marked as spam. Send it again to run it." }).line,
    "Aidan did nothing: The request was cancelled when this thread was marked as spam. Send it again to run it.");
});

let failed = 0;
for (const [name, fn] of checks) {
  try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}
console.log(failed ? `\n${failed} of ${checks.length} failed` : `\nsupport-page-core: ${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
