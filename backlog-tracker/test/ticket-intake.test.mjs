// Tests the REAL public/js/ticket-intake.js — plain ESM, no Firebase, no DOM.
// Run with:  node test/ticket-intake.test.mjs
import assert from "node:assert/strict";
import { INTAKE_SECTIONS, parseIntake, missingSections, applyAnswers, isSubstantive } from "../public/js/ticket-intake.js";

const keys = (a) => a.map((s) => s.key);

// Only an Outcome -> three missing, never the Outcome.
let d = "## Outcome\nA blocked ticket shows a Resolve button on its card.";
assert.deepEqual(keys(missingSections(d)), ["test", "deps", "spec"]);

// Plain text with no headings counts as the Outcome.
assert.deepEqual(keys(missingSections("Make the card show a resolve button please")), ["test", "deps", "spec"]);

// Empty description -> everything missing.
assert.deepEqual(keys(missingSections("")), ["outcome", "test", "deps", "spec"]);

// Placeholders and thin sections are not substantive; "None" is.
assert.equal(isSubstantive(INTAKE_SECTIONS[2], "None"), true);
assert.equal(isSubstantive(INTAKE_SECTIONS[2], "TBD"), false);
assert.equal(isSubstantive(INTAKE_SECTIONS[1], "try it"), false);

// Answers land in the right section, in canonical order, nothing lost.
let out = applyAnswers(d, { test: "Click Resolve and answer each question.", deps: "None" });
let p = parseIntake(out).sections;
assert.match(p.outcome, /Resolve button/);
assert.equal(p.test, "Click Resolve and answer each question.");
assert.equal(p.deps, "None");
assert.deepEqual(keys(missingSections(out)), ["spec"]);
assert.ok(out.indexOf("## Outcome") < out.indexOf("## Test steps") && out.indexOf("## Test steps") < out.indexOf("## Dependencies"));

// Completing the last one clears every gap.
out = applyAnswers(out, { spec: "REQUIREMENTS.md, blocked flag section" });
assert.deepEqual(missingSections(out), []);

// Unrecognised headings and unheaded leading text survive a rewrite.
out = applyAnswers("Intro line\n\n## Outcome\nSomething checkable happens here.\n\n## Notes\nkeep me", { test: "Do the thing and see it work." });
assert.match(out, /Intro line/);
assert.match(out, /## Notes\nkeep me/);

// Headingless description is promoted to an Outcome section on rewrite.
out = applyAnswers("Make the card show a resolve button please", { test: "Open a blocked card and look." });
assert.match(out, /^## Outcome\nMake the card show a resolve button please/);

console.log("ticket-intake: ok");
