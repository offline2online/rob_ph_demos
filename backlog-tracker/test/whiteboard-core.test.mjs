// Pure helpers behind the live whiteboard (public/js/whiteboard-core.js).
// Run with:  cd backlog-tracker/test && node whiteboard-core.test.mjs
import assert from "node:assert";
import {
  newBoardId, isValidBoardId, boardUrl, zoomAt, toWorld, chunkCoords, strokeHit, lastOwnGesture, boundsOf,
  clampZoom, MIN_ZOOM, MAX_ZOOM, fitView,
} from "../public/js/whiteboard-core.js";

// ids: 20 characters of letters and digits, never repeated, and the validator agrees
const ids = new Set(Array.from({ length: 500 }, () => newBoardId()));
assert.strictEqual(ids.size, 500, "ids are unique");
for (const id of ids) assert.ok(isValidBoardId(id) && id.length === 20, id);
// biased-looking input bytes still give a full id (bytes >= 248 are skipped)
assert.strictEqual(newBoardId(() => new Uint8Array(40).fill(255).map((_, i) => (i < 30 ? 255 : i))).length, 20);
for (const bad of ["", "nonsense", "a".repeat(19), "a".repeat(21), "a".repeat(19) + "-", null, undefined, 12, "a".repeat(19) + "/"]) assert.strictEqual(isValidBoardId(bad), false, String(bad));

// links
assert.strictEqual(boardUrl("A".repeat(20), "https://x.web.app/index.html?z=1#faq"), "https://x.web.app/whiteboard.html?b=" + "A".repeat(20));
assert.strictEqual(boardUrl("A".repeat(20), "https://x.web.app/whiteboard.html?b=old&new=1"), "https://x.web.app/whiteboard.html?b=" + "A".repeat(20));

// zoom keeps the point under the cursor fixed and respects the limits
let v = { x: 30, y: -20, k: 1 };
const before = toWorld(v, 400, 300);
v = zoomAt(v, 400, 300, 2);
const after = toWorld(v, 400, 300);
assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9, "anchor stays put");
assert.strictEqual(clampZoom(1e6), MAX_ZOOM);
assert.strictEqual(clampZoom(0), MIN_ZOOM);

// long strokes split into joined pieces under the cap
const long = Array.from({ length: 4000 }, (_, i) => i);
const parts = chunkCoords(long, 1500);
assert.ok(parts.every((p) => p.length <= 1500 && p.length % 2 === 0));
assert.deepStrictEqual(parts[1].slice(0, 2), parts[0].slice(-2), "pieces share their joining point");
assert.strictEqual(parts.at(-1).at(-1), 3999);
assert.deepStrictEqual(chunkCoords([1, 2, 3, 4], 1500), [[1, 2, 3, 4]]);

// eraser hit-testing
const s = { pts: [0, 0, 100, 0], size: 4 };
assert.ok(strokeHit(s, 50, 8, 8), "near the line");
assert.ok(!strokeHit(s, 50, 30, 8), "far from the line");
assert.ok(strokeHit({ pts: [10, 10], size: 6 }, 12, 12, 2), "a dot");

// undo picks the newest of my gestures that still exists
assert.strictEqual(lastOwnGesture(["a", "b", "c"], [{ g: "a" }, { g: "b" }]), "b");
assert.strictEqual(lastOwnGesture(["a"], []), null);

// bounds
assert.strictEqual(boundsOf([]), null);
assert.deepStrictEqual(boundsOf([{ pts: [1, 5, 9, -2] }, { pts: [4, 4] }]), { minX: 1, minY: -2, maxX: 9, maxY: 5 });
// fitView: centred, inside the padded area below the toolbar, capped at 2x
assert.deepStrictEqual(fitView([], 800, 600, 64), { x: 0, y: 0, k: 1 });
const fv = fitView([{ pts: [0, 0, 100, 50] }], 1000, 800, 100);
assert.strictEqual(fv.k, 2, "a small drawing is not blown up past 2x");
assert.ok(Math.abs((50 * fv.k + fv.x) - 500) < 1e-9 && Math.abs((25 * fv.k + fv.y) - 450) < 1e-9, "centre of the drawing is the centre of the free area");
const big = fitView([{ pts: [0, 0, 5000, 4000] }], 1000, 800, 100);
assert.ok(big.k < 0.2 && 5000 * big.k + big.x <= 940 + 1e-6 && 4000 * big.k + big.y <= 740 + 1e-6 && big.y >= 160 - 1e-6, "a large drawing zooms out to stay inside the padding");
assert.strictEqual(fitView([{ pts: [0, 0, 1e7, 1e7] }], 1000, 800).k, MIN_ZOOM, "never zooms out past the minimum");
console.log("whiteboard-core: all assertions passed");
