#!/usr/bin/env node
// Support Inbox: how well the real model matches emails to the Help Centre.
//
// Runs the same two-step triage the live inbox uses (functions/support-mail.js
// runTriage: is it about Personalisation Hub, which articles answer it, then
// the draft) on the made-up emails in test/fixtures/support-eval.json, against
// the published articles in faq/data, and reports for each one: about
// Personalisation Hub or not, the articles chosen, whether that was a right
// match, the confidence and the draft. Exits 1 when any case is wrong.
//
// REPLAY=<n> (and GOOGLE_APPLICATION_CREDENTIALS) also re-runs the newest n
// real tickets and prints only their SUP key, the articles matched before and
// now, and the scores. Never their subject, sender or text: logs here are
// public and those are customers' emails.
//
//   ANTHROPIC_API_KEY=… node backlog-tracker/scripts/support-eval.js [case-id …]
// .github/workflows/support-eval.yml runs it with the repository's key.
"use strict";
const fs = require("fs");
const path = require("path");
const core = require("../functions/support-core");
const { runTriage, articleView } = require("../functions/support-mail");

const root = path.join(__dirname, "..", "..");
const faqDir = path.join(root, "faq", "data");
const CONCURRENCY = 4;

function loadArticles() {
  const index = JSON.parse(fs.readFileSync(path.join(faqDir, "index.json"), "utf8"));
  const catName = new Map(index.categories.map((c) => [c.id, c.name]));
  return index.articles.filter((a) => a.status === "published").map((meta) => {
    const file = path.join(faqDir, "articles", `${meta.id}.json`);
    const full = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : meta;
    return articleView(Object.assign({}, meta, full), catName.get(meta.categoryId) || "");
  });
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function triage(ticket, messages, articles) {
  const raw = await runTriage({ apiKey: process.env.ANTHROPIC_API_KEY, workspaceId: process.env.ANTHROPIC_WORKSPACE_ID || "", ticket, messages, articles });
  return { raw, t: core.cleanTriage(raw, articles.map((a) => a.id)) };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "unset") { console.error("ANTHROPIC_API_KEY is not set"); process.exit(2); }
  const articles = loadArticles();
  const title = new Map(articles.map((a) => [a.id, a.title]));
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "support-eval.json"), "utf8")).cases;
  const only = process.argv.slice(2);
  const cases = only.length ? fixtures.filter((c) => only.includes(c.id)) : fixtures;
  console.log(`support-eval: ${cases.length} emails against ${articles.length} published articles\n`);

  const results = await pool(cases, CONCURRENCY, async (c) => {
    const t0 = Date.now();
    try {
      const ticket = { subject: c.subject || "(no subject)", customerEmail: c.fromEmail, fromEmail: c.fromEmail, customerName: c.fromName || "" };
      const { raw, t } = await triage(ticket, [{ direction: "in", text: c.text || "" }], articles);
      const chosen = raw.selectedIds || [];
      const problems = [];
      if (t.relevant !== c.relevant) problems.push(c.relevant ? "treated as not about Personalisation Hub" : "treated as about Personalisation Hub");
      if (c.relevant && c.articles.length && !chosen.some((id) => c.articles.includes(id))) problems.push("no right article chosen");
      if (c.relevant && !c.articles.length && t.answerable) problems.push("claimed the Help Centre answers it");
      if (!c.relevant && t.reply) problems.push("drafted a reply");
      const draft = t.reply ? core.composeReply(core.firstNameOf(ticket.customerName, ticket.customerEmail), t.reply) : "";
      return { c, t, chosen, problems, draft, ms: Date.now() - t0, top1: c.articles.length ? c.articles.includes(chosen[0]) : null };
    } catch (err) {
      return { c, error: String(err && err.message ? err.message : err), problems: ["error"], ms: Date.now() - t0 };
    }
  });

  for (const r of results) {
    const mark = r.problems.length ? "FAIL" : "ok  ";
    console.log(`${mark} ${r.c.id}  (${Math.round(r.ms / 100) / 10}s)`);
    console.log(`     subject: ${r.c.subject || "(none)"}`);
    if (r.error) { console.log(`     error: ${r.error}\n`); continue; }
    console.log(`     about Personalisation Hub: ${r.t.relevant ? "yes" : "no"} (expected ${r.c.relevant ? "yes" : "no"}) · category ${r.t.category} · confidence ${Math.round(r.t.confidence * 100)}% · ${r.t.answerable ? "answered" : "holding reply / none"}`);
    if ((r.t.confidenceSteps || []).length > 1) console.log(`     confidence: ${r.t.confidenceSteps.map((x) => `${Math.round(x.confidence * 100)}% from ${x.articles} article${x.articles === 1 ? "" : "s"}`).join(" → ")}`);
    console.log(`     understood: ${r.t.summary}`);
    console.log(`     chose: ${r.chosen.length ? r.chosen.map((id) => `${title.get(id)}${r.c.articles.includes(id) ? " ✓" : ""}`).join(" | ") : "(none)"}`);
    if (r.c.articles.length) console.log(`     right answers: ${r.c.articles.map((id) => title.get(id)).join(" | ")}`);
    if (r.problems.length) console.log(`     problem: ${r.problems.join("; ")}`);
    if (r.draft) console.log(`     draft:\n${r.draft.split("\n").map((l) => `       > ${l}`).join("\n")}`);
    console.log("");
  }

  const n = results.length, bad = results.filter((r) => r.problems.length);
  const withArticles = results.filter((r) => r.c.relevant && r.c.articles.length && !r.error);
  const relevance = results.filter((r) => !r.error && r.t.relevant === r.c.relevant).length;
  console.log(`about Personalisation Hub decided right: ${relevance}/${n}`);
  console.log(`a right article among those chosen: ${withArticles.filter((r) => r.chosen.some((id) => r.c.articles.includes(id))).length}/${withArticles.length}`);
  console.log(`a right article chosen first: ${withArticles.filter((r) => r.top1).length}/${withArticles.length}`);
  const confs = results.filter((r) => !r.error && r.t.relevant && r.t.answerable).map((r) => r.t.confidence);
  if (confs.length) console.log(`answered: ${confs.length}, average confidence ${Math.round(confs.reduce((x, y) => x + y, 0) / confs.length * 100)}%, ${confs.filter((c) => c >= 0.8).length} at 80% or more; ${results.filter((r) => (r.t && r.t.confidenceSteps || []).length > 1).length} needed more articles`);
  console.log(`cases passed: ${n - bad.length}/${n}${bad.length ? ` (failed: ${bad.map((r) => r.c.id).join(", ")})` : ""}`);

  const replay = Number(process.env.REPLAY || 0);
  if (replay > 0) await replayTickets(replay, articles, title);
  process.exit(bad.length ? 1 : 0);
}

// The newest real tickets again, printing nothing a customer wrote.
async function replayTickets(n, articles, title) {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) { console.log("\nreplay: skipped (no service account)"); return; }
  // firebase-admin is a dependency of functions/, not of this folder.
  const fromFunctions = (m) => require(require.resolve(m, { paths: [path.join(__dirname, "..", "functions")] }));
  const { initializeApp, applicationDefault } = fromFunctions("firebase-admin/app");
  const { getFirestore } = fromFunctions("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();
  const snap = await db.collection("supportTickets").orderBy("lastMessageAt", "desc").limit(Math.min(n, 20)).get();
  console.log(`\nreplay: the ${snap.size} newest real tickets (key and article titles only)`);
  for (const d of snap.docs) {
    const tk = d.data() || {};
    if (tk.automated) { console.log(`  ${tk.key}: machine-sent, never drafted`); continue; }
    const msnap = await d.ref.collection("messages").get();
    const messages = msnap.docs.map((m) => m.data()).filter((m) => m.direction === "in" || m.direction === "out")
      .sort((a, b) => (a.at && a.at.toMillis ? a.at.toMillis() : 0) - (b.at && b.at.toMillis ? b.at.toMillis() : 0));
    try {
      const { raw, t } = await triage({ subject: tk.subject, customerEmail: tk.customerEmail, fromEmail: tk.fromEmail, customerName: tk.customerName }, messages, articles);
      const before = ((tk.aiDraft && tk.aiDraft.articles) || []).map((a) => a.title);
      console.log(`  ${tk.key}: before → ${before.length ? before.join(" | ") : "(no article)"}`);
      console.log(`  ${" ".repeat(String(tk.key).length)}  now    → ${(raw.selectedIds || []).length ? raw.selectedIds.map((id) => title.get(id)).join(" | ") : "(no article)"} · about PH: ${t.relevant ? "yes" : "no"} · ${t.category} · ${Math.round(t.confidence * 100)}% · ${t.answerable ? "answered" : "holding reply / none"}`);
    } catch (err) { console.log(`  ${tk.key}: error ${String(err && err.message ? err.message : err).slice(0, 160)}`); }
  }
}

main().catch((err) => { console.error(err); process.exit(2); });
