// Docs page mirror view (a1xWfd9zq1a0cuuwf4cA): pure helpers in
// public/js/docs-view.js, plain node. Run: node docs-view.test.mjs
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isMirror, repoFileUrl, orderProjectDocs, projectDocRowHTML, interfaceActionsHTML,
  mirrorChipHTML, mirrorEditRefusal,
} from "../public/js/docs-view.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, "..", "public");

// isMirror
assert.equal(isMirror({ sourcePath: "a/b.md" }), true);
for (const r of [{}, { sourcePath: null }, { sourcePath: "" }, { sourcePath: "   " }, null]) assert.equal(isMirror(r), false);

// repoFileUrl
const B = "https://github.com/offline2online/rob_ph_demos/blob/main/";
assert.equal(repoFileUrl("dsp-integration/docs/dsp-integration/api/PH-CORE-BOUNDARIES.md"), B + "dsp-integration/docs/dsp-integration/api/PH-CORE-BOUNDARIES.md");
assert.equal(repoFileUrl("a b/c#d.md"), B + "a%20b/c%23d.md");
for (const bad of ["/etc/x", "a/../b", "https://x", "", null]) assert.equal(repoFileUrl(bad), null, String(bad));

// orderProjectDocs
const P = { id: "p1", startHereDocId: "sh" };
const docs = [
  { id: "m", projectId: "p1", name: "Mirror doc", sourcePath: "x.md" },
  { id: "b10", projectId: "p1", name: "Review (10/7)" },
  { id: "b2", projectId: "p1", name: "Review (2/7)" },
  { id: "s1", projectId: "p1", name: "Old A", status: "superseded", statusNote: "replaced" },
  { id: "s2", projectId: "p1", name: "Old B", status: "superseded" },
  { id: "w", projectId: "p1", name: "Wip", status: "working" },
  { id: "sh", projectId: "p1", name: "Zzz — Start here" },
];
let o = orderProjectDocs(docs, P);
assert.equal(o.startHere.id, "sh");
assert.deepEqual(o.current.map((d) => d.id), ["m", "b2", "b10", "w"]);
assert.equal(o.superseded.length, 2);
assert.equal(orderProjectDocs(docs, { id: "p1", startHereDocId: "readme" }).startHere, null);
assert.equal(orderProjectDocs(docs, { id: "p1", startHereDocId: "elsewhere" }).startHere, null);
assert.equal(orderProjectDocs([{ id: "sh", projectId: "p2", name: "x" }], P).startHere, null);
assert.equal(orderProjectDocs([{ id: "sh", projectId: "p1", name: "x", status: "superseded" }], P).superseded.length, 0, "start doc is never folded");

// rows
let row = projectDocRowHTML({ id: "m", name: "M", sourcePath: "dsp-integration/a b.md", contentMd: "x" });
assert.ok(row.includes("Mirror of dsp-integration/a b.md"));
assert.ok(row.includes(`href="${B}dsp-integration/a%20b.md"`) && row.includes('target="_blank"') && row.includes('rel="noopener"'));
assert.ok(!row.includes("doc-edit-btn") && row.includes("doc-delete-btn"));
assert.ok(projectDocRowHTML({ id: "b", name: "B" }).includes("doc-edit-btn"));
row = projectDocRowHTML({ id: "m", name: "M", sourcePath: "<script>alert(1)</script>.md" });
assert.ok(!row.includes("<script>") && row.includes("&lt;script&gt;"));
assert.ok(projectDocRowHTML({ id: "x", name: "X", status: "working" }).includes("docs-status-chip"));
assert.ok(!projectDocRowHTML({ id: "x", name: "X", status: "current" }).includes("docs-status-chip"));

// interfaces
const f = { id: "i1", name: "I", sourcePath: "shared/c.md", syncError: "<b>boom</b>" };
const acts = interfaceActionsHTML(f, "p1");
assert.ok(!acts.includes("interface-edit-btn") && acts.includes("Open in GitHub"));
const chip = mirrorChipHTML(f);
assert.ok(chip.includes("sync_problem") && chip.includes("&lt;b&gt;boom&lt;/b&gt;") && !chip.includes("<b>boom"));
assert.ok(interfaceActionsHTML({ id: "i2", name: "J" }, "p1").includes("interface-edit-btn"));

// refusal
assert.equal(mirrorEditRefusal({ name: "N" }), null);
assert.equal(
  mirrorEditRefusal({ name: "README", sourcePath: "p/README.md" }),
  "README is a copy of p/README.md in the repo. Edit that file; this copy is rewritten from it after the next merge to main.");

// wiring
assert.ok(/from "\.\/docs-view\.js"/.test(fs.readFileSync(path.join(pub, "js", "app.js"), "utf8")));
assert.ok(fs.readFileSync(path.join(pub, "index.html"), "utf8").includes('href="js/docs-view.js"'));
console.log("docs-view: ok");
