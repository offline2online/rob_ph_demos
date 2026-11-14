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

// 75 minutes, not 25 (26 Oct 2026): DSP build sessions report back after
// 28-59 minutes (median 38, 19-26 Oct), so the 25-minute note fired on 17
// healthy builds in a week and its "click Ready for Dev" started duplicate
// sessions whose late patches then collided with the landed ones. The
// automation restarts a session that is still silent at 90 minutes
// (sweepSilentBuildSessions), so this note only has to say what is going on.
const STALL_MS = 75 * 60 * 1000;

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

// ── Heartbeats (14 Nov 2026) ────────────────────────────────────────────────
// A session that died used to be noticed after 75 minutes and restarted after
// 90, and the restart often overlapped one that was only slow. Each fire now
// carries a buildAttemptId (stored on the card and on its lastFire), and the
// session PATCHes buildSession.heartbeatAt / .phase / .attemptId when it
// starts, at each phase change and at least every 10 minutes. Silence is then
// measured from the last heartbeat, not from the start:
//   no first heartbeat 10 minutes after the fire → started again
//   a heartbeat, then nothing for 20 minutes      → started again
//   still beating                                 → never restarted, up to a
//                                                   3-hour ceiling (flagged
//                                                   for a person instead)
// A fire with no buildAttemptId (started before this shipped) was never told
// to beat, so it keeps the old 90-minute rule.
const FIRST_HEARTBEAT_MS = 10 * 60 * 1000;
const HEARTBEAT_SILENT_MS = 20 * 60 * 1000;
const BUILD_CEILING_MS = 3 * 60 * 60 * 1000;
const LEGACY_SILENT_MS = 90 * 60 * 1000;
const BUILD_PHASES = ["reading", "building", "testing", "packaging"];

// The id of the build attempt this card is waiting on, or null for a fire
// from before attempt ids existed.
function currentAttemptId(card) {
  const id = card && (card.buildAttemptId || (card.lastFire && card.lastFire.buildAttemptId));
  return typeof id === "string" && id ? id : null;
}

// The last heartbeat of the CURRENT attempt, in ms (0 if none). A beat from an
// earlier attempt's session (one that was superseded but is still running)
// carries that attempt's id and does not count; nor does a time in the future.
function heartbeatMs(card, now = Date.now()) {
  const bs = card && card.buildSession;
  const attempt = currentAttemptId(card);
  if (!bs || !attempt || bs.attemptId !== attempt) return 0;
  const beat = millis(bs.heartbeatAt);
  return beat ? Math.min(beat, now) : 0;
}
function heartbeatPhase(card) {
  const p = card && card.buildSession && card.buildSession.phase;
  return typeof p === "string" && p.trim() ? p.trim().toLowerCase().slice(0, 40) : null;
}
// Is this card's current session beating right now?
function isBeating(card, now = Date.now()) {
  const beat = heartbeatMs(card, now);
  return !!beat && now - beat < HEARTBEAT_SILENT_MS;
}

// What the sweep should do about a started session that has not reported:
// null (leave it), or { action, kind, phase, quietMs } where action is
//   "retry"    start it again (under the retry cap)
//   "escalate" the retry went quiet too: mark errored, flag for a person
//   "ceiling"  still beating after 3 hours: flag for a person, do NOT restart
// and kind is "no-first-heartbeat" | "quiet" | "legacy" | "ceiling".
function silentBuildSession(card, now = Date.now(), retryCap = 1) {
  if (!card || card.status !== "backlog" || card.patchReady || (card.blocked && card.blocked.reason)) return null;
  const fire = card.lastFire;
  if (!fire || !fire.sessionId) return null;
  const fired = millis(fire.at);
  if (!fired) return null;
  const bs = card.buildSession;
  const reported = bs ? Math.max(millis(bs.reportedAt), millis(bs.finishedAt)) : 0;
  if (reported >= fired) return null; // it did report (done, or error)
  const phase = heartbeatPhase(card);
  let kind;
  let quietMs = now - fired;
  if (!currentAttemptId(card)) {
    if (now - fired < LEGACY_SILENT_MS) return null;
    kind = "legacy";
  } else {
    const beat = heartbeatMs(card, now);
    if (!beat) {
      if (now - fired < FIRST_HEARTBEAT_MS) return null;
      kind = "no-first-heartbeat";
    } else if (now - beat < HEARTBEAT_SILENT_MS) {
      if (now - fired < BUILD_CEILING_MS) return null;
      return { action: "ceiling", kind: "ceiling", phase, quietMs: now - beat };
    } else {
      kind = "quiet";
      quietMs = now - beat;
    }
  }
  const action = (Number(card.buildSessionRetries) || 0) < retryCap ? "retry" : "escalate";
  return { action, kind, phase: kind === "quiet" ? phase : null, quietMs };
}
const minutesOf = (ms) => Math.max(1, Math.round(ms / 60000));
// The one note a card gets for each of those outcomes.
function silentBuildNote(card, next) {
  const fire = (card && card.lastFire) || {};
  const startedIso = millis(fire.at) ? new Date(millis(fire.at)).toISOString() : "an unknown time";
  const during = next.phase ? ` during ${next.phase}` : "";
  const link = fire.sessionUrl ? `, ${fire.sessionUrl}` : "";
  if (next.action === "ceiling") {
    return `The build session started at ${startedIso} has been running for ${Math.round(BUILD_CEILING_MS / 3600000)} hours and is still reporting${during} (last heard from ${minutesOf(next.quietMs)} minutes ago${link}). It was not started again. Flagged for a person to decide.`;
  }
  if (next.action === "escalate") {
    const why = next.kind === "quiet" ? `went quiet ${minutesOf(next.quietMs)} minutes ago${during}`
      : next.kind === "no-first-heartbeat" ? `never sent a first heartbeat`
        : `never reported back`;
    return `The build session ${why}, and so did the attempt before it (last started ${startedIso}${link}). Marked as errored so the project is not left waiting on it.`;
  }
  if (next.kind === "quiet") return `Build session went quiet ${minutesOf(next.quietMs)} minutes ago${during}; starting it again.`;
  if (next.kind === "no-first-heartbeat") return `The build session started at ${startedIso} sent no first heartbeat within ${Math.round(FIRST_HEARTBEAT_MS / 60000)} minutes; starting it again.`;
  return `The build session started at ${startedIso} never reported back. Starting it again.`;
}

// A patch handed back by a session whose attempt has been superseded must not
// land (two sessions for one ticket each wrote their own fix on 14 tickets up
// to 10 Nov 2026). The session writes its own id as patchAttemptId in the same
// PATCH as patchFiles; the card's buildAttemptId is the current one. A patch
// with no id (a session from before this shipped, or a hand-made patch) is not
// stale. Pure.
function staleAttemptPatch(card) {
  const mine = card && card.patchAttemptId;
  const current = card && card.buildAttemptId;
  return typeof mine === "string" && !!mine && typeof current === "string" && !!current && mine !== current;
}

// → { outcome: "open" | "done" | "stalled" | "closed", noteCardIds }
// "closed" = nothing to do: the record is not in progress.
function notifyRoutineOutcome(routine, cards, now = Date.now()) {
  if (!routine || routine.status !== "in-progress") return { outcome: "closed", noteCardIds: [] };
  const byId = new Map((cards || []).map((c) => [c.id, c]));
  const unsettled = (routine.sentItemIds || []).filter((id) => !cardSettled(byId.get(id), routine));
  if (!unsettled.length) return { outcome: "done", noteCardIds: [] };
  const firedMs = millis(routine.firedAt);
  if (firedMs && now - firedMs >= STALL_MS) {
    // A session that is still beating is building, not stalled: the record
    // stays open for it (up to the 3-hour ceiling) and it gets no note.
    const beating = firedMs && now - firedMs < BUILD_CEILING_MS && unsettled.some((id) => isBeating(byId.get(id), now));
    if (beating) return { outcome: "open", noteCardIds: [] };
    return { outcome: "stalled", noteCardIds: unsettled };
  }
  return { outcome: "open", noteCardIds: [] };
}

function stalledNoteText(card, routine) {
  const fired = millis((card && card.lastFire && card.lastFire.at)) || millis(routine.firedAt);
  const sess = (card && card.lastFire && card.lastFire.sessionUrl)
    || ((routine.sessions || []).find((s) => s && s.itemId === (card && card.id)) || {}).sessionUrl
    || routine.sessionUrl || "no session link";
  return `The build session started at ${fired ? new Date(fired).toISOString() : "an unknown time"} (${sess}) hasn't reported back after ${Math.round(STALL_MS / 60000)} minutes. ` +
    `If it stays silent it is started again automatically; open the session to see what it is doing. No click is needed (a second Ready for Dev now would build it twice).`;
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
    if (!firedMs) return false;
    if (reportTimeMs(card.buildSession) >= firedMs) return false;
    // Beating: in flight however long it has run (up to the ceiling).
    if (isBeating(card, now) && now - firedMs < BUILD_CEILING_MS) return true;
    return now - firedMs < STALL_MS;
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

module.exports = {
  FIRST_HEARTBEAT_MS, HEARTBEAT_SILENT_MS, BUILD_CEILING_MS, LEGACY_SILENT_MS, BUILD_PHASES,
  currentAttemptId, heartbeatMs, heartbeatPhase, isBeating, silentBuildSession, silentBuildNote, staleAttemptPatch,
  STALL_MS, notifyRoutineOutcome, stalledNoteText, shouldStampReportedAt, reportTimeMs, millis, cardSettled, inFlightItemIds, unbuiltReportAction, UNBUILT_REPORT_GRACE_MS, UNBUILT_SETTER,
};
