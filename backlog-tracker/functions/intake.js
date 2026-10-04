// ph-ticket-intake — the definition-of-ready gate, applied at point of entry
// (skill `ph-ticket-intake` in the skills library). Pure: no Firebase, so the
// MCP server, the Firestore trigger and the tests all share one rule.
//
// A ticket description must carry four sections, in order: Outcome, Test
// steps, Dependencies, Spec reference. Whatever the creator typed is
// structured into them. Nothing is invented: a section the source doesn't
// contain stays a visible placeholder.
//
// Only the OUTCOME blocks (4 Oct 2026). It is the one thing only a person can
// supply; Test steps, Dependencies and Spec reference are what the build
// session works out from the code and the spec, so a gap there is listed in
// `pending` and filled in by that session before it builds (ROUTINE_
// INSTRUCTIONS.md → "Complete the intake sections first"), and
// run-backlog-automation.js refuses to land a patch while a placeholder is
// still in the description. The first version blocked on all four, which
// held every dictated board ticket out of Ready for Dev — four Display Types
// tickets in twenty minutes, none buildable.
"use strict";

const INTAKE_SETTER = "ph-ticket-intake";
const DESC_MAX = 2000; // the board's own description limit
const PLACEHOLDER = "_Not provided — needed before this can be built._";
// What a gap the build session fills in reads as; PLACEHOLDER is still
// recognised on tickets written before the split.
const TO_COMPLETE = "_To be completed by the build session from the code and spec, before it builds._";
const PLACEHOLDERS = [PLACEHOLDER, TO_COMPLETE];

const SECTIONS = [
  { key: "outcome", heading: "Outcome", minWords: 8 },
  { key: "testSteps", heading: "Test steps", minWords: 5 },
  { key: "dependencies", heading: "Dependencies", minWords: 1 },
  { key: "specReference", heading: "Spec reference", minWords: 1 },
];

const HEADING_RE = /^\s{0,3}#{1,6}\s*(outcome|test steps?|dependencies|spec(?:ification)? reference)\s*:?\s*$/i;
function keyForHeading(h) {
  const t = h.toLowerCase();
  if (t.startsWith("outcome")) return "outcome";
  if (t.startsWith("test")) return "testSteps";
  if (t.startsWith("dep")) return "dependencies";
  return "specReference";
}

const words = (s) => (String(s || "").match(/\S+/g) || []).length;

function parseSections(desc) {
  const found = {};
  let cur = null;
  const preamble = [];
  for (const line of String(desc || "").split(/\r?\n/)) {
    const m = HEADING_RE.exec(line);
    if (m) { cur = keyForHeading(m[1]); found[cur] = found[cur] || []; continue; }
    (cur ? found[cur] : preamble).push(line);
  }
  const out = {};
  for (const k of Object.keys(found)) {
    const body = found[k].join("\n").trim();
    out[k] = PLACEHOLDERS.includes(body) ? "" : body;
  }
  const pre = preamble.join("\n").trim();
  // Free text with no Outcome heading is the creator's statement of the
  // outcome — the only section it can honestly be mapped to.
  if (pre && !out.outcome) out.outcome = pre;
  else if (pre) out.outcome = `${pre}\n${out.outcome}`.trim();
  return out;
}

function inferType(text) {
  return /\b(bug|broken|crash(?:es|ed)?|error|fails?|failing|fix(?:es)?|regression|not working|doesn'?t work|incorrect|wrong)\b/i.test(text) ? "bug" : "feature";
}

// → { desc, sections, gaps: [{key, heading, why}], pending: [same, minus the
//     outcome], blocked: null | {reason, note}, type }
function applyIntake(rawDesc) {
  const sections = parseSections(rawDesc);
  const gaps = [];
  for (const s of SECTIONS) {
    const body = (sections[s.key] || "").trim();
    if (!body) gaps.push({ key: s.key, heading: s.heading, why: "missing" });
    else if (words(body) < s.minWords) gaps.push({ key: s.key, heading: s.heading, why: "too thin" });
  }
  const structured = SECTIONS
    .map((s) => `## ${s.heading}\n${(sections[s.key] || "").trim() || (s.key === "outcome" ? PLACEHOLDER : TO_COMPLETE)}`)
    .join("\n\n");
  const desc = structured.length <= DESC_MAX ? structured : String(rawDesc || "").trim();
  let blocked = null;
  const outcomeGap = gaps.find((g) => g.key === "outcome");
  if (outcomeGap) {
    // An outcome/scope call is the one thing only a person can supply.
    blocked = { reason: "needs-decision", note: `Intake: Outcome (${outcomeGap.why}) — say what should be different when this is done`.slice(0, 200) };
  }
  const pending = gaps.filter((g) => g.key !== "outcome");
  return { desc, sections, gaps, pending, blocked, type: inferType(String(rawDesc || "")) };
}

// Is this blocked flag one intake itself raised (and so intake's to clear)?
const isIntakeFlag = (blocked) => !!(blocked && blocked.reason && blocked.setBy === INTAKE_SETTER);

// Does a description still carry a section nobody has filled in yet?
const hasIntakePlaceholder = (desc) => PLACEHOLDERS.some((p) => String(desc || "").includes(p));

module.exports = { applyIntake, parseSections, inferType, isIntakeFlag, hasIntakePlaceholder, INTAKE_SETTER, DESC_MAX, PLACEHOLDER, TO_COMPLETE, SECTIONS };
