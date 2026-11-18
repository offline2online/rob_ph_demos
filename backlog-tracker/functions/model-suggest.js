"use strict";
// GENERATED from public/js/model-suggest.js by scripts/gen-model-suggest-cjs.sh — edit that file, then run this script.
// Which model a ticket should be built on, chosen automatically (ticket
// CCPnRjXOH4YMsfy3C49r, "Flow 8/9", 14 Nov 2026 board flow review).
//
// t1CU2q6LlxGd5pFB9vwG added a per-ticket Model (Standard / Advanced = Claude
// Opus) that a person set by hand, and nothing else chose it. Tickets that
// needed several builds for basic errors were all ones a reader would have
// called hard: permission code, the release pipeline, long multi-part
// specifications. This is a deterministic classifier (no model call) that
// says Advanced when any of these hold, and records which:
//
//   security     names or points at permission/security code (firestore.rules,
//                storage.rules, auth-gate.js, the MCP OAuth code, consoleUsers,
//                access/refresh/ID tokens, secrets)
//   pipeline     the release pipeline itself (run-backlog-automation.js,
//                train-lock.js, .github/workflows/)
//   migration    a data migration or backfill
//   contract     an interface contract between projects (shared/, `interfaces`)
//   multiProject files under two or more projects' owned paths
//   large        effort marked Large
//   long         a description over LONG_DESC_CHARS with MANY_BUILD_ITEMS or
//                more numbered build items in its Outcome
//
// The keyword rules read the title, the Outcome and the Spec reference, not
// the Test steps or Dependencies sections (scoredText), and a keyword with
// "no", "not", "without", "never" or "nor" just before it in the same clause
// does not count ("No new secret or index"). See version 2 below.
//
// Otherwise Standard. The result is stored as `modelSuggested`
// {model, reasons: [{key, text}], version}. If the person did not choose a
// model, `model` takes the suggestion (`modelAuto: true`); a person's explicit
// choice is never overridden (explicitModel). An escalation after failed rounds
// (functions/model-requirement.js → modelEscalation) is explicit too. While a
// build is in flight (buildInFlight) the suggestion is recorded but `model` is
// left as the build was fired with; it follows the suggestion once the build
// has handed back or reported.
//
// Also here, because the board and the server must agree on them:
// modelChipText (the card chip), reviewNeedsOpus (the review guard),
// needsAutoReview (which tickets are reviewed without a click), rendersUI
// (which tickets always get ph-designer) and buildsByModel (the 30-day table).
//
// Plain ESM with no imports, no DOM and no Firebase. functions/model-suggest.js
// is its generated CommonJS copy (scripts/gen-model-suggest-cjs.sh);
// test/model-suggest.test.js fails if the two drift.

// Version 2 (18 Nov 2026, ticket 6Nia0yWu8yAL3STGh96R): Test steps and
// Dependencies are no longer scored, and negated keywords no longer count.
// Two Standard builds were refused that day because the build session's own
// Dependencies line ("No new secret or index"; "the ANTHROPIC_API_KEY
// function secret, already set") re-marked the ticket Advanced at hand-over.
const MODEL_SUGGEST_VERSION = 2;
const LONG_DESC_CHARS = 2500;
const MANY_BUILD_ITEMS = 5;
// Reasons that also make a ticket reviewed without a click.
const AUTO_REVIEW_REASONS = ["security", "pipeline"];

const RULES = [
  {
    key: "security",
    text: "touches security rules",
    re: /\bfirestore\.rules\b|\bstorage\.rules\b|\bauth-gate(?:\.js)?\b|\boauth\b|\bpkce\b|\bconsoleUsers\b|\b(?:access|refresh|id|bearer|auth|api|session|fire|oauth)[ _-]?tokens?\b|\bsecrets?\b|\bSecret Manager\b|\bcustom claims?\b|\bsecurity rules?\b/i,
  },
  {
    key: "pipeline",
    text: "changes the release pipeline",
    re: /\brun-backlog-automation(?:\.js)?\b|\btrain-lock(?:\.js)?\b|\.github\/workflows\b/i,
  },
  {
    key: "migration",
    text: "migrates or backfills data",
    re: /\bdata migrations?\b|\bmigrat(?:e|es|ed|ing)\b[^.\n]{0,40}\b(?:data|docs?|documents?|records?|collection|fields?|cards?|tickets?)\b|\bbackfill(?:s|ed|ing)?\b|\bmigrations\/\d/i,
  },
  {
    key: "contract",
    text: "changes an interface contract",
    re: /(?:^|[\s`(])shared\/[\w.-]|\binterface[- ]contracts?\b|`interfaces`|\bboard-interfaces\.json\b/i,
  },
];

const PATH_RE = /(?:^|[\s`'"(\[])((?:\.?[\w-]+\/)+[\w.-]*)/g;

// Repo paths named in the text (folder prefixes included).
function pathsIn(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(PATH_RE)) {
    const p = m[1].replace(/^\.\//, "");
    if (p && !/^https?:/i.test(p) && !p.startsWith("//")) out.add(p);
  }
  return [...out];
}

// The folder prefixes a project owns: ownedPaths, else repoFolder.
function ownedPrefixes(project) {
  const list = Array.isArray(project && project.ownedPaths) && project.ownedPaths.length
    ? project.ownedPaths
    : (project && project.repoFolder ? [project.repoFolder] : []);
  return list.map((p) => String(p || "").trim().replace(/^\/+/, "").replace(/\/*$/, "/")).filter((p) => p.length > 1);
}

// Projects whose owned paths the text's paths fall under.
function projectsTouched(text, projects) {
  const paths = pathsIn(text);
  const hit = new Set();
  for (const p of Array.isArray(projects) ? projects : []) {
    const prefixes = ownedPrefixes(p);
    if (!prefixes.length) continue;
    if (paths.some((path) => prefixes.some((pre) => (path.endsWith("/") ? path : `${path}/`).startsWith(pre) || path.startsWith(pre)))) hit.add(p.id);
  }
  return [...hit];
}

// The Outcome part of a description: everything before "## Test steps".
function outcomePart(desc) {
  const text = String(desc || "");
  const m = text.match(/^\s{0,3}#{1,6}\s*test steps?\b/im);
  return m ? text.slice(0, m.index) : text;
}

// The text the keyword rules read: the title, and the description without
// its Test steps and Dependencies sections. Those say how to test the ticket
// and what it needs (another ticket, an existing secret), not what it changes,
// and a build session fills them in at hand-over.
const UNSCORED_SECTION_RE = /^(?:test steps?|dependencies)\b/i;
function scoredText(item) {
  const it = item || {};
  const kept = [];
  let skip = false;
  for (const line of String(it.desc || "").split("\n")) {
    const h = line.match(/^\s{0,3}#{1,6}\s*(.*)$/);
    if (h) skip = UNSCORED_SECTION_RE.test(h[1].trim());
    if (!skip) kept.push(line);
  }
  return `${it.title || ""}\n${kept.join("\n")}`;
}

// A negator just before a keyword, in the same clause: "no new secret",
// "without touching firestore.rules", "does not change auth-gate.js".
const NEGATED_BEFORE_RE = /\b(?:no|not|without|never|nor)\b(?!\s+longer\b)(?:\s+[\w'-]+){0,2}\s*$/i;
function ruleMatches(re, text) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(g)) {
    const clause = text.slice(Math.max(0, m.index - 60), m.index).split(/[.;:!?,()\n]/).pop();
    if (!NEGATED_BEFORE_RE.test(clause)) return true;
  }
  return false;
}

function numberedBuildItems(desc) {
  return (outcomePart(desc).match(/^\s{0,3}\d{1,2}[.)]\s+\S/gm) || []).length;
}

// → {model: "standard"|"advanced", reasons: [{key, text}], version}
// ctx.projects: [{id, ownedPaths?, repoFolder?}] for the multi-project rule.
function suggestModel(item, ctx = {}) {
  const it = item || {};
  const desc = String(it.desc || "");
  const text = scoredText(it);
  const reasons = [];
  for (const r of RULES) if (ruleMatches(r.re, text)) reasons.push({ key: r.key, text: r.text });
  const touched = projectsTouched(text, ctx.projects);
  if (touched.length >= 2) reasons.push({ key: "multiProject", text: `changes files of ${touched.length} projects` });
  if (String(it.effort || "").toLowerCase() === "large") reasons.push({ key: "large", text: "effort marked Large" });
  const steps = numberedBuildItems(desc);
  if (desc.length > LONG_DESC_CHARS && steps >= MANY_BUILD_ITEMS) reasons.push({ key: "long", text: `long ticket with ${steps} build items` });
  return { model: reasons.length ? "advanced" : "standard", reasons, version: MODEL_SUGGEST_VERSION };
}

// A person chose this model (or an escalation set it): never overridden.
// Unset, or set by the suggestion (modelAuto), is not a choice.
function explicitModel(item) {
  const m = item && item.model;
  return (m === "standard" || m === "advanced") && item.modelAuto !== true;
}

function sameSuggestion(a, b) {
  if (!a || !b) return false;
  const keys = (s) => (Array.isArray(s.reasons) ? s.reasons.map((r) => `${r && r.key}:${r && r.text}`).join("|") : "");
  return a.model === b.model && keys(a) === keys(b) && (a.version || 0) === (b.version || 0);
}

function timeMs(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  if (typeof v._seconds === "number") return v._seconds * 1000;
  return Date.parse(v);
}

// A build of this ticket is under way: its patch is handed back and waiting
// to land (patchReady), or a session was started for its current build
// attempt (lastFire) and has not reported done or error since
// (buildSession.reportedAt / finishedAt after lastFire.at). While it is, the
// classifier does not change `model`: the build was fired with a model, and
// the build session's own hand-over (it writes the completed description in
// the same PATCH as patchReady) must not move the goalposts under it.
function buildInFlight(item) {
  if (!item) return false;
  if (item.patchReady === true) return true;
  const fire = item.lastFire;
  const attempt = item.buildAttemptId;
  if (!fire || fire.status !== "started" || !attempt || fire.buildAttemptId !== attempt) return false;
  const firedAt = timeMs(fire.at);
  const s = item.buildSession || {};
  const reported = [s.reportedAt, s.finishedAt].some((t) => timeMs(t) >= firedAt);
  return !reported;
}

// The fields to write for a fresh suggestion, or {} when nothing changes.
function autoModelFields(item, suggestion) {
  const out = {};
  if (!sameSuggestion(item && item.modelSuggested, suggestion)) {
    out.modelSuggested = { model: suggestion.model, reasons: suggestion.reasons.map((r) => ({ key: r.key, text: r.text })), version: suggestion.version || MODEL_SUGGEST_VERSION };
  }
  if (!explicitModel(item) && !buildInFlight(item) && (item.model !== suggestion.model || item.modelAuto !== true)) {
    out.model = suggestion.model;
    out.modelAuto = true;
  }
  return out;
}

function isOpusModelId(modelId) {
  return typeof modelId === "string" && /\bopus\b|-opus-|opus-\d/i.test(modelId);
}

// "Advanced · Opus (auto: touches security rules)", "" for Standard.
function modelChipText(item) {
  if (!item || item.model !== "advanced") return "";
  if (item.modelEscalatedAt) return "Advanced · Opus (raised after 2 failed rounds)";
  const r = item.modelAuto && item.modelSuggested && Array.isArray(item.modelSuggested.reasons) ? item.modelSuggested.reasons[0] : null;
  return r && r.text ? `Advanced · Opus (auto: ${r.text})` : "Advanced · Opus";
}

// "Suggested: Advanced — touches security rules" beside the Model select.
function suggestionHint(suggestion) {
  if (!suggestion) return "";
  if (suggestion.model !== "advanced") return "Suggested: Standard";
  return `Suggested: Advanced — ${suggestion.reasons.map((r) => r.text).join(", ")}`;
}

// The review guard (mirrors modelGuardRefusal for builds): an Advanced
// ticket reviewed on anything but an Opus counts as not reviewed.
function reviewNeedsOpus(item) {
  if (!item || item.model !== "advanced") return false;
  const by = typeof item.reviewedByModel === "string" ? item.reviewedByModel.trim() : "";
  return !!by && !isOpusModelId(by);
}

// Reviewed on this commit, by a model the ticket allows.
function reviewedForCommit(item) {
  return !!(item && item.reviewStatus && item.reviewedCommit === item.deployCommit && !reviewNeedsOpus(item));
}

// Reviewed without a click: Advanced tickets, and any ticket the classifier
// scored for security or pipeline reasons.
function needsAutoReview(item) {
  if (!item) return false;
  if (item.model === "advanced") return true;
  const reasons = item.modelSuggested && Array.isArray(item.modelSuggested.reasons) ? item.modelSuggested.reasons : [];
  return reasons.some((r) => r && AUTO_REVIEW_REASONS.includes(r.key));
}

const UI_CATEGORIES = ["HQ Admin", "Retail Admin", "PH Website", "Pricing & Offers", "Product Assets"];
const UI_RE = /\b(?:UI|screens?|pages?|modals?|dialogs?|buttons?|layout|CSS|chips?|components?|rendered|renders?|visual|mobile|iPad|hover|tooltip|menu|form)\b|\.(?:css|html)\b|\bpublic\/(?:js|css)\//i;
// A ticket whose description or category says it changes rendered output
// always gets ph-designer (root CLAUDE.md: every UI change goes through it).
function rendersUI(item) {
  if (!item) return false;
  if (UI_CATEGORIES.includes(item.category)) return true;
  return UI_RE.test(`${item.title || ""}\n${outcomePart(item.desc)}`);
}

function millis(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  return Date.parse(v);
}

// The project's "Builds by model" table: tickets built in the last `days`
// days, grouped by the model that built them. rounds = Ready for Testing
// arrivals (testRound), rebuilds = send-backs plus automatic rebuilds.
function buildsByModel(items, now = Date.now(), days = 30) {
  const since = now - days * 24 * 60 * 60 * 1000;
  const rows = new Map();
  for (const i of Array.isArray(items) ? items : []) {
    const by = typeof (i && i.builtByModel) === "string" ? i.builtByModel.trim() : "";
    if (!by) continue;
    const at = millis(i.statusEnteredAt) || millis(i.updatedAt) || millis(i.createdAt);
    if (!(at >= since)) continue;
    const r = rows.get(by) || { model: by, tickets: 0, rounds: 0, rebuilds: 0, advanced: 0 };
    r.tickets += 1;
    r.rounds += Math.max(Number(i.testRound) || 0, 0);
    r.rebuilds += (Number(i.sendBackCount) || 0) + (Number(i.autoRebuilds) || 0);
    if (i.model === "advanced") r.advanced += 1;
    rows.set(by, r);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, roundsPerTicket: r.tickets ? Math.round((r.rounds / r.tickets) * 10) / 10 : 0 }))
    .sort((a, b) => b.tickets - a.tickets || a.model.localeCompare(b.model));
}

module.exports = { MODEL_SUGGEST_VERSION, LONG_DESC_CHARS, MANY_BUILD_ITEMS, AUTO_REVIEW_REASONS, pathsIn, projectsTouched, numberedBuildItems, suggestModel, explicitModel, buildInFlight, autoModelFields, isOpusModelId, modelChipText, suggestionHint, reviewNeedsOpus, reviewedForCommit, needsAutoReview, rendersUI, buildsByModel };
