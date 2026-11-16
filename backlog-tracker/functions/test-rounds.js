"use strict";
// Testing rounds (ticket hm84opFjizq3vekk0fC1, 14 Nov 2026 board flow review,
// "Flow 4/9").
//
// A ticket that bounced between Backlog and Ready for Testing looked like any
// other ticket: how many times it had been sent back was only ever worked out
// from note text (public/js/rejection-summary.js) and shown inside two
// modals, the automatic rebuild budget (autoRebuilds) was never shown, and a
// person's Failed testing rebuilt with no cap at all. Measured: 7 of 100
// sampled tickets failed more than once; one took 4 builds and 3 human fails.
//
// So the loop is stored on the card, as pipeline fields only the automation
// and the Cloud Functions (MCP) write (firestore.rules → itemPipelineFields):
//
//   testRound         1 on first arrival in Ready for Testing, +1 on each
//                     later arrival that follows a counted send-back.
//   sendBacks         [{at, by: "person"|"tests"|"review", who, category,
//                     line, counted}], newest last, the last 10 kept.
//   sendBackCount     every send-back ever (not capped).
//   countedSendBacks  the send-backs that count towards the loop cap.
//
// A send-back that is not the ticket's fault is recorded with counted: false
// and adds no round: "Blocking a release, not a rebuild", a ticket held
// because main was broken, and a red that passed when re-run (flaky).
//
// The cap: on the 3rd counted send-back the ticket is not rebuilt; it stays
// in Backlog flagged needs-decision. Clearing the flag (or answering it, or
// Ready for Dev) builds it again, and the next cap is at 5, then 7.
// That replaces autoRebuilds for send-backs, so there is one number: a test
// send-back no longer spends autoRebuilds, which is left to the other
// automatic rebuilds (a patch that conflicted, a migration number clash).
//
// Shared by scripts/run-backlog-automation.js, functions/mcp-server.js and
// scripts/backfill-test-rounds.js. public/js/test-rounds-view.js is the
// browser's read side (a browser module can't require this file).

const SEND_BACKS_KEPT = 10;
const NO_REBUILD_CATEGORY = "Blocking a release, not a rebuild";
const FIRST_CAP = 3;
const CAP_STEP = 2;
const LOOP_FLAG_SET_BY = "test-rounds";
const LINE_MAX = 280;

function timeMs(v) {
  if (v == null) return NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  return Date.parse(v);
}
function toIso(v) {
  const ms = timeMs(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
const clip = (s) => (s.length > LINE_MAX ? `${s.slice(0, LINE_MAX - 1)}…` : s);
function firstSentence(s) {
  const t = String(s || "").trim().split("\n")[0];
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  return clip((m ? m[1] : t).replace(/[.]$/, ""));
}

function isCountedCategory(category) {
  return category !== NO_REBUILD_CATEGORY;
}

// One send-back as stored. `line` is the one line a tester reads ("Sent back
// last time: <line>"): the failing test for an automatic send-back
// (summary), the first sentence of what a person wrote otherwise.
function sendBackEntry({ at, by, who, category, text, summary, line, counted } = {}) {
  const cat = String(category || "Other");
  return {
    at: toIso(at) || new Date().toISOString(),
    by: by === "tests" || by === "review" ? by : "person",
    who: String(who || (by === "tests" ? "automation" : by === "review" ? "ph-reviewer" : "a tester")).slice(0, 200),
    category: cat.slice(0, 120),
    line: clip(String(line || summary || firstSentence(text) || cat)),
    counted: counted === undefined ? isCountedCategory(cat) : !!counted,
  };
}

// The send-back a card's lastFailureReason describes, or null when it holds
// none. action "review-kickback" is the Review Batch's; a card ejected by the
// automation carries category "tests".
function sendBackFromFailureReason(item, who) {
  const r = item && item.lastFailureReason;
  if (!r || typeof r !== "object" || Number.isNaN(timeMs(r.at))) return null;
  const by = r.action === "review-kickback" ? "review" : (r.category === "tests" ? "tests" : "person");
  return sendBackEntry({ at: r.at, by, who: who || r.who || undefined, category: r.category, text: r.text, summary: r.summary });
}

// ── Reading the loop off a card, stored fields first, notes for old cards ──
// The same rules as rejectionsOf (public/js/rejection-summary.js) — kept in
// step by test/test-rounds.test.js, which runs both on the same notes.
const NOTE_RULES = [
  { re: /^Sent back automatically \(Failed testing \[([^\]]+)\]\):\s*/, by: "tests",
    line: (rest) => (/^Why: /.test(rest) ? clip(rest.slice(5).split("\n")[0].replace(/[.]$/, "")) : firstSentence(rest)) },
  { re: /^Failed testing \[([^\]]+)\](?: \(via MCP\))?:\s*/, by: "person", line: (rest, cat) => `${cat}: ${firstSentence(rest)}` },
  { re: /^Ejected from train \[([^\]]+)\]:\s*/, by: "person", line: (rest, cat) => `${cat}: ${firstSentence(rest)}` },
  { re: /^Not sent back: main is broken, not this ticket\.\s*/, by: "tests", held: true,
    line: (rest) => { const m = rest.match(/\)\s*:\s*(.+?)\. It stays where it is/); return clip(m ? `main is broken: ${m[1]}` : "main is broken, not this ticket"); } },
];
// Oldest first, like sendBacks.
function sendBacksFromNotes(notes) {
  const out = [];
  for (const n of Array.isArray(notes) ? notes : []) {
    const text = String((n && n.text) || "");
    for (const r of NOTE_RULES) {
      const m = text.match(r.re);
      if (!m) continue;
      const category = r.held ? "main is broken" : m[1];
      const who = r.by === "tests" ? "automation" : (n.author && n.author !== "viewer" ? n.author : "a tester");
      out.push(sendBackEntry({ at: n.at, by: r.by, who, category, line: r.line(text.slice(m[0].length), m[1]), counted: r.held ? false : isCountedCategory(category) }));
      break;
    }
  }
  return out.sort((a, b) => (timeMs(a.at) || 0) - (timeMs(b.at) || 0));
}

function hasStoredLoop(item) {
  return !!item && (item.sendBackCount != null || Array.isArray(item.sendBacks));
}

// { testRound, sendBacks (oldest first), sendBackCount, countedSendBacks }.
// A card written before this existed is read from its notes.
function loopState(item) {
  if (hasStoredLoop(item)) {
    const sendBacks = Array.isArray(item.sendBacks) ? item.sendBacks.slice() : [];
    return {
      testRound: Number(item.testRound) || 0,
      sendBacks,
      sendBackCount: Number(item.sendBackCount) || sendBacks.length,
      countedSendBacks: item.countedSendBacks != null ? Number(item.countedSendBacks) || 0 : sendBacks.filter((s) => s.counted !== false).length,
    };
  }
  return backfillFields(item || {});
}

// The once-only backfill (scripts/backfill-test-rounds.js) and the read of
// any card it has not reached. testRound: a card on the board now is in
// round 1 + its counted send-backs; one in Backlog last ran in round
// `counted` (0 if it never reached testing).
function backfillFields(item) {
  const all = sendBacksFromNotes(item && item.notes);
  const counted = all.filter((s) => s.counted).length;
  const onBoard = ["ready-for-testing", "ready-to-publish", "published-live", "archived"].includes(item && item.status);
  return {
    testRound: onBoard ? counted + 1 : counted,
    sendBacks: all.slice(-SEND_BACKS_KEPT),
    sendBackCount: all.length,
    countedSendBacks: counted,
  };
}

function hasSendBackAt(item, at) {
  const ms = timeMs(at);
  if (Number.isNaN(ms)) return false;
  return loopState(item).sendBacks.some((s) => timeMs(s.at) === ms);
}

// The fields to write for one more send-back, or null when this exact one
// (same `at`) is already recorded — the MCP tool and ejectRedCulprits write
// theirs at once, processRevertFromTrain records the browser's later.
function recordSendBack(item, entry) {
  if (!entry) return null;
  const s = loopState(item);
  // Already there. On a card with no stored fields that means its notes hold
  // it (the board's Failed testing writes the note with the same `at`): store
  // what the notes say, so the card is not read from notes again.
  if (hasSendBackAt(item, entry.at)) return hasStoredLoop(item) ? null : { ...s };
  const e = sendBackEntry(entry);
  return {
    sendBacks: s.sendBacks.concat(e).slice(-SEND_BACKS_KEPT),
    sendBackCount: s.sendBackCount + 1,
    countedSendBacks: s.countedSendBacks + (e.counted ? 1 : 0),
    // Stored once, so a card that had none is not read from notes again.
    testRound: s.testRound,
  };
}

// Arriving in Ready for Testing: round 1 the first time, and one more after
// each counted send-back. An uncounted one (taken off a release, held for a
// red main, a flaky red) adds no round.
function arrivalFields(item) {
  const s = loopState(item);
  return { testRound: Math.max(s.testRound, s.countedSendBacks + 1, 1) };
}

// 3, then 5, 7, … — the counted send-back on which a rebuild stops.
function capReached(countedSendBacks) {
  const c = Number(countedSendBacks) || 0;
  return c >= FIRST_CAP && (c - FIRST_CAP) % CAP_STEP === 0;
}
function nextCap(countedSendBacks) {
  const c = Number(countedSendBacks) || 0;
  if (c < FIRST_CAP) return FIRST_CAP;
  return c + (CAP_STEP - ((c - FIRST_CAP) % CAP_STEP));
}

function loopCapReasons(sendBacks, n = FIRST_CAP) {
  return (sendBacks || []).filter((s) => s.counted !== false).slice(-n);
}
function loopCapBlock(state, nowIso = new Date().toISOString()) {
  const c = state.countedSendBacks;
  return {
    reason: "needs-decision",
    note: `Sent back ${c} times. Decide: rewrite the ticket, split it, or build it on the Advanced model. Answer on the card (Answer button), or clear the flag to build it again as it is.`,
    setBy: LOOP_FLAG_SET_BY,
    setAt: nowIso,
  };
}
function loopCapNote(state) {
  const reasons = loopCapReasons(state.sendBacks);
  return `Not rebuilt: sent back ${state.countedSendBacks} times (person, tests and review counted together), so it waits for a decision instead of another automatic rebuild. ` +
    `Decide: rewrite the ticket, split it, or build it on the Advanced model. Clearing the flag (or Answer, or Ready for Dev) builds it again; the next cap is at ${nextCap(state.countedSendBacks)}.\n` +
    reasons.map((s, i) => `${i + 1}. ${toIso(s.at) ? `${toIso(s.at).slice(0, 16).replace("T", " ")} ` : ""}${s.by === "tests" ? "tests" : s.by === "review" ? "review" : s.who}: [${s.category}] ${s.line}`).join("\n");
}

// What processRevertFromTrain does once a sent-back card is off its train:
// record the send-back its lastFailureReason describes (unless recorded
// already), then either rebuild or stop at the cap.
//   { fields: loop fields to write (or {}), cap: bool, block, note }
function revertLoopPlan(item, { nowIso, who } = {}) {
  const entry = sendBackFromFailureReason(item, who);
  const recorded = entry ? recordSendBack(item, entry) : null;
  const state = { ...loopState(item), ...(recorded || {}) };
  const latest = entry ? state.sendBacks.find((s) => timeMs(s.at) === timeMs(entry.at)) : null;
  const cap = !!(item && item.rebuildAfterRevert && latest && latest.counted && capReached(state.countedSendBacks));
  return {
    fields: recorded || {},
    cap,
    block: cap ? loopCapBlock(state, nowIso) : null,
    note: cap ? loopCapNote(state) : null,
    state,
  };
}

module.exports = {
  SEND_BACKS_KEPT, NO_REBUILD_CATEGORY, FIRST_CAP, CAP_STEP, LOOP_FLAG_SET_BY,
  isCountedCategory, sendBackEntry, sendBackFromFailureReason, sendBacksFromNotes,
  hasStoredLoop, loopState, backfillFields, hasSendBackAt, recordSendBack, arrivalFields,
  capReached, nextCap, loopCapBlock, loopCapNote, revertLoopPlan,
};
