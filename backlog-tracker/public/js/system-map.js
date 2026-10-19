// The Concept Incubator's hero: ONE live system map of how every part of
// Personalisation Hub fits together (C4-style system context view).
//
// Pure functions, no DOM and no Firestore, so the unit test can drive them:
//   buildSystemMap({projects, concepts, interfaces, releases}) -> {nodes, edges}
//   systemMapHTML(model, {release}) -> an <svg> string
//
// Three kinds of node:
//   core     the PH platform backbone (not board entries) — status "Live"
//   project  every non-archived board project — "Project", or "Live" once
//            its release is marked live
//   concept  every un-promoted Concept Incubator concept — "Concept"
// A promoted concept is drawn as its project, never twice.
//
// Lines come from two places:
//   * the board's interface contracts — one line per contract, so adding an
//     interface adds a line with no code change (clickable: opens it)
//   * SYSTEM_MAP_LINKS below — the platform's own structure plus how a named
//     project or concept plugs into it (decided on ticket YyZwqyUOvEmkivV31jzo)
// A contract may carry an optional `flowLabel` ("audience segments"); without
// one the line is labelled with the contract's name.

export const SYSTEM_MAP_CORE = [
  { key: "campaigns", name: "Campaigns & Experiences", sub: "Personalised, real-time experiences", x: 760, y: 480 },
  { key: "harness", name: "Agent Harness", sub: "LangChain — creates, drives, optimises", x: 760, y: 300 },
  { key: "mcp", name: "MCP Access", sub: "Agents connect via MCP", x: 760, y: 160 },
  { key: "vector", name: "Vector Database", sub: "Insights store", x: 1080, y: 300 },
  { key: "devices", name: "Devices & Touchpoints", sub: "Displays, mobile, kiosks", x: 1080, y: 480 },
  { key: "profile", name: "Live Visitor Profile", sub: "Personalised campaigns", x: 470, y: 400 },
  { key: "store", name: "Store Data", sub: "Localised campaigns", x: 470, y: 560 },
];

// Lines with a core end and nothing else. `loop` marks the closed
// insights loop, drawn prominently; `kind` colours demand vs supply.
const CORE_LINKS = [
  { from: "profile", to: "campaigns", label: "personalised campaigns" },
  { from: "store", to: "campaigns", label: "localised campaigns" },
  { from: "harness", to: "campaigns", label: "creates, drives & optimises", loop: true },
  { from: "campaigns", to: "devices", label: "experiences to consumers", loop: true },
  { from: "devices", to: "vector", label: "insights feedback", loop: true },
  { from: "vector", to: "harness", label: "insights for optimisation", loop: true },
  { from: "mcp", to: "harness", label: "MCP tools" },
];

// How a named project / concept plugs into the platform. `match` is tested
// against the name; `anchor` is the core node it is drawn beside; `links`
// end at a core key, `self`, or { name: regex } for another board node.
export const SYSTEM_MAP_LINKS = [
  { match: /display types|dsp integration/i, anchor: "devices", links: [
    { from: "self", to: "campaigns", label: "advertiser demand", kind: "demand" },
    { from: "devices", to: "self", label: "inventory: slots & playlists", kind: "supply" },
  ] },
  { match: /experience templates/i, anchor: "campaigns", links: [
    { from: "self", to: "campaigns", label: "builds experiences in real time" },
    { from: "profile", to: "self", label: "visitor profile" },
    { from: "store", to: "self", label: "store data" },
  ] },
  { match: /products? and pricing|product, pricing/i, anchor: "store", links: [
    { from: "self", to: { name: /experience templates/i }, label: "products, pricing & assets" },
  ] },
  { match: /retail media insights/i, anchor: "vector", links: [
    { from: "vector", to: "self", label: "reads insights" },
  ] },
  { match: /live visitor profile/i, anchor: "profile", links: [
    { from: "self", to: "profile", label: "extends", dotted: true },
  ] },
  { match: /rtb|bidding/i, anchor: "devices", links: [
    { from: "self", to: { name: /display types|dsp integration/i }, label: "bidding support" },
  ] },
  { match: /mcp release|backlog tracker/i, anchor: "mcp", links: [
    { from: "self", to: "mcp", label: "extends", dotted: true },
  ] },
  { match: /customer support/i, anchor: "team", links: [
    { from: "self", to: "team", label: "support" },
  ] },
];

const TEAM_NODE = {
  key: "team", kind: "external", name: "PH Team", sub: "Help / FAQ, support, feature requests, Customer Success",
  x: 1490, y: 690, status: "External",
};

const W = 1620;
const H = 900;
const NODE_W = 220;
const NODE_H = 56;

export function releaseLabel(r) {
  if (!r) return "";
  return `Release ${r.version || r.name}`;
}

export function buildSystemMap({ projects = [], concepts = [], interfaces = [], releases = [] }) {
  const relById = {};
  releases.forEach((r) => { relById[r.id] = r; });
  const nodes = [];
  const byId = {};
  const add = (n) => { nodes.push(n); if (n.id) byId[n.id] = n; return n; };

  SYSTEM_MAP_CORE.forEach((c) => add({ ...c, id: `core:${c.key}`, kind: "core", status: "Live" }));
  add({ ...TEAM_NODE, id: "core:team" });

  const live = projects.filter((p) => !p.archived && p.id !== "general");
  live.forEach((p) => {
    const rel = relById[p.releaseId] || null;
    add({
      id: p.id, kind: "project", name: p.name || p.id,
      status: rel && rel.status === "live" ? "Live" : "Project",
      releaseId: rel ? rel.id : null, release: rel ? releaseLabel(rel) : "",
      href: p.artifactUrl || "",
    });
  });
  concepts.filter((c) => c.status !== "promoted").forEach((c) => {
    add({ id: c.id, kind: "concept", name: c.name || c.id, status: "Concept", href: c.artifactUrl || "" });
  });
  // Contracts name a promoted concept by its old id; point them at the project.
  const alias = {};
  concepts.filter((c) => c.status === "promoted" && c.promotedProjectId).forEach((c) => { alias[c.id] = c.promotedProjectId; });

  const coreId = (k) => `core:${k}`;
  const edges = [];
  CORE_LINKS.forEach((l) => edges.push({ ...l, from: coreId(l.from), to: coreId(l.to), source: "platform" }));

  const resolve = (ref, self) => {
    if (ref === "self") return self;
    if (typeof ref === "string") return byId[coreId(ref)] || null;
    return nodes.find((n) => n.kind !== "core" && ref.name.test(n.name)) || null;
  };
  const anchors = {}; // satellite id -> core key it is drawn beside
  nodes.filter((n) => n.kind === "project" || n.kind === "concept").forEach((n) => {
    const cfg = SYSTEM_MAP_LINKS.find((c) => c.match.test(n.name));
    if (cfg) {
      anchors[n.id] = cfg.anchor;
      cfg.links.forEach((l) => {
        const a = resolve(l.from, n);
        const b = resolve(l.to, n);
        if (a && b) edges.push({ from: a.id, to: b.id, label: l.label, kind: l.kind, dotted: l.dotted, source: "platform" });
      });
    }
  });

  // One line per interface contract.
  interfaces.forEach((f) => {
    const eps = (Array.isArray(f.endpoints) && f.endpoints.length === 2
      ? f.endpoints.map((e) => e.id)
      : Array.isArray(f.projectIds) ? f.projectIds : []).map((id) => alias[id] || id);
    if (eps.length !== 2 || !byId[eps[0]] || !byId[eps[1]] || eps[0] === eps[1]) return;
    edges.push({ from: eps[0], to: eps[1], label: f.flowLabel || f.name || "Interface", interfaceId: f.id, anchorId: eps[0], source: "contract" });
  });

  layoutSatellites(nodes, anchors);
  return { nodes, edges, byId };
}

// Each core node has fixed slots for the projects/concepts drawn beside it,
// so nothing overlaps and the picture stays readable as the board grows.
// Past the listed slots a node steps further out along the last slot's axis.
const SLOTS = {
  mcp: [[470, 140], [470, 230]],
  profile: [[135, 330], [135, 430]],
  store: [[135, 560], [135, 660]],
  campaigns: [[760, 750], [520, 750], [1000, 750]],
  vector: [[1490, 250], [1490, 160]],
  devices: [[1490, 430], [1490, 530]],
  team: [[1490, 810]],
};
function layoutSatellites(nodes, anchors) {
  const used = {};
  const loose = [];
  nodes.forEach((n) => {
    if (n.kind !== "project" && n.kind !== "concept") return;
    const a = anchors[n.id];
    if (!a) { loose.push(n); return; }
    const slots = SLOTS[a];
    const i = used[a] = (used[a] || 0) + 1;
    const [sx, sy] = slots[Math.min(i - 1, slots.length - 1)];
    const extra = Math.max(0, i - slots.length);
    n.x = sx; n.y = sy + extra * 100;
  });
  loose.forEach((n, i) => { n.x = 135 + i * 250; n.y = 860; });
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Where a line leaves/enters a node: the point on its box edge facing the other end.
function edgePoint(n, toward) {
  const dx = toward.x - n.x;
  const dy = toward.y - n.y;
  if (!dx && !dy) return { x: n.x, y: n.y };
  const sx = (NODE_W / 2) / Math.abs(dx || 1e-9);
  const sy = (NODE_H / 2) / Math.abs(dy || 1e-9);
  const s = Math.min(sx, sy);
  return { x: n.x + dx * s, y: n.y + dy * s };
}

function wrap(text, max) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  words.forEach((w) => {
    if ((cur + " " + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  });
  if (cur) lines.push(cur);
  return lines;
}

export function highlightedIds(model, releaseId) {
  if (!releaseId) return null;
  const inRelease = new Set(model.nodes.filter((n) => n.releaseId === releaseId).map((n) => n.id));
  const nodes = new Set(inRelease);
  const touching = new Set();
  model.edges.forEach((e, i) => {
    if (inRelease.has(e.from) || inRelease.has(e.to)) { touching.add(i); nodes.add(e.from); nodes.add(e.to); }
  });
  return { nodes, edges: touching };
}

export function systemMapHTML(model, { release = "" } = {}) {
  const hi = highlightedIds(model, release);
  const nodeDim = (n) => (hi && !hi.nodes.has(n.id) ? " dim" : "");
  const edgeDim = (i) => (hi && !hi.edges.has(i) ? " dim" : "");
  const byId = model.byId;
  let svg = `<svg class="sysmap-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Personalisation Hub system map">
    <defs>
      <marker id="sm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker>
    </defs>
    <rect class="sysmap-boundary" x="320" y="70" width="880" height="770" rx="8"/>
    <text class="sysmap-boundary-label" x="336" y="94">Personalisation Hub platform</text>`;

  model.edges.forEach((e, i) => {
    const a = byId[e.from];
    const b = byId[e.to];
    if (!a || !b) return;
    const p = edgePoint(a, b);
    const q = edgePoint(b, a);
    const cls = ["sysmap-edge", e.kind || "", e.loop ? "loop" : "", e.dotted ? "dotted" : "", e.interfaceId ? "clickable" : "", edgeDim(i)].filter(Boolean).join(" ");
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    const lines = wrap(e.label, 22);
    const attrs = e.interfaceId ? ` data-interface-id="${esc(e.interfaceId)}" data-anchor-id="${esc(e.anchorId)}" tabindex="0" role="button"` : "";
    // Contract lines bow sideways so they don't run straight through other boxes.
    const bow = e.interfaceId ? 0.18 : e.kind ? 0.14 : 0;
    const cxp = mx - (q.y - p.y) * bow;
    const cyp = my + (q.x - p.x) * bow;
    const curved = bow !== 0;
    const lx = curved ? (p.x + 2 * cxp + q.x) / 4 : mx;
    const ly = curved ? (p.y + 2 * cyp + q.y) / 4 : my;
    const d = `M${p.x} ${p.y} Q${cxp} ${cyp} ${q.x} ${q.y}`;
    const lbl = lines.map((t, k) => `<text class="sysmap-edge-label" x="${lx}" y="${ly + (k - (lines.length - 1) / 2) * 12 + 4}" text-anchor="middle">${esc(t)}</text>`).join("");
    const w = Math.max(...lines.map((t) => t.length)) * 5.6 + 10;
    svg += `<g class="${cls}"${attrs}><title>${esc(e.label)}${e.interfaceId ? " — open interface contract" : ""}</title>
      <path class="sysmap-hit" d="${d}"/>
      <path class="sysmap-line" d="${d}" marker-end="url(#sm-arrow)"/>
      <rect class="sysmap-edge-bg" x="${lx - w / 2}" y="${ly - lines.length * 6 - 2}" width="${w}" height="${lines.length * 12 + 4}" rx="3"/>${lbl}</g>`;
  });

  model.nodes.forEach((n) => {
    const x = n.x - NODE_W / 2;
    const y = n.y - NODE_H / 2;
    const clickable = n.kind === "project" || n.kind === "concept";
    const cls = `sysmap-node ${n.kind} s-${String(n.status).toLowerCase()}${clickable ? " clickable" : ""}${nodeDim(n)}`;
    const attrs = clickable ? ` data-node-id="${esc(n.id)}" data-node-kind="${n.kind}" tabindex="0" role="link"` : "";
    const sub = wrap(n.sub || "", 30).slice(0, 2);
    svg += `<g class="${cls}"${attrs}><title>${esc(n.name)} — ${esc(n.status)}${n.release ? ` — ${esc(n.release)}` : ""}</title>
      <rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="8"/>
      <text class="sysmap-node-name" x="${n.x}" y="${y + 20}" text-anchor="middle">${esc(n.name.length > 34 ? n.name.slice(0, 33) + "…" : n.name)}</text>
      ${sub.map((t, k) => `<text class="sysmap-node-sub" x="${n.x}" y="${y + 34 + k * 11}" text-anchor="middle">${esc(t)}</text>`).join("")}
      <text class="sysmap-node-status" x="${x + 8}" y="${y - 5}">${esc(n.status)}</text>
      ${n.release ? `<text class="sysmap-node-release" x="${x + NODE_W}" y="${y - 5}" text-anchor="end">${esc(n.release)}</text>` : ""}</g>`;
  });
  return svg + "</svg>";
}

export function systemMapLegendHTML() {
  return `<span class="sysmap-key s-live">Live</span><span class="sysmap-key s-project">Project</span><span class="sysmap-key s-concept">Concept</span><span class="sysmap-key s-external">External</span>
    <span class="sysmap-key line-demand">Demand (advertiser)</span><span class="sysmap-key line-supply">Supply (SSP)</span><span class="sysmap-key line-loop">Insights loop</span>`;
}
