// Concept critiques: the shared logic (synthesis, role handling, applying an
// accepted adjustment) and a guard that the board's ES module and the MCP
// server's CommonJS copy have not drifted apart.
import assert from "assert";
import fs from "fs";
import { createRequire } from "module";
import * as esm from "../public/js/concept-critiques.js";
const require = createRequire(import.meta.url);
const cjs = require("../functions/concept-critiques.js");

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ok  ${name}`); }

const strip = (s) => s.replace(/^export /gm, "").replace(/\/\/ Concept Incubator critiques[\s\S]*?\/\/ A critique is one/, "// A critique is one").replace(/\nmodule\.exports[^\n]*\n/, "\n").trimEnd();
test("the CommonJS copy is the ES module minus `export`", () => {
  const a = strip(fs.readFileSync(new URL("../public/js/concept-critiques.js", import.meta.url), "utf8"));
  const b = strip(fs.readFileSync(new URL("../functions/concept-critiques.js", import.meta.url), "utf8"));
  assert.strictEqual(b, a);
});

const crits = [
  { id: "a", role: "CFO", reviewer: "x@y", verdict: "conditional", argumentsFor: ["Opens a new revenue stream"], argumentsAgainst: ["Margins are thin"], assumptions: ["Retailers will pay for data"], recommendations: [{ id: "r1", text: "Cap the upfront spend", status: "pending" }] },
  { id: "b", role: "cfo", reviewer: "z@y", verdict: "wont-work", argumentsFor: [], argumentsAgainst: ["The margins are thin"], assumptions: [], recommendations: [{ id: "r1", text: "Cap upfront spend", status: "accepted" }] },
  { id: "c", role: "", reviewer: "w@y", verdict: "will-work", argumentsFor: ["Thin margins are fine"], argumentsAgainst: [], assumptions: [], recommendations: [{ id: "r1", text: "Pilot in one store", status: "rejected" }] },
];
for (const [name, m] of [["esm", esm], ["cjs", cjs]]) {
  test(`${name}: synthesis groups by role case-insensitively; no role is Unspecified`, () => {
    const s = m.synthesise(crits);
    assert.deepStrictEqual(s.byRole.map((r) => [r.role, r.critiques]), [["CFO", 2], ["Unspecified", 1]]);
    assert.deepStrictEqual(s.verdictCounts, { "will-work": 1, "wont-work": 1, conditional: 1 });
  });
  test(`${name}: agreement, disagreement and adjustments`, () => {
    const s = m.synthesise(crits);
    assert.ok(s.agreement.some((a) => a.kind === "argument-against" && a.supporters.length === 2));
    assert.ok(s.disagreement.some((d) => d.kind === "verdict"));
    assert.ok(s.disagreement.some((d) => d.kind === "contested-point"), "a point argued for and against");
    const cap = s.adjustments.find((a) => /cap/i.test(a.text));
    assert.strictEqual(cap.supporters.length, 2);
    assert.strictEqual(cap.state, "pending");
    assert.strictEqual(s.adjustments.find((a) => /pilot/i.test(a.text)).state, "rejected");
  });
  test(`${name}: role filter and suggestions`, () => {
    assert.strictEqual(m.synthesise(crits, { role: "CFO" }).total, 2);
    assert.strictEqual(m.synthesise(crits, { role: "Unspecified" }).total, 1);
    assert.deepStrictEqual(m.roleSuggestions(crits), ["CFO"]);
  });
}
test("critique status: addressed / dismissed / open", () => {
  assert.strictEqual(esm.critiqueStatus([{ status: "accepted" }, { status: "rejected" }]), "addressed");
  assert.strictEqual(esm.critiqueStatus([{ status: "rejected" }]), "dismissed");
  assert.strictEqual(esm.critiqueStatus([{ status: "accepted" }, { status: "pending" }]), "open");
});
test("an accepted adjustment is appended under one Critique adjustments heading", () => {
  const once = esm.applyAdjustment("# Req\n\nText.", "Cap spend", "CFO critique");
  assert.match(once, /# Req\n\nText\.\n\n## Critique adjustments\n\n- Cap spend _\(CFO critique\)_\n$/);
  const twice = esm.applyAdjustment(once, "Pilot", "");
  assert.strictEqual(twice.split("## Critique adjustments").length, 2);
  assert.ok(twice.endsWith("- Pilot\n"));
});
console.log(`\n${passed} passed`);
