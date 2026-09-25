// Pure, dependency-free clustering for "Cluster fed-in requirements into
// build batches" (z1Q6fxo0yTjamxVMWQK5) — groups a set of Backlog items
// into suggested build batches a human can review before sending any of
// them to Ready for Dev. Builds on the existing grooming flow's `category`
// classification (the board's own proxy for "shared area/files" — see root
// CLAUDE.md's "Every card carries a category") and adds a rough per-item
// effort estimate as a second, orthogonal signal, so a batch's items can
// also be seen ordered small-to-large within their shared area.
//
// No Firebase, no DOM: testable with plain node
// (test/build-batches.test.mjs), same reasoning as functions/train-lock.js's
// own pure-logic split — imported as-is by public/js/app.js (the Feed in
// requirements modal) and by that test file.

const EFFORT_KEYWORDS_LARGE = [
  "redesign", "rewrite", "overhaul", "rearchitect", "re-architect", "migrate",
  "migration", "restructure", "rebuild", "from scratch",
];
const EFFORT_KEYWORDS_SMALL = [
  "typo", "rename", "wording", "one-line", "one liner", "small tweak", "tweak",
  "color", "colour", "label",
];

// A rough, local, good-enough-not-final-answer estimate (same spirit as
// app.js's own suggestCategory()/generateTitle()) — never shown as if it
// were a real estimate, just a sort key and a hint.
function estimateEffort(item) {
  const text = `${item.title || ""} ${item.desc || ""}`.toLowerCase();
  if (EFFORT_KEYWORDS_LARGE.some((w) => text.includes(w))) return "large";
  if (text.length > 900) return "large";
  if (EFFORT_KEYWORDS_SMALL.some((w) => text.includes(w)) && text.length < 400) return "small";
  if (text.length < 250) return "small";
  return "medium";
}

const EFFORT_ORDER = { small: 0, medium: 1, large: 2 };

// Priority signal (cwehxSMZv8noJQv5kB22) — the second, orthogonal axis this
// clustering flow was missing: effort alone says how big a batch's items
// are, not which of them actually matter more. Same "rough local guess,
// never a real answer" spirit as estimateEffort — a real `item.priority`
// set on the card (Edit item modal) always wins; this only fills the gap
// for a freshly fed-in requirement that hasn't been given one yet.
const PRIORITY_KEYWORDS_HIGH = [
  "urgent", "asap", "blocking", "blocker", "critical", "broken", "down",
  "can't", "cannot", "outage", "security", "data loss", "losing data",
];
const PRIORITY_KEYWORDS_LOW = [
  "nice to have", "minor", "cosmetic", "eventually", "someday", "low priority",
  "when there's time", "not urgent",
];
function estimatePriority(item) {
  const text = `${item.title || ""} ${item.desc || ""}`.toLowerCase();
  if (PRIORITY_KEYWORDS_HIGH.some((w) => text.includes(w))) return "high";
  if (PRIORITY_KEYWORDS_LOW.some((w) => text.includes(w))) return "low";
  return "medium";
}
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

// Groups items by `category` — the closest signal this data model already
// has to "shared files/areas/dependencies", since CATEGORIES is exactly
// what the board uses to mean that (see root CLAUDE.md and the Archived
// page's own Area column/filter). A batch of one item is still returned as
// its own batch, not filtered out — this function only groups what looks
// related; a human decides whether a lone item ships alone or waits.
//
// Returns { batches: [{ category, items, count, effortCounts, priorityCounts }, ...] },
// largest batch first (ties broken alphabetically by category) — the
// batches most worth sending together as one bunch surface first. Within a
// batch, items are ordered highest-priority first, then smallest-effort
// first within the same priority — the two signals together are what the
// ticket this exists for (cwehxSMZv8noJQv5kB22) asked to sort/batch on.
function clusterBacklogItems(items) {
  const list = Array.isArray(items) ? items : [];
  const byCategory = new Map();
  for (const item of list) {
    const category = item.category || "Uncategorised";
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(Object.assign({}, item, {
      effort: item.effort || estimateEffort(item),
      priority: item.priority || estimatePriority(item),
    }));
  }
  const batches = Array.from(byCategory.entries()).map(([category, batchItems]) => {
    const sorted = batchItems.slice().sort((a, b) =>
      (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) ||
      (EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort]) ||
      String(a.title || "").localeCompare(String(b.title || "")));
    const effortCounts = { small: 0, medium: 0, large: 0 };
    const priorityCounts = { high: 0, medium: 0, low: 0 };
    sorted.forEach((i) => {
      effortCounts[i.effort] = (effortCounts[i.effort] || 0) + 1;
      priorityCounts[i.priority] = (priorityCounts[i.priority] || 0) + 1;
    });
    return { category, items: sorted, count: sorted.length, effortCounts, priorityCounts };
  });
  batches.sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  return { batches };
}

// Splits a block of freeform pasted text into individual requirements —
// one per non-empty line, except that consecutive non-empty lines with no
// blank line between them are treated as one multi-line requirement (so a
// requirement can still wrap across a couple of lines without becoming
// several separate items). Leading list markers ("-", "*", "1.") are
// stripped since they're formatting, not content.
function splitRequirementsText(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let current = [];
  const flush = () => {
    if (current.length) { blocks.push(current.join(" ").trim()); current = []; }
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { flush(); continue; }
    current.push(line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, ""));
  }
  flush();
  return blocks.filter(Boolean);
}

export { clusterBacklogItems, estimateEffort, estimatePriority, splitRequirementsText };
