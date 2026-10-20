// Pure planning for the one-click "Promote to project": which repo folder a
// concept's project gets, and which Backlog tickets are raised for it. No
// Firebase, no DOM — imported by public/js/app.js (promoteConceptToProject)
// and by test/promote-plan.test.mjs.
import { splitRequirementsText, estimateEffort, estimatePriority } from "./build-batches.js";

const MAX_BUILD_TICKETS = 30;

const FE_WORDS = /\b(ui|ux|screen|page|modal|button|form|table|layout|menu|navigation|nav|dashboard|view|display|show|shows|render|click|tap|mobile|responsive|style|icon|dialog|input|field|list|card|tab|filter|search box|front[- ]?end)\b/i;
const BE_WORDS = /\b(api|endpoint|database|db|schema|migration|server|service|queue|job|cron|integration|webhook|auth|authentication|permission|permissions|store|persist|sync|import|export|cache|firestore|function|back[- ]?end|rate limit|security|audit|log)\b/i;

// "Loyalty App!" -> "loyalty-app". Lower-case, [a-z0-9-] only, never empty.
function slugifyFolder(name) {
  const s = String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
  return s || "new-project";
}

// First free folder: the slug, then slug-2, slug-3… `taken` is a Set/array of
// lower-cased folder names already linked to projects or present at the repo root.
function pickRepoFolder(name, taken) {
  const used = new Set(Array.from(taken || [], (f) => String(f).toLowerCase()));
  const base = slugifyFolder(name);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now()}`;
}

function sideOf(text) {
  const fe = FE_WORDS.test(text), be = BE_WORDS.test(text);
  if (fe && !be) return "frontend";
  if (be && !fe) return "backend";
  if (fe && be) return "both";
  return "backend";
}

function firstSentence(text, max = 70) {
  const t = String(text || "").replace(/\s+/g, " ").replace(/^#+\s*/, "").trim();
  const cut = t.split(/(?<=[.!?])\s/)[0] || t;
  return cut.length > max ? `${cut.slice(0, max - 1).trimEnd()}…` : cut;
}

// Requirement-shaped lines of a Requirements markdown: drops headings, code
// fences and table rules, keeps bullets/paragraphs, via the same splitter
// Feed in requirements uses.
function requirementLines(requirementsMd) {
  const cleaned = String(requirementsMd || "").replace(/```[\s\S]*?```/g, "")
    .split("\n").filter((l) => !/^\s*(#{1,6}\s|\|?\s*[-:]+\s*(\|\s*[-:]+\s*)*\|?\s*$)/.test(l)).join("\n");
  return splitRequirementsText(cleaned).filter((r) => r.length >= 12);
}

// Returns [{title, desc, type, category, effort, priority, kind}] — all start
// in Backlog (addItem), nothing is approved or sent for build here.
function planPromotionTickets({ name, folder, readmeMd, requirementsMd, documents }) {
  const proj = String(name || "the project").trim();
  const reqs = requirementLines(requirementsMd).slice(0, MAX_BUILD_TICKETS);
  const out = [];
  const tail = `\n\nRaised automatically when "${proj}" was promoted from a concept. Requirements: ${folder}/REQUIREMENTS.md. Build in ${folder}/ (the project's repo folder).`;
  for (const r of reqs) {
    const side = sideOf(r);
    for (const s of side === "both" ? ["frontend", "backend"] : [side]) {
      const fe = s === "frontend";
      const draft = { title: `${fe ? "Build front end" : "Build back end"}: ${firstSentence(r)}`, desc: `## Outcome\n${fe ? "Front-end" : "Back-end"} work for this requirement${side === "both" ? " (its other half is a separate ticket)" : ""}:\n\n${r}${tail}`, type: "feature", category: fe ? "Retail Admin" : "Backend / Infrastructure" };
      out.push({ ...draft, kind: s, effort: estimateEffort(draft), priority: estimatePriority(draft) });
    }
  }
  if (!reqs.length) {
    for (const s of ["frontend", "backend"]) {
      const fe = s === "frontend";
      out.push({ kind: s, title: `Build ${fe ? "front end" : "back end"} for ${proj}`, desc: `## Outcome\nBuild the ${fe ? "front end" : "back end"} of ${proj} from its concept README and Requirements. The Requirements were too short to split into tickets: read them, then split this ticket if it holds independent pieces.${tail}`, type: "feature", category: fe ? "Retail Admin" : "Backend / Infrastructure", effort: "large", priority: "medium" });
    }
  }
  out.push({ kind: "e2e", title: `Write the full end-to-end test suite for ${proj}`, desc: `## Outcome\nA full end-to-end test suite covering every requirement in ${folder}/REQUIREMENTS.md (happy paths and the main failure paths), runnable in CI, living under ${folder}/.${tail}`, type: "feature", category: "Backend / Infrastructure", effort: "large", priority: "medium" });
  out.push({ kind: "doc", title: `Write the README for ${proj}`, desc: `## Outcome\nCreate ${folder}/README.md (what is in the folder, what each file does, how to run it, where the spec lives) and ${folder}/board-docs.json so the board mirrors it. This ticket also creates the repo folder if the build tickets have not yet.${tail}`, type: "feature", category: "Backend / Infrastructure", effort: "small", priority: "medium" });
  out.push({ kind: "doc", title: `Write the specs and Requirements for ${proj}`, desc: `## Outcome\nTurn the concept's Requirements into the full spec at ${folder}/REQUIREMENTS.md: acceptance criteria per requirement, data model, interfaces with other projects.${tail}`, type: "feature", category: "Backend / Infrastructure", effort: "medium", priority: "medium" });
  for (const d of Array.isArray(documents) ? documents : []) {
    const dn = String((d && d.name) || "").trim();
    if (!dn) continue;
    out.push({ kind: "doc", title: `Write the project document: ${dn}`.slice(0, 120), desc: `## Outcome\nBring the project document "${dn}" (carried over from the concept) up to date and complete, as a file under ${folder}/docs/ declared in ${folder}/board-docs.json.${tail}`, type: "feature", category: "Backend / Infrastructure", effort: "small", priority: "low" });
  }
  return out;
}

export { slugifyFolder, pickRepoFolder, planPromotionTickets, requirementLines, sideOf };
