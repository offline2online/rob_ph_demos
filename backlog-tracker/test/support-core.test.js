// functions/support-core.js — the Support Inbox rules (no Firebase, no network).
// Run: node test/support-core.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const core = require("../functions/support-core");

const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const gmailMsg = ({ id = "m1", threadId = "t1", headers = {}, text = "Hello", html = "", labels = ["INBOX"], date = 1760000000000, attachment = null }) => ({
  id, threadId, labelIds: labels, internalDate: String(date),
  payload: {
    mimeType: "multipart/mixed",
    headers: Object.entries({ From: "Ann Lee <ann@shop.example>", To: "support@ph.example", Subject: "How do I add a display?", "Message-ID": "<abc@shop.example>", ...headers }).map(([name, value]) => ({ name, value })),
    parts: [
      { mimeType: "multipart/alternative", parts: [
        ...(text ? [{ mimeType: "text/plain", body: { data: b64(text) } }] : []),
        ...(html ? [{ mimeType: "text/html", body: { data: b64(html) } }] : []),
      ] },
      ...(attachment ? [{ mimeType: "application/pdf", filename: attachment, body: { size: 1234, attachmentId: "x" } }] : []),
    ],
  },
});

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check("addresses: display names, bare addresses, quoted commas", () => {
  assert.deepStrictEqual(core.parseAddress('"Lee, Ann" <Ann@Shop.Example>'), { name: "Lee, Ann", email: "ann@shop.example" });
  assert.deepStrictEqual(core.parseAddress("ann@shop.example"), { name: "", email: "ann@shop.example" });
  assert.deepStrictEqual(core.parseAddressList('"Lee, Ann" <a@x.example>, b@y.example').map((a) => a.email), ["a@x.example", "b@y.example"]);
  assert.strictEqual(core.parseAddress("not an address").email, "");
});

check("a Gmail message becomes a console message: direction, body, attachments, snippet", () => {
  const m = core.parseGmailMessage(gmailMsg({ text: "Hi,\nHow do I add a display?\n\nOn Mon, 1 Jan 2026 at 10:00, Support <s@ph.example> wrote:\n> old text", attachment: "invoice.pdf" }), "support@ph.example");
  assert.strictEqual(m.direction, "in");
  assert.strictEqual(m.from, "ann@shop.example");
  assert.strictEqual(m.fromName, "Ann Lee");
  assert.strictEqual(m.subject, "How do I add a display?");
  assert.strictEqual(m.messageId, "<abc@shop.example>");
  assert.ok(m.text.includes("old text"), "the stored text keeps the quoted history");
  assert.strictEqual(m.snippet, "Hi, How do I add a display?", "the snippet is only the new part");
  assert.deepStrictEqual(m.attachments.map((a) => a.name), ["invoice.pdf"]);
  assert.strictEqual(m.at.getTime(), 1760000000000);
  assert.strictEqual(m.automated, "");
  const out = core.parseGmailMessage(gmailMsg({ headers: { From: "Support <support@ph.example>" }, labels: ["SENT"] }), "Support@PH.example");
  assert.strictEqual(out.direction, "out");
});

check("an html-only message is read as text, scripts dropped, entities decoded", () => {
  const m = core.parseGmailMessage(gmailMsg({ text: "", html: "<html><head><style>p{}</style></head><body><p>Hello &amp; welcome</p><script>alert(1)</script><div>Line&nbsp;two &#8364;5</div></body></html>" }), "s@ph.example");
  assert.strictEqual(m.text, "Hello & welcome\nLine two €5");
});

check("stripQuoted drops reply history in the common shapes and never returns nothing", () => {
  assert.strictEqual(core.stripQuoted("Thanks!\n\n> quoted\n> more"), "Thanks!");
  assert.strictEqual(core.stripQuoted("Thanks!\n\n-----Original Message-----\nFrom: x"), "Thanks!");
  assert.strictEqual(core.stripQuoted("Thanks!\n\nFrom: Support\nSent: Monday\nSubject: x"), "Thanks!");
  assert.strictEqual(core.stripQuoted("> only quoted"), "> only quoted");
});

check("machine-sent mail is recognised and is never a candidate for an automatic answer", () => {
  const reason = (headers, from = "ann@shop.example") => core.automatedReason(core.headerMap(Object.entries(headers).map(([name, value]) => ({ name, value }))), from);
  assert.strictEqual(reason({}), "");
  assert.strictEqual(reason({ "Auto-Submitted": "no" }), "");
  assert.ok(reason({ "Auto-Submitted": "auto-replied" }));
  assert.ok(reason({ Precedence: "bulk" }));
  assert.ok(reason({ "List-Unsubscribe": "<mailto:x@y.example>" }));
  assert.ok(reason({ "Return-Path": "<>" }));
  assert.ok(reason({}, "no-reply@shop.example"));
  assert.ok(reason({}, "mailer-daemon@googlemail.com"));
  assert.strictEqual(reason({}, "norah@shop.example"), "", "a person whose name starts like no-reply is a person");
  const settings = core.normaliseSettings({ autoReply: true });
  const triage = { answerable: true, reply: "x", articleIds: ["a"], confidence: 0.99, spamLikely: false };
  const d = core.decideAction({ triage, settings, automated: "mailing list" });
  assert.strictEqual(d.action, "human");
  assert.strictEqual(d.needsHuman, false);
});

check("high-value senders: a lead contact, a VIP domain, a TAM company, a lead company; never a personal mailbox by domain", () => {
  const ctx = {
    prospects: [{ id: "p1", name: "Big Retail", website: "https://www.bigretail.example/uk" }],
    leads: [{ id: "l1", name: "Corner Shop", website: "cornershop.example", contacts: [{ email: "Owner@Gmail.com" }] }],
    vipDomains: ["vip.example"], freeDomains: ["gmail.com"],
  };
  assert.strictEqual(core.matchAccount("buyer@uk.bigretail.example", ctx).kind, "prospect");
  assert.strictEqual(core.matchAccount("x@vip.example", ctx).kind, "vip");
  assert.strictEqual(core.matchAccount("sam@cornershop.example", ctx).id, "l1");
  assert.strictEqual(core.matchAccount("owner@gmail.com", ctx).kind, "lead", "an exact contact address matches even on a personal mailbox");
  assert.strictEqual(core.matchAccount("someone@gmail.com", ctx), null);
  assert.strictEqual(core.matchAccount("x@notbigretail.example", ctx), null);
  assert.strictEqual(core.matchAccount("", ctx), null);
});

check("FAQ ranking: loose matching, best first, nothing for an unrelated email", () => {
  const articles = [
    { id: "a1", title: "Add a display to a store", summary: "Pair a new screen", keywords: ["display", "pairing"], bodyMd: "Open Displays and Devices" },
    { id: "a2", title: "Reset your password", summary: "Use the sign-in page", keywords: ["password"], bodyMd: "" },
    { id: "a3", title: "Campaign targeting", summary: "Audiences", keywords: [], bodyMd: "display rules" },
  ];
  const got = core.rankArticles(articles, "Hello, please can you tell me how I add a new display to my store? Thanks");
  assert.strictEqual(got[0].id, "a1");
  assert.ok(!got.some((a) => a.id === "a2"));
  assert.deepStrictEqual(core.rankArticles(articles, "Invoice for March attached"), []);
  assert.deepStrictEqual(core.rankArticles(articles, ""), []);
});

check("every draft opens with the first name (or 'there') and thanks, and the model's own opening and sign-off are removed", () => {
  const cases = [["Ann Lee", "ann@x.example", "Ann"], ["Lee, Ann", "", "Ann"], ["ANN LEE", "", "Ann"], ["Dr. Raj Patel", "", "Raj"], ["O'Neil Sam", "", "O'Neil"], ["Zoë", "", "Zoë"],
    ["Acme Retail Ltd", "info@acme.example", ""], ["Support Team", "support@x.example", ""], ["", "ann.lee@shop.example", "Ann"], ["", "jsmith@shop.example", ""], ["", "info.desk@x.example", ""],
    ["Legal", "legal@bank.example", ""], ["Store Manager Kingston", "kingston.manager@retail.example", ""], ["Cloud Team", "cloud@x.example", ""], ["IT", "ann.lee@x.example", ""]];
  for (const [name, email, want] of cases) assert.strictEqual(core.firstNameOf(name, email), want, `${name} <${email}>`);
  assert.strictEqual(core.composeReply("Ann", "Hi Ann,\n\nThank you for your email.\n\nOpen Displays.\n\nKind regards,\nSupport"), "Hi Ann,\n\nThanks for your email.\n\nOpen Displays.");
  assert.strictEqual(core.composeReply("", "Hello there!\nI hope you are well. Open Displays."), "Hi there,\n\nThanks for your email.\n\nOpen Displays.");
  assert.strictEqual(core.composeReply("Ann", "Thanks for the update on the screens. Open Displays."), "Hi Ann,\n\nThanks for your email.\n\nThanks for the update on the screens. Open Displays.", "only a thanks for the email itself is removed");
  assert.strictEqual(core.composeReply("Ann", "  "), "");
});

check("matching: the whole catalogue is offered one line per article, and only real article ids survive", () => {
  const line = core.articleIndexLine({ id: "a1", title: "Add a display", summary: "Pair a screen", directAnswer: "Open Displays", keywords: ["pairing"], questionVariants: ["How do I add a screen?"] }, "Digital Signage");
  assert.strictEqual(line, "a1 | Digital Signage | Add a display | Pair a screen | Open Displays | asked as: How do I add a screen? | keywords: pairing");
  const sel = core.cleanSelection({ relevant: true, question: "q", category: "how-to", articleIds: ["a1", "zz", "a2", "a3", "a4", "a5"], spamLikely: false }, ["a1", "a2", "a3", "a4", "a5"]);
  assert.deepStrictEqual(sel.articleIds, ["a1", "a2", "a3"], "at most 3, invented ids dropped");
  const off = core.cleanSelection({ relevant: false, category: "how-to", articleIds: ["a1"] }, ["a1"]);
  assert.deepStrictEqual([off.relevant, off.category, off.articleIds], [false, "unrelated", []]);
  assert.ok(/retail media/i.test(core.SELECT_SYSTEM) && /Out of scope/.test(core.SELECT_SYSTEM), "the scope names the retail media proposition and what is out of scope");
});

check("never more than 3 articles, and the confidence steps are cleaned", () => {
  const t = core.cleanTriage({ answerable: true, reply: "x", articleIds: ["a", "b", "c", "d"], confidenceSteps: [{ articles: 9, confidence: 2 }, { articles: "1", confidence: "0.5" }, { articles: 2, confidence: 0.9 }] }, ["a", "b", "c", "d"]);
  assert.deepStrictEqual(t.articleIds, ["a", "b", "c"]);
  assert.deepStrictEqual(t.confidenceSteps, [{ articles: 3, confidence: 1 }, { articles: 1, confidence: 0.5 }]);
  assert.strictEqual(core.MAX_ARTICLES, 3);
});

check("an email that isn't about Personalisation Hub gets no draft and no article, whatever else the model said", () => {
  const t = core.cleanTriage({ relevant: false, category: "how-to", answerable: true, confidence: 0.95, reply: "Sure!", articleIds: ["a1"] }, ["a1"]);
  assert.deepStrictEqual([t.relevant, t.category, t.answerable, t.confidence, t.reply, t.articleIds], [false, "unrelated", false, 0, "", []]);
  const d = core.decideAction({ triage: t, settings: core.normaliseSettings({ autoReply: true }) });
  assert.deepStrictEqual([d.action, d.needsHuman], ["human", false]);
  assert.ok(/Not about Personalisation Hub/.test(d.reason));
  assert.strictEqual(core.cleanTriage({ answerable: true, reply: "x", articleIds: [] }, []).relevant, true, "an answer that doesn't say counts as in scope");
});

check("keyword fallback: the subject counts double, and plurals match", () => {
  const arts = [{ id: "a", title: "Queue settings", keywords: [] , summary: "", bodyMd: "displays" }, { id: "b", title: "Displays offline", keywords: ["display"], summary: "", bodyMd: "queue" }];
  assert.strictEqual(core.rankArticles(arts, "the queue went quiet", 2, "Displays offline")[0].id, "b");
});

check("the model's answer is made safe: unknown article ids dropped, confidence clamped, lengths capped", () => {
  const t = core.cleanTriage({ category: "nonsense", summary: "s", answerable: "yes", confidence: 7, reply: "x".repeat(20000), articleIds: ["a1", "zz", "a1"], spamLikely: 1 }, ["a1"]);
  assert.strictEqual(t.category, "other");
  assert.strictEqual(t.answerable, false, "only a real true counts");
  assert.strictEqual(t.confidence, 1);
  assert.strictEqual(t.reply.length, core.DRAFT_MAX);
  assert.deepStrictEqual(t.articleIds, ["a1"]);
  assert.strictEqual(t.spamLikely, false);
  assert.strictEqual(core.cleanTriage(null, []).confidence, 0);
});

check("decideAction: every gate between a draft and sending it by itself", () => {
  const on = core.normaliseSettings({ autoReply: true, autoReplyThreshold: 0.8 });
  const off = core.normaliseSettings({});
  const good = { answerable: true, reply: "Do this.", articleIds: ["a1"], confidence: 0.9, spamLikely: false };
  assert.strictEqual(off.autoReply, false, "sending by itself is off until an admin switches it on");
  assert.strictEqual(core.decideAction({ triage: good, settings: on }).action, "send");
  assert.strictEqual(core.decideAction({ triage: good, settings: off }).action, "review");
  assert.strictEqual(core.decideAction({ triage: { ...good, confidence: 0.79 }, settings: on }).action, "review");
  assert.strictEqual(core.decideAction({ triage: good, settings: on, autoRepliesSent: 1 }).action, "review", "one automatic answer per thread");
  assert.strictEqual(core.decideAction({ triage: good, settings: on, humanInvolved: true }).action, "review");
  assert.strictEqual(core.decideAction({ triage: good, settings: on, replyToDiffers: true }).action, "review", "never auto-answer to a Reply-To that isn't the sender");
  const hv = core.decideAction({ triage: good, settings: on, highValue: true });
  assert.deepStrictEqual([hv.action, hv.needsHuman, hv.escalate], ["human", true, true]);
  assert.strictEqual(core.decideAction({ triage: { ...good, answerable: false }, settings: on }).needsHuman, true);
  assert.strictEqual(core.decideAction({ triage: { ...good, articleIds: [] }, settings: on }).action, "human", "an answer that cites no article is not sent");
  assert.strictEqual(core.decideAction({ triage: { ...good, spamLikely: true }, settings: on }).action, "human");
  assert.strictEqual(core.decideAction({ triage: null, settings: on }).needsHuman, true);
});

check("settings: defaults, clamps and validation", () => {
  const s = core.normaliseSettings({ autoReplyThreshold: 5, vipDomains: "Big.example, https://www.shop.example/x  bad domain", importDays: 500, fromName: 'Sup"port\r\n<x>' });
  assert.strictEqual(s.autoReplyThreshold, 0.99);
  assert.deepStrictEqual(s.vipDomains, ["big.example", "shop.example"]);
  assert.strictEqual(s.importDays, 60);
  assert.strictEqual(s.fromName, "Supportx");
  const bad = core.cleanSettingsInput({ autoReplyThreshold: 0.2, escalationAssignee: "nope", vipDomains: "not a domain!" }, s);
  assert.strictEqual(bad.errors.length, 3);
  const ok = core.cleanSettingsInput({ autoReply: true, escalationAssignee: "Lead@PH.example" }, s);
  assert.deepStrictEqual([ok.errors.length, ok.value.autoReply, ok.value.escalationAssignee], [0, true, "lead@ph.example"]);
});

check("a reply is a well-formed email on the same thread, and header injection is impossible", () => {
  const raw = core.buildReplyRaw({
    fromName: "PH Support", fromEmail: "support@ph.example", to: "ann@shop.example", subject: "Café display\r\nBcc: evil@x.example",
    text: "Hello Ann,\nDo this.", inReplyTo: "<abc@shop.example>", references: "<first@shop.example>", auto: true,
  });
  const mail = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const [head, body] = mail.split("\r\n\r\n");
  assert.ok(!/^Bcc:/m.test(head), "a line break in the subject must not start a new header");
  assert.ok(/^Subject: =\?UTF-8\?B\?/m.test(head), "a non-ASCII subject is RFC 2047 encoded");
  assert.ok(/^In-Reply-To: <abc@shop\.example>$/m.test(head));
  assert.ok(/^References: <first@shop\.example> <abc@shop\.example>$/m.test(head));
  assert.ok(/^Auto-Submitted: auto-replied$/m.test(head), "an automatic answer says so, so other auto-responders stay quiet");
  assert.ok(/^From: "PH Support" <support@ph\.example>$/m.test(head));
  assert.strictEqual(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8"), "Hello Ann,\r\nDo this.");
  assert.ok(!/[+/=]/.test(raw), "base64url for Gmail");
  const human = Buffer.from(core.buildReplyRaw({ fromEmail: "s@ph.example", to: "a@b.example", subject: "Re: x", text: "y" }).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  assert.ok(!/Auto-Submitted/.test(human));
  assert.ok(/^Subject: Re: x$/m.test(human), "Re: is not doubled");
  assert.strictEqual(core.withSignature("Hi\n", "PH Support"), "Hi\n\nPH Support");
});

check("the page's copy of the statuses matches the server's", () => {
  const page = fs.readFileSync(path.join(__dirname, "../public/js/support-core.js"), "utf8");
  const m = page.match(/export const STATUSES = (\[[^\]]+\]);/);
  assert.ok(m, "public/js/support-core.js exports STATUSES");
  assert.deepStrictEqual(JSON.parse(m[1]), core.STATUSES);
});

check("inboxes: an email is filed under each alias it was written to (To, Cc, Delivered-To, X-Original-To), and under Support when it names none", () => {
  const BOX = "support@personalisationhub.com";
  const al = (headers) => core.parseGmailMessage(gmailMsg({ headers }), BOX).aliases;
  assert.deepStrictEqual(al({ To: "support@personalisationhub.com" }), ["support"]);
  assert.deepStrictEqual(al({ To: "Hello <Hello@PersonalisationHub.com>" }), ["hello"], "the alias is read from the To header, not the mailbox it was delivered to");
  assert.deepStrictEqual(al({ To: "aidan@personalisationhub.com" }), ["aidan"]);
  assert.deepStrictEqual(al({ To: "support@personalisationhub.com", Cc: "Aidan <aidan@personalisationhub.com>, someone@shop.example" }), ["support", "aidan"], "support@ with aidan@ in Cc is in both");
  assert.deepStrictEqual(al({ To: "hello@personalisationhub.com, aidan@personalisationhub.com, support@personalisationhub.com" }), ["support", "hello", "aidan"]);
  assert.deepStrictEqual(al({ To: "someone@shop.example" }), [], "no alias named");
  assert.deepStrictEqual(core.mergeInboxes([], []), ["support"], "which falls back to the Support Inbox");
  assert.deepStrictEqual(al({ To: "aidan@elsewhere.example", Cc: "hello@gmail.com" }), [], "the same name at another company is not ours");
  assert.deepStrictEqual(al({ To: "hello+newsletter@personalisationhub.com" }), ["hello"], "a +tag still names the alias");
  // A Bcc leaves no To or Cc: the delivery headers are all there is.
  const raw = gmailMsg({ headers: { To: "undisclosed-recipients:;" } });
  raw.payload.headers.push({ name: "Delivered-To", value: BOX }, { name: "Delivered-To", value: "hello@personalisationhub.com" }, { name: "X-Original-To", value: "aidan@personalisationhub.com" });
  assert.deepStrictEqual(core.parseGmailMessage(raw, BOX).aliases, ["hello", "aidan"], "every Delivered-To line is read; the mailbox's own address is on every message and says nothing");
  // A mailbox on another domain (a test or staging mailbox) still has its aliases.
  assert.deepStrictEqual(core.parseGmailMessage(gmailMsg({ headers: { To: "hello@ph.example" } }), "support@ph.example").aliases, ["hello"]);
  // Mail the mailbox sent names no inbox.
  assert.deepStrictEqual(core.parseGmailMessage(gmailMsg({ headers: { From: `Support <${BOX}>`, To: "hello@personalisationhub.com" }, labels: ["SENT"] }), BOX).aliases, []);
  // A ticket keeps its inboxes and gains the ones a later email names; an email naming none adds nothing.
  assert.deepStrictEqual(core.mergeInboxes(["hello"], []), ["hello"]);
  assert.deepStrictEqual(core.mergeInboxes(["hello"], ["aidan"]), ["hello", "aidan"]);
  assert.deepStrictEqual(core.mergeInboxes(["aidan", "bogus"], ["support"]), ["support", "aidan"]);
  assert.deepStrictEqual(Object.values(core.INBOX_LABEL), ["Support Inbox", "Hello", "Aidan"]);
});

check("decideAction: only mail written to the support address is answered by itself", () => {
  const good = { relevant: true, answerable: true, reply: "Do this.", confidence: 0.95, articleIds: ["a1"], spamLikely: false };
  const on = core.normaliseSettings({ autoReply: true });
  assert.strictEqual(core.decideAction({ triage: good, settings: on, inboxes: ["support"] }).action, "send");
  assert.strictEqual(core.decideAction({ triage: good, settings: on, inboxes: ["support", "aidan"] }).action, "send");
  const hello = core.decideAction({ triage: good, settings: on, inboxes: ["hello"] });
  assert.deepStrictEqual([hello.action, hello.needsHuman], ["review", false]);
  assert.strictEqual(core.decideAction({ triage: good, settings: on, inboxes: ["aidan"] }).action, "review");
  assert.strictEqual(core.decideAction({ triage: good, settings: on }).action, "send", "a ticket from before the inboxes existed is Support's");
});

check("the page's inbox keys match the server's", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "js", "support-core.js"), "utf8");
  const keys = [...src.slice(src.indexOf("export const INBOXES"), src.indexOf("export const DEFAULT_INBOX")).matchAll(/key: "([a-z]+)", label: "([^"]+)"/g)];
  assert.deepStrictEqual(keys.map((m) => m[1]), core.INBOXES);
  assert.deepStrictEqual(keys.map((m) => m[2]), core.INBOXES.map((k) => core.INBOX_LABEL[k]));
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }
  console.log(failed ? `\n${failed} of ${checks.length} failed` : `\nsupport-core: ${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
