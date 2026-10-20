// The Concept Incubator hero map: nodes, status, release badges, the filter,
// and "a new interface contract adds a line with no code change".
import assert from "node:assert/strict";
import { buildSystemMap, systemMapHTML, highlightedIds, shortDescription, layoutSystemMap, nodeBox, fitViewBox } from "../public/js/system-map.js";

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
  ["Custom & Edge Models", "Digital Identity & Resolution", "Offsite (Meta, YouTube)", "Federated PH Instance"].forEach((n) => assert.equal(byName(n).status, "Concept", n));
  ["Salesforce CRM", "Amazon Connect", "Advertiser"].forEach((n) => assert.equal(byName(n).status, "External", n));
  const lab = (t) => mm.edges.filter((e) => e.label === t);
  ["HMAC-hashed edge identifiers (e.g. plates)", "edge model deployment", "stitching trigger", "pseudonymous IDs + attributes", "PH-optimised models",
    "retailer-owned data for model training/optimisation", "offsite creative", "advertiser offsite buys"].forEach((t) => assert.ok(lab(t).length, t));
  assert.equal(lab("pseudonymised attributes in / insights written back").filter((e) => e.both).length, 2);
  assert.equal(lab("hashed audiences (SHA-256 email)").length, 1);
  assert.equal(mm.nodes.filter((x) => /offsite|^(Meta|TikTok|Google Display|YouTube)$/i.test(x.name)).length, 1);
  const h = systemMapHTML(mm);
  assert.ok(h.includes("sysmap-pii") && h.includes("agents never cross it"));
  // a board concept of the same name replaces the built-in node
  const mc = buildSystemMap({ ...base, concepts: [...concepts, { id: "c9", name: "Digital Identity", status: "active" }] });
  assert.ok(mc.byId.c9 && !mc.nodes.some((x) => x.id === "ext:identity"));
  assert.ok(mc.edges.some((e) => e.from === "c9" && e.to === "core:profile"));
}
console.log("system-map (new concepts): ok");

// Clean-up: internal items out, Live Visitor Profile once, fits the page
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
  ["Retailer PH instance", "Partner retailer PH instance", "Advertiser PH instance", "Data Clean Room"].forEach((n) => assert.ok(!mm.nodes.some((x) => x.name === n), `${n} is gone`));
  assert.ok(!mm.edges.some((e) => /authenticated partnership|campaign & data export|advertiser results|clean-room/.test(e.label)), "no federation links");
  const adv = mm.nodes.find((n) => n.name === "Advertiser" && n.kind === "external");
  const fed = mm.nodes.find((n) => n.name === "Federated PH Instance");
  assert.equal(fed.status, "Concept");
  const bd = mm.layout.boundary;
  assert.ok(adv.x < bd.x && fed.x < bd.x, "Advertiser and Federated PH Instance sit outside the platform box, to its left");
  const h = systemMapHTML(mm);
  assert.ok(!/min-width/.test(h) && h.includes(`viewBox="0 0 ${mm.layout.w} ${mm.layout.h}"`));
  // every node inside the drawing area
  assert.ok(mm.nodes.every((n) => n.x >= 95 && n.x <= mm.layout.w - 95 && n.y >= 50 && n.y <= mm.layout.h - 10), "all nodes within the viewBox");
  const fit = fitViewBox(mm);
  const z = zoomViewBox(fit, 2, fit.w / 2, fit.h / 2, fit);
  assert.ok(z.w === fit.w / 2 && z.x >= 0 && z.x + z.w <= fit.w);
  assert.deepEqual(zoomViewBox(fit, 0.5, fit.w / 2, fit.h / 2, fit), fit, "cannot zoom out past fit");
}
console.log("system-map (clean-up): ok");

// Federation: Advertiser and Federated PH Instance each have one line to MCP Release
{
  const mm = buildSystemMap({ ...base, projects: [...projects, { id: "mcpr", name: "MCP Release" }] });
  const mcp = mm.byId.mcpr;
  const adv = mm.nodes.find((n) => n.name === "Advertiser" && n.kind === "external");
  const fed = mm.nodes.find((n) => n.name === "Federated PH Instance");
  [adv, fed].forEach((n) => assert.equal(mm.edges.filter((e) => (e.from === n.id && e.to === mcp.id) || (e.to === n.id && e.from === mcp.id)).length, 1, `${n.name} has one line to MCP Release`));
  assert.equal(mm.edges.filter((e) => e.from === adv.id || e.to === adv.id || e.from === fed.id || e.to === fed.id).length, 2, "no other federation lines");
}
console.log("system-map (federation): ok");

// Hover descriptions: project description, concept description or README fallback, gap flagged
{
  const mm = buildSystemMap({
    projects: [{ id: "p1", name: "Described", description: "Sells ad slots.  Two sentences." }, { id: "p2", name: "Bare" }],
    concepts: [{ id: "k1", name: "From readme", readmeMd: "# Title\n\nFirst **line** of [prose](http://x).\nSecond line.\n\nLater para." }, { id: "k2", name: "Own", description: "Explicit.", readmeMd: "Ignored" }],
    interfaces: [], releases: [],
  });
  assert.equal(mm.byId.p1.desc, "Sells ad slots. Two sentences.");
  assert.equal(mm.byId.k1.desc, "First line of prose. Second line.");
  assert.equal(mm.byId.k2.desc, "Explicit.");
  const h = systemMapHTML(mm);
  const { nodeTipHTML } = await import("../public/js/system-map.js");
  assert.ok(nodeTipHTML(mm, "p1").includes("Sells ad slots. Two sentences."));
  assert.ok(nodeTipHTML(mm, "p2").includes("No description yet"), "a project with no description is flagged");
  assert.ok(h.includes('data-node-id="p1"'), "still click-through");
  assert.ok(shortDescription("word ".repeat(100)).length <= 221 && shortDescription("word ".repeat(100)).endsWith("…"));
  assert.equal(shortDescription("", "```\ncode\n```\n- item one"), "item one");
}
console.log("system-map descriptions: ok");

// Hover tooltips: live details for nodes and lines
{
  const { nodeTipHTML, edgeTipHTML, ticketCounts } = await import("../public/js/system-map.js");
  const mm = buildSystemMap({ ...base, concepts: [{ id: "c1", name: "Experience Templates", status: "active", description: "Builds <b>experiences</b>", updatedAt: new Date(Date.UTC(2026, 9, 20)) }],
    interfaces: [{ id: "i1", name: "A ↔ B", flowLabel: "audience segments", contentMd: "Segments flow from A to B.", endpoints: [{ type: "project", id: "dsp" }, { type: "concept", id: "c1" }], projectIds: ["dsp", "c1"] }] });
  const counts = ticketCounts([{ projectId: "dsp", status: "backlog" }, { projectId: "dsp", status: "backlog" }, { projectId: "dsp", status: "ready-for-testing" }]);
  const p = nodeTipHTML(mm, "dsp", counts);
  assert.ok(p.includes("Release 5.0") && p.includes("Project") && p.includes("Backlog 2") && p.includes("Ready for Testing 1") && p.includes("Feeds") && p.includes("Fed by"));
  const c = nodeTipHTML(mm, "c1", counts);
  assert.ok(c.includes("20 Oct 2026") && c.includes("Builds &lt;b&gt;experiences") && !c.includes("Tickets"));
  const idx = mm.edges.findIndex((e) => e.interfaceId === "i1");
  const e = edgeTipHTML(mm, idx);
  assert.ok(e.includes("A ↔ B") && e.includes("Direction") && e.includes("→") && e.includes("Segments flow from A to B") && e.includes("open the contract"));
  const h = systemMapHTML(mm);
  assert.ok(h.includes(`data-tip-edge="${idx}"`) && h.includes('data-tip-node="dsp"') && !h.includes("<title>Display"));
  console.log("system-map tooltips: ok");
}

// Layout: nothing overlaps, the platform is centred, labels are clear — at every breakpoint
{
  const projectsMany = [
    { id: "dsp", name: "Display Types & DSP Integration", releaseId: "r5" },
    { id: "ret", name: "Retail Media Insights & Analytics Dashboards" },
    { id: "pp", name: "Products and Pricing Prototype" },
    { id: "mcpr", name: "MCP Release" },
    { id: "rtb", name: "RTB Bidding" },
    { id: "vp", name: "Live Visitor Profile & Personas" },
    { id: "x1", name: "Extra project one" }, { id: "x2", name: "Extra project two" }, { id: "x3", name: "Extra project three" },
  ];
  const conceptsMany = [
    { id: "et", name: "Experience Templates", status: "active" },
    { id: "id", name: "Digital Identity Management", status: "active" },
    { id: "ed", name: "Custom & Edge Models", status: "active" },
    { id: "off", name: "Offsite Retail Media", status: "active" },
    { id: "fed", name: "Federated Retail Media", status: "active" },
    { id: "k1", name: "Idea one", status: "active" }, { id: "k2", name: "Idea two", status: "active" },
  ];
  const ifaces = [
    { id: "i1", name: "VP ↔ DSP", flowLabel: "audience segments", projectIds: ["vp", "dsp"] },
    { id: "i2", name: "Pricing ↔ Templates", projectIds: ["pp", "et"] },
    { id: "i3", name: "Insights ↔ DSP", flowLabel: "campaign results", projectIds: ["ret", "dsp"] },
  ];
  const full = { projects: projectsMany, concepts: conceptsMany, interfaces: ifaces, releases };
  const textBoxOK = (r, w, h) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
  for (const [mode, widths] of [["narrow", [390, 820]], ["wide", [1180, 1440, 1920]]]) {
    for (const width of widths) {
      for (const [label, base] of [["sparse", { projects: [], concepts: [], interfaces: [], releases: [] }], ["typical", base_()], ["full", full]]) {
        const mm = layoutSystemMap(buildSystemMap(base), { width });
        const L = mm.layout;
        const ctx = `${label} @${width}px (${mode})`;
        assert.equal(L.mode, mode, ctx);
        // fit-to-page: the drawing is one viewBox, no fixed pixel width
        assert.ok(!/min-width|width="\d+px"/.test(systemMapHTML(mm)), ctx);
        // nodes inside the drawing, none overlapping another (status label included)
        mm.nodes.forEach((n) => assert.ok(textBoxOK(nodeBox(n), L.w, L.h), `${ctx}: ${n.name} inside the drawing`));
        for (let i = 0; i < mm.nodes.length; i++) {
          for (let j = i + 1; j < mm.nodes.length; j++) {
            const a = nodeBox(mm.nodes[i]);
            const b = nodeBox(mm.nodes[j]);
            const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            assert.ok(!hit, `${ctx}: ${mm.nodes[i].name} overlaps ${mm.nodes[j].name}`);
          }
        }
        // the platform boundary is centred and holds exactly the core nodes
        assert.ok(Math.abs(L.boundary.x + L.boundary.w / 2 - L.w / 2) < 1, `${ctx}: platform centred horizontally`);
        const nonPiiH = L.pii.y - 34;
        assert.ok(Math.abs(L.boundary.y + L.boundary.h / 2 - nonPiiH / 2) < 1, `${ctx}: platform centred vertically`);
        mm.nodes.forEach((n) => {
          const inside = n.x >= L.boundary.x && n.x <= L.boundary.x + L.boundary.w && n.y >= L.boundary.y && n.y <= L.boundary.y + L.boundary.h;
          assert.equal(inside, n.kind === "core" || !!n.coreSlot, `${ctx}: ${n.name} ${inside ? "inside" : "outside"} the platform box`);
        });
        // every label is on the drawing, clear of every node and of every other label
        const rects = [];
        mm.edges.forEach((e) => {
          if (!e.geom || !e.geom.label) return;
          const lb = e.geom.label;
          assert.ok(lb.clear, `${ctx}: label "${e.label}" has a clear spot`);
          assert.ok(textBoxOK(lb.r, L.w, L.h), `${ctx}: label "${e.label}" inside the drawing`);
          mm.nodes.forEach((n) => {
            const b = nodeBox(n);
            assert.ok(!(lb.r.x < b.x + b.w && b.x < lb.r.x + lb.r.w && lb.r.y < b.y + b.h && b.y < lb.r.y + lb.r.h), `${ctx}: label "${e.label}" overlaps ${n.name}`);
          });
          rects.forEach(([t, r]) => assert.ok(!(lb.r.x < r.x + r.w && r.x < lb.r.x + lb.r.w && lb.r.y < r.y + r.h && r.y < lb.r.y + lb.r.h), `${ctx}: labels "${e.label}" and "${t}" overlap`));
          rects.push([e.label, lb.r]);
        });
      }
    }
  }
  function base_() { return { projects: projectsMany.slice(0, 4), concepts: conceptsMany.slice(0, 3), interfaces: ifaces.slice(0, 1), releases }; }
}
console.log("system-map (layout, 390/820/1180/1440/1920): ok");
