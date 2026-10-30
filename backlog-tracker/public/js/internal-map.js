// The Concept Incubator's second map: how Personalisation Hub runs INTERNALLY
// (ticket ufOwuueuj1f5vmeN0xi2, Rob's sketch of 30 Oct 2026). Left to right:
// Customer Success, PH in the middle, Sales on the right; Feature Release
// along the top (step 2); the FAQs DB (step 1) under PH.
//
// Pure functions, no DOM and no Firestore, so the unit test can drive them:
//   buildInternalMap({projects, concepts}) -> {nodes, edges, notes, zones, layout, byId}
//   internalMapHTML(model) -> an <svg> string
//
// The layout is fixed (the sketch), not pinned or saved like the Platform
// map. Board entries typed "Internal operations", and entries with no type
// yet (badged "Unassigned"), sit in a strip under the sketch. Anything here
// that belongs to the platform is a dashed BRIDGE node inside the PH box,
// not a second copy of a platform item: clicking one opens the Platform map.

import { typeOf, inTypeView, TYPE_INTERNAL } from "./entity-type.js";

export const INTERNAL_W = 1500;
const NODE_W = 180;
const NODE_H = 56;
const STRIP_COLS = 7;
const STRIP_GAP_X = 210;
const STRIP_GAP_Y = 96;

// Fixed zones: the three columns and the Feature Release band.
export const INTERNAL_ZONES = [
  { key: "release", name: "Feature Release", step: 2, x: 300, y: 24, w: 900, h: 140 },
  { key: "cs", name: "Customer Success", x: 24, y: 190, w: 320, h: 660 },
  { key: "ph", name: "Personalisation Hub (PH)", x: 560, y: 190, w: 380, h: 430 },
  { key: "sales", name: "Sales", x: 1060, y: 190, w: 416, h: 660 },
];

// kind: fixed (an internal part of the sketch) | bridge (a PH platform node,
// dashed, click opens the Platform map). a step field draws the numbered marker.
export const INTERNAL_NODES = [
  { key: "requests", kind: "fixed", name: "Prioritised requests", sub: "From the Customer Success queue", x: 420, y: 100 },
  { key: "pipeline", kind: "fixed", name: "Release pipeline", sub: "Releases pass a gate, then go live", x: 710, y: 100 },
  { key: "live", kind: "fixed", name: "Live releases", sub: "Feed the FAQs DB", x: 1000, y: 100 },

  { key: "clients", kind: "fixed", name: "Clients", sub: "Submit new feature requests", x: 214, y: 250 },
  { key: "agents", kind: "fixed", name: "Customer Success agents", sub: "One agent per client", x: 214, y: 360 },
  { key: "reqqueue", kind: "fixed", name: "Feature request queue", sub: "Agents vote and prioritise", x: 214, y: 470 },
  { key: "casestudies", kind: "fixed", name: "Case studies", sub: "Feed Customer Success", x: 214, y: 600 },

  { key: "embedded", kind: "bridge", name: "Embedded support", sub: "FAQ panel inside PH", x: 690, y: 280, bridgeTo: "Platform: PH platform" },
  { key: "mcp", kind: "bridge", name: "MCP Access", sub: "Agents connect per client", x: 690, y: 400, bridgeTo: "Platform: MCP Access" },
  { key: "phreleases", kind: "bridge", name: "PH releases", sub: "Release-specific content", x: 690, y: 520, bridgeTo: "Platform: releases" },

  { key: "faqs", kind: "fixed", name: "FAQs DB", sub: "Replaces Freshdesk", x: 750, y: 780, step: 1 },

  { key: "ads", kind: "fixed", name: "Ads, Social posts & PR", sub: "Release-specific content", x: 1160, y: 260 },
  { key: "website", kind: "fixed", name: "PH website", sub: "Connects to Sales agents", x: 1160, y: 520 },
  { key: "prospects", kind: "fixed", name: "Prospects & brands", sub: "Talk to Sales agents", x: 1370, y: 260 },
  { key: "salesagents", kind: "fixed", name: "Sales agents", sub: "Talk to prospects", x: 1370, y: 440 },
  { key: "email", kind: "fixed", name: "Support email", sub: "Sales agents and the FAQs DB", x: 1370, y: 700 },
];

// `via` are waypoints; the line leaves and enters on each box's edge.
export const INTERNAL_EDGES = [
  { from: "clients", to: "agents", label: "talk to", both: true },
  { from: "clients", to: "reqqueue", label: "feature requests", via: [[64, 250], [64, 470]] },
  { from: "agents", to: "reqqueue", label: "vote & prioritise" },
  { from: "casestudies", to: "agents", label: "case studies", via: [[44, 600], [44, 360]] },
  { from: "agents", to: "mcp", label: "MCP, per client" },
  { from: "reqqueue", to: "requests", label: "prioritised", via: [[354, 470], [354, 100]] },
  { from: "requests", to: "pipeline", label: "build" },
  { from: "pipeline", to: "live", label: "gate, then live" },
  { from: "live", to: "faqs", label: "live releases", via: [[1000, 128], [1000, 790]] },
  { from: "embedded", to: "faqs", label: "API: support embedded via platform", via: [[880, 280], [880, 690], [750, 690]], both: true },
  { from: "phreleases", to: "ads", label: "release content", dotted: true },
  { from: "faqs", to: "email", label: "FAQ answers" },
  { from: "faqs", to: "website", label: "FAQ answers" },
  { from: "website", to: "salesagents", label: "connects" },
  { from: "ads", to: "salesagents", label: "feeds in" },
  { from: "salesagents", to: "prospects", label: "talk to", both: true },
  { from: "salesagents", to: "email", label: "connect", both: true },
];

// September focus, shown as notes under the sketch.
export const SEPTEMBER_FOCUS = [
  { step: 1, text: "Get rid of Freshdesk, replaced by the FAQs DB and support." },
  { step: 2, text: "Get rid of Atlassian (about $60 a seat), replaced by the Feature Release pipeline and Staff Kanban." },
];

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function wrap(text, max) {
  const lines = [];
  let cur = "";
  String(text).split(/\s+/).forEach((w) => {
    if ((cur + " " + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  });
  if (cur) lines.push(cur);
  return lines;
}

// Where a line leaves/enters a box: the point on its edge facing `toward`.
function edgePoint(n, toward) {
  const dx = toward.x - n.x;
  const dy = toward.y - n.y;
  if (!dx && !dy) return { x: n.x, y: n.y };
  const s = Math.min((NODE_W / 2) / Math.abs(dx || 1e-9), (NODE_H / 2) / Math.abs(dy || 1e-9));
  return { x: n.x + dx * s, y: n.y + dy * s };
}

export function buildInternalMap({ projects = [], concepts = [] } = {}) {
  const nodes = INTERNAL_NODES.map((n) => ({ ...n, id: `int:${n.key}` }));
  const byId = {};
  nodes.forEach((n) => { byId[n.id] = n; });

  // Board entries for this side: typed Internal operations, or not typed yet.
  const items = [];
  projects.filter((p) => !p.archived && p.id !== "general" && inTypeView(p, TYPE_INTERNAL)).forEach((p) => {
    items.push({ id: p.id, kind: "project", name: p.name || p.id, status: "Project", unassigned: !typeOf(p), type: typeOf(p), href: p.artifactUrl || "" });
  });
  concepts.filter((c) => c.status !== "promoted" && inTypeView(c, TYPE_INTERNAL)).forEach((c) => {
    items.push({ id: c.id, kind: "concept", name: c.name || c.id, status: "Concept", unassigned: !typeOf(c), type: typeOf(c), href: c.artifactUrl || "" });
  });
  items.sort((a, b) => a.name.localeCompare(b.name));

  const stripTop = 910;
  const rows = Math.max(1, Math.ceil(items.length / STRIP_COLS));
  items.forEach((it, i) => {
    it.x = 24 + NODE_W / 2 + (i % STRIP_COLS) * STRIP_GAP_X + 6;
    it.y = stripTop + 92 + Math.floor(i / STRIP_COLS) * STRIP_GAP_Y;
    nodes.push(it);
    byId[it.id] = it;
  });
  const stripH = 56 + (items.length ? rows * STRIP_GAP_Y : 50);
  const notesTop = stripTop + stripH + 16;
  const notes = SEPTEMBER_FOCUS.map((n, i) => ({ ...n, x: 24 + i * 742, y: notesTop + 34, w: 730, lines: wrap(n.text, 100) }));
  const notesH = 34 + 20 * Math.max(...notes.map((n) => n.lines.length)) + 24;
  const H = notesTop + notesH + 16;

  const edges = INTERNAL_EDGES.map((e) => ({ ...e, from: `int:${e.from}`, to: `int:${e.to}` }));
  edges.forEach((e) => {
    const a = byId[e.from];
    const b = byId[e.to];
    const pts = (e.via || []).map(([x, y]) => ({ x, y }));
    const p = edgePoint(a, pts[0] || b);
    const q = edgePoint(b, pts[pts.length - 1] || a);
    e.path = [p, ...pts, q];
    // The label sits on the longest straight stretch.
    let best = 0, at = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    for (let i = 0; i + 1 < e.path.length; i++) {
      const len = Math.hypot(e.path[i + 1].x - e.path[i].x, e.path[i + 1].y - e.path[i].y);
      if (len > best) { best = len; at = { x: (e.path[i].x + e.path[i + 1].x) / 2, y: (e.path[i].y + e.path[i + 1].y) / 2 }; }
    }
    e.labelAt = at;
  });

  return {
    nodes, edges, notes, byId, items,
    zones: INTERNAL_ZONES,
    strip: { top: stripTop, h: stripH },
    layout: { w: INTERNAL_W, h: H, mode: "internal" },
  };
}

export function internalMapHTML(model) {
  const { w: W, h: H } = model.layout;
  let svg = `<svg class="sysmap-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Personalisation Hub internal operations map">
    <defs>
      <marker id="im-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#6b7177"/></marker>
    </defs>`;
  model.zones.forEach((z) => {
    svg += `<g class="intmap-zone intmap-zone-${z.key}"><rect class="sysmap-boundary" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="8"/>
      <text class="sysmap-boundary-label" x="${z.x + 16}" y="${z.y + 22}">${esc(z.name)}</text>${z.step ? stepBadge(z.x + z.w - 22, z.y + 22, z.step) : ""}</g>`;
  });
  model.edges.forEach((e) => {
    const d = e.path.map((pt, i) => `${i ? "L" : "M"}${Math.round(pt.x * 10) / 10} ${Math.round(pt.y * 10) / 10}`).join(" ");
    const lines = wrap(e.label, 16);
    const lw = Math.max(...lines.map((t) => t.length)) * 6.3 + 10;
    const lh = lines.length * 12 + 6;
    const lbl = lines.map((t, k) => `<text class="sysmap-edge-label" x="${Math.round(e.labelAt.x)}" y="${Math.round(e.labelAt.y + (k - (lines.length - 1) / 2) * 12 + 4)}" text-anchor="middle">${esc(t)}</text>`).join("");
    svg += `<g class="sysmap-edge${e.dotted ? " dotted" : ""}"><path class="sysmap-line" d="${d}" marker-end="url(#im-arrow)"${e.both ? ' marker-start="url(#im-arrow)"' : ""}/>
      <rect class="sysmap-edge-bg" x="${Math.round(e.labelAt.x - lw / 2)}" y="${Math.round(e.labelAt.y - lh / 2)}" width="${Math.round(lw)}" height="${lh}" rx="3"/>${lbl}</g>`;
  });
  svg += `<text class="sysmap-boundary-label" x="24" y="${model.strip.top + 22}">Internal operations items on the board</text>`;
  if (!model.items.length) {
    svg += `<text class="sysmap-node-sub" x="24" y="${model.strip.top + 54}">No concepts or projects are typed Internal operations yet.</text>`;
  }
  model.nodes.forEach((n) => {
    const x = n.x - NODE_W / 2;
    const y = n.y - NODE_H / 2;
    const board = n.kind === "project" || n.kind === "concept";
    const bridge = n.kind === "bridge";
    const cls = `sysmap-node intmap-${n.kind}${board ? " clickable s-" + n.status.toLowerCase() : ""}${bridge ? " clickable intmap-bridge" : ""}`;
    const attrs = board || bridge
      ? ` data-node-id="${esc(n.id)}" data-node-kind="${n.kind}" tabindex="0" role="link" aria-label="${esc(n.name)}${bridge ? " — opens the Platform map" : ""}"`
      : "";
    const sub = n.sub ? wrap(n.sub, 29).slice(0, 2) : [];
    const name = n.name.length > 25 ? n.name.slice(0, 24) + "…" : n.name;
    svg += `<g class="${cls}"${attrs}>
      <rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="8"/>
      <text class="sysmap-node-name" x="${n.x}" y="${y + 20}" text-anchor="middle">${esc(name)}</text>
      ${sub.map((t, k) => `<text class="sysmap-node-sub" x="${n.x}" y="${y + 34 + k * 11}" text-anchor="middle">${esc(t)}</text>`).join("")}
      ${bridge ? `<text class="sysmap-node-status" x="${x + 8}" y="${y - 5}">Platform</text>` : ""}
      ${board ? `<text class="sysmap-node-status" x="${x + 8}" y="${y - 5}">${esc(n.status)}${n.unassigned ? '<tspan class="sysmap-node-unassigned" dx="8">Unassigned</tspan>' : ""}</text>` : ""}
      ${n.step ? stepBadge(x + NODE_W - 4, y - 2, n.step) : ""}</g>`;
  });
  svg += `<text class="sysmap-boundary-label" x="24" y="${model.notes[0].y - 14}">September focus</text>`;
  model.notes.forEach((n) => {
    svg += `<g class="intmap-note"><rect class="intmap-note-box" x="${n.x}" y="${n.y}" width="${n.w}" height="${20 * n.lines.length + 24}" rx="8"/>
      ${stepBadge(n.x + 24, n.y + 24, n.step)}
      ${n.lines.map((t, k) => `<text class="sysmap-edge-label intmap-note-text" x="${n.x + 48}" y="${n.y + 28 + k * 20}">${esc(t)}</text>`).join("")}</g>`;
  });
  return svg + "</svg>";
}

function stepBadge(cx, cy, step) {
  return `<g class="intmap-step" aria-label="Step ${step}"><circle cx="${cx}" cy="${cy}" r="13"/><text x="${cx}" y="${cy + 5}" text-anchor="middle">${step}</text></g>`;
}

export function internalLegendHTML() {
  return `<span class="sysmap-key s-project">Project</span><span class="sysmap-key s-concept">Concept</span><span class="sysmap-key s-bridge">Bridge to the Platform map</span><span class="sysmap-key s-step">1 / 2 September focus</span>`;
}
