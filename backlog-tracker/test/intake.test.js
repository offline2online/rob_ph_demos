// ph-ticket-intake gate: structuring, gap flagging, type inference and
// idempotency. Pure — functions/intake.js has no Firebase dependency.
// Run with:  node test/intake.test.js
"use strict";
const assert = require("assert");
const { applyIntake, isIntakeFlag, hasIntakePlaceholder, INTAKE_SETTER, PLACEHOLDER, TO_COMPLETE } = require("../functions/intake");

// 1. A dictated ticket with a clear outcome is NOT blocked (4 Oct 2026): the
//    other sections are left for the build session to complete.
let r = applyIntake("Add a dark mode toggle to the settings page");
assert.ok(/^## Outcome\nAdd a dark mode toggle/.test(r.desc));
for (const h of ["Outcome", "Test steps", "Dependencies", "Spec reference"]) assert.ok(r.desc.includes(`## ${h}`), h);
assert.ok(r.desc.includes(TO_COMPLETE));
assert.strictEqual(r.blocked, null, "a clear outcome is enough to enter Ready for Dev");
assert.deepStrictEqual(r.pending.map((g) => g.heading), ["Test steps", "Dependencies", "Spec reference"]);
assert.ok(hasIntakePlaceholder(r.desc), "the automation can still see it isn't complete");

// 1b. The real ticket that was stuck (gqLSUsEMht98QWME0Ixi), already rewritten
//     with the old placeholder: still parsed as empty, still not blocked.
const stuck = "## Outcome\nOn the available inventory table it's not allowing me to remove an interactive targeting support item from the menu board slot\n\n## Test steps\n" + PLACEHOLDER + "\n\n## Dependencies\n" + PLACEHOLDER + "\n\n## Spec reference\n" + PLACEHOLDER;
r = applyIntake(stuck);
assert.strictEqual(r.blocked, null);
assert.ok(hasIntakePlaceholder(r.desc));

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
assert.ok(!hasIntakePlaceholder(r.desc));

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
