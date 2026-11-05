// Pure rules of the Permissions matrix (public/js/permissions.js).
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { SECTION_KEYS, effectiveLevels, storedLevel, roleLevels, setLevel, canView, canEdit, canAdmin, sectionForHash, firstAllowedSection, permissionCss, isAdminRole, PERMISSION_GROUPS, sectionForSettingsPage, SECTIONS, discoverNavSections } from "../public/js/permissions.js";

assert.deepStrictEqual(SECTION_KEYS, ["agent-board", "staff-kanban", "concepts", "whiteboard", "promote", "promote-leads", "faq", "settings", "user-management", "releases", "skills", "project-docs"]);

const engineer = { id: "e", name: "Engineer", permissions: { concepts: "none", faq: "view" } };
const lv = effectiveLevels("editor", engineer);
assert.strictEqual(lv.concepts, "none");
assert.strictEqual(lv.faq, "view");
assert.strictEqual(lv.skills, "edit", "unset sections default to edit");
assert.strictEqual(lv["user-management"], "none");
assert.ok(!canView(lv, "concepts") && canView(lv, "faq") && !canEdit(lv, "faq") && canEdit(lv, "skills") && !canAdmin(lv, "skills"));

// no assigned role: unrestricted, except User Management for non-admins
assert.strictEqual(canView(effectiveLevels("editor", null), "concepts"), true);
assert.strictEqual(canView(effectiveLevels("editor", null), "user-management"), false);
assert.strictEqual(canAdmin(effectiveLevels("admin", null), "user-management"), true);
assert.strictEqual(canView(null, "concepts"), true, "levels not loaded yet = unrestricted");

// an admin can never lock themselves out of User Management
const locked = { id: "p", name: "Product", permissions: { "user-management": "none", concepts: "none" } };
assert.strictEqual(effectiveLevels("admin", locked)["user-management"], "admin");
assert.strictEqual(effectiveLevels("admin", locked).concepts, "none", "other sections still follow the role");
// the Admin role is always full access and cannot be edited
const adminRole = { id: "a", name: " admin ", permissions: { concepts: "none" } };
assert.ok(isAdminRole(adminRole));
assert.ok(Object.values(roleLevels(adminRole)).every((l) => l === "admin"));
assert.throws(() => setLevel(adminRole, "concepts", "none"));
// a fixed viewer never exceeds View
assert.strictEqual(effectiveLevels("viewer", { name: "X", permissions: { faq: "admin" } }).faq, "view");

const changed = setLevel(engineer, "concepts", "view");
assert.strictEqual(changed.concepts, "view");
assert.strictEqual(changed.faq, "view", "other cells keep their value");
assert.throws(() => setLevel(engineer, "nope", "view"));
assert.throws(() => setLevel(engineer, "concepts", "owner"));

assert.strictEqual(sectionForHash(""), "agent-board");
assert.strictEqual(sectionForHash("#concept-incubator"), "concepts");
assert.strictEqual(sectionForHash("#concept-abc"), "concepts");
assert.strictEqual(sectionForHash("#promote/brand-guidelines"), "promote");
assert.strictEqual(sectionForHash("#faq-article/x"), "faq");
assert.strictEqual(sectionForHash("#docs/p1?interface=2"), "project-docs");
assert.strictEqual(sectionForHash("#user-management/permissions"), "user-management");
assert.strictEqual(sectionForHash("#settings/user-management/roles/r1"), "user-management");
assert.strictEqual(sectionForSettingsPage("user-management"), "user-management");
assert.strictEqual(sectionForHash("#settings/releases"), "settings");
assert.strictEqual(sectionForHash("#whatever"), null);
assert.strictEqual(firstAllowedSection({ ...Object.fromEntries(SECTION_KEYS.map((k) => [k, "none"])), faq: "view" }), "faq");

const css = permissionCss(lv);
assert.ok(css.includes("#concept-incubator-btn{display:none"), "Concepts nav is hidden");
assert.ok(css.includes("#fa-new-article-btn"), "FAQ edit controls are hidden at View");
assert.ok(!css.includes("#skills-add-btn"), "Skills stays editable");
assert.strictEqual(permissionCss(null), "");

// The role page groups every section exactly once, in the sidebar's order.
assert.deepStrictEqual(PERMISSION_GROUPS.map((g) => g.label), ["Build", "Promote", "Support", "Settings", "Other"]);
assert.deepStrictEqual(PERMISSION_GROUPS.flatMap((g) => g.keys).sort(), [...SECTION_KEYS].sort());
assert.strictEqual(storedLevel(null, "faq"), "edit");

// Leads inherits the old single Promote grant; an explicit Leads entry wins.
assert.strictEqual(storedLevel({ name: "Old", permissions: { promote: "view" } }, "promote-leads"), "view");
assert.strictEqual(storedLevel({ name: "Old", permissions: { promote: "view" } }, "promote"), "view");
assert.strictEqual(storedLevel({ name: "New", permissions: { promote: "view", "promote-leads": "none" } }, "promote-leads"), "none");
assert.strictEqual(sectionForHash("#promote/leads"), "promote-leads");
assert.ok(permissionCss(effectiveLevels("editor", { name: "N", permissions: { "promote-leads": "none" } })).includes("#promote-leads-btn{display:none"));
assert.ok(!permissionCss(effectiveLevels("editor", { name: "N", permissions: { "promote-leads": "none" } })).includes("#promote-brand-btn{display:none"), "Brand Guidelines stays");

// The menu and Roles cannot drift: every sidebar button in index.html is owned
// by a section, with the sidebar's own name, group and order.
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const nav = html.slice(html.indexOf('id="nav-drawer"'), html.indexOf("</nav>", html.indexOf('id="nav-drawer"')));
const menu = [];
for (const g of nav.split('class="nav-group"').slice(1)) {
  const group = /class="nav-drawer-section"[^>]*>([^<]+)</.exec(g)[1].trim();
  for (const m of g.matchAll(/<button[^>]*class="nav-drawer-item[^"]*"[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)) {
    menu.push({ id: m[1], group, label: m[2].replace(/<span[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, "").trim() });
  }
}
menu.splice(0, menu.length, ...menu.filter((m) => m.id !== "cmdk-open-btn")); // Search is not a page
assert.ok(menu.length >= 8, "found the sidebar buttons");
const byNav = (id) => SECTIONS.find((s) => s.nav.includes("#" + id));
let last = -1;
for (const it of menu) {
  const sec = byNav(it.id);
  assert.ok(sec, `sidebar button #${it.id} has a permission section`);
  assert.strictEqual(sec.label, it.label, `#${it.id} is named as in the menu`);
  assert.strictEqual(PERMISSION_GROUPS.find((g) => g.keys.includes(sec.key)).label, it.group, `${it.label} sits in the ${it.group} group`);
}
for (const g of ["Build", "Promote", "Support"]) {
  assert.deepStrictEqual(PERMISSION_GROUPS.find((x) => x.label === g).keys.map((k) => SECTIONS.find((s) => s.key === k).nav[0]), menu.filter((m) => m.group === g).map((m) => "#" + m.id), `${g} is in menu order`);
}
assert.deepStrictEqual(SECTIONS.filter((s) => s.nav[0] && s.nav[0].startsWith("[data-settings-page")).map((s) => s.label), ["Settings > User Management", "Releases", "Skills & phase bindings"]);

// A new menu item shows up in Roles automatically, and a role's grant for its
// siblings carries to it until someone sets it.
const added = discoverNavSections([...menu, { id: "promote-prospects-btn", label: "Prospects (TAM)", group: "Promote" }, { id: "cmdk-open-btn", label: "Search", group: "" }]);
assert.deepStrictEqual(added, ["promote-prospects"]);
assert.ok(SECTION_KEYS.includes("promote-prospects") && PERMISSION_GROUPS.find((g) => g.label === "Promote").keys.at(-1) === "promote-prospects");
assert.strictEqual(sectionForHash("#promote/prospects"), "promote-prospects");
assert.strictEqual(storedLevel({ name: "Old", permissions: { promote: "view" } }, "promote-prospects"), "view");
assert.deepStrictEqual(discoverNavSections(menu), [], "nothing is added twice");
assert.deepStrictEqual(PERMISSION_GROUPS.flatMap((g) => g.keys).sort(), [...SECTION_KEYS].sort());
console.log("permissions: ok");
