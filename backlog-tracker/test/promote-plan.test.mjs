// node test/promote-plan.test.mjs — the pure planner behind one-click Promote.
import assert from "node:assert";
import { slugifyFolder, pickRepoFolder } from "../public/js/promote-plan.js";

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
test("the planner no longer exists: promotion raises no tickets", async () => {
  const mod = await import("../public/js/promote-plan.js");
  assert.strictEqual(mod.planPromotionTickets, undefined);
});
console.log(`${n} passed`);
