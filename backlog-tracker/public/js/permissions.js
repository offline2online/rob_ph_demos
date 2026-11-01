// User Management → Permissions: which console sections each role may view,
// edit or administer, and how that is enforced in the console's own UI.
//
// Pure functions only (no DOM, no Firestore) so test/permissions.test.mjs can
// drive them; app.js owns the roles/consoleUsers listeners and the rendering.
//
// Storage: `roles/{id}.permissions` = { <sectionKey>: "none"|"view"|"edit"|"admin" }.
// A role with no `permissions` map gets DEFAULT_LEVEL everywhere except User
// Management, so roles created before this existed keep working.
//
// This is console UI enforcement (nav hidden, route blocked, edit controls
// removed). firestore.rules still gate data by the fixed admin/editor/viewer
// console role, not per section.

export const LEVELS = ["none", "view", "edit", "admin"];
export const LEVEL_LABELS = { none: "No access", view: "View", edit: "Edit", admin: "Admin" };
const RANK = { none: 0, view: 1, edit: 2, admin: 3 };

// `nav` is the sidebar button (or buttons) the section owns; `edit` lists the
// controls that mutate data and disappear below Edit access.
export const SECTIONS = [
  { key: "agent-board", label: "Agent board", nav: ["#nav-ph-console-btn"],
    edit: ["#new-project-btn", ".new-item-btn", ".project-rename-btn", ".card-move", ".card-select-cb"] },
  { key: "staff-kanban", label: "Staff Kanban", nav: ["#staff-kanban-btn"], edit: [] },
  { key: "concepts", label: "Concepts", nav: ["#concept-incubator-btn"],
    edit: ["#concept-add-btn", "#concept-incubator-page [data-editor-only]", "#concept-detail-page [data-editor-only]", "#concept-description-save"] },
  { key: "faq", label: "FAQ management", nav: ["#faq-articles-btn"],
    edit: ["#fa-new-article-btn", "#faq-new-category-btn", "#fa-save-draft", "#fa-analytics-tag-save", "#faq-cat-edit-save-btn"] },
  { key: "skills", label: "Skills", nav: ['[data-settings-page="skills"]'], edit: ["#skills-add-btn", "#skills-page [data-editor-only]", "#skill-add-file-btn"] },
  { key: "releases", label: "Releases", nav: ['[data-settings-page="releases"]'], edit: ["#releases-add-btn", ".release-mark-live-btn", "#release-editor-save"] },
  { key: "project-docs", label: "Project docs", nav: [],
    edit: ["#docs-description-save", "#docs-repo-folder-save", "#docs-readme-save", "#docs-requirements-save", "#docs-add-doc-btn", "#docs-routine-prompt-save", "#docs-add-interface-btn"] },
  { key: "settings", label: "Settings", nav: ["#faq-settings-btn"], edit: ["#faq-settings-page .btn-primary"] },
  { key: "user-management", label: "User Management", nav: ['[data-nav-group="user-management"]'],
    edit: ["#team-add-open", "#roles-create", ".role-actions", "#um-bulk", ".um-manage"] },
];
export const SECTION_KEYS = SECTIONS.map((s) => s.key);
export const DEFAULT_LEVEL = "edit";
export const LOCKED_SECTION = "user-management"; // an admin can never lose this

const isAdminRoleName = (n) => String(n || "").trim().toLowerCase() === "admin";
export const isAdminRole = (role) => !!role && isAdminRoleName(role.name);

export function validLevel(v) { return LEVELS.includes(v); }

// The stored level for one section, with defaults applied. Never throws.
export function storedLevel(role, key) {
  if (isAdminRole(role)) return "admin";
  const p = role && role.permissions;
  if (p && validLevel(p[key])) return p[key];
  return key === LOCKED_SECTION ? "none" : DEFAULT_LEVEL;
}

// Every section's level for a role (what the matrix shows).
export function roleLevels(role) {
  const out = {};
  for (const k of SECTION_KEYS) out[k] = storedLevel(role, k);
  return out;
}

// What the signed-in person gets. `consoleRole` is the fixed admin/editor/
// viewer; `role` is their assigned role doc (or null). Rules, in order:
//  - no assigned role: unrestricted, as before roles existed;
//  - the fixed `admin` console role always keeps User Management;
//  - the fixed `viewer` console role never exceeds View;
export function effectiveLevels(consoleRole, role) {
  const out = {};
  for (const k of SECTION_KEYS) {
    let l = role ? storedLevel(role, k) : (consoleRole === "admin" || k !== LOCKED_SECTION ? "admin" : "none");
    if (k === LOCKED_SECTION && consoleRole === "admin") l = "admin";
    if (consoleRole === "viewer" && RANK[l] > RANK.view) l = "view";
    out[k] = l;
  }
  return out;
}

export const canView = (levels, key) => !levels || RANK[levels[key]] >= RANK.view;
export const canEdit = (levels, key) => !levels || RANK[levels[key]] >= RANK.edit;
export const canAdmin = (levels, key) => !levels || RANK[levels[key]] >= RANK.admin;

// Return a copy of `permissions` with one cell changed. The Admin role and the
// User Management column of an Admin role cannot be lowered.
export function setLevel(role, key, level) {
  if (!SECTION_KEYS.includes(key) || !validLevel(level)) throw new Error("Unknown section or level.");
  if (isAdminRole(role)) throw new Error("The Admin role always has full access.");
  return Object.assign(roleLevels(role), { [key]: level });
}

// The first section a person can open, for redirecting away from a blocked one.
export function firstAllowedSection(levels) {
  return SECTION_KEYS.find((k) => canView(levels, k)) || null;
}

// URL hash → section key. "" (the board) is agent-board; unknown hashes are
// not a section and are never blocked.
export function sectionForHash(hash) {
  const h = String(hash || "").split("?")[0];
  if (h === "" || h === "#") return "agent-board";
  if (h === "#faq-management" || h.startsWith("#faq-article")) return "faq";
  if (h === "#skills") return "skills";
  if (h === "#releases") return "releases";
  if (h === "#concept-incubator" || h.startsWith("#concept-")) return "concepts";
  if (h.startsWith("#docs/")) return "project-docs";
  if (h === "#staff-kanban" || h.startsWith("#staff-kanban/")) return "staff-kanban";
  if (h.startsWith("#user-management")) return "user-management";
  if (h === "#settings" || h.startsWith("#settings/")) return "settings";
  return null;
}

// The hash a section opens at, for the redirect.
export const SECTION_HASH = {
  "agent-board": "", "staff-kanban": "#staff-kanban", concepts: "#concept-incubator", faq: "#faq-management",
  skills: "#settings/skills", releases: "#settings/releases", "project-docs": "", settings: "#settings",
  "user-management": "#user-management/users",
};

// A settings sub-page also needs the section it shows (Releases, Skills).
export function sectionForSettingsPage(page) {
  return page === "releases" ? "releases" : page === "skills" ? "skills" : "settings";
}

// Stylesheet text that hides what the levels remove. Selectors come only from
// SECTIONS above, never from user input.
export function permissionCss(levels) {
  if (!levels) return "";
  const rules = [];
  for (const s of SECTIONS) {
    if (!canView(levels, s.key) && s.nav.length) rules.push(`${s.nav.join(",")}{display:none !important}`);
    if (!canEdit(levels, s.key) && s.edit.length) rules.push(`${s.edit.join(",")}{display:none !important}`);
  }
  if (!canEdit(levels, "user-management")) rules.push(".um-role-select{pointer-events:none;opacity:.6}");
  return rules.join("\n");
}

// Rows for the matrix grid: one per section, a column per role.
export function matrixRows(roles) {
  const sorted = (roles || []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  return SECTIONS.map((s) => {
    const row = { key: s.key, section: s.label };
    for (const r of sorted) row[`r:${r.id}`] = storedLevel(r, s.key);
    return row;
  });
}
