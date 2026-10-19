// The Concept Incubator hero map: nodes, status, release badges, the filter,
// and "a new interface contract adds a line with no code change".
import assert from "node:assert/strict";
import { buildSystemMap, systemMapHTML, highlightedIds } from "../public/js/system-map.js";

const releases = [{ id: "r5", name: "DSP Integration", version: "5.0", status: "draft" }, { id: "r4", name: "Sep", version: "4.2", status: "live" }];
const projects = [
  { id: "dsp", name: "Display Types & DSP Integration", releaseId: "r5" },
  { id: "old", name: "Shipped thing", releaseId: "r4" },
  { id: "gone", name: "Archived", archived: true },
];
const concepts = [
  { id: "c1", name: "Experience Templates", status: "active" },
  { id: "c2", name: "Promoted idea", status: "promoted", promotedProjectId: "old" },
];
const base = { projects, concepts, interfaces: [], releases };

const m = buildSystemMap(base);
const core = m.nodes.filter((n) => n.kind === "core");
assert.deepEqual(core.map((n) => n.name).slice(0, 7), ["Campaigns & Experiences", "Agent Harness", "MCP Access", "Vector Database", "Devices & Touchpoints", "Live Visitor Profile", "Store Data"]);
assert.ok(core.every((n) => n.status === "Live" || n.name === "PH Team"));
assert.equal(m.byId.dsp.status, "Project");
assert.equal(m.byId.dsp.release, "Release 5.0");
assert.equal(m.byId.old.status, "Live", "a project in a live release is Live");
assert.equal(m.byId.c1.status, "Concept");
assert.ok(!m.byId.gone && !m.byId.c2, "archived projects and promoted concepts are not drawn twice");

// DSP: two labelled lines, demand and supply
const dsp = m.edges.filter((e) => e.from === "dsp" || e.to === "dsp");
assert.deepEqual(dsp.map((e) => e.kind).sort(), ["demand", "supply"]);
// the insights loop is closed
const loop = m.edges.filter((e) => e.loop).map((e) => `${e.from}>${e.to}`);
assert.equal(loop.length, 4);

// a new contract adds exactly one clickable line
const m2 = buildSystemMap({ ...base, interfaces: [{ id: "i1", name: "A ↔ B", flowLabel: "audience segments", endpoints: [{ type: "project", id: "dsp" }, { type: "concept", id: "c1" }], projectIds: ["dsp", "c1"] }] });
assert.equal(m2.edges.length, m.edges.length + 1);
const html = systemMapHTML(m2);
assert.ok(html.includes('data-interface-id="i1"') && html.includes("audience segments"));
assert.ok(html.includes('data-node-id="dsp"') && html.includes("Release 5.0"));
// a contract naming a promoted concept follows it to its project
const m3 = buildSystemMap({ ...base, interfaces: [{ id: "i2", name: "x", projectIds: ["c2", "dsp"] }] });
assert.equal(m3.edges.filter((e) => e.interfaceId === "i2")[0].from, "old");

// release filter: nodes and lines of that release stay lit, the rest dim
const hi = highlightedIds(m, "r5");
assert.ok(hi.nodes.has("dsp") && hi.nodes.has("core:campaigns") && !hi.nodes.has("core:mcp"));
assert.ok((systemMapHTML(m, { release: "r5" }).match(/ dim"/g) || []).length > 0);
assert.ok(!/ dim"/.test(systemMapHTML(m)));
console.log("system-map: ok");
