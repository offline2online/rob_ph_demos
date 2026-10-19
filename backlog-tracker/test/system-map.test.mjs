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
assert.ok(core.every((n) => n.status === "Live"));
assert.equal(m.byId.dsp.status, "Project");
assert.equal(m.byId.dsp.release, "Release 5.0");
assert.equal(m.byId.old.status, "Live", "a project in a live release is Live");
assert.equal(m.byId.c1.status, "Concept");
assert.ok(!m.byId.gone && !m.byId.c2, "archived projects and promoted concepts are not drawn twice");

// DSP: two labelled lines, demand and supply
const dsp = m.edges.filter((e) => (e.from === "dsp" || e.to === "dsp") && e.kind);
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

// Custom & Edge Models, Digital Identity, Offsite, Federation + externals, PII wall
{
  const mm = buildSystemMap(base);
  const byName = (n) => mm.nodes.find((x) => x.name === n);
  ["Custom & Edge Models", "Digital Identity & Resolution", "Offsite Retail Media & Social", "Federated Retail Media (PH-to-PH)"].forEach((n) => assert.equal(byName(n).status, "Concept", n));
  ["Salesforce CRM", "Amazon Connect", "Meta", "TikTok", "Google Display", "YouTube", "Advertiser", "Retailer PH instance", "Advertiser PH instance"].forEach((n) => assert.equal(byName(n).status, "External", n));
  const lab = (t) => mm.edges.filter((e) => e.label === t);
  ["HMAC-hashed edge identifiers (e.g. plates)", "edge model deployment", "stitching trigger", "pseudonymous IDs + attributes", "PH-optimised models",
    "retailer-owned data for model training/optimisation", "offsite creative", "advertiser offsite buys", "authenticated partnership (mTLS + scoped OAuth)"].forEach((t) => assert.ok(lab(t).length, t));
  assert.equal(lab("pseudonymised attributes in / insights written back").filter((e) => e.both).length, 2);
  assert.equal(lab("hashed audiences (SHA-256 email)").length, 5);
  const h = systemMapHTML(mm);
  assert.ok(h.includes("sysmap-pii") && h.includes("agents never cross it"));
  // a board concept of the same name replaces the built-in node
  const mc = buildSystemMap({ ...base, concepts: [...concepts, { id: "c9", name: "Digital Identity", status: "active" }] });
  assert.ok(mc.byId.c9 && !mc.nodes.some((x) => x.id === "ext:identity"));
  assert.ok(mc.edges.some((e) => e.from === "c9" && e.to === "core:profile"));
}
console.log("system-map (new concepts): ok");

// Clean-up: internal items out, Live Visitor Profile once, clean room in, fits the page
{
  const { zoomViewBox, FIT_VIEWBOX } = await import("../public/js/system-map.js");
  const mm = buildSystemMap({
    projects: [...projects, { id: "bt", name: "Backlog Tracker & FAQs" }, { id: "vp", name: "Live Visitor Profile & Personas" }, { id: "cs", name: "Customer Success" }],
    concepts: [...concepts, { id: "brand", name: "PH Brand", status: "active" }, { id: "sup", name: "Customer Support", status: "active" }],
    interfaces: [], releases,
  });
  ["bt", "brand", "cs", "sup"].forEach((id) => assert.ok(!mm.byId[id], `${id} is internal and not drawn`));
  assert.ok(!mm.nodes.some((n) => /PH Team|Customer (Support|Success)/.test(n.name)), "no support/success/PH Team nodes");
  const vp = mm.nodes.filter((n) => /live visitor profile/i.test(n.name));
  assert.equal(vp.length, 1, "Live Visitor Profile appears once");
  assert.equal(vp[0].kind, "concept");
  assert.equal(vp[0].status, "Concept");
  assert.ok(mm.edges.some((e) => e.from === "core:profile" && mm.byId[e.from] === vp[0]), "platform lines still reach it");
  const cr = mm.nodes.find((n) => n.name === "Data Clean Room");
  assert.equal(cr.status, "External");
  assert.match(cr.sub, /AWS Clean Rooms.*Snowflake.*LiveRamp.*Google Ads Data Hub/);
  const crEdges = mm.edges.filter((e) => e.from === cr.id || e.to === cr.id);
  assert.ok(crEdges.some((e) => e.both && e.to === cr.id && mm.byId[e.from].name === "Retailer PH instance"));
  assert.ok(crEdges.some((e) => e.both && e.from === cr.id && mm.byId[e.to].name === "Advertiser PH instance"));
  assert.ok(crEdges.some((e) => e.from === "ext:identity" && /pseudonymous/.test(e.label)), "fed by Digital Identity");
  assert.ok(crEdges.filter((e) => e.both).every((e) => /aggregated, no raw data/.test(e.label)));
  assert.ok(cr.y === 860, "sits on the PII boundary line");
  const h = systemMapHTML(mm);
  assert.ok(!/min-width/.test(h) && h.includes('viewBox="0 0 1600 1040"'));
  // every node inside the drawing area
  assert.ok(mm.nodes.every((n) => n.x >= 95 && n.x <= 1505 && n.y >= 50 && n.y <= 1010), "all nodes within the viewBox");
  const z = zoomViewBox(FIT_VIEWBOX, 2, 800, 520);
  assert.ok(z.w === 800 && z.x >= 0 && z.x + z.w <= 1600);
  assert.deepEqual(zoomViewBox(FIT_VIEWBOX, 0.5, 800, 520), FIT_VIEWBOX, "cannot zoom out past fit");
}
console.log("system-map (clean-up): ok");
