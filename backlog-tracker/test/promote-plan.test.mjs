// node test/promote-plan.test.mjs — the pure planner behind one-click Promote.
import assert from "node:assert";
import { slugifyFolder, pickRepoFolder, planPromotionTickets } from "../public/js/promote-plan.js";

let n = 0;
function test(name, fn) { fn(); n += 1; console.log(`  ok  ${name}`); }

test("slugifyFolder", () => {
  assert.strictEqual(slugifyFolder("Loyalty App!"), "loyalty-app");
  assert.strictEqual(slugifyFolder("Café & Bar"), "cafe-and-bar");
  assert.strictEqual(slugifyFolder("!!!"), "new-project");
});
test("pickRepoFolder avoids taken names", () => {
  assert.strictEqual(pickRepoFolder("Loyalty App", ["faq"]), "loyalty-app");
  assert.strictEqual(pickRepoFolder("Loyalty App", ["Loyalty-App", "loyalty-app-2"]), "loyalty-app-3");
});
test("name-only concept still gets FE, BE, E2E and doc tickets", () => {
  const t = planPromotionTickets({ name: "Test", folder: "test", requirementsMd: "", readmeMd: "" });
  const kinds = t.map((x) => x.kind);
  for (const k of ["frontend", "backend", "e2e", "doc"]) assert.ok(kinds.includes(k), k);
  assert.strictEqual(t.filter((x) => x.kind === "doc").length, 2);
});
test("requirements split into FE and BE tickets, per-document tickets added", () => {
  const md = "# Reqs\n\n- The admin page shows a table of stores with a filter.\n- The API stores each visit in the database and exposes an endpoint.\n- Staff can upload a menu and the service syncs it.\n";
  const t = planPromotionTickets({ name: "X", folder: "x", requirementsMd: md, documents: [{ name: "Runbook" }] });
  assert.ok(t.some((x) => x.kind === "frontend" && /table of stores/.test(x.desc)));
  assert.ok(t.some((x) => x.kind === "backend" && /endpoint/.test(x.desc)));
  assert.ok(t.some((x) => x.title.includes("Runbook")));
  assert.ok(t.every((x) => x.desc.includes("## Outcome") && x.title.length <= 140));
});
console.log(`${n} passed`);
