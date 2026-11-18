// functions/aidan-voice.js — Aidan's voice (ticket SYkk20srKT7pIKM1HS8Z): the
// character lives in the "aidan-voice" skill; the rules are code. One aside at
// most, after the reply; none on a complaint, a fault or anything commercial;
// never a fact; a plain yes when asked whether he is a bot; the signature.
// Pure: no Firebase, no network.
// Run: node test/aidan-voice.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const av = require("../functions/aidan-voice");
const ac = require("../functions/aidan-core");

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check("the skill: the repo copy is what the library is given; it is never a documentation skill", () => {
  const md = fs.readFileSync(path.join(__dirname, "..", "skill-sources", "aidan-voice.md"), "utf8");
  assert.strictEqual(av.DEFAULT_SKILL_MD, md, "skill-sources/aidan-voice.md and DEFAULT_SKILL_MD are the same text");
  const doc = av.defaultSkillDoc();
  assert.deepStrictEqual([doc.slug, doc.name, doc.files.length, doc.files[0].path, doc.misses], ["aidan-voice", "Aidan voice", 1, "SKILL.md", []]);
  for (const want of ["Email body only", "One quirk per email at most", "No quirk at all on a complaint", "does not volunteer that he is an AI", "Aidan, Personalisation Hub", "\"personalisation\" with an S", "Got it, Rob. Filed, sorted"]) assert.ok(md.includes(want), want);
  assert.ok(!/personalization/i.test(md) && !/[—–]/.test(md), "spelled with an S, no long dashes");
  const skills = [{ id: "s1", slug: "poc-summary", name: "POC summary" }, { id: "v", slug: "Aidan-Voice", name: "Aidan voice" }];
  assert.strictEqual(av.voiceSkillIn(skills).id, "v");
  assert.deepStrictEqual(av.withoutVoiceSkill(skills).map((s) => s.id), ["s1"], "not in the list a run chooses a skill from");
  assert.strictEqual(av.voiceSkillIn([skills[0]]), null);
  // The prompt reads the library's text when there is one, and the built-in text otherwise.
  assert.ok(av.voiceSystemFor({ files: [{ path: "SKILL.md", content: "Tuned: drier, fewer analogies." }, { path: "logo.svg", content: "<svg/>" }] }).includes("<voice_skill>\nTuned: drier, fewer analogies.\n</voice_skill>"));
  assert.ok(av.voiceSystemFor(null).includes("## The character"));
  assert.ok(av.voiceSystemFor({ files: [] }).includes("## The character"), "an emptied skill falls back to the built-in text");
});

check("no quirk on a complaint, an outage, a fault or anything commercial", () => {
  for (const [text, want] of [
    ["I'm really unhappy with how this was handled", "a complaint"],
    ["This is unacceptable, I want to escalate", "a complaint"],
    ["the screens in Leeds are down again", "an outage or a fault"],
    ["Playlist isn't working since this morning", "an outage or a fault"],
    ["we had an outage on Friday", "an outage or a fault"],
    ["there is a bug in the targeting screen", "an outage or a fault"],
    ["what's the pricing for 200 stores?", "a commercial matter"],
    ["can you confirm the contract renewal date", "a commercial matter"],
    ["Please resend the invoice", "a commercial matter"],
    ["how much does it cost per display", "a commercial matter"],
  ]) assert.strictEqual(av.sensitiveReason(text), want, text);
  for (const text of ["please confirm you received this email", "how do I set up targeting?", "what's in Ready for Testing?", "summarise the Kestrel thread", "send the onboarding pack for client Kestrel",
    "ask owner@offline2online.example", "they quoted Shakespeare", "a downtown store"]) assert.strictEqual(av.sensitiveReason(text), "", text);
  assert.strictEqual(av.sensitiveReason(["all fine", null, "Subject: invoice query"]), "a commercial matter", "any of the texts given");
});

check("\"are you a bot?\": recognised, always answered yes, never denied", () => {
  for (const q of ["are you a bot?", "Are you an AI?", "are you a real person", "is this a bot or a human?", "am I talking to a robot", "r u a bot", "Are you automated?", "is Aidan an AI", "human or bot?"]) assert.ok(av.asksIfAi(q), q);
  for (const q of ["are you free on Tuesday?", "are you sure about that", "what about the chatbot feature", "please confirm you received this", "is this the latest pack?"]) assert.ok(!av.asksIfAi(q), q);
  assert.deepStrictEqual(av.ensureAiDisclosure("Yes, I'm an AI assistant. Happy to help.", { asked: true }), { text: "Yes, I'm an AI assistant. Happy to help.", added: false }, "already a plain yes: unchanged");
  const dodge = av.ensureAiDisclosure("Happy to help with anything you need.", { asked: true });
  assert.deepStrictEqual([dodge.added, dodge.text], [true, `${av.AI_LINE}\n\nHappy to help with anything you need.`], "a dodge gets the plain line first");
  for (const lie of ["No, I'm not a bot.", "I am a real person, promise.", "Definitely not an AI."]) assert.deepStrictEqual(av.ensureAiDisclosure(lie, { asked: true }), { text: av.AI_LINE, added: true }, `a denial is never sent: ${lie}`);
  assert.deepStrictEqual(av.ensureAiDisclosure("", { asked: true }), { text: av.AI_LINE, added: true });
  assert.deepStrictEqual(av.ensureAiDisclosure("Got it, all good.", { asked: false }), { text: "Got it, all good.", added: false }, "not asked: he does not volunteer it");
  assert.ok(/AI assistant/.test(av.AI_LINE) && !/[—–]/.test(av.AI_LINE));
});

check("\"are you a bot?\" with a question in it: the denial goes, the substance stays", () => {
  const mixed = "No, I'm not a bot. To set up targeting, open Targeting and add a rule.\n\n1. Open Targeting.\n2. Save.";
  assert.deepStrictEqual(av.ensureAiDisclosure(mixed, { asked: true }),
    { text: `${av.AI_LINE}\n\nTo set up targeting, open Targeting and add a rule.\n\n1. Open Targeting.\n2. Save.`, added: true }, "only the denying sentence is taken out");
  assert.strictEqual(av.withoutDenials("Happy to help. I'm a real person, honestly. Ask away."), "Happy to help. Ask away.");
  for (const yes of ["Yes, I'm an AI-powered assistant.", "Guilty: I am a bot, a friendly one.", "I'm not a human, I'm PH's assistant.", av.AI_LINE, av.AI_LINE_PLAIN]) {
    assert.deepStrictEqual(av.ensureAiDisclosure(yes, { asked: true }), { text: yes, added: false }, `already a yes: ${yes}`);
  }
  for (const notYes of ["Good question about bots. Here is the guide.", "Our chatbot feature is in Settings."]) {
    assert.strictEqual(av.ensureAiDisclosure(notYes, { asked: true }).added, true, `mentioning bots is not saying yes: ${notYes}`);
  }
  assert.deepStrictEqual(av.ensureAiDisclosure("Sorry about the outage.", { asked: true, line: av.AI_LINE_PLAIN }),
    { text: `${av.AI_LINE_PLAIN}\n\nSorry about the outage.`, added: true }, "the plain yes, for an email that gets no quirk");
  assert.ok(!/coffee|guilty/i.test(av.AI_LINE_PLAIN) && /AI assistant/.test(av.AI_LINE_PLAIN));
});

check("the quirk: one short sentence, after the reply, never a fact", () => {
  assert.strictEqual(av.cleanQuirk({ sensitive: false, quirk: "  Fewer steps than a meal deal.  " }), "Fewer steps than a meal deal.");
  assert.strictEqual(av.cleanQuirk({ sensitive: false, quirk: "\"I only got distracted by one retail media chart on the way\"" }), "I only got distracted by one retail media chart on the way.", "quotes off, a full stop on");
  assert.strictEqual(av.cleanQuirk({ sensitive: false, quirk: "First line.\nSecond line." }), "First line.", "one line only");
  assert.strictEqual(av.cleanQuirk({ sensitive: false, quirk: "I do love personalization — honestly" }), "I do love personalisation, honestly.", "an S, and no long dash");
  for (const [bad, why] of [
    [{ sensitive: true, quirk: "A joke anyway." }, "the model judged it sensitive"],
    [{ sensitive: false, quirk: "" }, "nothing fitted"],
    [{ sensitive: false, quirk: "It only takes 3 minutes." }, "a figure"],
    [{ sensitive: false, quirk: "More at https://example.com." }, "a link"],
    [{ sensitive: false, quirk: "Ask owner@example.com." }, "an address"],
    [{ sensitive: false, quirk: "One. Two. Three. Four." }, "more than a sentence or two"],
    [{ sensitive: false, quirk: "x".repeat(av.QUIRK_MAX + 1) }, "too long"],
    [{ sensitive: false, quirk: "As an AI I never sleep." }, "volunteers that he is an AI"],
    [{ sensitive: false, quirk: "Cheaper than our pricing page suggests." }, "commercial"],
    [{ sensitive: false, quirk: "Enjoy \u{1F600}" }, "an emoji"],
    [null, "nothing returned"],
  ]) assert.strictEqual(av.cleanQuirk(bad), "", why);
  assert.strictEqual(av.withQuirk("Got it, Owner. Filed and sorted.\n", "Fewer steps than a meal deal."), "Got it, Owner. Filed and sorted.\n\nFewer steps than a meal deal.", "its own last paragraph");
  assert.strictEqual(av.withQuirk("Got it.", ""), "Got it.");
  const prompt = av.voicePrompt({ kind: "generate", instruction: "send the pack", body: "Here is the pack.", firstName: "Owner" });
  assert.ok(prompt.includes("<reply>\nHere is the pack.\n</reply>") && prompt.includes("a cover note for a document attached") && prompt.includes("The sender's first name: Owner"));
  assert.ok(/never rewrite it/.test(av.VOICE_SYSTEM) && /untrusted data/.test(av.VOICE_SYSTEM) && /Never mention that Aidan is an AI/.test(av.VOICE_SYSTEM));
});

check("the signature: \"Aidan, Personalisation Hub\"; the extra line only when it is switched on", () => {
  assert.strictEqual(ac.signOff({ fromName: "Aidan" }), "Aidan, Personalisation Hub");
  assert.strictEqual(ac.signOff({}), "Aidan, Personalisation Hub");
  assert.strictEqual(ac.signOff({ fromName: "Aidan", signatureLine: " PH's digital\r\nassistant <x> " }), "Aidan, Personalisation Hub\nPH's digital assistant x", "one clean line");
  const off = ac.normaliseConfig({ allowedSenders: ["owner@example.com"], signatureLine: "PH's digital assistant" });
  assert.deepStrictEqual([off.signatureLineOn, off.signatureLine, ac.signatureLineOf(off)], [false, "PH's digital assistant", ""], "off by default; the text is kept");
  const on = ac.normaliseConfig({ allowedSenders: ["owner@example.com"], signatureLineOn: true, signatureLine: "PH's digital assistant" });
  assert.deepStrictEqual([on.signatureLineOn, ac.signatureLineOf(on)], [true, "PH's digital assistant"]);
  assert.strictEqual(ac.normaliseConfig({ signatureLineOn: true, signatureLine: "  " }).signatureLineOn, false, "on with no text is off");
  assert.strictEqual(ac.normaliseConfig({ signatureLine: "x".repeat(200) }).signatureLine.length, ac.SIGNATURE_LINE_MAX);
  const pub = ac.publicConfig({ allowedSenders: ["owner@example.com"], signatureLineOn: true, signatureLine: "PH's digital assistant" });
  assert.deepStrictEqual([pub.signatureLineOn, pub.signatureLine], [true, "PH's digital assistant"], "the settings page can draw it");
  const line = ac.signatureLineOf(on);
  assert.strictEqual(ac.composeAidanAnswer({ replyText: "Got it, Owner.", fromName: "Aidan" }), "Got it, Owner.\n\nAidan, Personalisation Hub");
  assert.strictEqual(ac.composeAidanAnswer({ replyText: "Got it, Owner.", fromName: "Aidan", signatureLine: line }), "Got it, Owner.\n\nAidan, Personalisation Hub\nPH's digital assistant");
  assert.ok(ac.composeAidanReply({ firstName: "Owner", replyText: "Attached.", fromName: "Aidan", signatureLine: line }).endsWith("\n\nAidan, Personalisation Hub\nPH's digital assistant"));
  assert.ok(ac.composeHelpCentreAnswer({ firstName: "Owner", replyText: "Open Targeting.", fromName: "Aidan" }).endsWith("\n\nAidan, Personalisation Hub"));
  assert.ok(ac.composeReadOnlyReply({ firstName: "Owner", fromName: "Aidan", signatureLine: line }).endsWith("\n\nAidan, Personalisation Hub\nPH's digital assistant"));
  for (const text of [ac.composeAidanAnswer({ replyText: "x" }), ac.composeReadOnlyReply({})]) assert.ok(!/Assistant to/.test(text), "the old sign-off is gone");
});

check("the prompts ask for the substance, in his register; the document stays on brand voice", () => {
  for (const sys of [ac.ANSWER_SYSTEM, ac.CONSOLE_ANSWER_SYSTEM]) {
    assert.ok(sys.includes(ac.VOICE_BODY_LINE) && sys.includes(ac.VOICE_IDENTITY_LINE));
  }
  assert.ok(ac.DOC_SYSTEM.includes(ac.VOICE_DOCUMENT_LINE) && ac.docSystemFor(true).includes(ac.VOICE_DOCUMENT_LINE), "with or without console data");
  assert.ok(/no joke, aside or quirk anywhere in it/.test(ac.VOICE_DOCUMENT_LINE));
  assert.ok(/Do not volunteer that you are an AI/.test(ac.VOICE_IDENTITY_LINE) && /never deny it/.test(ac.VOICE_IDENTITY_LINE));
  assert.ok(/No joke, aside or flourish/.test(ac.VOICE_BODY_LINE), "the aside is the voice step's, so there is only ever one");
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); } catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }
  console.log(failed ? `\n${failed} of ${checks.length} failed` : `\naidan-voice: ${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
