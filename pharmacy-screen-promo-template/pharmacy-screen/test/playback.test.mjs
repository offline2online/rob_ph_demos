// Playing once (the player, unless loop=1): the Seasonal beats' timings end with the last beat on screen.
// The player's own behaviour (scenes held, restarts, loop=1) is tested in Chromium: test/ui/playback.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../js/render.js';
import { OCCASION_CSS, OCCASION_DESIGNS } from '../js/occasions.js';

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

test('Christmas landscape lights sit on the tree, inside the drifting photo; portrait lights are where they were', () => {
  const fx = OCCASION_DESIGNS.christmas.fx;
  // .gl is inside .photo (so it drifts with xmasDrift); .gp stays a layer of its own above the shade.
  const gl = fx.match(/^<div class="fx photo anim"><div class="fx glow gl">(.*?)<\/div><\/div><div class="fx shade"><\/div>/s);
  assert.ok(gl, 'the landscape lights are the photo layer\'s only child');
  // Every light, put back into screen % of a 1920x1080 landscape screen (.photo has inset -4%), is inside the tree's
  // silhouette as the photo is drawn there (cover, center 38%).
  const B = [[0, 44, 68], [10, 42, 69], [30, 37, 72], [50, 32, 78], [70, 32, 79], [90, 31, 81], [100, 31, 81]];
  const bounds = (y) => { for (let i = 0; i < B.length - 1; i++) { const [y0, a0, b0] = B[i], [y1, a1, b1] = B[i + 1]; if (y >= y0 && y <= y1) { const t = (y - y0) / (y1 - y0); return [a0 + (a1 - a0) * t, b0 + (b1 - b0) * t]; } } return null; };
  const lights = [...gl[1].matchAll(/left:([\d.]+)%;top:([\d.]+)%/g)].map(([, x, y]) => [+x * 1.08 - 4, +y * 1.08 - 4]);
  assert.ok(lights.length >= 60 && lights.length <= 100, `${lights.length} lights`);
  for (const [x, y] of lights) {
    const b = bounds(y);
    assert.ok(b && x >= b[0] - 0.2 && x <= b[1] + 0.2, `light at ${x.toFixed(1)}%, ${y.toFixed(1)}% is off the tree`);
  }
  // Portrait: 49 lights, first one where it always was (the seeded scatter is unchanged).
  const gp = fx.match(/<div class="fx glow gp">(.*?)<\/div>/s)[1];
  assert.equal((gp.match(/<i /g) || []).length, 49);
  assert.match(gp, /^<i style="left:54\.1%;top:10\.8%;/);
});
