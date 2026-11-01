// Settings section of the console: the sub-menu, its routes and the row
// builders for each page's grid. Pure functions only (no DOM, no Firestore),
// so test/settings-section.test.mjs can drive them; app.js owns the rendering.

export const SETTINGS_PAGES = [
  { key: "projects", label: "Projects", icon: "folder" },
  { key: "releases", label: "Releases", icon: "rocket_launch" },
  { key: "skills", label: "Skills & phase bindings", icon: "psychology" },
  { key: "automations", label: "Automations", icon: "bolt" },
  { key: "integrations", label: "Integrations & MCP", icon: "api" },
];
export const DEFAULT_SETTINGS_PAGE = "projects";

// "#settings" and "#settings/<page>" -> the page key, or null when the hash
// is not a Settings route. An unknown sub-page falls back to the first one.
export function settingsPageFromHash(hash) {
  const h = String(hash || "").split("?")[0];
  if (h === "#settings") return DEFAULT_SETTINGS_PAGE;
  if (!h.startsWith("#settings/")) return null;
  const key = h.slice("#settings/".length);
  return SETTINGS_PAGES.some((p) => p.key === key) ? key : DEFAULT_SETTINGS_PAGE;
}
export function settingsHash(key) { return `#settings/${key}`; }

const dateText = (v) => {
  if (!v) return "";
  try {
    const d = typeof v.toDate === "function" ? v.toDate() : new Date(v);
    return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
  } catch { return ""; }
};

export function projectRows(projects, { typeOf = () => "" } = {}) {
  return (projects || []).filter((p) => !p.archived).map((p) => ({
    id: p.id,
    name: p.name || "(untitled)",
    description: p.description || "",
    type: typeOf(p) || "Unassigned",
    repoFolder: p.repoFolder ? `${p.repoFolder}/` : "",
    repoNote: p.repoFolderNotApplicable ? "No single folder" : "",
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function releaseRows(releases, projects, { compare } = {}) {
  const list = (releases || []).slice();
  if (compare) list.sort(compare);
  return list.map((r) => ({
    id: r.id,
    version: r.version || "",
    name: r.name || "(untitled)",
    created: dateText(r.createdAt),
    madeLive: dateText(r.madeLiveAt),
    status: r.status === "live" ? "Live" : "Planned",
    projectCount: (projects || []).filter((p) => p.releaseId === r.id && !p.archived).length,
  }));
}

export function skillRows(skills) {
  return (skills || []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))).map((s) => ({
    id: s.id,
    name: s.name || "",
    slug: s.slug || "",
    summary: s.summary || "",
    version: s.version ? `v${s.version}` : "",
    files: Array.isArray(s.files) ? s.files.length : 0,
    team: s.owningTeam || "",
  }));
}

// settings/phaseSkillBindings is { build: slug[], deploy: slug[] }; one row per
// bound skill and phase, with the skill's name when the library has it.
export function bindingRows(bindings, skills) {
  const out = [];
  for (const [phase, label] of [["build", "Build"], ["deploy", "Deploy"]]) {
    const slugs = bindings && Array.isArray(bindings[phase]) ? bindings[phase] : [];
    for (const slug of slugs) {
      const s = (skills || []).find((x) => x.slug === slug);
      out.push({ id: `${phase}:${slug}`, phase: label, slug, name: s ? s.name : "Not in the library yet", found: !!s });
    }
  }
  return out;
}

export function boundSkillsText(bindings, phase) {
  const slugs = bindings && Array.isArray(bindings[phase]) ? bindings[phase] : [];
  return slugs.length ? slugs.join(", ") : "None";
}

// The four automations behind the board's buttons. `phase` names the binding
// list whose skills they run with ("" when none apply).
export function automationRows(bindings) {
  return [
    { id: "notify", name: "Notify Claude", trigger: "Ready for Dev on a project's Backlog", does: "Starts one build session per ticket, which investigates and packages the change.", phase: "build" },
    { id: "groom", name: "Groom Backlog", trigger: "Groom Backlog on a project's Backlog", does: "Classifies and summarises Backlog tickets without writing any code.", phase: "" },
    { id: "review", name: "Batch review", trigger: "A build batch lands", does: "Reviews the batch's code and docs before it reaches testing.", phase: "" },
    { id: "e2e", name: "Run E2E", trigger: "Run E2E on a project", does: "Runs the project's end-to-end test steps and reports the result.", phase: "" },
  ].map((a) => ({
    ...a,
    skills: a.phase ? boundSkillsText(bindings, a.phase) : "None",
    binding: "Shared automation",
  }));
}
