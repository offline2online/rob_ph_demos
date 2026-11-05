// Pure rules of the Permissions matrix (public/js/permissions.js).
import assert from "node:assert";
import { SECTION_KEYS, effectiveLevels, storedLevel, roleLevels, setLevel, canView, canEdit, canAdmin, sectionForHash, firstAllowedSection, permissionCss, isAdminRole, PERMISSION_GROUPS, sectionForSettingsPage, SECTIONS } from "../public/js/permissions.js";

assert.deepStrictEqual(SECTION_KEYS, ["agent-board", "staff-kanban", "concepts", "promote", "prospects", "faq", "skills", "releases", "project-docs", "settings", "user-management"]);

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
assert.strictEqual(sectionForHash("#promote/leads"), "promote");
assert.strictEqual(sectionForHash("#promote/prospects"), "prospects", "Prospects (TAM) has its own permission section");
assert.strictEqual(sectionForHash("#faq-article/x"), "faq");
{
  // Removing Prospects from a role hides its nav entry and blocks the route; Leads is untouched.
  const noTam = effectiveLevels("editor", { name: "Sales", permissions: { prospects: "none" } });
  assert.ok(!canView(noTam, "prospects") && canView(noTam, "promote"));
  const hidden = permissionCss(noTam);
  assert.ok(hidden.includes("#promote-prospects-btn{display:none"), "the Prospects nav entry is hidden");
  assert.ok(!hidden.includes("#promote-leads-btn{display:none"), "Leads stays visible");
  const viewOnly = permissionCss(effectiveLevels("editor", { name: "Sales", permissions: { prospects: "view" } }));
  assert.ok(viewOnly.includes("#prospects-grid [data-editor-only]"), "Convert to lead is removed at View");
  assert.ok(!viewOnly.includes("#promote-prospects-btn{display:none"));
  assert.strictEqual(canView(effectiveLevels("editor", { name: "Old", permissions: {} }), "prospects"), true, "roles saved before this keep access");
}
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

// The role page groups every section exactly once: Build, Support, Settings.
assert.deepStrictEqual(PERMISSION_GROUPS.map((g) => g.label), ["Build", "Support", "Settings"]);
assert.deepStrictEqual(PERMISSION_GROUPS.flatMap((g) => g.keys).sort(), [...SECTION_KEYS].sort());
assert.strictEqual(storedLevel(null, "faq"), "edit");
console.log("permissions: ok");
