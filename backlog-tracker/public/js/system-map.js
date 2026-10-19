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
// Only PH product projects, product concepts and PH Core areas are drawn:
// INTERNAL_RE names the board entries that are not part of the product
// (the console itself, PH Brand, support/success) and are left out.
// Live Visitor Profile is drawn once, as a concept, in the PH Core slot.
//
// Lines come from two places:
//   * the board's interface contracts — one line per contract, so adding an
//     interface adds a line with no code change (clickable: opens it)
//   * SYSTEM_MAP_LINKS below — the platform's own structure plus how a named
//     project or concept plugs into it (decided on ticket YyZwqyUOvEmkivV31jzo)
// A contract may carry an optional `flowLabel` ("audience segments"); without
// one the line is labelled with the contract's name.

export const SYSTEM_MAP_CORE = [
  { key: "campaigns", name: "Campaigns & Experiences", sub: "Personalised, real-time experiences", x: 580, y: 400 },
  { key: "harness", name: "Agent Harness", sub: "LangChain — creates, drives, optimises", x: 580, y: 250 },
  { key: "mcp", name: "MCP Access", sub: "Agents connect via MCP", x: 580, y: 110 },
  { key: "vector", name: "Vector Database", sub: "Insights store", x: 830, y: 250 },
  { key: "devices", name: "Devices & Touchpoints", sub: "Displays, mobile, kiosks", x: 830, y: 400 },
  { key: "profile", name: "Live Visitor Profile", sub: "Personalised campaigns", x: 330, y: 330 },
  { key: "store", name: "Store Data", sub: "Localised campaigns", x: 330, y: 470 },
  { key: "checkin", name: "Check-in", sub: "PH Core", x: 830, y: 540 },
  { key: "brand", name: "Brand Guidelines", sub: "PH Core — retailer, advertiser & partnership rules", x: 830, y: 110 },
];

// Board entries that are not part of the product map.
export const INTERNAL_RE = /backlog tracker|\bph brand\b|customer (support|success)|\bph team\b/i;

// Where the Chinese wall sits: everything inside this box is on the PII
// side; everything else on the map is non-PII. Agents never cross it.
export const PII_ZONE = { x: 20, y: 860, w: 1560, h: 150 };

// Concepts that are part of the picture whether or not anyone has filed a
// Concept Incubator entry for them. If a board project/concept whose name
// matches `match` exists, that one is drawn (at this position) instead.
export const SYSTEM_MAP_CONCEPTS = [
  { key: "custom", match: /custom.*edge models?/i, name: "Custom & Edge Models", full: "Custom & Edge Models",
    sub: "PH-optimised open-weights models + edge model shop (vision, lift & learn, plates)", x: 1060, y: 570 },
  { key: "identity", match: /digital identity/i, name: "Digital Identity & Resolution", full: "Digital Identity Management & Resolution",
    sub: "Identity vault + resolution service + identity graph", x: 440, y: 940 },
  { key: "offsite", match: /offsite retail media/i, name: "Offsite Retail Media & Social", full: "Offsite Retail Media & Social Activation",
    sub: "Hashed audiences to Meta, TikTok, Google, YouTube", x: 1060, y: 330 },
  { key: "federation", match: /federated retail media/i, name: "Federated Retail Media (PH-to-PH)", full: "Federated Retail Media (PH-to-PH)",
    sub: "Peer-to-peer partnerships, no central hub", x: 1365, y: 600 },
];

// External systems and actors (C4 external style).
export const SYSTEM_MAP_EXTERNALS = [
  { key: "salesforce", name: "Salesforce CRM", sub: "PII side — consent checked here", x: 130, y: 922 },
  { key: "amazon", name: "Amazon Connect", sub: "Customer Profiles — PII side, consent checked here", x: 130, y: 982 },
  { key: "meta", name: "Meta", sub: "Offsite platform", x: 1260, y: 190 },
  { key: "tiktok", name: "TikTok", sub: "Offsite platform", x: 1470, y: 190 },
  { key: "gdisplay", name: "Google Display", sub: "Offsite platform", x: 1260, y: 260 },
  { key: "youtube", name: "YouTube", sub: "Offsite platform", x: 1470, y: 260 },
  { key: "retailerph", name: "Retailer PH instance", sub: "This retailer's Personalisation Hub", x: 1160, y: 700 },
  { key: "otherph", name: "Partner retailer PH instance", sub: "Another retailer's Personalisation Hub", x: 1470, y: 700 },
  { key: "advph", name: "Advertiser PH instance", sub: "Phase 3: advertiser runs their own PH", x: 1160, y: 800 },
  { key: "advertiser", name: "Advertiser", sub: "Phase 2: logs into the retailer's PH", x: 1470, y: 800 },
  { key: "cleanroom", name: "Data Clean Room", sub: "AWS Clean Rooms (primary); alternatives: Snowflake, LiveRamp, Google Ads Data Hub", x: 1315, y: 860 },
];

// Lines for the nodes above. Ends are a core key, a SYSTEM_MAP_CONCEPTS /
// SYSTEM_MAP_EXTERNALS key, or { name: regex } for a board node (skipped
// when no such node exists). `both` draws arrows at each end; `bow` curves it.
const AUTH = "authenticated partnership (mTLS + scoped OAuth)";
const CLEAN = "audience matching & measurement (aggregated, no raw data)";
const EXTRA_LINKS = [
  { from: "custom", to: "identity", label: "HMAC-hashed edge identifiers (e.g. plates)", bow: 0.12 },
  { from: "devices", to: "custom", label: "edge model deployment" },
  { from: "checkin", to: "identity", label: "stitching trigger", bow: 0.1 },
  { from: "salesforce", to: "identity", label: "pseudonymised attributes in / insights written back", both: true },
  { from: "amazon", to: "identity", label: "pseudonymised attributes in / insights written back", both: true },
  { from: "identity", to: "profile", label: "pseudonymous IDs + attributes", bow: -0.35 },
  { from: "vector", to: "custom", label: "retailer-owned data for model training/optimisation" },
  { from: "custom", to: "harness", label: "PH-optimised models", bow: 0.35 },
  { from: "campaigns", to: "offsite", label: "offsite experiences (retailer and advertiser)", bow: 0.1 },
  { from: { name: /experience templates/i }, to: "offsite", label: "offsite creative", bow: 0.12 },
  { from: { name: /display types|dsp integration/i }, to: "offsite", label: "advertiser offsite buys", bow: -0.12 },
  { from: "identity", to: "offsite", label: "hashed audiences (SHA-256 email)", short: "hashed audiences" },
  { from: "identity", to: "cleanroom", label: "pseudonymous IDs for clean-room matching", short: "pseudonymous IDs", bow: -0.08 },
  { from: "retailerph", to: "cleanroom", label: CLEAN, short: "audience matching (aggregated)", both: true },
  { from: "cleanroom", to: "advph", label: CLEAN, short: "audience matching (aggregated)", both: true },
  { from: "offsite", to: "meta", label: "hashed audiences (SHA-256 email)", short: "hashed audiences" },
  { from: "offsite", to: "tiktok", label: "hashed audiences (SHA-256 email)", short: "" },
  { from: "offsite", to: "gdisplay", label: "hashed audiences (SHA-256 email)", short: "" },
  { from: "offsite", to: "youtube", label: "hashed audiences (SHA-256 email)", short: "" },
  { from: "meta", to: "vector", label: "offsite exposure for closed-loop measurement", bow: 0.1 },
  { from: "tiktok", to: "vector", label: "", bow: 0.1 },
  { from: "gdisplay", to: "vector", label: "", bow: 0.1 },
  { from: "youtube", to: "vector", label: "", bow: 0.1 },
  { from: "federation", to: "retailerph", label: "extends", dotted: true },
  { from: "retailerph", to: "otherph", label: AUTH, short: "authenticated partnership", both: true },
  { from: "advph", to: "retailerph", label: AUTH, both: true, bow: -0.1 },
  { from: "retailerph", to: "advph", label: "campaign & data export (advertiser-tagged)", bow: 0.2 },
  { from: "retailerph", to: "advph", label: "advertiser results (closed loop, retailer can switch off per advertiser)", bow: -0.25 },
  { from: "advertiser", to: "retailerph", label: "Phase 2: logs into the retailer's PH" },
  { from: "advertiser", to: "advph", label: "Phase 3: runs own PH" },
  { from: { name: /mcp release/i }, to: "advertiser", label: "Phase 2 advertiser access", bow: 0.2 },
  { from: "brand", to: "harness", label: "brand rules for asset creation (jointly branded assets for the retailer's network)" },
  { from: "brand", to: { name: /experience templates/i }, label: "brand rules for asset creation", bow: 0.2 },
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
  { match: /rtb|bidding/i, anchor: "devices", links: [
    { from: "self", to: { name: /display types|dsp integration/i }, label: "bidding support" },
  ] },
  { match: /mcp release/i, anchor: "mcp", links: [
    { from: "self", to: "mcp", label: "extends", dotted: true },
  ] },
];

const W = 1600;
const H = 1040;
const NODE_W = 190;
const NODE_H = 52;
export const SYSTEM_MAP_SIZE = { w: W, h: H };

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

  const live = projects.filter((p) => !p.archived && p.id !== "general" && !INTERNAL_RE.test(p.name || ""));
  live.forEach((p) => {
    const rel = relById[p.releaseId] || null;
    add({
      id: p.id, kind: "project", name: p.name || p.id,
      status: rel && rel.status === "live" ? "Live" : "Project",
      releaseId: rel ? rel.id : null, release: rel ? releaseLabel(rel) : "",
      href: p.artifactUrl || "",
    });
  });
  concepts.filter((c) => c.status !== "promoted" && !INTERNAL_RE.test(c.name || "")).forEach((c) => {
    add({ id: c.id, kind: "concept", name: c.name || c.id, status: "Concept", href: c.artifactUrl || "" });
  });
  // Live Visitor Profile: one node, a concept, in the PH Core slot.
  const placed = []; // [node, x, y] board nodes pinned to a fixed position
  const vp = nodes.find((n) => (n.kind === "project" || n.kind === "concept") && /live visitor profile/i.test(n.name));
  if (vp) {
    const slot = nodes.find((n) => n.id === "core:profile");
    nodes.splice(nodes.indexOf(slot), 1);
    byId["core:profile"] = vp;
    if (vp.kind === "project") { vp.kind = "concept"; vp.status = "Concept"; vp.release = ""; vp.releaseId = null; vp.isProject = true; }
    vp.sub = slot.sub;
    vp.pinned = true;
    placed.push([vp, slot.x, slot.y]);
  }
  // Fixed concepts and external systems. A board entry of the same name wins.
  const keyed = {}; // extra key -> node
  SYSTEM_MAP_CONCEPTS.forEach((c) => {
    const hit = nodes.find((n) => (n.kind === "concept" || n.kind === "project") && c.match.test(n.name));
    if (hit) { keyed[c.key] = hit; placed.push([hit, c.x, c.y]); return; }
    keyed[c.key] = add({ id: `ext:${c.key}`, kind: "concept", name: c.name, full: c.full, sub: c.sub, status: "Concept", x: c.x, y: c.y, fixed: true });
  });
  SYSTEM_MAP_EXTERNALS.forEach((x) => {
    keyed[x.key] = add({ id: `ext:${x.key}`, kind: "external", name: x.name, sub: x.sub, status: "External", x: x.x, y: x.y });
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
        if (a && b && a !== b) edges.push({ from: a.id, to: b.id, label: l.label, kind: l.kind, dotted: l.dotted, source: "platform" });
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
  placed.forEach(([n, x, y]) => { n.x = x; n.y = y; });

  const endOf = (ref) => {
    if (typeof ref === "string") return keyed[ref] || byId[coreId(ref)] || null;
    return nodes.find((n) => (n.kind === "project" || n.kind === "concept") && ref.name.test(n.name)) || null;
  };
  EXTRA_LINKS.forEach((l) => {
    const a = endOf(l.from);
    const b = endOf(l.to);
    if (a && b && a !== b) edges.push({ from: a.id, to: b.id, label: l.label, short: l.short, dotted: l.dotted, both: l.both, bow: l.bow, source: "platform" });
  });
  return { nodes, edges, byId };
}

// Each core node has fixed slots for the projects/concepts drawn beside it,
// so nothing overlaps and the picture stays readable as the board grows.
// Past the listed slots a node steps further out along the last slot's axis.
const SLOTS = {
  mcp: [[330, 150], [330, 215]],
  profile: [[100, 290], [100, 370]],
  store: [[100, 470], [100, 560]],
  campaigns: [[580, 670], [380, 670], [780, 670]],
  vector: [[1060, 250], [1060, 170]],
  devices: [[1060, 400], [1060, 480]],
};
function layoutSatellites(nodes, anchors) {
  const used = {};
  const loose = [];
  nodes.forEach((n) => {
    if ((n.kind !== "project" && n.kind !== "concept") || n.fixed || n.pinned) return;
    const a = anchors[n.id];
    if (!a) { loose.push(n); return; }
    const slots = SLOTS[a];
    const i = used[a] = (used[a] || 0) + 1;
    const [sx, sy] = slots[Math.min(i - 1, slots.length - 1)];
    const extra = Math.max(0, i - slots.length);
    n.x = sx; n.y = sy + extra * 100;
  });
  loose.forEach((n, i) => { n.x = 110 + (i % 7) * 215; n.y = 760 + Math.floor(i / 7) * 58; });
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

// At most `max` lines of `width` characters; the last gets an ellipsis when
// text was cut. Full text stays in the element's <title> tooltip.
function shortLines(text, width, max) {
  if (!text) return [];
  const all = wrap(text, width);
  if (all.length <= max) return all;
  const out = all.slice(0, max);
  const last = out[max - 1];
  out[max - 1] = (last.length > width - 1 ? last.slice(0, width - 1) : last) + "…";
  return out;
}

// Zoom the visible window by `factor` around (cx, cy), staying inside the
// full map; the default window is the whole map ("fit").
export function zoomViewBox(vb, factor, cx, cy) {
  const w = Math.min(W, Math.max(W / 6, vb.w / factor));
  const h = w * (H / W);
  return clampViewBox({ x: cx - (cx - vb.x) * (w / vb.w), y: cy - (cy - vb.y) * (h / vb.h), w, h });
}
export function clampViewBox(vb) {
  return { x: Math.min(Math.max(0, vb.x), W - vb.w), y: Math.min(Math.max(0, vb.y), H - vb.h), w: vb.w, h: vb.h };
}
export const FIT_VIEWBOX = { x: 0, y: 0, w: W, h: H };

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

export function systemMapHTML(model, { release = "", viewBox = null } = {}) {
  const vb = viewBox;
  const hi = highlightedIds(model, release);
  const nodeDim = (n) => (hi && !hi.nodes.has(n.id) ? " dim" : "");
  const edgeDim = (i) => (hi && !hi.edges.has(i) ? " dim" : "");
  const byId = model.byId;
  let svg = `<svg class="sysmap-svg" viewBox="${vb ? `${vb.x} ${vb.y} ${vb.w} ${vb.h}` : `0 0 ${W} ${H}`}" role="img" aria-label="Personalisation Hub system map">
    <defs>
      <marker id="sm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker>
    </defs>
    <rect class="sysmap-boundary" x="230" y="60" width="700" height="550" rx="8"/>
    <text class="sysmap-boundary-label" x="246" y="82">Personalisation Hub platform</text>
    <rect class="sysmap-pii" x="${PII_ZONE.x}" y="${PII_ZONE.y}" width="${PII_ZONE.w}" height="${PII_ZONE.h}" rx="8"/>
    <text class="sysmap-pii-label" x="${PII_ZONE.x + 14}" y="${PII_ZONE.y + 24}">PII side — identity vault, Salesforce, Amazon Connect</text>
    <text class="sysmap-pii-wall" x="${PII_ZONE.x + 14}" y="${PII_ZONE.y - 8}"><title>Non-PII: Live Visitor Profile, Agent Harness, agents, Campaigns &amp; Experiences. PII boundary (Chinese wall): agents never cross it.</title>▲ Non-PII above — agents never cross it ▲</text>`;

  model.edges.forEach((e, i) => {
    const a = byId[e.from];
    const b = byId[e.to];
    if (!a || !b) return;
    const p = edgePoint(a, b);
    const q = edgePoint(b, a);
    const cls = ["sysmap-edge", e.kind || "", e.loop ? "loop" : "", e.dotted ? "dotted" : "", e.interfaceId ? "clickable" : "", edgeDim(i)].filter(Boolean).join(" ");
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    const lines = shortLines(e.short != null ? e.short : e.label, 20, 2);
    const attrs = e.interfaceId ? ` data-interface-id="${esc(e.interfaceId)}" data-anchor-id="${esc(e.anchorId)}" tabindex="0" role="button"` : "";
    // Contract lines bow sideways so they don't run straight through other boxes.
    const bow = e.bow != null ? e.bow : e.interfaceId ? 0.18 : e.kind ? 0.14 : 0;
    const cxp = mx - (q.y - p.y) * bow;
    const cyp = my + (q.x - p.x) * bow;
    const curved = bow !== 0;
    const lx = curved ? (p.x + 2 * cxp + q.x) / 4 : mx;
    const ly = curved ? (p.y + 2 * cyp + q.y) / 4 : my;
    const d = `M${p.x} ${p.y} Q${cxp} ${cyp} ${q.x} ${q.y}`;
    const lbl = lines.map((t, k) => `<text class="sysmap-edge-label" x="${lx}" y="${ly + (k - (lines.length - 1) / 2) * 12 + 4}" text-anchor="middle">${esc(t)}</text>`).join("");
    const w = Math.max(0, ...lines.map((t) => t.length)) * 6.1 + 10;
    svg += `<g class="${cls}"${attrs}><title>${esc(e.label)}${e.interfaceId ? " — open interface contract" : ""}</title>
      <path class="sysmap-hit" d="${d}"/>
      <path class="sysmap-line" d="${d}" marker-end="url(#sm-arrow)"${e.both ? ' marker-start="url(#sm-arrow)"' : ""}/>
      ${lines.length ? `<rect class="sysmap-edge-bg" x="${lx - w / 2}" y="${ly - lines.length * 6 - 2}" width="${w}" height="${lines.length * 12 + 4}" rx="3"/>${lbl}` : ""}</g>`;
  });

  model.nodes.forEach((n) => {
    const x = n.x - NODE_W / 2;
    const y = n.y - NODE_H / 2;
    const clickable = (n.kind === "project" || n.kind === "concept") && !n.fixed;
    const cls = `sysmap-node ${n.kind} s-${String(n.status).toLowerCase()}${clickable ? " clickable" : ""}${nodeDim(n)}`;
    const attrs = clickable ? ` data-node-id="${esc(n.id)}" data-node-kind="${n.kind}" tabindex="0" role="link"` : "";
    const sub = shortLines(n.sub, 29, 2);
    svg += `<g class="${cls}"${attrs}><title>${esc(n.full || n.name)} — ${esc(n.status)}${n.release ? ` — ${esc(n.release)}` : ""}${n.sub ? `\n${esc(n.sub)}` : ""}</title>
      <rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="8"/>
      <text class="sysmap-node-name" x="${n.x}" y="${y + 19}" text-anchor="middle">${esc(n.name.length > 25 ? n.name.slice(0, 24) + "…" : n.name)}</text>
      ${sub.map((t, k) => `<text class="sysmap-node-sub" x="${n.x}" y="${y + 32 + k * 11}" text-anchor="middle">${esc(t)}</text>`).join("")}
      <text class="sysmap-node-status" x="${x + 8}" y="${y - 5}">${esc(n.status)}</text>
      ${n.release ? `<text class="sysmap-node-release" x="${x + NODE_W}" y="${y - 5}" text-anchor="end">${esc(n.release)}</text>` : ""}</g>`;
  });
  return svg + "</svg>";
}

export function systemMapLegendHTML() {
  return `<span class="sysmap-key s-live">Live</span><span class="sysmap-key s-project">Project</span><span class="sysmap-key s-concept">Concept</span><span class="sysmap-key s-external">External</span><span class="sysmap-key s-pii">PII boundary</span>
    <span class="sysmap-key line-demand">Demand (advertiser)</span><span class="sysmap-key line-supply">Supply (SSP)</span><span class="sysmap-key line-loop">Insights loop</span>`;
}
