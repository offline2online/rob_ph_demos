// Groom Backlog -> deploy packages. Plain ESM, no Firebase, no DOM, so the
// browser (public/js/app.js) and the tests import the same code; the Cloud
// Function side lives in functions/package-queue.js.
//
// A package is a batch of Backlog tickets built together. Rules (ticket
// 4rc1t7zXf5o8q8BUTbQ5):
//   - every ticket gets a complexity (small / medium / large);
//   - packages are sized by a complexity BUDGET (points), never a ticket count;
//   - tickets touching the same area are never split across packages, even if
//     that stretches the budget.

export const COMPLEXITY_POINTS = { small: 1, medium: 3, large: 6 };
export const DEFAULT_GROOM_THRESHOLD = 5;
export const DEFAULT_PACKAGE_BUDGET = 10;

const RISK_WORDS = /\b(migration|schema|firestore rules?|security|auth(?:entication|orisation|orization)?|permission|refactor|rewrite|pipeline|cloud function|data model|payment|billing|delete|backfill)\b/gi;
const PATH_LIKE = /[\w.-]+\/[\w./-]+\.\w{1,5}\b/g;

// The groom session may write `groomComplexity` itself; that wins. Otherwise a
// text heuristic: how much is being asked for, and how risky the words are.
export function scoreComplexity(item) {
  const given = String((item && item.groomComplexity) || "").toLowerCase();
  if (COMPLEXITY_POINTS[given]) return { size: given, points: COMPLEXITY_POINTS[given], source: "groom" };
  const text = `${(item && item.title) || ""}\n${(item && item.desc) || ""}`;
  const bullets = (text.match(/^\s*(?:[-*]|\d+\.)\s+/gm) || []).length;
  const risk = new Set((text.match(RISK_WORDS) || []).map((w) => w.toLowerCase())).size;
  const files = new Set(text.match(PATH_LIKE) || []).size;
  let score = Math.min(text.length / 600, 3) + Math.min(bullets / 4, 2) + risk * 1.2 + Math.min(files, 3) * 0.6;
  if (item && item.type === "bug") score -= 0.5;
  const size = score >= 4 ? "large" : score >= 1.8 ? "medium" : "small";
  return { size, points: COMPLEXITY_POINTS[size], source: "heuristic" };
}

// Areas a ticket touches: the groom session's `groomAreas` (code areas such as
// "backlog-tracker/public"), else the card's category.
export function areasOf(item) {
  const given = Array.isArray(item && item.groomAreas) ? item.groomAreas.map((a) => String(a).trim().toLowerCase()).filter(Boolean) : [];
  if (given.length) return [...new Set(given)];
  return [String((item && item.category) || "Uncategorised").trim().toLowerCase() || "uncategorised"];
}

// Tickets that share any area end up in one cluster (union-find).
function clusterByArea(items) {
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map();
  items.forEach((item, i) => {
    for (const a of areasOf(item)) {
      if (owner.has(a)) parent[find(i)] = find(owner.get(a));
      else owner.set(a, i);
    }
  });
  const clusters = new Map();
  items.forEach((item, i) => {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(item);
  });
  return [...clusters.values()];
}

// Packs area clusters into packages by first-fit-decreasing on points. A
// cluster bigger than the budget gets a package to itself, whole.
export function packageBacklog(items, { budget = DEFAULT_PACKAGE_BUDGET } = {}) {
  const cap = Math.max(1, Number(budget) || DEFAULT_PACKAGE_BUDGET);
  const clusters = clusterByArea(items || []).map((members) => {
    const scored = members.map((item) => ({ item, ...scoreComplexity(item) }));
    return { scored, points: scored.reduce((n, s) => n + s.points, 0), areas: [...new Set(members.flatMap(areasOf))] };
  }).sort((a, b) => b.points - a.points || a.scored[0].item.id.localeCompare(b.scored[0].item.id));

  const bins = [];
  for (const c of clusters) {
    const bin = bins.find((b) => b.points + c.points <= cap);
    if (bin) { bin.clusters.push(c); bin.points += c.points; }
    else bins.push({ clusters: [c], points: c.points });
  }
  return bins.map((bin, n) => {
    const scored = bin.clusters.flatMap((c) => c.scored);
    const itemIds = scored.map((s) => s.item.id).sort();
    return {
      id: `pkg-${itemIds[0]}`,
      name: `Package ${n + 1}`,
      itemIds,
      points: bin.points,
      overBudget: bin.points > cap,
      areas: [...new Set(bin.clusters.flatMap((c) => c.areas))],
      sizes: Object.fromEntries(scored.map((s) => [s.item.id, s.size])),
      counts: { small: scored.filter((s) => s.size === "small").length, medium: scored.filter((s) => s.size === "medium").length, large: scored.filter((s) => s.size === "large").length },
    };
  });
}

// "Groom Backlog" shows only when the Backlog is bigger than the threshold.
export function groomButtonVisible(groomableCount, threshold) {
  const t = Number.isFinite(Number(threshold)) && threshold !== null && threshold !== "" ? Number(threshold) : DEFAULT_GROOM_THRESHOLD;
  return groomableCount > Math.max(0, t);
}
