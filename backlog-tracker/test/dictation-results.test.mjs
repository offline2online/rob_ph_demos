// public/js/dictation-results.js under plain Node: how SpeechRecognition
// result events become committed text, for the console's mics (app.js) and
// the Staff Kanban's (kanban/kanban-page.js).
//
// Why (21 Oct 2026): on an Android phone the Staff Kanban's Record button
// wrote "add add add a new add a new Epic add a new Epic to add a new Epic
// to add a new Epic to the add a new Epic to the board Jack Jack Johnson
// Jack Johnson why why is ...". Android Chrome in continuous mode reports
// every in-progress guess as a final, each the whole utterance so far. The
// events below are that sequence, in the shape Chrome delivers it (finals
// accumulate in event.results; resultIndex is the new one).
//
// Run with:  node test/dictation-results.test.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const {
  isAndroidDevice, useContinuousMode, resetDictationEngineState, relateToPrevious, createResultReader,
} = await import(pathToFileURL(path.join(here, "..", "public", "js", "dictation-results.js")).href);

const result = (transcript, isFinal) => Object.assign([{ transcript }], { isFinal });
// One session as Chrome reports it: finals stay in the list, the interim
// (if any) is the last entry and is replaced by the next event.
function session() {
  const results = [];
  return {
    say(transcript, isFinal) {
      const last = results[results.length - 1];
      const index = last && !last.isFinal ? results.length - 1 : results.length;
      results[index] = result(transcript, isFinal);
      return { resultIndex: index, results: results.slice() };
    },
  };
}
// What a consumer does with the reader: one segment per final, a
// cumulative final taking the place of the one before it.
function transcriber() {
  const reader = createResultReader();
  const segs = [];
  let interim = "";
  const commit = (f) => { if (f.replaces && segs.length) segs[segs.length - 1] = f.text; else segs.push(f.text); };
  return {
    newSession() { reader.reset(); },
    event(e) { const out = reader.read(e); out.finals.forEach(commit); interim = out.interim; },
    end() { const s = reader.settle(interim); interim = ""; if (s) commit(s); },
    text: () => [...segs, interim].join(" ").replace(/\s+/g, " ").trim(),
  };
}

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
// Chrome on Android with "Desktop site" on, or an Android tablet.
const ANDROID_DESKTOP_SITE_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

let passed = 0;
function check(name, fn) {
  resetDictationEngineState();
  fn();
  passed++;
  process.stdout.write(`  ok  ${name}\n`);
}

check("the reported Android sequence is written once per utterance", () => {
  const t = transcriber();
  const utterances = [
    ["add", "add", "add a new", "add a new Epic", "add a new Epic", "add a new Epic to", "add a new Epic to", "add a new Epic to the", "add a new Epic to the board"],
    ["Jack", "Jack Johnson", "Jack Johnson"],
    ["why", "why is", "why is it", "why is it doing", "why is it doing that"],
    ["it's", "it's", "it's repeating", "it's repeating", "it's repeating the", "it's repeating the text"],
  ];
  for (const guesses of utterances) {
    // Android ends the session after every utterance; the page restarts it.
    t.newSession();
    const s = session();
    for (const g of guesses) t.event(s.say(g, true));
    t.end();
  }
  assert.equal(t.text(), "add a new Epic to the board Jack Johnson why is it doing that it's repeating the text");
});

check("cumulative finals within one long session fold too", () => {
  const t = transcriber();
  const s = session();
  for (const g of ["add", "add a new", "add a new Epic to the board"]) t.event(s.say(g, true));
  assert.equal(t.text(), "add a new Epic to the board");
});

check("seeing cumulative finals twice in a session ends continuous mode for the visit", () => {
  const nav = { userAgent: DESKTOP_UA };
  assert.equal(useContinuousMode(nav), true);
  const t = transcriber();
  const s = session();
  t.event(s.say("add", true));
  t.event(s.say("add a new", true));
  assert.equal(useContinuousMode(nav), true, "once could be a person repeating themselves");
  t.event(s.say("add a new Epic", true));
  assert.equal(useContinuousMode(nav), false, "twice is the engine");
});

check("Android records one utterance per session, whatever its user agent says", () => {
  assert.equal(isAndroidDevice({ userAgent: ANDROID_UA }), true);
  assert.equal(useContinuousMode({ userAgent: ANDROID_UA }), false);
  assert.equal(isAndroidDevice({ userAgent: ANDROID_DESKTOP_SITE_UA, userAgentData: { platform: "Android", mobile: false } }), true);
  assert.equal(isAndroidDevice({ userAgent: DESKTOP_UA, userAgentData: { platform: "macOS" } }), false);
  assert.equal(useContinuousMode({ userAgent: DESKTOP_UA }), true);
  assert.equal(isAndroidDevice({}), false);
});

check("Android in one-utterance mode: interim guesses, then one final", () => {
  const t = transcriber();
  const s = session();
  t.event(s.say("add a", false));
  assert.equal(t.text(), "add a");
  t.event(s.say("add a new epic", false));
  assert.equal(t.text(), "add a new epic");
  t.event(s.say("add a new epic to the board", true));
  t.end();
  assert.equal(t.text(), "add a new epic to the board");
});

check("desktop Chrome's separate finals are all kept, interim shown after them", () => {
  const t = transcriber();
  const s = session();
  t.event(s.say("hello world", true));
  t.event(s.say(" how are", false));
  assert.equal(t.text(), "hello world how are");
  t.event(s.say(" how are you", true));
  t.event(s.say(" the menu board is", false));
  assert.equal(t.text(), "hello world how are you the menu board is");
  t.end();
  assert.equal(t.text(), "hello world how are you the menu board is", "unfinalized words are kept when the session ends");
});

check("a final repeated as a new result (resultIndex 1 = results[0]) is dropped", () => {
  const reader = createResultReader();
  assert.deepEqual(reader.read({ resultIndex: 0, results: [result("hello there", true)] }).finals, [{ text: "hello there", replaces: false }]);
  assert.deepEqual(reader.read({ resultIndex: 1, results: [result("hello there", true), result("hello there", true)] }).finals, []);
});

check("an engine that resends the whole list from index 0 commits nothing twice", () => {
  const reader = createResultReader();
  const all = [result("first part", true)];
  assert.equal(reader.read({ resultIndex: 0, results: all.slice() }).finals.length, 1);
  all.push(result("second part", true));
  const out = reader.read({ resultIndex: 0, results: all.slice() });
  assert.deepEqual(out.finals, [{ text: "second part", replaces: false }]);
});

check("an engine that skips resultIndex past a final still commits it", () => {
  const reader = createResultReader();
  const out = reader.read({ resultIndex: 1, results: [result("missed", true), result("next", true)] });
  assert.deepEqual(out.finals.map((f) => f.text), ["missed", "next"]);
});

check("a new session starts its result indexes again", () => {
  const reader = createResultReader();
  reader.read({ resultIndex: 0, results: [result("one", true), result("two", true)] });
  reader.reset();
  assert.deepEqual(reader.read({ resultIndex: 0, results: [result("three", true)] }).finals, [{ text: "three", replaces: false }]);
});

check("how a final relates to the one before it", () => {
  assert.equal(relateToPrevious("", "hello"), "append");
  assert.equal(relateToPrevious("hello", ""), "drop");
  assert.equal(relateToPrevious("add a new", "add a new"), "drop");
  assert.equal(relateToPrevious("add a new epic", "add a new"), "drop", "an older, shorter guess");
  assert.equal(relateToPrevious("add a new", "add a new epic"), "replace");
  assert.equal(relateToPrevious("its", "It's repeating."), "replace", "case, apostrophes and punctuation don't count");
  assert.equal(relateToPrevious("add it to the bored", "add it to the board please"), "replace", "the last word of a longer guess was revised");
  assert.equal(relateToPrevious("to the", "to them all"), "append", "too short to call a revision");
  assert.equal(relateToPrevious("hello world", "how are you"), "append");
  assert.equal(relateToPrevious("the price is wrong", "the stock is wrong too"), "append", "only the last word may differ");
});

check("settle() commits words never finalized, folding them like a final", () => {
  const reader = createResultReader();
  reader.read({ resultIndex: 0, results: [result("add a new", true)] });
  assert.deepEqual(reader.settle("add a new epic"), { text: "add a new epic", replaces: true });
  assert.equal(reader.settle("   "), null);
  assert.equal(reader.settle("add a new"), null);
});

resetDictationEngineState();
console.log(`\ndictation-results: ok — ${passed} scenarios\n`);
