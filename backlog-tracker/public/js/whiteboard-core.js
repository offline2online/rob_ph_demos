// Live whiteboard: the pure parts (ids, links, geometry), kept apart from the
// canvas and Firestore code in whiteboard.js so they can be tested in Node.
//
// A board is a Firestore doc whiteboards/{id} with a strokes/{strokeId}
// subcollection. The 20-character id is the only credential: anyone holding
// the link may draw while the board is shared (firestore.rules → "Whiteboard").

export const BOARD_ID_LENGTH = 20;
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export const COLORS = ["#232628", "#d4433f", "#e8830c", "#52a81a", "#169bc2", "#9747ff"];
export const SIZES = [2, 5, 10];
export const MAX_COORDS_PER_STROKE = 1500; // x,y pairs flattened; firestore.rules caps a stroke at 4000
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

// Uniform pick from the alphabet using the platform's CSPRNG (rejection sampling, no modulo bias).
export function newBoardId(randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  let id = "";
  while (id.length < BOARD_ID_LENGTH) {
    for (const b of randomBytes(BOARD_ID_LENGTH * 2)) {
      if (b < 248 && id.length < BOARD_ID_LENGTH) id += ALPHABET[b % ALPHABET.length];
    }
  }
  return id;
}

export function isValidBoardId(id) {
  return typeof id === "string" && /^[A-Za-z0-9]{20}$/.test(id);
}

// The shareable link for a board, relative to wherever whiteboard.html is served.
export function boardUrl(id, base) {
  const u = new URL("whiteboard.html", base);
  u.search = "";
  u.hash = "";
  u.searchParams.set("b", id);
  return u.toString();
}

export function clampZoom(k) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

// view = { x, y, k }: world point (wx, wy) is drawn at screen (wx*k + x, wy*k + y).
export function toWorld(view, sx, sy) {
  return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
}

// Zoom by `factor` keeping the world point under screen (sx, sy) where it is.
export function zoomAt(view, sx, sy, factor) {
  const k = clampZoom(view.k * factor);
  const w = toWorld(view, sx, sy);
  return { k, x: sx - w.x * k, y: sy - w.y * k };
}

// Split a flat [x0,y0,x1,y1,…] run into chunks of at most `max` numbers; each
// chunk repeats the previous chunk's last point so the line stays joined.
export function chunkCoords(coords, max = MAX_COORDS_PER_STROKE) {
  if (coords.length <= max) return [coords];
  const out = [];
  let i = 0;
  while (i < coords.length - 2) {
    const end = Math.min(coords.length, i + max);
    out.push(coords.slice(i, end));
    if (end === coords.length) break;
    i = end - 2;
  }
  return out;
}

// Distance from point p to segment ab.
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Does the eraser at world point (x, y) with world radius r touch this stroke?
export function strokeHit(stroke, x, y, r) {
  const p = stroke.pts;
  const reach = r + (stroke.size || 0) / 2;
  if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= reach;
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (distToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return true;
  }
  return false;
}

// Every stroke document that belongs to the same pen-down gesture as `stroke`.
export function gestureMembers(strokes, stroke) {
  return strokes.filter((s) => s.g === stroke.g);
}

// The newest gesture id in `mine` (gesture ids this client drew, oldest first) that still has strokes.
export function lastOwnGesture(mine, strokes) {
  const live = new Set(strokes.map((s) => s.g));
  for (let i = mine.length - 1; i >= 0; i--) if (live.has(mine[i])) return mine[i];
  return null;
}

// Bounding box of all strokes, or null when the board is empty (used by "reset view").
export function boundsOf(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (let i = 0; i + 1 < s.pts.length; i += 2) {
      minX = Math.min(minX, s.pts[i]); maxX = Math.max(maxX, s.pts[i]);
      minY = Math.min(minY, s.pts[i + 1]); maxY = Math.max(maxY, s.pts[i + 1]);
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}
