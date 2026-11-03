// Pure planning for the one-click "Promote to project": which repo folder a
// concept's project gets (no tickets are raised on promotion). No
// Firebase, no DOM — imported by public/js/app.js (promoteConceptToProject)
// and by test/promote-plan.test.mjs.


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

export { slugifyFolder, pickRepoFolder };
