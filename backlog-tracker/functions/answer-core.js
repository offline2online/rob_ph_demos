"use strict";
// One answering engine for platform questions, shared by the Support Inbox
// (functions/support-mail.js → triageTicket) and Aidan's "answer" runs
// (functions/aidan.js → answerFromHelpCentre):
//
//   match       the model sees the WHOLE published Help Centre (one line per
//               article), decides whether the email is about Personalisation
//               Hub and picks the articles that answer it (at most 3);
//   draft       the reply is written from the full text of the best article;
//   confidence  under 80% it is written again from the best 2 or 3 articles
//               together, and the better of the two is kept.
//
// The prompts, schemas and limits are support-core.js's (SELECT_*, TRIAGE_*,
// MAX_ARTICLES, CONFIDENCE_BOOST_BELOW): there is one copy of each. What
// differs between the two callers is only what happens AFTER the engine:
// the Support Inbox applies its gates (support-core.js → decideAction: send by
// itself, wait for approval, or a person); Aidan applies none of them and
// replies to an allowed sender whenever the Help Centre answers the question
// (usableAnswer), keeping the confidence on the ticket and out of the email.
//
// Pure: the model caller is passed in (`call`), so test/answer-core.test.js
// and test/support-mail.test.js drive it with no network.

const core = require("./support-core");
const faqFeed = require("./faq-feed");

// An article as the engine uses it. `hidden` (hiddenFromWebsite on the article
// or its category/folder, see functions/faq-feed.js) keeps it in the catalogue
// the reply is written from, with no url: it has no public page to link to.
function articleView(a, categoryName = "", hidden = false) {
  return {
    id: a.id, title: a.title || "", summary: a.summary || "", directAnswer: a.directAnswer || "", keywords: a.keywords || [], questionVariants: a.questionVariants || [],
    categoryName, bodyMd: a.bodyMd || "", body: core.htmlToText(a.bodyMd || ""),
    url: hidden ? "" : `https://personalisationhub.com/support-centre/article.html?id=${encodeURIComponent(a.id)}`,
    hiddenFromWebsite: !!hidden,
  };
}
// The catalogue both callers answer from: every published article, hidden-
// from-website ones included (3HabqHlC4WwL137CYTv1). `rows` and `cats` are the
// faqArticles and faqCategories documents, each with its id.
function publishedArticles(rows, cats) {
  const catName = new Map((cats || []).map((c) => [c.id, c.name || ""]));
  const hiddenCats = faqFeed.hiddenCategoryIds(cats || []);
  return (rows || []).filter((a) => a.status === "published").map((a) => articleView(a, catName.get(a.categoryId) || "", faqFeed.isHiddenFromWebsite(a, hiddenCats)));
}

// The email as both steps see it: who sent it, the subject, and the thread
// (quoted history removed, newest last). A message marked `verbatim` is read
// as it is, history and all, up to twice the length: it is the quoted
// question Aidan was asked to answer (questionFromEmail's `content`), already
// cut from its email, so removing "history" from it would remove the question.
function emailBlock(ticket, messages) {
  const thread = (messages || []).filter((m) => m.direction === "in" || m.direction === "out").slice(-8).map((m) =>
    `[${m.direction === "in" ? "customer" : "support"}]\n${m.verbatim ? core.clip(String(m.text || ""), 12000) : core.clip(core.stripQuoted(m.text), 6000)}`).join("\n\n---\n\n");
  return `From: ${ticket.customerName || "(name unknown)"} <${ticket.customerEmail || ""}>\nSubject: ${ticket.subject || "(no subject)"}\n\n<email_thread>\n${thread}\n</email_thread>`;
}

// One email as the engine's input, for a caller that has no Support Inbox
// ticket to hand (Aidan, scripts/support-eval.js): the same { ticket,
// messages } the Support Inbox passes for a customer's first email. Only that
// one email is read, never the rest of its thread, unless `content` is given:
// when Aidan is asked to answer a question on the thread ("answer John's
// question below", OrkZBBjz9RM5DY54azIG), `content` is that quoted or
// forwarded question (and the thread's earlier emails), read first and as it
// is, and `text` is then the asker's new text only.
function questionFromEmail({ fromName = "", fromEmail = "", subject = "", text = "", content = "" } = {}) {
  return {
    ticket: { subject: subject || "(no subject)", customerEmail: fromEmail, fromEmail, customerName: fromName || "" },
    messages: [...(content ? [{ direction: "in", text: String(content), verbatim: true }] : []), { direction: "in", text: String(text || "") }],
  };
}

// Match, draft and score one email. Step 1 sees every published article (one
// line each) and decides whether the email is about Personalisation Hub and
// which articles answer it; step 2 writes the reply from the full text of
// those articles only. Returns the raw combined answer for core.cleanTriage.
// `call(opts)`: one structured model call ({ system, schema, content, effort,
// maxTokens }) that returns the parsed JSON, or throws.
// `articles`: [{id, title, summary, directAnswer, keywords, questionVariants, categoryName, body, url}]
async function matchAndDraft({ call, ticket, messages, articles }) {
  const email = emailBlock(ticket, messages);
  const catalogue = articles.map((a) => core.articleIndexLine(a, a.categoryName)).join("\n");
  const sel = core.cleanSelection(await call({
    system: core.SELECT_SYSTEM, schema: core.SELECT_SCHEMA, effort: "medium", maxTokens: 2000,
    content: `<catalogue>\n${catalogue}\n</catalogue>\n\n${email}`,
  }), articles.map((a) => a.id));
  const base = { relevant: sel.relevant, category: sel.category, summary: sel.question, spamLikely: sel.spamLikely, selectedIds: sel.articleIds };
  if (!sel.relevant || sel.spamLikely) return Object.assign(base, { answerable: false, confidence: 0, reply: "", articleIds: [] });
  const byId = new Map(articles.map((a) => [a.id, a]));
  const chosen = sel.articleIds.map((id) => byId.get(id)).filter(Boolean).slice(0, core.MAX_ARTICLES);
  const draftFrom = async (list) => {
    const texts = list.map((a) =>
      `<article id="${a.id}" url="${a.url}">\nTitle: ${a.title}\n${a.directAnswer ? `Short answer: ${a.directAnswer}\n` : ""}${a.summary ? `Summary: ${a.summary}\n` : ""}${core.clip(a.body, 8000)}\n</article>`).join("\n\n");
    const d = await call({
      system: core.TRIAGE_SYSTEM, schema: core.TRIAGE_SCHEMA, effort: "medium",
      content: `${email}\n\nWhat they need, as understood: ${sel.question || "(not stated)"}\n\n<help_articles>\n${texts || "(no article answers this)"}\n</help_articles>`,
    });
    const ids = new Set(list.map((a) => a.id));
    const c = Number(d.confidence);
    return {
      summary: d.summary, reply: d.reply, answerable: d.answerable === true && list.length > 0,
      confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0,
      articleIds: (Array.isArray(d.articleIds) ? d.articleIds : []).filter((id) => ids.has(id)),
      articles: list.length,
    };
  };
  // The best article alone first; 2 or 3 together only when that scores low.
  let best = await draftFrom(chosen.slice(0, 1));
  const steps = chosen.length ? [{ articles: best.articles, confidence: best.confidence }] : [];
  if (chosen.length > 1 && best.confidence < core.CONFIDENCE_BOOST_BELOW) {
    const wider = await draftFrom(chosen);
    steps.push({ articles: wider.articles, confidence: wider.confidence });
    if (wider.confidence >= best.confidence) best = wider;
  }
  return Object.assign(base, {
    summary: best.summary || sel.question,
    answerable: best.answerable,
    confidence: best.confidence,
    confidenceSteps: steps,
    reply: best.reply,
    articleIds: best.articleIds,
  });
}

// The articles a reply relies on, as a ticket keeps them: { id, title, url }
// (url "" for one hidden from the website).
function citedArticles(triage, articles) {
  if (!triage) return [];
  const byId = new Map((articles || []).map((a) => [a.id, a]));
  return triage.articleIds.map((id) => byId.get(id)).filter(Boolean).map((a) => ({ id: a.id, title: a.title, url: a.url }));
}

// The whole engine as both callers use it: run it (or the stand-in a test
// injects as `run`), make the answer safe, and name the articles it relies
// on. `source` ("support" | "aidan") only tells a stand-in who is asking; the
// engine itself never reads it. Returns { raw, triage, cited }; throws when
// the model can't be reached.
async function answerFromHelpCentre({ run = null, call, ticket, messages, articles, source = "support" }) {
  const raw = await (run ? run({ ticket, messages, articles, source }) : matchAndDraft({ call, ticket, messages, articles }));
  const triage = core.cleanTriage(raw, articles.map((a) => a.id));
  return { raw, triage, cited: citedArticles(triage, articles) };
}

// Whether the Help Centre answers the question: about Personalisation Hub,
// not spam, a reply the articles fully answer, and at least one article cited.
// These are the first of decideAction's rules, the ones about the ANSWER; the
// rest of decideAction (confidence threshold, the auto-send switch, one
// automatic answer per thread …) are the Support Inbox's sending gates, and
// are not applied here.
function usableAnswer(triage) {
  return Boolean(triage && triage.relevant !== false && !triage.spamLikely && triage.answerable && triage.reply && triage.articleIds.length);
}

// The body of a reply with the articles it was written from named by title:
// one line added under it for every cited article the body doesn't name
// already. An article hidden from the website (no url) is never named, as the
// drafting prompt asks. Returns the body unchanged when nothing is to add.
function withArticleTitles(body, cited) {
  const text = String(body || "").trim();
  const flat = text.toLowerCase().replace(/\s+/g, " ");
  const missing = (cited || []).filter((a) => a && a.url && a.title && !flat.includes(String(a.title).toLowerCase().replace(/\s+/g, " ").trim()));
  if (!text || !missing.length) return text;
  const lines = missing.map((a) => `${a.title}: ${a.url}`);
  return `${text}\n\n${missing.length === 1 ? "Help Centre article" : "Help Centre articles"}:\n${lines.join("\n")}`;
}

module.exports = { articleView, publishedArticles, emailBlock, questionFromEmail, matchAndDraft, citedArticles, answerFromHelpCentre, usableAnswer, withArticleTitles };
