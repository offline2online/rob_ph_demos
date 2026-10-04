// Pure, dependency-free helpers for the "Resolve" flow on blocked tickets —
// the ph-ticket-intake definition of ready (skills library, slug
// `ph-ticket-intake`): a description must carry four sections, in order,
// each substantive, before a ticket can be marked DECIDED.
//
// No Firebase, no DOM: testable with plain node (test/ticket-intake.test.mjs)
// and imported as-is by public/js/app.js (the Resolve modal).

export const INTAKE_SECTIONS = [
  {
    key: "outcome",
    heading: "Outcome",
    question: "What does done look like? Describe the concrete, checkable result.",
    minChars: 20,
  },
  {
    key: "test",
    heading: "Test steps",
    question: "How should this be tested? Tell me the screens or steps to try and what you expect to see.",
    minChars: 20,
  },
  {
    key: "deps",
    heading: "Dependencies",
    question: "Does this need any other ticket, migration or spec to exist first? Say \"none\" if not.",
    minChars: 4,
  },
  {
    key: "spec",
    heading: "Spec reference",
    question: "Which requirements section, boundary doc or spec ticket does this build against? Say \"none\" if there isn't one.",
    minChars: 4,
  },
];

const HEADING_RE = /^\s{0,3}#{1,6}\s*(.+?)\s*#*\s*$/;

function sectionKeyOf(headingText) {
  const h = String(headingText || "").trim().toLowerCase();
  const s = INTAKE_SECTIONS.find((x) => x.heading.toLowerCase() === h);
  return s ? s.key : null;
}

// Splits a description into `{preamble, sections: {key: body}, other}`.
// Headings that aren't one of the four are kept verbatim inside `other`
// (in order) so rewriting never loses text the person wrote.
export function parseIntake(desc) {
  const lines = String(desc || "").split("\n");
  const sections = {};
  const preamble = [];
  const other = [];
  let cur = null;      // {kind: "known"|"other", key?, buf: []}
  const flush = () => {
    if (!cur) return;
    const body = cur.buf.join("\n").trim();
    if (cur.kind === "known") {
      sections[cur.key] = sections[cur.key] ? `${sections[cur.key]}\n${body}`.trim() : body;
    } else {
      other.push(cur.head + (body ? `\n${body}` : ""));
    }
  };
  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      flush();
      const key = sectionKeyOf(m[1]);
      cur = key ? { kind: "known", key, buf: [] } : { kind: "other", head: line.trim(), buf: [] };
    } else if (cur) {
      cur.buf.push(line);
    } else {
      preamble.push(line);
    }
  }
  flush();
  return { preamble: preamble.join("\n").trim(), sections, other };
}

// A section is substantive when it has real text, not just a placeholder.
export function isSubstantive(section, body) {
  const text = String(body || "").replace(/[\s\-*_>`#]+/g, " ").trim();
  if (!text) return false;
  if (/^(tbd|todo|\?+|n\/?a|\.+|to be decided|to be added)$/i.test(text)) return false;
  return text.length >= section.minChars;
}

// Sections that still need an answer, in intake order.
export function missingSections(desc) {
  const { preamble, sections } = parseIntake(desc);
  // A description with no headings at all is treated as the Outcome text,
  // matching how the intake skill structures whatever the creator supplied.
  const eff = Object.keys(sections).length === 0 && preamble ? { outcome: preamble } : sections;
  return INTAKE_SECTIONS.filter((s) => !isSubstantive(s, eff[s.key]));
}

// Rebuilds the description with `answers` ({key: text}) written into their
// own sections, in the canonical order, keeping existing sections, any
// unrecognised headings and any unheaded leading text.
export function applyAnswers(desc, answers) {
  const { preamble, sections, other } = parseIntake(desc);
  const merged = { ...sections };
  // Unheaded text on a ticket with no headings is its Outcome.
  if (Object.keys(sections).length === 0 && preamble && !answers.outcome) merged.outcome = preamble;
  for (const [k, v] of Object.entries(answers)) {
    const t = String(v || "").trim();
    if (t) merged[k] = t;
  }
  const parts = [];
  const keepPreamble = preamble && !(Object.keys(sections).length === 0 && !answers.outcome);
  if (keepPreamble) parts.push(preamble);
  for (const s of INTAKE_SECTIONS) {
    if (merged[s.key]) parts.push(`## ${s.heading}\n${merged[s.key]}`);
  }
  parts.push(...other);
  return parts.join("\n\n");
}

// Describes the next step of the conversation for the Resolve modal.
export function resolvePlan(desc) {
  const missing = missingSections(desc);
  return { missing, done: missing.length === 0 };
}
