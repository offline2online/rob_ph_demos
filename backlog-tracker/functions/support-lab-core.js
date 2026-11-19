"use strict";
// Support › Support Inbox › Test lab: the rules, pure (no Firestore, no
// network), so test/support-lab.test.js drives them directly. The routes are
// functions/support-lab.js; the page is public/js/support-lab.js.
//
// A case is one question with what should happen to it:
//   expect "articles"   about Personalisation Hub, and these articles answer it
//          "none"       about Personalisation Hub, and no article answers it yet
//          "unrelated"  not about Personalisation Hub: no article, no reply
// A case copied from a real ticket whose answer recorded no articles waits as
// `needsReview` until a person says what should happen; it is left out of runs.
//
// judgeCase is the one rule for "did the engine get it right", shared with
// scripts/support-eval.js (the fixtures and the live check).

const core = require("./support-core");

const EXPECTS = ["articles", "none", "unrelated"];
const RATINGS = ["correct", "partly", "wrong"];
const SOURCES = ["lab", "support", "aidan"];
const SUBJECT_MAX = 300;
const QUESTION_MAX = 8000;
const ANSWER_MAX = 8000;
const NOTE_MAX = 1000;
const MAX_EXPECTED = core.MAX_ARTICLES;   // never more articles than the engine uses
const MAX_CASES = 300;                    // cases in one run (keeps the run document small)
const STEP_CASES = 3;                     // cases one step runs, side by side
const CLAIM_STALE_MS = 150000;            // a claimed case no step finished in this long is run again
const RUN_STALE_MS = 60 * 60 * 1000;      // an unfinished run left this long is stopped, not resumed
const CASE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

// What the person sent for a case, made safe. `known` is the published
// article ids. Returns { value } or { error }.
function cleanCaseInput(body, known) {
  const b = body && typeof body === "object" ? body : {};
  const subject = core.clip(String(b.subject || "").replace(/\s+/g, " ").trim(), SUBJECT_MAX);
  const text = String(b.text || "").replace(/\r/g, "").trim();
  if (!text) return { error: "Write the question first." };
  if (text.length > QUESTION_MAX) return { error: `A question is at most ${QUESTION_MAX} characters.` };
  const expect = String(b.expect || "");
  if (!EXPECTS.includes(expect)) return { error: "Say what should happen: these articles, no answer yet, or not about Personalisation Hub." };
  const knownIds = new Set(known || []);
  const ids = [...new Set((Array.isArray(b.articleIds) ? b.articleIds : []).map(String))];
  if (expect === "articles") {
    if (!ids.length) return { error: "Pick the article that should answer it." };
    if (ids.length > MAX_EXPECTED) return { error: `Pick at most ${MAX_EXPECTED} articles.` };
    const unknown = ids.filter((id) => !knownIds.has(id));
    if (unknown.length) return { error: "That article isn't published." };
  }
  const rating = RATINGS.includes(b.rating) ? b.rating : "";
  const note = core.clip(String(b.note || "").trim(), NOTE_MAX);
  // What the engine answered when the case was rated (Ask): ids and a number only.
  const a = b.answered && typeof b.answered === "object" ? b.answered : null;
  const answered = a ? {
    articleIds: [...new Set((Array.isArray(a.articleIds) ? a.articleIds : []).map(String))].filter((id) => knownIds.has(id)).slice(0, MAX_EXPECTED),
    confidence: Math.min(1, Math.max(0, Number(a.confidence) || 0)),
  } : null;
  return { value: { subject, text, expect, articleIds: expect === "articles" ? ids : [], rating, note, ...(answered ? { answered } : {}) } };
}

// A case as the judge reads it: { relevant, articles } (the fixtures' shape).
function fixtureOf(c) {
  return { relevant: c.expect !== "unrelated", articles: c.expect === "articles" ? (c.articleIds || []).slice() : [] };
}
// Whether a case takes part in a run.
const inRun = (c) => Boolean(c && !c.needsReview && EXPECTS.includes(c.expect) && String(c.text || "").trim());

// What is wrong with the engine's answer for a case (or a fixture): the same
// rules for every path. `raw.selectedIds` are the articles the match step chose.
function judgeCase(c, raw, t) {
  const chosen = (raw && raw.selectedIds) || [];
  const problems = [];
  if (t.relevant !== c.relevant) problems.push(c.relevant ? "treated as not about Personalisation Hub" : "treated as about Personalisation Hub");
  if (c.relevant && c.articles.length && !chosen.some((id) => c.articles.includes(id))) problems.push("no right article chosen");
  if (c.relevant && !c.articles.length && t.answerable) problems.push("claimed the Help Centre answers it");
  if (!c.relevant && t.reply) problems.push("drafted a reply");
  return { chosen, problems };
}

// One case's result as a run keeps it: ids, numbers and the judge's wording
// only, never the question or the draft (a run is read by every member, and
// its counts are what a workflow may print).
function resultOf(c, answered) {
  const { raw, triage: t } = answered;
  const { chosen, problems } = judgeCase(fixtureOf(c), raw, t);
  return {
    passed: problems.length === 0, problems, chosen: chosen.slice(0, MAX_EXPECTED),
    cited: (t.articleIds || []).slice(0, MAX_EXPECTED), confidence: t.confidence, relevant: t.relevant, answerable: t.answerable,
  };
}
function errorResult(message) {
  return { passed: false, problems: ["error"], error: core.clip(String(message || "failed"), 200), chosen: [], cited: [], confidence: 0, relevant: null, answerable: false };
}

// Passed, failed and accuracy (0 to 1, null before any case finished) over a run's results.
function summarise(results) {
  const list = Object.values(results || {});
  const passed = list.filter((r) => r && r.passed).length;
  const failed = list.length - passed;
  return { passed, failed, done: list.length, accuracy: list.length ? passed / list.length : null };
}

// The next cases a step runs: claims nobody finished in CLAIM_STALE_MS first
// (a tab that closed mid-step), then the pending ones. Returns { take, pending,
// claims } where `claims` already includes the ones taken now.
function claimNext(run, nowMs, n = STEP_CASES) {
  const pending = Array.isArray(run.pending) ? run.pending.slice() : [];
  const claims = (Array.isArray(run.claims) ? run.claims : []).filter((c) => c && c.id);
  const stale = claims.filter((c) => nowMs - Number(c.at || 0) > CLAIM_STALE_MS).map((c) => c.id);
  const take = [...stale, ...pending.filter((id) => !stale.includes(id))].slice(0, n);
  const taken = new Set(take);
  return {
    take,
    pending: pending.filter((id) => !taken.has(id)),
    claims: [...claims.filter((c) => !taken.has(c.id)), ...take.map((id) => ({ id, at: nowMs }))],
  };
}

// A case copied from a real ticket ("Add to test lab"): the last customer
// email before the final answer, and that answer. `messages` oldest first.
// The answer's own articles (an automatic reply, or Aidan's Help Centre
// answer, records them) become the expected articles; otherwise the case waits
// for a person (needsReview).
function caseFromTicket(ticket, messages, source) {
  const list = (messages || []).filter((m) => m && (m.direction === "in" || m.direction === "out"));
  let lastOut = -1;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].direction === "out" && list[i].source !== "compose") { lastOut = i; break; }
  const upTo = lastOut >= 0 ? list.slice(0, lastOut) : list;
  const question = [...upTo].reverse().find((m) => m.direction === "in");
  if (!question) return { error: "This ticket has no customer email to test with." };
  const text = core.clip(core.stripQuoted(String(question.text || "")).trim() || String(question.text || "").trim(), QUESTION_MAX);
  if (!text) return { error: "This ticket's question is empty." };
  const answer = lastOut >= 0 ? list[lastOut] : null;
  const ids = answer && Array.isArray(answer.articles) ? [...new Set(answer.articles.map((a) => String((a && a.id) || "")).filter(Boolean))].slice(0, MAX_EXPECTED) : [];
  return {
    value: {
      subject: core.clip(String((ticket && ticket.subject) || question.subject || "").replace(/\s+/g, " ").trim(), SUBJECT_MAX),
      text, finalAnswer: answer ? core.clip(String(answer.text || ""), ANSWER_MAX) : "",
      answeredBy: answer ? (answer.source === "aidan" ? "aidan" : answer.auto ? "ai" : "person") : "",
      expect: ids.length ? "articles" : "", articleIds: ids, needsReview: !ids.length,
      source: SOURCES.includes(source) ? source : "support", rating: "", note: "",
    },
  };
}

// What decideAction's verdict reads as in the lab.
const DECISION_LABEL = { send: "Sent by itself", review: "Draft to approve", human: "Needs a person" };

module.exports = {
  EXPECTS, RATINGS, SOURCES, SUBJECT_MAX, QUESTION_MAX, ANSWER_MAX, NOTE_MAX, MAX_EXPECTED, MAX_CASES, STEP_CASES, CLAIM_STALE_MS, RUN_STALE_MS, CASE_ID_RE,
  cleanCaseInput, fixtureOf, inRun, judgeCase, resultOf, errorResult, summarise, claimNext, caseFromTicket, DECISION_LABEL,
};
