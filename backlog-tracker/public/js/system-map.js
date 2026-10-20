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

// Core nodes sit in a fixed three-column cluster (x, y are offsets inside it;
// the layout centres the whole cluster, drawn as the platform boundary, in
// the available space). Columns are far enough apart for a line label to sit
// on the clear stretch of line between two boxes.
export const SYSTEM_MAP_CORE = [
  { key: "campaigns", name: "Campaigns & Experiences", sub: "Personalised, real-time experiences", x: 0, y: 320 },
  { key: "harness", name: "Agent Harness", sub: "LangChain — creates, drives, optimises", x: 0, y: 160 },
  { key: "mcp", name: "MCP Access", sub: "Agents connect via MCP", x: 0, y: 0 },
  { key: "vector", name: "Vector Database", sub: "Insights store", x: 340, y: 160 },
  { key: "devices", name: "Devices & Touchpoints", sub: "Displays, mobile, kiosks", x: 340, y: 320 },
  { key: "profile", name: "Live Visitor Profile", sub: "Personalised campaigns", x: -340, y: 320 },
  { key: "store", name: "Store Data", sub: "Localised campaigns", x: -340, y: 480 },
  { key: "checkin", name: "Check-in", sub: "PH Core", x: 340, y: 480 },
  { key: "brand", name: "Brand Guidelines", sub: "PH Core — retailer, advertiser & partnership rules", x: 340, y: 0 },
];

// Board entries that are not part of the product map.
export const INTERNAL_RE = /backlog tracker|\bph brand\b|customer (support|success)|\bph team\b/i;

// Where the Chinese wall sits: everything inside the PII band along the
// bottom is on the PII side; everything else on the map is non-PII. Agents
// never cross it.
const PII_H = 196;

// Concepts that are part of the picture whether or not anyone has filed a
// Concept Incubator entry for them. If a board project/concept whose name
// matches `match` exists, that one is drawn (near `pref`, an offset from the
// platform's centre) instead.
export const SYSTEM_MAP_CONCEPTS = [
  { key: "custom", match: /custom.*edge models?/i, name: "Custom & Edge Models", full: "Custom & Edge Models",
    sub: "PH-optimised open-weights models + edge model shop (vision, lift & learn, plates)", pref: [660, 190] },
  { key: "identity", match: /digital identity/i, name: "Digital Identity & Resolution", full: "Digital Identity Management & Resolution",
    sub: "Identity vault + resolution service + identity graph", pii: true },
  { key: "offsite", match: /offsite retail media/i, name: "Offsite (Meta, YouTube)", full: "Offsite (Meta, YouTube)",
    sub: "Hashed audiences to offsite platforms", pref: [660, 20] },
  { key: "federation", match: /federated retail media|federated ph/i, name: "Federated PH Instance", full: "Federated PH Instance",
    sub: "Another PH instance, peer to peer", pref: [-660, -150] },
];

// External systems and actors (C4 external style).
export const SYSTEM_MAP_EXTERNALS = [
  { key: "salesforce", name: "Salesforce CRM", sub: "PII side — consent checked here", pii: true },
  { key: "amazon", name: "Amazon Connect", sub: "Customer Profiles — PII side, consent checked here", pii: true },
  { key: "advertiser", name: "Advertiser", sub: "External actor", pref: [-660, -270] },
];

// Lines for the nodes above. Ends are a core key, a SYSTEM_MAP_CONCEPTS /
// SYSTEM_MAP_EXTERNALS key, or { name: regex } for a board node (skipped
// when no such node exists). `both` draws arrows at each end; `bow` curves it.
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
  { from: "offsite", to: "vector", label: "offsite exposure for closed-loop measurement", bow: 0.1 },
  { from: "advertiser", to: { name: /mcp release/i }, label: "advertiser access" },
  { from: "federation", to: { name: /mcp release/i }, label: "federated PH access" },
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

const NODE_W = 190;
const NODE_H = 52;

// The one- or two-sentence description a hover tooltip shows. A project
// uses its board description; a concept uses its description, else the first
// prose lines of its README (headings, rules, code and list markers dropped).
export const DESC_MAX = 220;
export function shortDescription(description, readmeMd = "") {
  let t = String(description || "").trim();
  if (!t) {
    const lines = [];
    let fenced = false;
    for (const raw of String(readmeMd || "").split("\n")) {
      const l = raw.trim();
      if (/^(```|~~~)/.test(l)) { fenced = !fenced; continue; }
      if (fenced || !l) { if (lines.length && !l) break; continue; }
      if (/^(#|>|\||-{3,}|={3,}|<)/.test(l)) continue;
      lines.push(l.replace(/^([-*+]|\d+\.)\s+/, ""));
      if (lines.join(" ").length >= DESC_MAX) break;
    }
    t = lines.join(" ");
  }
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  if (t.length <= DESC_MAX) return t;
  const cut = t.slice(0, DESC_MAX - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), DESC_MAX / 2)).replace(/[\s,;:.-]+$/, "") + "…";
}

// A Firestore Timestamp, a Date or epoch ms -> epoch ms (0 when unknown).
function tsMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return Number(v) || 0;
}

// Release order: by version, part by part and numerically (5.0, 5.1, 5.2 ...
// 5.10, 6.0), never as text and never by creation date. A release without a
// version sorts after the versioned ones, by its creation `order`.
export function versionParts(v) {
  const m = String(v == null ? "" : v).match(/\d+/g);
  return m ? m.map(Number) : null;
}
export function compareReleases(a, b) {
  const pa = versionParts(a && a.version), pb = versionParts(b && b.version);
  if (pa && pb) {
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
  } else if (pa || pb) return pa ? -1 : 1;
  return (Number(a && a.order) || 0) - (Number(b && b.order) || 0);
}

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
      desc: shortDescription(p.description),
    });
  });
  // A concept's release is the release whose conceptIds lists it.
  const relOfConcept = {};
  releases.forEach((r) => (Array.isArray(r.conceptIds) ? r.conceptIds : []).forEach((cid) => { if (!relOfConcept[cid]) relOfConcept[cid] = r; }));
  concepts.filter((c) => c.status !== "promoted" && !INTERNAL_RE.test(c.name || "")).forEach((c) => {
    const crel = relOfConcept[c.id] || null;
    add({ id: c.id, kind: "concept", name: c.name || c.id, status: "Concept",
      releaseId: crel ? crel.id : null, release: crel ? releaseLabel(crel) : "", href: c.artifactUrl || "", desc: shortDescription(c.description, c.readmeMd), updatedMs: tsMs(c.updatedAt) });
  });
  // Live Visitor Profile: one node, a concept, in the PH Core slot.
  const vp = nodes.find((n) => (n.kind === "project" || n.kind === "concept") && /live visitor profile/i.test(n.name));
  if (vp) {
    const slot = nodes.find((n) => n.id === "core:profile");
    nodes.splice(nodes.indexOf(slot), 1);
    byId["core:profile"] = vp;
    if (vp.kind === "project") { vp.kind = "concept"; vp.status = "Concept"; vp.release = ""; vp.releaseId = null; vp.isProject = true; }
    vp.sub = slot.sub;
    vp.coreSlot = true;
    vp.x = slot.x; vp.y = slot.y;
  }
  // Fixed concepts and external systems. A board entry of the same name wins.
  const keyed = {}; // extra key -> node
  SYSTEM_MAP_CONCEPTS.forEach((c) => {
    const hit = nodes.find((n) => (n.kind === "concept" || n.kind === "project") && c.match.test(n.name));
    if (hit) { keyed[c.key] = hit; hit.pref = c.pref; hit.pii = !!c.pii; hit.keyed = true; return; }
    keyed[c.key] = add({ id: `ext:${c.key}`, kind: "concept", name: c.name, full: c.full, sub: c.sub, status: "Concept", pref: c.pref, pii: !!c.pii, keyed: true, fixed: true });
  });
  SYSTEM_MAP_EXTERNALS.forEach((x) => {
    keyed[x.key] = add({ id: `ext:${x.key}`, kind: "external", name: x.name, sub: x.sub, status: "External", pref: x.pref, pii: !!x.pii, keyed: true });
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
    edges.push({ from: eps[0], to: eps[1], label: f.flowLabel || f.name || "Interface", interfaceId: f.id, anchorId: eps[0], source: "contract", contractName: f.name || "Interface", summary: shortDescription(f.contentMd) });
  });

  nodes.forEach((n) => { if (anchors[n.id]) n.anchor = anchors[n.id]; });

  const endOf = (ref) => {
    if (typeof ref === "string") return keyed[ref] || byId[coreId(ref)] || null;
    return nodes.find((n) => (n.kind === "project" || n.kind === "concept") && ref.name.test(n.name)) || null;
  };
  EXTRA_LINKS.forEach((l) => {
    const a = endOf(l.from);
    const b = endOf(l.to);
    if (a && b && a !== b) edges.push({ from: a.id, to: b.id, label: l.label, short: l.short, dotted: l.dotted, both: l.both, bow: l.bow, source: "platform" });
  });
  const model = { nodes, edges, byId };
  return layoutSystemMap(model, { width: WIDE_W });
}

// ---------------------------------------------------------------------------
// Layout. The platform boundary (the core cluster) is centred in the drawing;
// every other node is placed by a greedy collision-avoiding search: the free
// spot nearest to where it would like to be, with a margin around each box so
// no two overlap and lines have room to run between them. The drawing grows
// taller until everything fits. Lines then pick the bow that runs clear of
// other boxes, and each line label sits on a clear stretch of line (or just
// beside it) away from every box and every other label.
// The layout depends on the width available: a wide drawing puts projects and
// concepts beside the platform; a narrow one stacks them above and below it.
// ---------------------------------------------------------------------------
const WIDE_W = 1700;
const NARROW_W = 1040;
export const WIDE_MIN_WIDTH = 1100;
export const systemMapModeFor = (width) => (width >= WIDE_MIN_WIDTH ? "wide" : "narrow");

const FOOT_HW = 150; // placement footprint around a node centre (box + room for a line label)
const FOOT_UP = 66;
const FOOT_DOWN = 66;
const BOX_UP = 41; // the box plus its status label above
const BOX_DOWN = 26;
const CLUSTER_TOP = 62; // boundary top to the top row's centre
const CLUSTER_BOTTOM = 52;
const CLUSTER_SIDE = 28;
const GRID = 20;
const LABEL_CHAR_W = 6.3;

export const nodeBox = (n, pad = 0) => ({ x: n.x - NODE_W / 2 - pad, y: n.y - BOX_UP - pad, w: NODE_W + 2 * pad, h: BOX_UP + BOX_DOWN + 2 * pad });
const rectsOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const footprint = (x, y) => ({ x: x - FOOT_HW, y: y - FOOT_UP, w: 2 * FOOT_HW, h: FOOT_UP + FOOT_DOWN });

export function layoutSystemMap(model, { width = WIDE_W } = {}) {
  const { nodes } = model;
  const W = systemMapModeFor(width) === "wide" ? WIDE_W : NARROW_W;
  const isCore = (n) => n.kind === "core" || n.coreSlot;
  const core = nodes.filter(isCore);
  core.forEach((n) => { if (n.cx == null) { n.cx = n.x; n.cy = n.y; } });
  const minX = Math.min(...core.map((n) => n.cx));
  const maxX = Math.max(...core.map((n) => n.cx));
  const minY = Math.min(...core.map((n) => n.cy));
  const maxY = Math.max(...core.map((n) => n.cy));
  const bw = maxX - minX + NODE_W + 2 * CLUSTER_SIDE;
  const bh = maxY - minY + CLUSTER_TOP + CLUSTER_BOTTOM;
  const cx = W / 2;

  const movable = [];
  const pii = nodes.filter((n) => !isCore(n) && n.pii);
  const fixedFirst = nodes.filter((n) => !isCore(n) && !n.pii && n.pref);
  const rest = nodes.filter((n) => !isCore(n) && !n.pii && !n.pref);
  movable.push(...fixedFirst, ...rest);

  // Where a node would like to be, relative to the platform (cy is its centre y).
  const dirOf = { mcp: [0, -1], profile: [-1, 0], store: [-1, 0], campaigns: [0, 1], vector: [1, 0], devices: [1, 0] };
  const used = {};
  const looseN = { n: 0 };
  const prefFor = (n, cy, bx, by) => {
    if (n.pref) return [cx + n.pref[0], cy + n.pref[1]];
    const dir = dirOf[n.anchor];
    if (!dir) {
      const i = looseN.n++;
      return [cx + ((i % 5) - 2) * 230, by + bh + 120 + Math.floor(i / 5) * 100];
    }
    const i = used[n.anchor] = (used[n.anchor] || 0);
    used[n.anchor] += 1;
    const lat = Math.ceil(i / 2) * (i % 2 ? 1 : -1) * 100;
    const a = core.find((c) => `core:${n.anchor}` === c.id || c === model.byId[`core:${n.anchor}`]);
    const ax = bx + CLUSTER_SIDE + NODE_W / 2 + (a.cx - minX);
    const ay = by + CLUSTER_TOP + (a.cy - minY);
    return [dir[0] ? cx + dir[0] * (bw / 2 + 150) : ax + lat, dir[1] ? cy + dir[1] * (bh / 2 + 90) : ay + lat];
  };

  const tryPlace = (Hn) => {
    const cy = Hn / 2;
    const bx = cx - bw / 2;
    const by = cy - bh / 2;
    const wall = { x: bx - 10, y: by - 10, w: bw + 20, h: bh + 20 };
    const placed = [];
    for (const n of core) {
      n.x = bx + CLUSTER_SIDE + NODE_W / 2 + (n.cx - minX);
      n.y = by + CLUSTER_TOP + (n.cy - minY);
    }
    for (const k in used) delete used[k];
    looseN.n = 0;
    for (const n of movable) {
      const [px, py] = prefFor(n, cy, bx, by);
      let best = null;
      let bestD = Infinity;
      for (let x = 125; x <= W - 125; x += GRID) {
        for (let y = FOOT_UP + 4; y <= Hn - FOOT_DOWN + 20; y += GRID) {
          const d = (x - px) * (x - px) + (y - py) * (y - py);
          if (d >= bestD) continue;
          const f = footprint(x, y);
          if (rectsOverlap(f, wall) || placed.some((p) => rectsOverlap(f, p))) continue;
          best = [x, y]; bestD = d;
        }
      }
      if (!best) return null;
      n.x = best[0]; n.y = best[1];
      placed.push(footprint(n.x, n.y));
    }
    return { cy, bx, by };
  };

  let Hn = Math.round(bh + 2 * 110);
  let spot = tryPlace(Hn);
  for (let i = 0; !spot && i < 60; i++) { Hn += 90; spot = tryPlace(Hn); }
  if (!spot) { Hn += 90; spot = { cy: Hn / 2, bx: cx - bw / 2, by: Hn / 2 - bh / 2 }; }

  // PII band along the bottom; salesforce/amazon stacked left, identity centred.
  const piiBox = { x: 20, y: Hn + 34, w: W - 40, h: PII_H };
  const ordered = pii.slice().sort((a, b) => (a.kind === "external" ? 0 : 1) - (b.kind === "external" ? 0 : 1));
  let ext = 0;
  ordered.forEach((n) => {
    if (n.kind === "external") { n.x = piiBox.x + 115; n.y = piiBox.y + 80 + 76 * ext++; } else { n.x = cx; n.y = piiBox.y + 110; }
  });
  const H = piiBox.y + PII_H + 10;
  model.layout = { w: W, h: H, mode: W === WIDE_W ? "wide" : "narrow", boundary: { x: spot.bx, y: spot.by, w: bw, h: bh }, pii: piiBox };
  routeEdges(model);
  return model;
}

// ---- lines and their labels ----
function quadPoint(p, c, q, t) {
  const u = 1 - t;
  return { x: u * u * p.x + 2 * u * t * c.x + t * t * q.x, y: u * u * p.y + 2 * u * t * c.y + t * t * q.y };
}
function edgeCurve(a, b, bow) {
  const p = edgePoint(a, b);
  const q = edgePoint(b, a);
  const c = { x: (p.x + q.x) / 2 - (q.y - p.y) * bow, y: (p.y + q.y) / 2 + (q.x - p.x) * bow };
  return { p, q, c };
}
const pointInRect = (pt, r) => pt.x > r.x && pt.x < r.x + r.w && pt.y > r.y && pt.y < r.y + r.h;

function routeEdges(model) {
  const { nodes, edges, byId, layout } = model;
  const boxes = nodes.map((n) => ({ n, r: nodeBox(n, 3) }));
  // Text already on the drawing that a label must not cover.
  const fixedText = [
    { x: layout.boundary.x, y: layout.boundary.y, w: 240, h: 30 },
    { x: layout.pii.x, y: layout.pii.y - 24, w: 360, h: 30 },
    { x: layout.pii.x, y: layout.pii.y, w: 520, h: 34 },
  ];
  // Loop lines first, then the rest, so the prominent lines get the best spots.
  const order = edges.map((e, i) => i).sort((i, j) => (edges[j].loop ? 1 : 0) - (edges[i].loop ? 1 : 0));
  const labels = [];
  const crossings = (curve, a, b) => {
    let hits = 0;
    for (let k = 1; k < 24; k++) {
      const pt = quadPoint(curve.p, curve.c, curve.q, k / 24);
      if (boxes.some(({ n, r }) => n !== a && n !== b && pointInRect(pt, r))) hits++;
    }
    return hits;
  };
  const placeLabel = (curve, w, h) => {
    let best = null;
    const ts = [0.5];
    for (let k = 1; k <= 11; k++) ts.push(0.5 - 0.04 * k, 0.5 + 0.04 * k);
    const offs = [0, h / 2 + 9, -(h / 2 + 9), h + 20, -(h + 20)];
    for (const off of offs) {
      for (const t of ts) {
        const pt = quadPoint(curve.p, curve.c, curve.q, t);
        const ahead = quadPoint(curve.p, curve.c, curve.q, Math.min(1, t + 0.02));
        const dx = ahead.x - pt.x;
        const dy = ahead.y - pt.y;
        const len = Math.hypot(dx, dy) || 1;
        const lx = pt.x - (dy / len) * off;
        const ly = pt.y + (dx / len) * off;
        const r = { x: lx - w / 2, y: ly - h / 2, w, h };
        let hits = 0;
        if (r.x < 0 || r.y < 0 || r.x + r.w > layout.w || r.y + r.h > layout.h) hits += 5;
        hits += boxes.filter(({ r: nr }) => rectsOverlap(r, nr)).length * 3;
        hits += labels.filter((l) => rectsOverlap(r, l)).length * 2;
        hits += fixedText.filter((f) => rectsOverlap(r, f)).length;
        const score = hits * 100 + Math.abs(t - 0.5) * 40 + Math.abs(off) / 10;
        if (!best || score < best.score) best = { lx, ly, w, h, r, score, clear: hits === 0 };
        if (hits === 0) return best;
      }
    }
    return best;
  };
  for (const i of order) {
    const e = edges[i];
    const a = byId[e.from];
    const b = byId[e.to];
    if (!a || !b) { e.geom = null; continue; }
    const pref = e.bow != null ? e.bow : e.interfaceId ? 0.18 : e.kind ? 0.14 : 0;
    let curve = null;
    let bowBest = Infinity;
    for (const bow of [pref, 0, 0.12, -0.12, 0.25, -0.25, 0.4, -0.4, 0.6, -0.6, 0.8, -0.8, 1.0, -1.0]) {
      const cv = edgeCurve(a, b, bow);
      const hits = crossings(cv, a, b);
      if (hits < bowBest) { bowBest = hits; curve = { ...cv, bow }; }
      if (!hits) break;
    }
    const text = e.short != null ? e.short : e.label;
    let lines = [];
    let label = null;
    // Wider first; a narrower, taller label when the stretch of line is short.
    for (const [chars, max] of [[20, 2], [14, 3], [10, 4]]) {
      lines = shortLines(text, chars, max);
      if (!lines.length) break;
      const w = Math.max(0, ...lines.map((t) => t.length)) * LABEL_CHAR_W + 12;
      const h = lines.length * 12 + 6;
      const found = { ...placeLabel(curve, w, h), lines };
      if (!label || found.score < label.score) label = found;
      if (found.clear) break;
    }
    if (label) labels.push(label.r);
    e.geom = { ...curve, lines: label ? label.lines : [], label };
  }
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
// full map (`size`, from fitViewBox(model)); the default window is the whole
// map ("fit").
export const FIT_VIEWBOX = { x: 0, y: 0, w: WIDE_W, h: 1040 };
export const fitViewBox = (model) => (model && model.layout ? { x: 0, y: 0, w: model.layout.w, h: model.layout.h } : { ...FIT_VIEWBOX });
export function zoomViewBox(vb, factor, cx, cy, size = FIT_VIEWBOX) {
  const w = Math.min(size.w, Math.max(size.w / 6, vb.w / factor));
  const h = w === size.w ? size.h : w * (size.h / size.w);
  return clampViewBox({ x: cx - (cx - vb.x) * (w / vb.w), y: cy - (cy - vb.y) * (h / vb.h), w, h }, size);
}
export function clampViewBox(vb, size = FIT_VIEWBOX) {
  return { x: Math.min(Math.max(0, vb.x), size.w - vb.w), y: Math.min(Math.max(0, vb.y), size.h - vb.h), w: vb.w, h: vb.h };
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

export function systemMapHTML(model, { release = "", viewBox = null } = {}) {
  const vb = viewBox;
  const hi = highlightedIds(model, release);
  const nodeDim = (n) => (hi && !hi.nodes.has(n.id) ? " dim" : "");
  const edgeDim = (i) => (hi && !hi.edges.has(i) ? " dim" : "");
  const byId = model.byId;
  const { w: W, h: H, boundary: bd, pii } = model.layout;
  let svg = `<svg class="sysmap-svg" viewBox="${vb ? `${vb.x} ${vb.y} ${vb.w} ${vb.h}` : `0 0 ${W} ${H}`}" role="img" aria-label="Personalisation Hub system map">
    <defs>
      <marker id="sm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker>
    </defs>
    <rect class="sysmap-boundary" x="${bd.x}" y="${bd.y}" width="${bd.w}" height="${bd.h}" rx="8"/>
    <text class="sysmap-boundary-label" x="${bd.x + 16}" y="${bd.y + 22}">Personalisation Hub platform</text>
    <rect class="sysmap-pii" x="${pii.x}" y="${pii.y}" width="${pii.w}" height="${pii.h}" rx="8"/>
    <text class="sysmap-pii-label" x="${pii.x + 14}" y="${pii.y + 24}">PII side — identity vault, Salesforce, Amazon Connect</text>
    <text class="sysmap-pii-wall" x="${pii.x + 14}" y="${pii.y - 8}"><title>Non-PII: Live Visitor Profile, Agent Harness, agents, Campaigns &amp; Experiences. PII boundary (Chinese wall): agents never cross it.</title>▲ Non-PII above — agents never cross it ▲</text>`;

  model.edges.forEach((e, i) => {
    const g = e.geom;
    if (!g) return;
    const { p, q, c, lines, label } = g;
    const cls = ["sysmap-edge", e.kind || "", e.loop ? "loop" : "", e.dotted ? "dotted" : "", e.interfaceId ? "clickable" : "", edgeDim(i)].filter(Boolean).join(" ");
    const attrs = ` data-tip-edge="${i}"${e.interfaceId ? ` data-interface-id="${esc(e.interfaceId)}" data-anchor-id="${esc(e.anchorId)}" tabindex="0" role="button" aria-label="${esc(e.label)} — open interface contract"` : ""}`;
    const d = `M${p.x} ${p.y} Q${c.x} ${c.y} ${q.x} ${q.y}`;
    const round = (v) => Math.round(v * 10) / 10;
    const lbl = label ? lines.map((t, k) => `<text class="sysmap-edge-label" x="${round(label.lx)}" y="${round(label.ly + (k - (lines.length - 1) / 2) * 12 + 4)}" text-anchor="middle">${esc(t)}</text>`).join("") : "";
    svg += `<g class="${cls}"${attrs}>
      <path class="sysmap-hit" d="${d}"/>
      <path class="sysmap-line" d="${d}" marker-end="url(#sm-arrow)"${e.both ? ' marker-start="url(#sm-arrow)"' : ""}/>
      ${label ? `<rect class="sysmap-edge-bg" x="${round(label.r.x)}" y="${round(label.r.y)}" width="${round(label.w)}" height="${round(label.h)}" rx="3"/>${lbl}` : ""}</g>`;
  });

  model.nodes.forEach((n) => {
    const x = n.x - NODE_W / 2;
    const y = n.y - NODE_H / 2;
    const clickable = (n.kind === "project" || n.kind === "concept") && !n.fixed;
    const cls = `sysmap-node ${n.kind} s-${String(n.status).toLowerCase()}${clickable ? " clickable" : ""}${nodeDim(n)}`;
    const attrs = ` data-tip-node="${esc(n.id)}"${clickable ? ` data-node-id="${esc(n.id)}" data-node-kind="${n.kind}" tabindex="0" role="link" aria-label="${esc(n.full || n.name)} — ${esc(n.status)}"` : ""}`;
    const sub = shortLines(n.sub, 29, 2);
    svg += `<g class="${cls}"${attrs}>
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

// ---- Hover / tap tooltips -------------------------------------------------
// Pure: the model and the board's tickets in, an HTML string out, so the
// console can build it at the moment of hover from live data and the unit
// test can drive it. The markup is styled by the Retail Media Insights
// tooltip (`.pg-tip`, copied into styles.css as `.sysmap-tip`).
const TIP_COLUMNS = [["backlog", "Backlog"], ["ready-for-testing", "Ready for Testing"], ["ready-to-publish", "Live on Feature Branch"], ["published-live", "Merged to Main"]];

// { projectId: { backlog, "ready-for-testing", ... } } from the board's tickets.
export function ticketCounts(items = []) {
  const out = {};
  items.forEach((it) => {
    if (!it || !it.projectId) return;
    const c = out[it.projectId] || (out[it.projectId] = {});
    c[it.status] = (c[it.status] || 0) + 1;
  });
  return out;
}

export function formatUpdated(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const TIP_LIST_MAX = 4;
function tipNames(model, ids) {
  const names = [...new Set(ids.map((id) => model.byId[id]).filter(Boolean).map((n) => n.full || n.name))];
  const shown = names.slice(0, TIP_LIST_MAX).map(esc).join(", ");
  return names.length > TIP_LIST_MAX ? `${shown} +${names.length - TIP_LIST_MAX} more` : shown;
}

export function nodeTipHTML(model, id, counts = {}) {
  const n = model.byId[id] || model.nodes.find((x) => x.id === id);
  if (!n) return "";
  const feeds = model.edges.filter((e) => e.from === n.id).map((e) => e.to);
  const fedBy = model.edges.filter((e) => e.to === n.id).map((e) => e.from);
  const board = n.kind === "project" || n.kind === "concept";
  const desc = n.desc || n.sub || (board && !n.fixed ? "No description yet — add one on the Docs page." : "");
  let h = `<div class="sysmap-tip-head"><strong>${esc(n.full || n.name)}</strong><span class="sysmap-tip-pill s-${esc(String(n.status).toLowerCase())}">${esc(n.status)}</span>${n.release ? `<span class="sysmap-tip-pill rel">${esc(n.release)}</span>` : ""}</div>`;
  if (desc) h += `<p>${esc(desc)}</p>`;
  if (feeds.length) h += `<div class="sysmap-tip-row"><span>Feeds</span> ${tipNames(model, feeds)}</div>`;
  if (fedBy.length) h += `<div class="sysmap-tip-row"><span>Fed by</span> ${tipNames(model, fedBy)}</div>`;
  if (n.kind === "project") {
    const c = counts[n.id] || {};
    h += `<div class="sysmap-tip-row"><span>Tickets</span> ${TIP_COLUMNS.map(([k, l]) => `${l} ${c[k] || 0}`).join(" · ")}</div>`;
  } else if (n.kind === "concept" && n.updatedMs) {
    h += `<div class="sysmap-tip-row"><span>Last updated</span> ${esc(formatUpdated(n.updatedMs))}</div>`;
  }
  return h;
}

export function edgeTipHTML(model, index) {
  const e = model.edges[index];
  const a = e && model.byId[e.from];
  const b = e && model.byId[e.to];
  if (!a || !b) return "";
  const nm = (n) => esc(n.full || n.name);
  const flow = `${nm(a)} ${e.both ? "↔" : "→"} ${nm(b)}`;
  const summary = e.summary || e.label;
  return `<div class="sysmap-tip-head"><strong>${esc(e.contractName || e.label)}</strong>${e.interfaceId ? '<span class="sysmap-tip-pill rel">Interface contract</span>' : ""}</div>
    <div class="sysmap-tip-row"><span>Direction</span> ${flow}</div>
    <p>${esc(summary)}</p>${e.interfaceId ? '<div class="sysmap-tip-row hint">Click to open the contract</div>' : ""}`;
}
