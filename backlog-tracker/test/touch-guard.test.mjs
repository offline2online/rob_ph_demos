// Guards the iPad tap fix at the source, without a browser (see
// REQUIREMENTS.md → "iPad taps"). The iPad went dead three times when taps
// were handled per control: 21 Oct (Staff Kanban link), 3 Nov (Staff Kanban,
// Concepts), 5 Nov (Settings and User Management tabs, "many of the links").
// Since 5 Nov every control in the console is covered by ONE console-wide
// handler; these checks fail the build if that is narrowed, bypassed or
// silently worked around:
//   1. nav-shell.js installs installTouchTaps() for the whole document;
//   2. TAP_TARGETS still covers every kind of tappable control;
//   3. no new mousedown/mouseup-only handler without a reviewed entry below
//      (iOS sends no mousedown for a tap once touchend's default is
//      prevented, so a control that acts on mousedown needs [data-native-tap]
//      or must act on click);
//   4. the touch path still listens to Touch Events, times with
//      performance.now(), and swallows the late click.
// Run with:  cd backlog-tracker/test && node touch-guard.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const js = path.join(here, "..", "public", "js");
const read = (f) => fs.readFileSync(path.join(js, f), "utf8");

// 1. Console-wide install.
const nav = read("nav-shell.js");
assert.match(nav, /import \{[^}]*\binstallTouchTaps\b[^}]*\} from "\.\/touch-click\.js"/, "nav-shell.js must import installTouchTaps");
assert.match(nav, /\binstallTouchTaps\(\s*\)/, "nav-shell.js must call installTouchTaps() with no root, i.e. for the whole document");

// 2. What counts as tappable.
const tc = read("touch-click.js");
const targets = (tc.match(/export const TAP_TARGETS = '([^']+)'/) || [])[1];
assert.ok(targets, "touch-click.js must export TAP_TARGETS as a single-quoted string");
for (const need of ["[data-touch-tap]", "button", "a[href]", '[role="button"]', '[role="tab"]', '[role="menuitem"]', '[role="option"]', "summary", 'input[type="checkbox"]', 'input[type="radio"]', "label"]) {
  assert.ok(targets.split(",").map((s) => s.trim()).includes(need), `TAP_TARGETS must include ${need}`);
}
for (const never of ["input[type=\"text\"]", "select", "textarea", "[contenteditable]"]) {
  assert.ok(!targets.includes(never), `TAP_TARGETS must never include ${never}: it needs the native tap for focus and the keyboard`);
}

// 4. The four WebKit failure modes stay handled.
assert.match(tc, /addEventListener\("touchend"[\s\S]*?\{ passive: true \}/, "touchend must stay passive: preventing its default made the browser drop the next quick tap's click (5 Nov 2026); the window click guard swallows the duplicate instead");
assert.match(tc, /addEventListener\("touchstart"/, "Touch Events must be tracked (pointercancel / missing pointer events)");
assert.ok(!/\.timeStamp\b/.test(tc.replace(/\/\/.*$/gm, "")), "taps must be timed with performance.now(), not Event.timeStamp");
assert.match(tc, /window\.addEventListener\("click"[\s\S]*?stopImmediatePropagation[\s\S]*?\}, true\)/, "the late native click must be swallowed by a window capture listener");
assert.match(tc, /window\.addEventListener\("touchstart", disarm/, "a new touch must disarm the late-click guard, or it eats the next tap's real click (Staff Kanban cards, 5 Nov 2026)");

assert.match(tc, /const isToggle = /, "checkboxes, radios and labels must await the browser's own click (fallback only), not be clicked on lift: swallowing a duplicate click reverts a checkbox (5 Nov 2026)");
assert.match(tc, /setTimeout\(firePending, FALLBACK_MS\)/, "a toggle whose click WebKit dropped must still get a fallback click");

// 3. mousedown/mouseup handlers: each one reviewed for the iPad.
// file → number of addEventListener("mousedown"|"mouseup") calls, and why it is safe.
const REVIEWED = {
  "app.js": [1, "FAQ table toolbar keeps focus in the cell; the buttons act on click, which the touch path sends"],
  "leads-page.js": [1, "backdrop <div> closes on mousedown; a <div> is not a tap target, so iOS still sends mousedown"],
  "nav-shell.js": [1, "Command-K backdrop <div>, same as leads-page.js"],
  "kanban/kanban-editor.js": [1, "mention picker acts on mousedown; its box is [data-native-tap]"],
  "kanban/kanban-page.js": [1, "ticket picker acts on mousedown; its box is [data-native-tap]"],
};
const found = {};
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "vendor") walk(p); continue; }
    if (!e.name.endsWith(".js")) continue;
    const n = (fs.readFileSync(p, "utf8").match(/addEventListener\(\s*["'](mousedown|mouseup)["']/g) || []).length;
    if (n) found[path.relative(js, p).split(path.sep).join("/")] = n;
  }
};
walk(js);
for (const [f, n] of Object.entries(found)) {
  assert.ok(REVIEWED[f], `${f} adds a mousedown/mouseup handler that has not been reviewed for the iPad. iOS sends no mousedown for a tap the console has already acted on: act on "click" instead, or put the control inside [data-native-tap] and add ${f} to REVIEWED in test/touch-guard.test.mjs with the reason.`);
  assert.equal(n, REVIEWED[f][0], `${f} now has ${n} mousedown/mouseup handlers, reviewed for ${REVIEWED[f][0]}. Review the new one for the iPad (see the message above) and update REVIEWED.`);
}
for (const f of ["kanban/kanban-editor.js", "kanban/kanban-page.js"]) {
  assert.match(read(f), /box\.dataset\.nativeTap = ""/, `${f}: the mousedown picker must stay inside [data-native-tap]`);
}

console.log("touch-guard: ok");
