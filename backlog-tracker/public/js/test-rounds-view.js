// Testing rounds on the board (ticket hm84opFjizq3vekk0fC1, 15 Nov 2026).
// The read side of functions/test-rounds.js, which the automation and the MCP
// server use to write testRound / sendBacks / sendBackCount /
// countedSendBacks (a browser module can't require that file, and a browser
// never writes those fields: firestore.rules → itemPipelineFields). A card
// from before those fields existed is read from its notes with rejectionsOf,
// the same rules the backfill used. Plain ESM, no DOM, no Firebase:
// test/test-rounds-view.test.mjs.
import { rejectionsOf } from "./rejection-summary.js";

export const NO_REBUILD_CATEGORY = "Blocking a release, not a rebuild";
// From this round on a ticket is "in a testing loop": warning colour, the
// Ready for Testing header count and filter, listed first over MCP.
export const LOOP_ROUND = 3;
// The chip shows from this round.
export const CHIP_ROUND = 2;
const ON_BOARD = new Set(["ready-for-testing", "ready-to-publish", "published-live", "archived"]);

function toDate(at) {
  if (!at) return null;
  if (typeof at.toDate === "function") return at.toDate();
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hasStored(item) {
  return !!item && (item.sendBackCount != null || Array.isArray(item.sendBacks));
}

// Notes → send-backs, oldest first, for a card the backfill never reached.
function fromNotes(notes) {
  return rejectionsOf(notes).reverse().map((r) => {
    const uncountedCategory = r.line.startsWith(`${NO_REBUILD_CATEGORY}:`);
    return {
      at: r.at, by: r.who === "automation" ? "tests" : "person", who: r.who,
      category: r.kind === "held" ? "main is broken" : (uncountedCategory ? NO_REBUILD_CATEGORY : ""),
      line: r.line, counted: r.kind !== "held" && !uncountedCategory,
    };
  });
}

// { round, sendBacks (oldest first, at as Date|null), sendBackCount, counted }
export function loopOf(item) {
  if (!item) return { round: 0, sendBacks: [], sendBackCount: 0, counted: 0 };
  if (hasStored(item)) {
    const sendBacks = (Array.isArray(item.sendBacks) ? item.sendBacks : []).map((s) => ({ ...s, at: toDate(s.at), counted: s.counted !== false }));
    const counted = item.countedSendBacks != null ? Number(item.countedSendBacks) || 0 : sendBacks.filter((s) => s.counted).length;
    const round = Math.max(Number(item.testRound) || 0, ON_BOARD.has(item.status) ? counted + 1 : counted);
    return { round, sendBacks, sendBackCount: Number(item.sendBackCount) || sendBacks.length, counted };
  }
  const sendBacks = fromNotes(item.notes);
  const counted = sendBacks.filter((s) => s.counted).length;
  return { round: ON_BOARD.has(item.status) ? counted + 1 : counted, sendBacks, sendBackCount: sendBacks.length, counted };
}

export function isLooping(item) {
  return loopOf(item).round >= LOOP_ROUND;
}

// The most recent send-back that counted, or null.
export function lastCountedSendBack(item) {
  const list = loopOf(item).sendBacks.filter((s) => s.counted);
  return list.length ? list[list.length - 1] : null;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = (d) => (d ? d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const byLabel = (s) => (s.by === "tests" ? "tests" : s.by === "review" ? "review" : (s.who || "a tester"));

function historyLine(s) {
  return `${when(s.at)} · ${byLabel(s)}${s.category ? ` · ${s.category}` : ""} · ${s.line}${s.counted ? "" : " (not counted)"}`;
}

// The "Round N" chip, from round 2, in every column. A button so a tap
// (iPad) lists the earlier send-backs inline; the same list is its hover
// title. `expanded` keeps the list open across re-renders.
export function roundChipHTML(item, { expanded = false } = {}) {
  const loop = loopOf(item);
  if (loop.round < CHIP_ROUND) return "";
  const warn = loop.round >= LOOP_ROUND;
  const title = loop.sendBacks.length
    ? `Round ${loop.round}. Sent back ${loop.counted} time${loop.counted === 1 ? "" : "s"}${loop.sendBackCount > loop.counted ? ` (plus ${loop.sendBackCount - loop.counted} not counted)` : ""}:\n${loop.sendBacks.map(historyLine).join("\n")}`
    : `Round ${loop.round}`;
  const list = expanded && loop.sendBacks.length
    ? `<ol class="round-history">${loop.sendBacks.map((s) => `<li class="${s.counted ? "" : "round-history-uncounted"}"><span class="round-history-when">${esc(when(s.at))}</span> <span class="round-history-who">${esc(byLabel(s))}</span>${s.category ? ` <span class="round-history-cat">${esc(s.category)}</span>` : ""} <span class="round-history-line">${esc(s.line)}</span>${s.counted ? "" : ' <span class="round-history-flag">not counted</span>'}</li>`).join("")}</ol>`
    : "";
  return `<button type="button" class="round-chip${warn ? " round-chip-warn" : ""}" data-id="${esc(item.id)}" aria-expanded="${expanded ? "true" : "false"}" title="${esc(title)}"><span class="material-symbols-outlined" aria-hidden="true">replay</span>Round ${loop.round}</button>${list}`;
}

// Ready for Testing, round 2 or later: what to re-check.
export function sentBackLastTimeHTML(item) {
  if (!item || item.status !== "ready-for-testing" || loopOf(item).round < CHIP_ROUND) return "";
  const last = lastCountedSendBack(item);
  return last ? `<p class="resent-line" title="${esc(historyLine(last))}">Sent back last time: ${esc(last.line)}</p>` : "";
}

// ── The "Testing loops" report (project ⋮ menu) ─────────────────────────
export const REPORT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_BUILD_RE = /^Committed to the project's integration branch/;

function firstBuildAt(item) {
  let first = null;
  for (const n of item.notes || []) {
    if (!FIRST_BUILD_RE.test(String((n && n.text) || ""))) continue;
    const d = toDate(n.at);
    if (d && (!first || d < first)) first = d;
  }
  return first;
}

// One report row: `shown` are the send-backs the row is about (the last 30
// days for testingLoopRows, every counted one for retestedRows).
function loopRow(item, loop, shown) {
  const firstBuild = firstBuildAt(item);
  const approved = toDate(item.approvedAt);
  return {
    id: item.id, title: item.title || "", status: item.status || "backlog", projectId: item.projectId || "",
    round: loop.round, counted: loop.counted, recent: shown.length,
    reasons: shown.slice(-3).map((s) => `${byLabel(s)}: ${s.line}`),
    lastAt: shown.length ? shown[shown.length - 1].at : null,
    firstBuild, approved,
    buildToApprovalMs: firstBuild && approved && approved >= firstBuild ? approved - firstBuild : null,
  };
}
const lastAtMs = (r) => (r.lastAt ? r.lastAt.getTime() : 0);

// Tickets with 2+ counted send-backs in the last 30 days, highest round first.
export function testingLoopRows(items, now = Date.now()) {
  const since = now - REPORT_DAYS * DAY_MS;
  const rows = [];
  for (const item of items || []) {
    const loop = loopOf(item);
    const recent = loop.sendBacks.filter((s) => s.counted && s.at && s.at.getTime() >= since);
    if (recent.length < 2) continue;
    rows.push(loopRow(item, loop, recent));
  }
  return rows.sort((a, b) => (b.round - a.round) || (lastAtMs(b) - lastAtMs(a)));
}

// Retested tickets (0I93kb0fqXL4Qr4qyzwv): every ticket not archived that went
// back through retesting, i.e. has at least one counted send-back, with
// `counted` the number of times. The Dashboard's Flow & blockers figure and the
// "#testing-loops?view=retested" list both come from this, so the count on the
// tile is always the length of the list it opens. Most retested first, then the
// most recent send-back.
export function retestedRows(items) {
  const rows = [];
  for (const item of items || []) {
    if (!item || item.status === "archived") continue;
    const loop = loopOf(item);
    if (loop.counted < 1) continue;
    rows.push(loopRow(item, loop, loop.sendBacks.filter((s) => s.counted)));
  }
  return rows.sort((a, b) => (b.counted - a.counted) || (lastAtMs(b) - lastAtMs(a)) || a.title.localeCompare(b.title));
}

export function formatDuration(ms) {
  if (ms == null) return "";
  const h = Math.round(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))} min`;
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}
