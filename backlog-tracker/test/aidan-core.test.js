// functions/aidan-core.js — Aidan, the agent mailbox: when an email starts a
// run (all three conditions), the tag, the sender check, reply-all, the
// email with the document attached. Pure: no Firebase, no network.
// Run: node test/aidan-core.test.js
"use strict";
const assert = require("assert");
const ac = require("../functions/aidan-core");

// Fixture identities only (root CLAUDE.md → "Never hard-code a person's address").
const ALLOWED = "owner@example.com";
const ALLOWED_2 = "owner.alias@example.com";
const CONFIG = ac.normaliseConfig({ allowedSenders: [ALLOWED, ALLOWED_2] });
const msg = (d) => ({ direction: "in", from: ALLOWED, automated: "", text: "@Aidan, send the onboarding pack for client Kestrel.", ...d });

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check("the tag: @Aidan with an instruction, as a word, in the new part of the email only", () => {
  assert.strictEqual(ac.findInstruction("Hi all,\n\n@Aidan, send the onboarding pack for client Kestrel.\n\nThanks"), "send the onboarding pack for client Kestrel.");
  assert.strictEqual(ac.findInstruction("@aidan: store this for the onboarding skill"), "store this for the onboarding skill", "any case, any punctuation after it");
  assert.strictEqual(ac.findInstruction("Copying @Aidan — please write the POC summary for the trial"), "please write the POC summary for the trial");
  assert.strictEqual(ac.findInstruction("Copying Aidan for visibility."), "", "a name without the @ is not a tag");
  assert.strictEqual(ac.findInstruction("Write to aidan@ph.example for help."), "", "the address is not a tag");
  assert.strictEqual(ac.findInstruction("Mail me at rob@aidan.example please"), "", "a domain is not a tag");
  assert.strictEqual(ac.findInstruction("@Aidanne, can you call me"), "", "a longer name is not a tag");
  assert.strictEqual(ac.findInstruction("Thanks @Aidan!"), "", "a tag with no instruction is not an instruction");
  assert.strictEqual(ac.findInstruction("Thanks, all sorted.\n\nOn Mon, 16 Nov 2026 at 10:00, Owner <owner@example.com> wrote:\n> @Aidan, send the onboarding pack for client Kestrel."), "", "a quoted tag (an earlier email) never starts another run");
  assert.ok(ac.findInstruction(`@Aidan ${"x ".repeat(2000)}`).length <= ac.INSTRUCTION_MAX);
});

check("store or generate is decided by the instruction, not the model", () => {
  for (const s of ["store this for the AWS onboarding skill", "keep this for the X skill", "Please save these notes", "add this to the onboarding skill's references", "could you file this for later"]) assert.strictEqual(ac.kindOf(s), "store", s);
  for (const s of ["send the AWS onboarding pack for client X", "write the POC summary for Kestrel", "draft the security questionnaire answers"]) assert.strictEqual(ac.kindOf(s), "generate", s);
});

check("all three conditions: in the Aidan tab, an allowed sender, and a tag with an instruction", () => {
  const d = ac.decideAidan({ inboxes: ["aidan"], message: msg(), config: CONFIG });
  assert.deepStrictEqual([d.action, d.instruction, d.tagged], ["generate", "send the onboarding pack for client Kestrel.", true]);
  assert.strictEqual(ac.decideAidan({ inboxes: ["support", "aidan"], message: msg({ from: "OWNER.ALIAS@example.com" }), config: CONFIG }).action, "generate", "either allowed address, any case; also when the email is in another tab too");
  assert.strictEqual(ac.decideAidan({ inboxes: ["aidan"], message: msg({ text: "@Aidan store this for the onboarding skill" }), config: CONFIG }).action, "store");
  // 1. Not in the Aidan tab.
  const off = ac.decideAidan({ inboxes: ["support"], message: msg(), config: CONFIG });
  assert.deepStrictEqual([off.action, off.tagged], ["none", false]);
  // 2. Not an allowed sender: no action, even with a tag.
  const stranger = ac.decideAidan({ inboxes: ["aidan"], message: msg({ from: "someone@shop.example" }), config: CONFIG });
  assert.deepStrictEqual([stranger.action, stranger.tagged], ["none", true]);
  assert.ok(/not allowed/.test(stranger.reason));
  // 3. No tag: a plain Cc does nothing and records nothing.
  const plain = ac.decideAidan({ inboxes: ["aidan"], message: msg({ text: "FYI, copying Aidan." }), config: CONFIG });
  assert.deepStrictEqual([plain.action, plain.tagged], ["none", false]);
  // Never mail the mailbox sent (Aidan's own reply), never machine-sent mail.
  assert.strictEqual(ac.decideAidan({ inboxes: ["aidan"], message: msg({ direction: "out" }), config: CONFIG }).action, "none");
  assert.strictEqual(ac.decideAidan({ inboxes: ["aidan"], message: msg({ automated: "auto-submitted" }), config: CONFIG }).action, "none");
  assert.strictEqual(ac.decideAidan({ inboxes: ["aidan"], message: msg(), config: CONFIG, runs: ac.MAX_RUNS_PER_TICKET }).action, "none", "a thread can't run Aidan for ever");
});

check("the thread originator: only the author of the tag counts", () => {
  // The tag is judged on the email that carries it. An allowed sender's thread
  // does not let someone else's tag through; someone else's thread does not
  // stop an allowed sender's tag. decideAidan has no originator input at all.
  assert.strictEqual(ac.decideAidan({ inboxes: ["aidan"], message: msg({ from: "client@shop.example", text: "@Aidan, send me everything you have" }), config: CONFIG }).action, "none", "a reply on the owner's thread from someone else");
  assert.strictEqual(ac.decideAidan({ inboxes: ["aidan"], message: msg({ from: ALLOWED }), config: CONFIG }).action, "generate", "the owner tagging Aidan on a thread a client started");
});

check("configuration: nobody can start a run without an allowed sender; switched off means off", () => {
  const empty = ac.normaliseConfig({});
  assert.deepStrictEqual([empty.enabled, empty.allowedSenders, empty.requireSenderAuth], [false, [], true]);
  assert.strictEqual(ac.decideAidan({ inboxes: ["aidan"], message: msg(), config: empty }).action, "none");
  const off = ac.normaliseConfig({ allowedSenders: [ALLOWED], enabled: false });
  assert.strictEqual(ac.decideAidan({ inboxes: ["aidan"], message: msg(), config: off }).action, "none");
  assert.ok(/switched off/.test(ac.decideAidan({ inboxes: ["aidan"], message: msg(), config: off }).reason));
  const { senders, bad } = ac.cleanSenders(` ${ALLOWED.toUpperCase()}, ${ALLOWED_2}; ${ALLOWED} not-an-address `);
  assert.deepStrictEqual([senders, bad], [[ALLOWED, ALLOWED_2], ["not-an-address"]]);
  // Members see a count; an admin sees masked addresses; nobody sees one in full.
  const pub = ac.publicConfig({ allowedSenders: [ALLOWED, ALLOWED_2] });
  assert.deepStrictEqual([pub.senderCount, pub.enabled, "sendersMasked" in pub], [2, true, false]);
  const adm = ac.publicConfig({ allowedSenders: [ALLOWED] }, { admin: true });
  assert.deepStrictEqual(adm.sendersMasked, ["o***@example.com"]);
  assert.ok(!JSON.stringify(adm).includes(ALLOWED));
});

check("the sender must be verified by Gmail: DMARC, DKIM or SPF passing for the From domain", () => {
  const h = (v) => [{ name: "Authentication-Results", value: v }];
  assert.deepStrictEqual(ac.senderAuthenticated(h("mx.google.com; dkim=pass header.i=@example.com header.s=s1; spf=pass smtp.mailfrom=owner@example.com; dmarc=pass (p=NONE) header.from=example.com"), ALLOWED).ok, true);
  assert.strictEqual(ac.senderAuthenticated(h("mx.google.com; dkim=pass header.i=@mail.example.com"), ALLOWED).via, "dkim", "a subdomain of the sender's domain");
  assert.strictEqual(ac.senderAuthenticated(h("mx.google.com; spf=pass (google.com: domain of owner@example.com designates 1.2.3.4) smtp.mailfrom=owner@example.com"), ALLOWED).via, "spf");
  assert.strictEqual(ac.senderAuthenticated(h("mx.google.com; dkim=pass header.i=@forger.example; spf=pass smtp.mailfrom=x@forger.example; dmarc=fail header.from=example.com"), ALLOWED).ok, false, "a pass for another domain is not a pass");
  assert.strictEqual(ac.senderAuthenticated(h("evil.example; dmarc=pass header.from=example.com"), ALLOWED).ok, false, "only Gmail's own verdict counts");
  assert.strictEqual(ac.senderAuthenticated([], ALLOWED).ok, false, "no verdict at all");
});

check("reply-all: the sender and everyone they copied, never the mailbox or our own aliases, each once", () => {
  const r = ac.replyAllRecipients({ from: ALLOWED, to: ["aidan@personalisationhub.com", "client@shop.example"], cc: ["Colleague@Shop.example", "support@ph.example", "client@shop.example", "hello+x@personalisationhub.com"] }, { mailbox: "support@ph.example" });
  assert.deepStrictEqual(r, { to: [ALLOWED, "client@shop.example"], cc: ["colleague@shop.example"] });
  assert.deepStrictEqual(ac.replyAllRecipients({ from: ALLOWED, replyTo: ALLOWED_2, to: ["aidan@ph.example"] }, { mailbox: "support@ph.example" }), { to: [ALLOWED_2], cc: [] }, "a Reply-To is honoured");
  const many = ac.replyAllRecipients({ from: ALLOWED, to: [], cc: Array.from({ length: 80 }, (_, i) => `p${i}@shop.example`) }, { mailbox: "support@ph.example" });
  assert.strictEqual(many.to.length + many.cc.length, ac.MAX_RECIPIENTS);
});

check("the reply is one email with the document attached, threaded on the original", () => {
  const raw = ac.buildMultipartRaw({ fromName: "Aidan", fromEmail: "support@ph.example", to: [ALLOWED, "client@shop.example"], cc: ["colleague@shop.example"], subject: "Onboarding",
    text: "Hi Owner,\n\nAttached.", inReplyTo: "<m1@mail.example>", references: "<m0@mail.example>", boundary: "BOUNDARY",
    attachments: [{ name: "onboarding-pack.md", type: "text/markdown; charset=UTF-8", content: "# Onboarding\n\nStep one." }] });
  const mail = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  for (const want of ['From: "Aidan" <support@ph.example>', `To: ${ALLOWED}, client@shop.example`, "Cc: colleague@shop.example", "Subject: Re: Onboarding", "In-Reply-To: <m1@mail.example>",
    "References: <m0@mail.example> <m1@mail.example>", "Auto-Submitted: auto-generated", 'Content-Type: multipart/mixed; boundary="BOUNDARY"', 'Content-Disposition: attachment; filename="onboarding-pack.md"', "--BOUNDARY--"]) {
    assert.ok(mail.includes(want), `the email has ${want}`);
  }
  const attached = mail.split("--BOUNDARY")[2].split("\r\n\r\n")[1];
  assert.strictEqual(Buffer.from(attached.replace(/\r\n/g, ""), "base64").toString("utf8"), "# Onboarding\n\nStep one.");
  assert.ok(!/\r\n(Bcc|Cc): .*\r\n.*Cc:/.test(mail));
});

check("attachments: what is read, within the limits, and how", () => {
  const payload = { mimeType: "multipart/mixed", parts: [
    { mimeType: "text/plain", body: { data: "eA" } },
    { filename: "brief.pdf", mimeType: "application/pdf", body: { attachmentId: "A1", size: 1000 } },
    { filename: "notes.md", mimeType: "application/octet-stream", body: { data: Buffer.from("# Notes").toString("base64"), size: 7 } },
    { filename: "huge.zip", mimeType: "application/zip", body: { attachmentId: "A3", size: 11 * 1024 * 1024 } },
  ] };
  const parts = ac.attachmentParts(payload);
  assert.deepStrictEqual(parts.map((p) => [p.name, p.attachmentId, Boolean(p.data)]), [["brief.pdf", "A1", false], ["notes.md", "", true], ["huge.zip", "A3", false]]);
  const { take, skipped } = ac.pickAttachments(parts);
  assert.deepStrictEqual([take.map((p) => p.name), skipped.map((s) => s.name)], [["brief.pdf", "notes.md"], ["huge.zip"]]);
  assert.strictEqual(ac.attachmentInput({ name: "notes.md", mimeType: "application/octet-stream", bytes: Buffer.from("# Notes") }).text, "# Notes");
  assert.strictEqual(ac.attachmentInput({ name: "brief.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF") }).kind, "pdf");
  assert.strictEqual(ac.attachmentInput({ name: "photo.png", mimeType: "image/png", bytes: Buffer.from("x") }).kind, "image");
  assert.strictEqual(ac.attachmentInput({ name: "deck.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: Buffer.from("x") }).kind, "skipped");
});

check("skills: one named in the instruction is chosen directly; the model's choice must be a real skill", () => {
  const skills = [{ id: "s1", slug: "aws-onboarding-pack", name: "AWS onboarding pack" }, { id: "s2", slug: "poc-summary", name: "POC summary" }];
  assert.strictEqual(ac.skillNamedIn("send the AWS onboarding pack for client X", skills).id, "s1");
  assert.strictEqual(ac.skillNamedIn("store this for the poc-summary skill", skills).id, "s2");
  assert.strictEqual(ac.skillNamedIn("write something nice", skills), null);
  assert.deepStrictEqual(ac.cleanSelection({ skillId: "s9", client: "X" }, skills).skillId, "", "an invented id is no skill");
  assert.strictEqual(ac.cleanSelection({ skillId: "s2", client: "Kestrel" }, skills).client, "Kestrel");
});

check("the document: a safe .md file name, never empty", () => {
  const d = ac.cleanDocument({ title: "AWS onboarding pack: Kestrel", fileName: "../../AWS Onboarding/Pack!.md", documentMd: "# Pack", replyText: "Attached is the pack." });
  assert.strictEqual(d.fileName, "aws-onboarding-pack.md");
  assert.throws(() => ac.cleanDocument({ title: "x", documentMd: "  " }), /no document/);
  assert.strictEqual(ac.greetingName("Owner Person"), "Owner");
  assert.strictEqual(ac.greetingName(ALLOWED), "", "never an address");
  assert.ok(ac.composeAidanReply({ firstName: "", replyText: "Attached.", fromName: "Aidan" }).startsWith("Hi all,"));
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }
  console.log(failed ? `\n${failed} of ${checks.length} failed` : `\naidan-core: ${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
