// Run with:  node test/groom-packages.test.mjs
import assert from "node:assert";
import { scoreComplexity, packageBacklog, groomButtonVisible, areasOf } from "../public/js/groom-packages.js";

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}
const mk = (id, category, size) => ({ id, title: id, desc: "d", category, groomComplexity: size });

test("button hidden at/below threshold, shown above", () => {
  assert.strictEqual(groomButtonVisible(5, 5), false);
  assert.strictEqual(groomButtonVisible(6, 5), true);
  assert.strictEqual(groomButtonVisible(4, 3), true);
  assert.strictEqual(groomButtonVisible(6, undefined), true);
  assert.strictEqual(groomButtonVisible(5, undefined), false);
});

test("groom-written complexity wins; heuristic grades size", () => {
  assert.strictEqual(scoreComplexity({ groomComplexity: "large" }).size, "large");
  assert.strictEqual(scoreComplexity({ title: "Typo", desc: "Fix typo", type: "bug" }).size, "small");
  const big = { title: "Rewrite sync", desc: "Refactor the data model and migration for auth.\n- one\n- two\n- three\nTouches a/b/c.js and d/e/f.js", type: "feature" };
  assert.notStrictEqual(scoreComplexity(big).size, "small");
});

test("sized by budget, not ticket count", () => {
  const smalls = Array.from({ length: 8 }, (_, i) => mk(`s${i}`, `area${i}`, "small"));
  const pk = packageBacklog(smalls, { budget: 10 });
  assert.strictEqual(pk.length, 1);
  const larges = Array.from({ length: 4 }, (_, i) => mk(`l${i}`, `area${i}`, "large"));
  const pl = packageBacklog(larges, { budget: 10 });
  assert.strictEqual(pl.length, 4);
  assert.ok(pl.every((p) => p.points <= 10));
});

test("same-area tickets stay together even over budget", () => {
  const items = [mk("a", "HQ Admin", "large"), mk("b", "HQ Admin", "large"), mk("c", "Menu Board", "small")];
  const pk = packageBacklog(items, { budget: 6 });
  const hq = pk.find((p) => p.itemIds.includes("a"));
  assert.ok(hq.itemIds.includes("b"));
  assert.strictEqual(hq.overBudget, true);
  assert.ok(!hq.itemIds.includes("c"));
});

test("a ticket spanning two areas joins both groups", () => {
  const items = [mk("a", "x", "small"), mk("b", "y", "small"), { ...mk("c", "z", "small"), groomAreas: ["x", "y"] }];
  const pk = packageBacklog(items, { budget: 1 });
  assert.strictEqual(pk.length, 1);
  assert.deepStrictEqual(pk[0].itemIds, ["a", "b", "c"]);
});

test("every ticket lands in exactly one package; ids are stable", () => {
  const items = Array.from({ length: 10 }, (_, i) => mk(`t${i}`, ["A", "B", "C"][i % 3], ["small", "medium", "large"][i % 3]));
  const pk = packageBacklog(items, { budget: 8 });
  assert.deepStrictEqual(pk.flatMap((p) => p.itemIds).sort(), items.map((i) => i.id).sort());
  assert.deepStrictEqual(packageBacklog(items.slice().reverse(), { budget: 8 }).map((p) => p.id), pk.map((p) => p.id));
  assert.deepStrictEqual(areasOf({ category: "HQ Admin" }), ["hq admin"]);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
