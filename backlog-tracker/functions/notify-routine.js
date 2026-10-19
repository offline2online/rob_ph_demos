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

module.exports = { STALL_MS, notifyRoutineOutcome, stalledNoteText, shouldStampReportedAt, reportTimeMs, millis };
