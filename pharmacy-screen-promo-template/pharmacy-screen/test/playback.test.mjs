// Playing once (the player, unless loop=1): the Seasonal beats' timings end with the last beat on screen.
// The player's own behaviour (scenes held, restarts, loop=1) is tested in Chromium: test/ui/playback.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../js/render.js';
import { OCCASION_CSS } from '../js/occasions.js';

test('occasionTiming: played once, the last beat ends visible; looping (the editor, loop=1) it fades out as before', () => {
  // Default timings: the designs' own keyframes either way (the .once class picks the last beat's).
  assert.deepEqual(R.occasionTiming([{}, {}, {}], { once: true }), { custom: false, total: 12 });
  const loop = R.occasionTiming([{ dur: 3 }, { dur: 4 }]);
  const once = R.occasionTiming([{ dur: 3 }, { dur: 4 }], { once: true });
  assert.equal(once.total, 7);
  assert.equal(once.style(1), 'animation-name:occTo3_4B2;animation-duration:7s', 'its own keyframe names, apart from the loop\'s');
  assert.equal(loop.style(1), 'animation-name:occT3_4B2;animation-duration:7s');
  const lastOnce = /@keyframes occTo3_4B2\{([^]*?)\}\}/.exec(once.css)[1];
  assert.match(lastOnce, /,100%\{opacity:1;transform:none$/, 'played once: the last beat ends visible');
  assert.match(/@keyframes occT3_4B2\{([^]*?)\}\}/.exec(loop.css)[1], /100%\{opacity:0;/, 'looping: the last beat fades out');
  // Every beat before the last fades out in both.
  assert.match(/@keyframes occTo3_4B1\{([^]*?)\}\}/.exec(once.css)[1], /100%\{opacity:0;/);
  // The first beat's keyframes are the same played once or looping.
  assert.equal(/@keyframes occTo3_4B1(\{[^]*?\}\})/.exec(once.css)[1], /@keyframes occT3_4B1(\{[^]*?\}\})/.exec(loop.css)[1]);
});

test('OCCASION_CSS: .once runs each beat one time and the last beat (Christmas: the second) on keyframes that end visible', () => {
  assert.match(OCCASION_CSS, /\.occ\.once \.b\{animation-iteration-count:1\}/);
  assert.match(OCCASION_CSS, /\.occ\.once \.b3\{animation-name:occB3Once\}/);
  assert.match(OCCASION_CSS, /\.occ-christmas\.once \.b2\{animation-name:xmasB2Once\}/);
  assert.match(OCCASION_CSS, /@keyframes occB3Once\{[^}]*\}71%,100%\{opacity:1;transform:none\}\}/);
  assert.match(OCCASION_CSS, /@keyframes xmasB2Once\{[^}]*\}56%,100%\{opacity:1;transform:none\}\}/);
  // The held beat (.hold) is unchanged: the copy-fit audit and the editor's paused preview see what they saw.
  assert.match(OCCASION_CSS, /\.occ\.hold \.b\{animation:none;opacity:0;transform:none\}\n\.occ\.hold \.b\.on\{opacity:1\}/);
});
