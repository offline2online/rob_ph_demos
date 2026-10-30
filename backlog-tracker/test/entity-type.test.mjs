// Platform / Internal operations (ticket ufOwuueuj1f5vmeN0xi2): the type
// helpers, the Platform map's filter and the Internal operations map.
import assert from "node:assert/strict";
import { ENTITY_TYPES, typeOf, inTypeView, matchesTypeFilter, typeBadgeHTML, typeOptionsHTML } from "../public/js/entity-type.js";
import { buildSystemMap, systemMapHTML } from "../public/js/system-map.js";
import { buildInternalMap, internalMapHTML, INTERNAL_ZONES, INTERNAL_NODES, INTERNAL_EDGES } from "../public/js/internal-map.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ── helpers ──
assert.deepEqual(ENTITY_TYPES, ["Platform", "Internal operations"]);
assert.equal(typeOf({ type: "Platform" }), "Platform");
assert.equal(typeOf({ type: "Product" }), "", "anything but the two values reads as unset");
assert.equal(typeOf({}), "");
assert.ok(inTypeView({}, "Platform") && inTypeView({}, "Internal operations"), "unset belongs to both views");
assert.ok(inTypeView({ type: "Platform" }, "Platform") && !inTypeView({ type: "Platform" }, "Internal operations"));
assert.ok(matchesTypeFilter({ type: "Platform" }, "all") && matchesTypeFilter({}, "unassigned") && !matchesTypeFilter({ type: "Platform" }, "unassigned"));
assert.ok(!matchesTypeFilter({ type: "Internal operations" }, "Platform"));
assert.match(typeBadgeHTML({}, esc), /Unassigned/);
assert.match(typeBadgeHTML({ type: "Internal operations" }, esc), /type-internal/);
assert.match(typeOptionsHTML("", { withEmpty: true }), /Choose a type/);
assert.match(typeOptionsHTML("all", { filter: true }), /All types[\s\S]*Platform[\s\S]*Internal operations[\s\S]*Unassigned/);

// ── Platform map: only Platform and unset items; unset ones badged ──
const projects = [
  { id: "p-plat", name: "Display Types & DSP Integration", type: "Platform" },
  { id: "p-int", name: "Staff Kanban", type: "Internal operations" },
  { id: "p-unset", name: "Mystery project" },
];
const concepts = [
  { id: "c-plat", name: "Loyalty idea", type: "Platform", status: "active" },
  { id: "c-int", name: "RevOps tooling", type: "Internal operations", status: "active" },
  { id: "c-unset", name: "Untyped idea", status: "active" },
  { id: "c-old", name: "Backlog Tracker thing", status: "active" }, // the old internal-name list still keeps this off the Platform map
];
const plat = buildSystemMap({ projects, concepts, interfaces: [], releases: [] });
assert.ok(plat.byId["p-plat"] && plat.byId["c-plat"]);
assert.ok(!plat.byId["p-int"] && !plat.byId["c-int"], "Internal operations items are not on the Platform map");
assert.ok(plat.byId["p-unset"] && plat.byId["c-unset"], "unset items are on the Platform map");
assert.equal(plat.byId["p-unset"].unassigned, true);
assert.equal(plat.byId["p-plat"].unassigned, false);
assert.ok(!plat.byId["c-old"], "an unset item the old internal-name list matches stays off the Platform map");
assert.match(systemMapHTML(plat), /sysmap-node-unassigned/);

// ── Internal operations map ──
const internal = buildInternalMap({ projects: [...projects, { id: "p-old", name: "Backlog Tracker & FAQs" }], concepts: [...concepts, { id: "c-done", name: "Promoted", status: "promoted", type: "Internal operations" }] });
const boardIds = internal.items.map((i) => i.id).sort();
assert.deepEqual(boardIds, ["c-int", "c-old", "c-unset", "p-int", "p-old", "p-unset"], "Internal operations plus unset; no Platform items, no promoted concepts");
assert.ok(internal.items.find((i) => i.id === "p-unset").unassigned);
assert.ok(!internal.items.find((i) => i.id === "p-int").unassigned);

// the sketch: Customer Success left, PH in the middle, Sales on the right, Feature Release along the top
const zone = (k) => INTERNAL_ZONES.find((z) => z.key === k);
assert.ok(zone("cs").x + zone("cs").w <= zone("ph").x && zone("ph").x + zone("ph").w <= zone("sales").x, "left to right: Customer Success, PH, Sales");
assert.ok(zone("release").y + zone("release").h <= Math.min(zone("cs").y, zone("ph").y, zone("sales").y), "Feature Release sits along the top");
const inZone = (n, z) => n.x - 90 >= z.x && n.x + 90 <= z.x + z.w && n.y - 28 >= z.y && n.y + 28 <= z.y + z.h;
const place = { requests: "release", pipeline: "release", live: "release", clients: "cs", agents: "cs", reqqueue: "cs", casestudies: "cs", embedded: "ph", mcp: "ph", phreleases: "ph", ads: "sales", website: "sales", prospects: "sales", salesagents: "sales", email: "sales" };
for (const [key, z] of Object.entries(place)) assert.ok(inZone(INTERNAL_NODES.find((n) => n.key === key), zone(z)), `${key} is inside ${z}`);
// bridge nodes are dashed PH nodes inside the PH box
assert.deepEqual(INTERNAL_NODES.filter((n) => n.kind === "bridge").map((n) => n.name), ["Embedded support", "MCP Access", "PH releases"]);
// steps 1 and 2
assert.equal(INTERNAL_NODES.find((n) => n.key === "faqs").step, 1);
assert.equal(zone("release").step, 2);
// every line joins two known nodes
const keys = new Set(INTERNAL_NODES.map((n) => n.key));
for (const e of INTERNAL_EDGES) assert.ok(keys.has(e.from) && keys.has(e.to), `${e.from}>${e.to}`);
// the lines of the sketch
const has = (a, b) => INTERNAL_EDGES.some((e) => (e.from === a && e.to === b) || (e.both && e.from === b && e.to === a));
for (const [a, b] of [["agents", "mcp"], ["casestudies", "agents"], ["reqqueue", "requests"], ["pipeline", "live"], ["live", "faqs"], ["embedded", "faqs"], ["faqs", "email"], ["faqs", "website"], ["website", "salesagents"], ["salesagents", "prospects"], ["salesagents", "email"], ["ads", "salesagents"]]) assert.ok(has(a, b), `${a} - ${b}`);
assert.ok(INTERNAL_EDGES.find((e) => e.from === "phreleases" && e.to === "ads").dotted, "a dotted line from PH releases to Ads, Social posts and PR");

const html = internalMapHTML(internal);
assert.match(html, /September focus/);
assert.match(html, /Freshdesk/);
assert.match(html, /Atlassian/);
assert.match(html, /\$60 a seat/);
assert.match(html, /Unassigned/);
assert.ok(html.includes('data-node-id="int:mcp"') && html.includes('data-node-id="p-int"'));
assert.ok(!html.includes("Loyalty idea") && !html.includes("Display Types"), "no Platform item is drawn twice on the Internal map");
assert.ok(internal.layout.w >= 1000 && internal.layout.h > 900);
// no two fixed boxes overlap
for (const a of INTERNAL_NODES) for (const b of INTERNAL_NODES) {
  if (a === b) continue;
  assert.ok(Math.abs(a.x - b.x) >= 180 || Math.abs(a.y - b.y) >= 56, `${a.key} overlaps ${b.key}`);
}
console.log("entity-type + internal map: ok");
