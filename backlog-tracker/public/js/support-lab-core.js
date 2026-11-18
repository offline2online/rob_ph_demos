// Support › Support Inbox › Test lab: the page's rules. Pure functions only
// (no DOM, no Firestore), so test/support-page-core.test.mjs can drive them;
// support-lab.js owns the rendering. The server's half is
// functions/support-lab-core.js (EXPECTS and RATINGS must match it).

export const EXPECTS = [
  { key: "articles", label: "These articles" },
  { key: "none", label: "No answer yet" },
  { key: "unrelated", label: "Not about PH" },
];
export const RATINGS = [
  { key: "correct", label: "Correct", icon: "check_circle" },
  { key: "partly", label: "Partly", icon: "rule" },
  { key: "wrong", label: "Wrong", icon: "cancel" },
];
export const RATED_TEXT = { correct: "Rated correct", partly: "Rated partly right", wrong: "Rated wrong" };
export const MAX_EXPECTED = 3;
export const RUNS_SHOWN = 12;

// Firestore Timestamp, Date, ISO string, ms or the test stub's {$ts} -> ms.
const toMs = (v) => (!v ? 0 : typeof v.toMillis === "function" ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === "number" ? v
  : typeof v === "object" && typeof v.$ts === "number" ? v.$ts : typeof v === "object" && typeof v.seconds === "number" ? v.seconds * 1000 : Date.parse(v) || 0);

export function normaliseCase(id, d) {
  const c = d || {};
  const r = c.lastResult && typeof c.lastResult === "object" ? c.lastResult : null;
  return {
    id, subject: String(c.subject || ""), text: String(c.text || ""), expect: EXPECTS.some((e) => e.key === c.expect) ? c.expect : "",
    articleIds: Array.isArray(c.articleIds) ? c.articleIds.map(String).slice(0, MAX_EXPECTED) : [],
    rating: RATED_TEXT[c.rating] ? c.rating : "", note: String(c.note || ""), needsReview: !!c.needsReview,
    source: ["lab", "support", "aidan"].includes(c.source) ? c.source : "lab", ticketId: String(c.ticketId || ""), ticketKey: String(c.ticketKey || ""),
    finalAnswer: String(c.finalAnswer || ""), answeredBy: String(c.answeredBy || ""),
    lastResult: r ? { runId: String(r.runId || ""), passed: !!r.passed, problems: Array.isArray(r.problems) ? r.problems.map(String) : [], chosen: Array.isArray(r.chosen) ? r.chosen.map(String) : [], error: String(r.error || "") } : null,
    createdAt: toMs(c.createdAt), updatedAt: toMs(c.updatedAt), createdBy: String(c.createdBy || ""),
  };
}
export function normaliseRun(id, d) {
  const r = d || {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    id, status: ["running", "done", "stopped"].includes(r.status) ? r.status : "done", startedBy: String(r.startedBy || ""),
    startedAt: toMs(r.startedAt), updatedAt: toMs(r.updatedAt), finishedAt: toMs(r.finishedAt),
    total: num(r.total), done: num(r.done), passed: num(r.passed), failed: num(r.failed),
    accuracy: r.accuracy == null || !Number.isFinite(Number(r.accuracy)) ? null : Number(r.accuracy),
    results: r.results && typeof r.results === "object" ? r.results : {},
  };
}

// Newest first, then by id: the order the page lists cases in.
export const sortCases = (cases) => [...(cases || [])].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt) || String(a.id).localeCompare(String(b.id)));
// What a case's row says about it: { label, tone } (tone: pass | fail | wait | none).
export function caseState(c) {
  if (c.needsReview || !c.expect) return { label: "Needs review", tone: "wait" };
  if (!c.lastResult) return { label: "Not run", tone: "none" };
  return c.lastResult.passed ? { label: "Passed", tone: "pass" } : { label: "Failed", tone: "fail" };
}
export function sourceText(c) {
  if (c.source === "aidan") return `From Aidan${c.ticketKey ? ` · ${c.ticketKey}` : ""}`;
  if (c.source === "support") return `From ${c.ticketKey || "a ticket"}`;
  return "Asked in the lab";
}
// One line for a case: its subject, or the start of its question.
export function caseTitle(c) {
  const s = String(c.subject || "").trim();
  if (s) return s;
  const t = String(c.text || "").replace(/\s+/g, " ").trim();
  return t.length > 90 ? `${t.slice(0, 89)}…` : t || "(empty question)";
}
export const accuracyText = (a) => (a == null ? "–" : `${Math.round(a * 100)}%`);
// The running run, if any (the newest one still running).
export const runningRun = (runs) => (runs || []).filter((r) => r.status === "running").sort((a, b) => b.startedAt - a.startedAt)[0] || null;
export const progressText = (run) => (run ? `Running: ${run.done} of ${run.total} case${run.total === 1 ? "" : "s"} done` : "");
// Finished runs for "Accuracy over time": the newest RUNS_SHOWN, oldest first.
export function accuracyRows(runs) {
  return (runs || []).filter((r) => r.status === "done" && r.done > 0).sort((a, b) => b.startedAt - a.startedAt).slice(0, RUNS_SHOWN).reverse()
    .map((r) => ({ id: r.id, at: r.finishedAt || r.startedAt, passed: r.passed, failed: r.failed, accuracy: r.accuracy }));
}
// The newest finished run's failing cases, with the expected and the matched
// article titles. `titleOf(id)` names an article.
export function failingCases(runs, cases, titleOf) {
  const run = (runs || []).filter((r) => r.status === "done").sort((a, b) => b.startedAt - a.startedAt)[0];
  if (!run) return { run: null, rows: [] };
  const byId = new Map((cases || []).map((c) => [c.id, c]));
  const name = (id) => titleOf(id) || "An article no longer published";
  const rows = Object.entries(run.results).filter(([, r]) => r && !r.passed).map(([id, r]) => {
    const c = byId.get(id);
    return {
      id, exists: !!c, title: c ? caseTitle(c) : "A deleted case",
      expected: !c ? "" : c.expect === "unrelated" ? "Not about Personalisation Hub" : c.expect === "none" ? "No article (the Help Centre doesn't answer it yet)" : c.articleIds.map(name).join(", "),
      matched: (Array.isArray(r.chosen) ? r.chosen : []).map(name).join(", ") || "No article",
      problem: (Array.isArray(r.problems) ? r.problems : []).filter((p) => p !== "error").join("; ") || (r.error ? `Couldn't be run: ${r.error}` : ""),
    };
  });
  return { run, rows };
}

// What should happen, as first proposed after Ask: what the engine did.
export function proposedExpect(result) {
  if (!result) return { expect: "", articleIds: [] };
  if (result.relevant === false) return { expect: "unrelated", articleIds: [] };
  const ids = (result.articles || []).map((a) => a.id).filter(Boolean).slice(0, MAX_EXPECTED);
  return ids.length && result.answerable ? { expect: "articles", articleIds: ids } : { expect: "none", articleIds: [] };
}
// What stops a case from being saved, or "".
export function caseProblem({ text, expect, articleIds }) {
  if (!String(text || "").trim()) return "Write the question first.";
  if (!EXPECTS.some((e) => e.key === expect)) return "Say what should happen: these articles, no answer yet, or not about Personalisation Hub.";
  if (expect === "articles" && !(articleIds || []).length) return "Pick the article that should answer it.";
  return "";
}
// The body POSTed to /supportMail/v1/lab/cases.
export function caseBody(form, answered) {
  return {
    ...(form.id ? { id: form.id } : {}), subject: String(form.subject || "").trim(), text: String(form.text || ""), expect: form.expect,
    articleIds: form.expect === "articles" ? (form.articleIds || []).slice(0, MAX_EXPECTED) : [], rating: form.rating || "", note: String(form.note || "").trim(),
    ...(answered ? { answered } : {}),
  };
}
// "55% from 1 article, 82% with 3 combined" is support-core.js's confidenceChange.
