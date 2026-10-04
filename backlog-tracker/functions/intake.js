// ph-ticket-intake — the definition-of-ready gate, applied at point of entry
// (skill `ph-ticket-intake` in the skills library). Pure: no Firebase, so the
// MCP server, the Firestore trigger and the tests all share one rule.
//
// A ticket description must carry four sections, in order: Outcome, Test
// steps, Dependencies, Spec reference. Whatever the creator typed is
// structured into them; a missing or too-thin section is named in a
// `blocked` flag (set by INTAKE_SETTER) that holds the ticket in Backlog —
// the build fan-out already skips blocked tickets. Nothing is invented: a
// section the source doesn't contain stays a visible placeholder.
"use strict";

const INTAKE_SETTER = "ph-ticket-intake";
const DESC_MAX = 2000; // the board's own description limit
const PLACEHOLDER = "_Not provided — needed before this can be built._";

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
    out[k] = body === PLACEHOLDER ? "" : body;
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

// → { desc, sections, gaps: [{key, heading, why}], blocked: null | {reason, note}, type }
function applyIntake(rawDesc) {
  const sections = parseSections(rawDesc);
  const gaps = [];
  for (const s of SECTIONS) {
    const body = (sections[s.key] || "").trim();
    if (!body) gaps.push({ key: s.key, heading: s.heading, why: "missing" });
    else if (words(body) < s.minWords) gaps.push({ key: s.key, heading: s.heading, why: "too thin" });
  }
  const structured = SECTIONS
    .map((s) => `## ${s.heading}\n${(sections[s.key] || "").trim() || PLACEHOLDER}`)
    .join("\n\n");
  const desc = structured.length <= DESC_MAX ? structured : String(rawDesc || "").trim();
  let blocked = null;
  if (gaps.length) {
    const named = gaps.map((g) => `${g.heading} (${g.why})`).join(", ");
    const outcomeGap = gaps.some((g) => g.key === "outcome");
    blocked = {
      // An outcome/scope call is the one thing only a person can supply.
      reason: outcomeGap ? "needs-decision" : "waiting-on-input",
      note: `Intake: ${named}`.slice(0, 200),
    };
  }
  return { desc, sections, gaps, blocked, type: inferType(String(rawDesc || "")) };
}

// Is this blocked flag one intake itself raised (and so intake's to clear)?
const isIntakeFlag = (blocked) => !!(blocked && blocked.reason && blocked.setBy === INTAKE_SETTER);

module.exports = { applyIntake, parseSections, inferType, isIntakeFlag, INTAKE_SETTER, DESC_MAX, PLACEHOLDER, SECTIONS };
