// Tests the REAL public/js/train-overlap.js (wPoSOXfp8Em06Vzp3Cz7) — plain
// ESM, no Firebase, no DOM: the shared-files and owned-paths chips, the
// project header line, the queued hint and the Docs page's owned-paths parser.
import assert from "node:assert/strict";
import { sharedWithChipsHTML, foreignPathsChipsHTML, sharedFilesHeaderHTML, deployQueuedHintHTML, parseOwnedPaths } from "../public/js/train-overlap.js";

const shared = { projectId: "pK", projectName: "Staff Kanban", paths: ["backlog-tracker/MCP.md"], conflictPaths: [], conflict: false };
const conflict = { projectId: "pW", projectName: "PH Website", paths: ["a.html"], conflictPaths: ["a.html"], conflict: true };

// Shown in Ready for Testing and Approved only.
assert.equal(sharedWithChipsHTML({ status: "backlog", sharedWith: [shared] }), "");
assert.equal(sharedWithChipsHTML({ status: "published-live", sharedWith: [shared] }), "");
const chip = sharedWithChipsHTML({ status: "ready-for-testing", sharedWith: [shared] });
assert.match(chip, /call_split<\/span>Also changed on Staff Kanban's train<\/span>$/);
assert.match(chip, /title="[^"]*backlog-tracker\/MCP\.md"/, "hover lists the files");
assert.doesNotMatch(chip, /train-overlap-chip-warn/);
const warn = sharedWithChipsHTML({ status: "ready-to-publish", sharedWith: [conflict] });
assert.match(warn, /train-overlap-chip-warn/);
assert.match(warn, /Conflicts with PH Website's train: a\.html/);
// Escaped, and an entry with no paths shows nothing.
assert.match(sharedWithChipsHTML({ status: "ready-for-testing", sharedWith: [{ ...shared, projectName: "<b>x</b>" }] }), /&lt;b&gt;x&lt;\/b&gt;/);
assert.equal(sharedWithChipsHTML({ status: "ready-for-testing", sharedWith: [{ ...shared, paths: [] }] }), "");

const owned = foreignPathsChipsHTML({ status: "ready-for-testing", foreignPaths: [{ projectName: "Staff Kanban", paths: ["k/a.js", "k/b.js", "k/c.js"] }] });
assert.match(owned, /Changes Staff Kanban's files: k\/a\.js, k\/b\.js \+1/);
assert.equal(foreignPathsChipsHTML({ status: "backlog", foreignPaths: [{ projectName: "X", paths: ["a"] }] }), "");

// Header line: while any train card shares files.
assert.equal(sharedFilesHeaderHTML([{ status: "backlog", sharedWith: [shared] }]), "");
const header = sharedFilesHeaderHTML([{ status: "ready-for-testing", sharedWith: [shared] }, { status: "ready-to-publish", sharedWith: [shared, conflict] }]);
assert.match(header, /Shares files with Staff Kanban&#39;s train and PH Website&#39;s train/);
assert.match(header, /train-shared-hint-warn/);

// Queued hint.
assert.equal(deployQueuedHintHTML({ trainHold: "tests-running" }), "");
assert.match(deployQueuedHintHTML({ trainHold: "queued", trainNote: "Queued behind Staff Kanban's deploy; starts by itself when that merges." }), /Queued behind Staff Kanban&#39;s deploy; starts by itself when that merges\./);
assert.match(deployQueuedHintHTML({ trainHold: "queued" }), /Queued behind another project&#39;s deploy/);

// Owned paths parser.
assert.deepEqual(parseOwnedPaths(" backlog-tracker/\nfaq/\n\nCLAUDE.md\nfaq/ "), { paths: ["backlog-tracker/", "faq/", "CLAUDE.md"] });
assert.deepEqual(parseOwnedPaths(""), { paths: [] });
assert.ok(parseOwnedPaths("/etc/").error);
assert.ok(parseOwnedPaths("a/../b").error);
assert.ok(parseOwnedPaths(Array.from({ length: 31 }, (_, i) => `p${i}/`).join("\n")).error);

console.log("train-overlap view: all assertions passed");
