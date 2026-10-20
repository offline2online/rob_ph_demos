// Pure rules for closing a project's per-item build record
// (projects/{id}.notifyRoutine) and for stamping a trusted report time on a
// card's buildSession. Required by functions/index.js (the reportedAt
// trigger) and scripts/run-backlog-automation.js (the sweep that closes the
// record). No Firebase SDK, no network — plain data in, plain answers out —
// so test/notify-routine.test.js runs with nothing but `node`.
//
// Why: on 19 Oct 2026 "Deving…" spun for hours after every build had
// finished. A session's own `finishedAt` is its guess at "now" (one was
// stamped 14:00:00.000Z for work that landed at 20:22), and nothing ever
// closed the project record, so the board could only infer the truth from
// clocks. `reportedAt` is the server's clock; the sweep closes the record.
"use strict";

const STALL_MS = 25 * 60 * 1000;

function millis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && typeof v._seconds === "number") return v._seconds * 1000;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
}

const REPORTED = new Set(["done", "error"]);

// A session has reported when it said done/error. The time that counts is the
// server's `reportedAt`; the session's own `finishedAt` is only a fallback for
// records written before the trigger existed.
function reportTimeMs(buildSession) {
  const bs = buildSession;
  if (!bs || !REPORTED.has(bs.status)) return 0;
  return millis(bs.reportedAt) || millis(bs.finishedAt);
}

// Has this sent card stopped needing its session? It left Backlog, has a
// finished patch, or its session reported after the click.
function cardSettled(card, routine) {
  if (!card) return true; // deleted
  if (card.status !== "backlog" || card.patchReady) return true;
  if (routine.mode !== "per-item") return false;
  return reportTimeMs(card.buildSession) >= millis(routine.firedAt) && reportTimeMs(card.buildSession) > 0;
}

// → { outcome: "open" | "done" | "stalled" | "closed", noteCardIds }
// "closed" = nothing to do: the record is not in progress.
function notifyRoutineOutcome(routine, cards, now = Date.now()) {
  if (!routine || routine.status !== "in-progress") return { outcome: "closed", noteCardIds: [] };
  const byId = new Map((cards || []).map((c) => [c.id, c]));
  const unsettled = (routine.sentItemIds || []).filter((id) => !cardSettled(byId.get(id), routine));
  if (!unsettled.length) return { outcome: "done", noteCardIds: [] };
  const firedMs = millis(routine.firedAt);
  if (firedMs && now - firedMs >= STALL_MS) return { outcome: "stalled", noteCardIds: unsettled };
  return { outcome: "open", noteCardIds: [] };
}

function stalledNoteText(card, routine) {
  const fired = millis((card && card.lastFire && card.lastFire.at)) || millis(routine.firedAt);
  const sess = (card && card.lastFire && card.lastFire.sessionUrl)
    || ((routine.sessions || []).find((s) => s && s.itemId === (card && card.id)) || {}).sessionUrl
    || routine.sessionUrl || "no session link";
  return `The build session started at ${fired ? new Date(fired).toISOString() : "an unknown time"} (${sess}) never reported back. Open the session to see what happened, or click Ready for Dev to build it again.`;
}

// Should this write to a backlogItems doc stamp buildSession.reportedAt? Only
// when a session reports done/error: the status changed to it, or a new
// report (finishedAt/errorMessage) arrived on a card that already said so.
// Any other write — including this stamp itself — is left alone.
function shouldStampReportedAt(before, after) {
  const a = after && after.buildSession;
  if (!a || !REPORTED.has(a.status)) return false;
  const b = (before && before.buildSession) || {};
  return b.status !== a.status || millis(b.finishedAt) !== millis(a.finishedAt) || (b.errorMessage || null) !== (a.errorMessage || null);
}

// The sent tickets an in-progress click is still building right now: a session
// actually started for the card (lastFire "started"), less than STALL_MS ago,
// has not reported since, and the card is still waiting in Backlog. A new
// Ready for Dev click must not start a second session for these (20 Oct 2026:
// every ticket on both trains was built twice, by two sessions that each wrote
// their own version of the fix). Timed per card, from its own fire, because a
// later click carries these ids onto a newer record. A fire that never started
// a session is not in flight — its retry must still go out — and one older
// than STALL_MS has stalled rather than building.
function inFlightItemIds(routine, cards, now = Date.now()) {
  if (!routine || routine.status !== "in-progress" || !Array.isArray(routine.sentItemIds)) return [];
  const byId = new Map((cards || []).map((c) => [c.id, c]));
  return routine.sentItemIds.filter((id) => {
    const card = byId.get(id);
    if (!card || card.status !== "backlog" || card.patchReady) return false;
    if (card.blocked && card.blocked.reason) return false;
    const fire = card.lastFire;
    if (!fire || fire.status !== "started") return false;
    const firedMs = millis(fire.at);
    if (!firedMs || now - firedMs >= STALL_MS) return false;
    return reportTimeMs(card.buildSession) < firedMs;
  });
}

// A session that reported "done" but left its card in Backlog with no patch
// and no blocked flag stopped on something only a person can answer — usually
// a question written as a comment (20 Oct 2026, ticket rx1RfF2p7tyqJABWHR0q:
// "Which one? Answer on the card", but no flag, so no Answer button; the reply
// went in as a plain comment, nothing rebuilt it, and the project's Ready for
// Testing hand-off waited on it as "still building"). Returns what the sweep
// should do, or null:
//   { action: "rebuild", answer }  a person has already replied in a comment
//                                  since the report: that reply is the answer
//                                  (the build prompt carries the comments)
//   { action: "block", blocked }   nobody has: raise waiting-on-input with the
//                                  session's last comment, so the card shows
//                                  the question and an Answer button
// Waits GRACE_MS after the report so a session that writes patchReady just
// after its buildSession is not caught mid-way.
const UNBUILT_REPORT_GRACE_MS = 3 * 60 * 1000;
const UNBUILT_REPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UNBUILT_SETTER = "build-report";
const isPersonNote = (n) => !!n && typeof n.author === "string" && n.author.includes("@") && typeof n.text === "string" && n.text.trim();
function unbuiltReportAction(card, now = Date.now()) {
  if (!card || card.status !== "backlog" || card.patchReady) return null;
  if (card.blocked && card.blocked.reason) return null;
  const bs = card.buildSession;
  if (!bs || bs.status !== "done") return null;
  const reported = reportTimeMs(bs);
  if (!reported || now - reported < UNBUILT_REPORT_GRACE_MS) return null;
  // Only recent reports: an old card left alone in Backlog is someone's
  // decision, not a stuck build, and must not start building out of the blue.
  if (now - reported > UNBUILT_REPORT_MAX_AGE_MS) return null;
  // Something already happened since the report: a newer fire (Answer, Ready
  // for Dev, a rebuild), a person clearing the flag by hand, or the pipeline
  // acting on the card (its patch landed and it was sent back since).
  if (card.lastFire && millis(card.lastFire.at) > reported) return null;
  if (card.blockedClearedAt && millis(card.blockedClearedAt) > reported) return null;
  const notes = Array.isArray(card.notes) ? card.notes : [];
  if (notes.some((n) => n && n.author === "backlog-automation" && millis(n.at) > reported)) return null;
  const reply = notes.filter((n) => isPersonNote(n) && millis(n.at) > reported).pop();
  if (reply) return { action: "rebuild", answer: reply.text.trim() };
  const fromSession = notes.filter((n) => n && n.author === "claude" && typeof n.text === "string" && n.text.trim());
  const last = fromSession[fromSession.length - 1];
  const why = last ? last.text.trim() : "The build session finished without packaging a patch and left no explanation on the card.";
  return {
    action: "block",
    blocked: { reason: "waiting-on-input", note: `${why.length > 1500 ? `${why.slice(0, 1500)}…` : why}\n\nAnswer on the card (Answer button)`, setBy: UNBUILT_SETTER },
  };
}

module.exports = { STALL_MS, notifyRoutineOutcome, stalledNoteText, shouldStampReportedAt, reportTimeMs, millis, cardSettled, inFlightItemIds, unbuiltReportAction, UNBUILT_REPORT_GRACE_MS, UNBUILT_SETTER };
