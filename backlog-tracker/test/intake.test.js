// ph-ticket-intake gate: structuring, gap flagging, type inference and
// idempotency. Pure — functions/intake.js has no Firebase dependency.
// Run with:  node test/intake.test.js
"use strict";
const assert = require("assert");
const { applyIntake, isIntakeFlag, INTAKE_SETTER, PLACEHOLDER } = require("../functions/intake");

// 1. Thin one-liner → structured, Outcome kept, held BLOCKED naming the gaps.
let r = applyIntake("Add a dark mode toggle to the settings page");
assert.ok(/^## Outcome\nAdd a dark mode toggle/.test(r.desc));
for (const h of ["Outcome", "Test steps", "Dependencies", "Spec reference"]) assert.ok(r.desc.includes(`## ${h}`), h);
assert.ok(r.desc.includes(PLACEHOLDER));
assert.strictEqual(r.blocked.reason, "waiting-on-input");
assert.ok(/Test steps \(missing\)/.test(r.blocked.note) && /Spec reference/.test(r.blocked.note));

// 2. No usable outcome at all → needs-decision (a human call).
r = applyIntake("");
assert.strictEqual(r.blocked.reason, "needs-decision");
r = applyIntake("fix it");
assert.strictEqual(r.blocked.reason, "needs-decision");
assert.ok(/Outcome \(too thin\)/.test(r.blocked.note));

// 3. Fully specified ticket passes clean ("None" counts as an answer).
const full = [
  "## Outcome", "Archived tickets table shows a Version column that is sortable and filterable.",
  "## Test steps", "1. Open Archived tickets. 2. Click the Version header. Expect ascending sort.",
  "## Dependencies", "None",
  "## Spec reference", "backlog-tracker/REQUIREMENTS.md → Test version",
].join("\n");
r = applyIntake(full);
assert.strictEqual(r.blocked, null);
assert.deepStrictEqual(r.gaps, []);

// 4. Idempotent: intake on its own output changes nothing.
const once = applyIntake("Add a dark mode toggle to the settings page");
const twice = applyIntake(once.desc);
assert.strictEqual(twice.desc, once.desc);
assert.deepStrictEqual(twice.blocked, once.blocked);
assert.strictEqual(applyIntake(full).desc, applyIntake(applyIntake(full).desc).desc);

// 5. Type inference.
assert.strictEqual(applyIntake("The save button crashes when the title is empty").type, "bug");
assert.strictEqual(applyIntake("Add an export button to the archive page").type, "feature");

// 6. Over-long structured output keeps the original text (board limit 2000).
const long = "x ".repeat(990);
assert.strictEqual(applyIntake(long).desc, long.trim());

// 7. Only intake's own flag is its to manage.
assert.ok(isIntakeFlag({ reason: "needs-decision", setBy: INTAKE_SETTER }));
assert.ok(!isIntakeFlag({ reason: "needs-decision", setBy: "rob@offline2online.com" }));
assert.ok(!isIntakeFlag(null));

console.log("intake.test.js: all passed");
