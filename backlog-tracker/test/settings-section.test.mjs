// Pure row builders and routes for the Settings section (public/js/settings-section.js).
import assert from "node:assert";
import { SETTINGS_PAGES, settingsPageFromHash, settingsHash, projectRows, releaseRows, skillRows, bindingRows, automationRows } from "../public/js/settings-section.js";

assert.deepStrictEqual(SETTINGS_PAGES.map((p) => p.key), ["projects", "releases", "skills", "automations", "integrations"]);
assert.strictEqual(settingsPageFromHash("#settings"), "projects");
assert.strictEqual(settingsPageFromHash("#settings/automations"), "automations");
assert.strictEqual(settingsPageFromHash("#settings/nope"), "projects");
assert.strictEqual(settingsPageFromHash("#releases"), null);
assert.strictEqual(settingsPageFromHash("#user-management"), null);
assert.strictEqual(settingsHash("skills"), "#settings/skills");

const pr = projectRows([{ id: "b", name: "Beta", repoFolder: "beta", type: "Platform" }, { id: "a", name: "Alpha", repoFolderNotApplicable: true }, { id: "c", name: "Gone", archived: true }], { typeOf: (p) => p.type || "" });
assert.deepStrictEqual(pr.map((r) => r.name), ["Alpha", "Beta"]);
assert.strictEqual(pr[0].type, "Unassigned");
assert.strictEqual(pr[0].repoNote, "No single folder");
assert.strictEqual(pr[1].repoFolder, "beta/");

const rr = releaseRows([{ id: "r1", name: "Oct", version: "2.0.0", status: "live" }, { id: "r2", name: "Nov", status: "planned" }], [{ id: "p", releaseId: "r1" }, { id: "q", releaseId: "r1", archived: true }]);
assert.strictEqual(rr[0].status, "Live");
assert.strictEqual(rr[0].projectCount, 1);
assert.strictEqual(rr[1].status, "Planned");

const skills = [{ id: "s1", name: "Designer", slug: "ph-designer", version: 3, files: [{}, {}] }];
assert.strictEqual(skillRows(skills)[0].files, 2);
const br = bindingRows({ build: ["ph-designer", "missing"], deploy: [] }, skills);
assert.deepStrictEqual(br.map((r) => [r.phase, r.name]), [["Build", "Designer"], ["Build", "Not in the library yet"]]);
assert.deepStrictEqual(bindingRows(null, skills), []);

const ar = automationRows({ build: ["ph-designer"] });
assert.deepStrictEqual(ar.map((r) => r.name), ["Notify Claude", "Groom Backlog", "Batch review", "Run E2E"]);
assert.strictEqual(ar[0].skills, "ph-designer");
assert.strictEqual(ar[1].skills, "None");
console.log("settings-section: ok");
