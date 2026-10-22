// Reading SpeechRecognition results the same way on every browser. Shared
// by the console's dictation controller (app.js: New Item, every comment
// box) and the Staff Kanban's recorder (kanban/kanban-page.js: Record task,
// the description and comment mics). No DOM, so
// test/dictation-results.test.mjs runs it under plain Node.
//
// Why (21 Oct 2026, from an Android phone on the Staff Kanban's New task
// Record button): "add add add a new add a new Epic add a new Epic to ..."
// — every phrase written out again each time a word was added. Android
// Chrome in continuous mode reports each in-progress guess at an utterance
// as a FINAL result, and each one is the whole utterance so far, so code
// that appends finals writes the sentence over and over. Two defences:
//   1. On Android, never continuous mode: one utterance per session, the
//      session restarted when it ends (useContinuousMode()). app.js has
//      done this since 16 Sep 2026; the Staff Kanban never did.
//   2. Whatever the engine, a final that only carries the previous final of
//      the same session further replaces it instead of being appended, and
//      one that repeats it is dropped (createResultReader()). That covers an
//      Android device the user-agent check misses ("Desktop site", and
//      Android tablets, send a desktop user agent) and any engine that does
//      the same. Seen twice in one session, the page stops using continuous
//      mode for the rest of the visit.

// Android, from the user agent or, where Chrome sends them, its client hints.
export function isAndroidDevice(nav) {
  const n = nav || (typeof navigator !== "undefined" ? navigator : null);
  if (!n) return false;
  if (/Android/i.test(n.userAgent || "")) return true;
  const data = n.userAgentData;
  return !!(data && /Android/i.test(data.platform || ""));
}

// Set once an engine has been caught sending cumulative finals.
let cumulativeEngine = false;

// Whether the next recognition session should run in continuous mode.
export function useContinuousMode(nav) {
  return !cumulativeEngine && !isAndroidDevice(nav);
}

// For tests only: forget a cumulative engine seen earlier in this page.
export function resetDictationEngineState() {
  cumulativeEngine = false;
}

// Lowercased words without punctuation, so "It's" and "its," compare equal.
function wordsOf(text) {
  return String(text || "").toLowerCase().replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// How a final result relates to the final committed just before it in the
// same session:
//   "drop"    — nothing new: the same words, or an earlier, shorter guess;
//   "replace" — the same utterance carried further ("add a new" after
//               "add a"), allowing the engine to have revised the last word
//               of a longer guess ("to the bored" → "to the board please");
//   "append"  — new words.
export function relateToPrevious(previous, next) {
  const b = wordsOf(next);
  if (!b.length) return "drop";
  const a = wordsOf(previous);
  if (!a.length) return "append";
  let same = 0;
  while (same < a.length && same < b.length && a[same] === b[same]) same++;
  if (same === b.length) return "drop";
  if (same === a.length) return "replace";
  if (a.length >= 3 && same === a.length - 1 && b.length >= a.length) return "replace";
  return "append";
}

// One reader per dictation run. reset() at the start of every recognition
// session (result indexes start again from 0); read(event) for every
// `result` event; settle(text) to commit words that were shown but never
// finalized when a session ends.
//
// read() returns { finals: [{ text, replaces }], interim }. `replaces`: the
// final takes the place of the one committed just before it in this
// session (it is never true for a session's first final).
export function createResultReader() {
  // Highest result index already committed as final in this session, and
  // that final's transcript.
  let through = -1;
  let last = "";
  // Finals this session that carried the previous one further.
  let carried = 0;

  function take(text) {
    const how = relateToPrevious(last, text);
    if (how === "drop") return null;
    if (how === "replace" && ++carried >= 2) cumulativeEngine = true;
    last = text;
    return { text, replaces: how === "replace" };
  }

  return {
    reset() { through = -1; last = ""; carried = 0; },
    read(event) {
      const results = (event && event.results) || [];
      const finals = [];
      let interim = "";
      // Start at the event's resultIndex, but never past a final not yet
      // committed: an engine that skips ahead loses nothing, and one that
      // points back at finals already committed doesn't commit them twice.
      const from = Math.max(0, Math.min(Number(event && event.resultIndex) || 0, through + 1));
      for (let i = from; i < results.length; i++) {
        const result = results[i];
        const text = result && result[0] ? String(result[0].transcript || "") : "";
        if (!result || !result.isFinal) { interim += text; continue; }
        if (i <= through) continue;
        through = i;
        const final = take(text);
        if (final) finals.push(final);
      }
      return { finals, interim };
    },
    settle(text) { return String(text || "").trim() ? take(text) : null; },
  };
}
