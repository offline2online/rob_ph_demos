// Tests the REAL public/js/build-batches.js — plain ESM, no Firebase, no
// DOM — imported directly, same "test the pure module the browser code
// actually uses" approach as test/train-lock.test.js takes for
// functions/train-lock.js.
//
// Run with:  node test/build-batches.test.mjs
import assert from "node:assert";
import { clusterBacklogItems, estimateEffort, estimatePriority, splitRequirementsText } from "../public/js/build-batches.js";

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

test("groups items by category, largest batch first", () => {
  const items = [
    { id: "1", title: "Fix menu board price", desc: "short", category: "Menu Board" },
    { id: "2", title: "Fix menu board tile", desc: "short", category: "Menu Board" },
    { id: "3", title: "Add FAQ table support", desc: "short", category: "Uncategorised" },
  ];
  const { batches } = clusterBacklogItems(items);
  assert.strictEqual(batches.length, 2);
  assert.strictEqual(batches[0].category, "Menu Board");
  assert.strictEqual(batches[0].count, 2);
  assert.strictEqual(batches[1].count, 1);
});

test("items with no category fall into Uncategorised, not dropped", () => {
  const { batches } = clusterBacklogItems([{ id: "1", title: "x", desc: "y" }]);
  assert.strictEqual(batches.length, 1);
  assert.strictEqual(batches[0].category, "Uncategorised");
});

test("a batch of one item is still returned, not filtered out", () => {
  const { batches } = clusterBacklogItems([{ id: "1", title: "Lone item", desc: "d", category: "HQ Admin" }]);
  assert.strictEqual(batches.length, 1);
  assert.strictEqual(batches[0].items.length, 1);
});

test("empty input returns no batches, doesn't throw", () => {
  assert.deepStrictEqual(clusterBacklogItems([]).batches, []);
  assert.deepStrictEqual(clusterBacklogItems(null).batches, []);
});

test("estimateEffort: a 'redesign' request is large regardless of length", () => {
  assert.strictEqual(estimateEffort({ title: "Redesign the pricing page", desc: "short" }), "large");
});

test("estimateEffort: a short, plain request is small", () => {
  assert.strictEqual(estimateEffort({ title: "Fix a typo", desc: "The label says 'Recieve' instead of 'Receive'." }), "small");
});

test("estimateEffort: a long, keyword-free request is medium or large by length alone", () => {
  const longDesc = "This needs quite a lot of context. ".repeat(30); // > 900 chars
  assert.strictEqual(estimateEffort({ title: "Something involved", desc: longDesc }), "large");
});

test("items within a batch are sorted small effort first", () => {
  const items = [
    { id: "1", title: "Overhaul the whole flow", desc: "d", category: "HQ Admin" },
    { id: "2", title: "Fix a typo", desc: "d", category: "HQ Admin" },
  ];
  const { batches } = clusterBacklogItems(items);
  assert.strictEqual(batches[0].items[0].id, "2", "the small item should sort first");
  assert.strictEqual(batches[0].items[1].id, "1");
});

test("estimatePriority: an urgent/blocking request is high", () => {
  assert.strictEqual(estimatePriority({ title: "Checkout is broken", desc: "Blocking every purchase, needs a fix asap" }), "high");
});

test("estimatePriority: a nice-to-have request is low", () => {
  assert.strictEqual(estimatePriority({ title: "Nicer icon", desc: "Cosmetic only, nice to have when there's time" }), "low");
});

test("estimatePriority: a plain request with no signal words is medium", () => {
  assert.strictEqual(estimatePriority({ title: "Add a filter", desc: "Let the table be filtered by status" }), "medium");
});

test("a real item.priority/item.effort always wins over the estimate", () => {
  const { batches } = clusterBacklogItems([
    { id: "1", title: "Overhaul the whole flow", desc: "d", category: "HQ Admin", priority: "low", effort: "small" },
  ]);
  assert.strictEqual(batches[0].items[0].priority, "low");
  assert.strictEqual(batches[0].items[0].effort, "small");
});

test("items within a batch sort highest priority first, then smallest effort", () => {
  const items = [
    { id: "1", title: "Medium priority small fix", desc: "d", category: "HQ Admin", priority: "medium", effort: "small" },
    { id: "2", title: "High priority large fix", desc: "d", category: "HQ Admin", priority: "high", effort: "large" },
    { id: "3", title: "High priority small fix", desc: "d", category: "HQ Admin", priority: "high", effort: "small" },
  ];
  const { batches } = clusterBacklogItems(items);
  assert.deepStrictEqual(batches[0].items.map((i) => i.id), ["3", "2", "1"]);
  assert.strictEqual(batches[0].priorityCounts.high, 2);
  assert.strictEqual(batches[0].priorityCounts.medium, 1);
});

test("splitRequirementsText: one requirement per blank-line-separated block", () => {
  const out = splitRequirementsText("Fix the header\n\nAdd a footer\n\nRedesign the sidebar");
  assert.deepStrictEqual(out, ["Fix the header", "Add a footer", "Redesign the sidebar"]);
});

test("splitRequirementsText: consecutive non-blank lines join into one requirement", () => {
  const out = splitRequirementsText("Fix the header on the\nhomepage so it doesn't wrap\n\nAdd a footer");
  assert.deepStrictEqual(out, ["Fix the header on the homepage so it doesn't wrap", "Add a footer"]);
});

test("splitRequirementsText: strips list markers and ignores blank/whitespace-only lines", () => {
  const out = splitRequirementsText("- First item\n\n* Second item\n\n1. Third item\n\n   \n2) Fourth item");
  assert.deepStrictEqual(out, ["First item", "Second item", "Third item", "Fourth item"]);
});

test("splitRequirementsText: empty/whitespace input returns no requirements", () => {
  assert.deepStrictEqual(splitRequirementsText(""), []);
  assert.deepStrictEqual(splitRequirementsText("   \n\n  "), []);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
