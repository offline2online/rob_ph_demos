import { useEffect, useRef, useState } from 'react';
import { Input, Switch, Select, Tag, Modal, Button, message } from 'antd';
import dayjs from 'dayjs';
import { removeBackground as imglyRemoveBackground, preload as imglyPreload } from '@imgly/background-removal';
import MaterialIcon from '../../components/MaterialIcon.jsx';
import BespokeIcon from '../../components/BespokeIcon.jsx';
import IconAction from '../../components/IconAction.jsx';
import BeforeAfterSlider from '../../components/BeforeAfterSlider.jsx';
import TouchUpModal from '../../components/TouchUpModal.jsx';
import ClearableDate from '../../components/ClearableDate.jsx';
import TargetingBuilder, { describeTargeting } from '../../components/TargetingBuilder.jsx';
import { useAiProviders, getBrandById } from '../../data/registries.js';
import { editProductImage, generateProductVideo, isProviderConfigured } from '../../lib/aiProviders.js';

function licenceState(expiry) {
  if (!expiry) return 'ok';
  const days = Math.ceil((new Date(expiry) - new Date()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'ok';
}
function daysUntil(expiry) {
  return Math.ceil((new Date(expiry) - new Date()) / 86400000);
}

function nextVariantLabel(images, type) {
  const isVideo = type === 'video';
  const existing = images.filter((i) => (i.type === 'video') === isVideo);
  if (isVideo) return 'V' + (existing.length + 1);
  return String.fromCharCode(65 + existing.length);
}

// The three image-editing treatments an asset can carry at once — shared
// by the chaining/revert logic in applyImageTreatment and by the saved-vs-
// pending check that locks a toggle and drops the before/after slider once
// its flag is also true in the last-saved baseline.
const TREATMENT_FLAGS = ['bgRemoved', 'enhanced', 'customEdited'];

// isnet_fp16 — the library's own default/balanced model — trades a larger
// one-time download (~80MB vs quint8's ~40MB) for meaningfully better edge
// fidelity; quint8 ("smallest... sometimes shows artifacts", per its own
// docs) was eroding fine product detail on real photos. The full-precision
// `isnet` tier was also tried, compared directly against Canva's own BG
// Remover on the same photo — it produced a pixel-for-pixel identical
// result to fp16 on the one known gap this library has (see below), so
// there's no quality reason to ship its larger download over fp16. Shared
// by both the background preload below and the actual removeBackground
// call so they always agree on — and reuse the same cached — model.
//
// Known gap vs Canva's (proprietary, server-side) BG Remover: on a photo
// with a large light-coloured garnish/napkin surface adjacent to the main
// backdrop, this model's family sometimes treats that surface as
// background too (with a few stray red fragments left behind from a
// patterned print on it), where Canva's correctly keeps it as part of the
// product. Confirmed present in both isnet_fp16 and full isnet — not a
// precision issue, so switching tiers again won't fix it.
const BG_REMOVAL_CONFIG = { model: 'isnet_fp16' };

// Mirrors menu-board.html's own DEFAULT_ROTATION_SECONDS fallback (used
// there when the active Local Feature Highlight template has no Rotation
// Speed set) — see the Generate Video duration comment below for why this
// value matters here too.
const DEFAULT_ROTATION_SECONDS = 5;

// Every image is stored as a base64 data URI inside the Firestore document
// itself (no separate blob storage), and the whole document has to stay
// under Firestore's ~1 MiB limit. An unedited marketing photo (600KB-1.2MB
// raw) blows that on its own — and the save then fails outright with
// nothing wrong-looking in this tab itself, since setting it as default
// already updated the on-screen state before the save is even attempted.
// Downscale/recompress anything over a modest threshold before it's ever
// added to state, so an oversized upload can't silently fail to save.
const COMPRESS_THRESHOLD_BYTES = 300_000;
const MAX_DIMENSION = 1000;

// Firestore counts a base64 string toward its ~1 MiB document limit by its
// raw character length — base64 is plain ASCII, one byte stored per
// character — not the (smaller) size of the image it decodes to. Base64
// expands binary data by roughly 4/3, so measuring "decoded bytes" against
// a byte threshold under-counts the real stored size by that same margin.
// Every size check in this file measures raw string length directly.
function rawBytes(dataUrl) {
  return dataUrl.length - dataUrl.indexOf(',') - 1;
}

// Firestore's hard limit on a whole document is 1,048,576 bytes; this
// margin leaves headroom for the rest of the product's own fields (name,
// descriptions, pricing, targeting, ...) to grow a little later without an
// unrelated edit tipping the same document over by itself.
const MAX_DOC_BYTES = 950_000;

// How much of that budget is actually free right now, for one asset —
// computed against the true rest of the document (every other field,
// every other asset), not a flat per-image assumption. A product already
// carrying several assets (or, worse, one big never-compressed legacy
// video) can be sitting close to the ceiling before this particular asset
// is even touched — confirmed live on a real product whose whole document
// was already ~1.01 MB, at which point even a well-compressed few-hundred-
// KB replacement image tipped a save over the edge with an error naming an
// internal field path, not "too big." `images`/`draft` are passed in
// (rather than closed over) so this can be called with a hypothetical
// next-state before it's actually patched. `targetIndex` is the index of
// the asset this budget is *for*, when it's replacing one that already
// exists in `images` — its own current contribution is zeroed out first
// so it isn't counted against itself; omit it for a brand new asset that
// doesn't exist in `images` yet (a fresh upload, a generated video).
// `nextFields`, when given, are other fields on the target asset that are
// about to change alongside its src — most importantly `original`. The
// first time any treatment (Enhance/Background/Touch Up/Request Changes)
// is ever applied to an asset, it copies that asset's own pre-treatment
// src into a new `original` field so the treatment can be undone later —
// a second, full-size copy of an image that didn't exist a moment before,
// and one a budget computed only against the *current* state (before that
// copy exists) would never see coming. Confirmed live: enhancing a 222KB
// image whose document was already tight on room made the save fail
// *worse* than before, because the "rest of the document" grew by a whole
// extra copy of that same 222KB the instant `original` was first set,
// while the budget calculation still thought only the new (smaller,
// compressed) src needed to fit. Pass `{ original: current.original ||
// current.src }` — the exact value the operation is about to write —
// from any call site that sets `original`, so it's accounted for whether
// this is that asset's first treatment or a later one.
function computeImageBudget(draft, images, targetIndex, nextFields = {}) {
  const withoutTarget = targetIndex == null
    ? images
    : images.map((img, i) => (i === targetIndex ? { ...img, src: '', ...nextFields } : img));
  const restBytes = JSON.stringify({ ...draft, images: withoutTarget }).length;
  return Math.max(30_000, MAX_DOC_BYTES - restBytes);
}

// Same size budget as readAndCompress below, applied to a data URL rather
// than a File — an AI-edited image comes back from the provider as base64
// already, and can just as easily blow Firestore's ~1 MiB document limit
// as a raw upload can (background removal in particular tends to return a
// full-resolution image, and so does Request Changes).
//
// This used to re-encode as PNG — safe for transparency (unlike JPEG,
// which has no alpha channel and would silently flatten a cut-out back to
// solid), but PNG is lossless, so a busy/detailed AI result (food texture,
// a checkerboard, steam) barely shrinks: one real save attempt came back
// from Remove Background + Request Changes at 1.06 MB *alone*, over
// Firestore's whole-document cap before any other asset or field is even
// counted, and setDoc failed outright. WebP keeps the alpha channel PNG
// has but compresses far tighter, so it replaces PNG here for any image
// that needs shrinking — transparent or not. If one pass still isn't
// under budget, it retries progressively smaller/lower-quality passes
// rather than saving something guaranteed to blow the document limit.
// `budgetBytes` is this asset's actual remaining headroom (see
// computeImageBudget above) — falls back to the flat threshold only for
// call sites that haven't been given a real one.
function compressDataUrl(dataUrl, budgetBytes = COMPRESS_THRESHOLD_BYTES) {
  return new Promise((resolve) => {
    if (rawBytes(dataUrl) <= budgetBytes) { resolve(dataUrl); return; }
    const img = new Image();
    img.onload = () => {
      const render = (maxDim, quality) => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        return canvas.toDataURL('image/webp', quality);
      };
      // Two extra, more aggressive passes over the original four — a tight
      // budget (a product already near the ceiling) needs somewhere left
      // to go rather than giving up at 450px/0.6 and saving something
      // guaranteed to still be over.
      const passes = [[MAX_DIMENSION, 0.82], [800, 0.76], [600, 0.7], [450, 0.6], [300, 0.5], [200, 0.4]];
      let out = render(...passes[0]);
      for (let i = 1; i < passes.length && rawBytes(out) > budgetBytes; i++) {
        out = render(...passes[i]);
      }
      resolve(out);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// The Image provider's "remove background" edit doesn't reliably come back
// fully cut out. Confirmed live against two different products: sometimes
// it paints a fake grey/white checkerboard into the opaque pixels instead
// of real alpha (a *picture* of transparency, the way it's seen
// transparency represented in training images); on a photo with a
// saturated colour backdrop (a red seasonal studio background), it left
// patches of that original red fully opaque and untouched, only partially
// clearing it. Either way the result isn't genuinely transparent.
//
// This flood-fills real alpha=0 outward from the image border, accepting a
// pixel once it's close enough to an adaptively-updating reference colour
// for its own connected region (not one fixed reference for the whole
// image, and not a chroma cutoff) — each accepted pixel nudges its
// region's reference a little toward its own colour before propagating
// further. That follows a gradient or lightly-varying solid colour
// (checkerboard, vignette, or a flat red backdrop alike) exactly the way a
// magic-wand tool does, while an early version that compared only to the
// immediate neighbour it was reached from had no way to tell "smooth
// gradient through more background" apart from "smooth gradient across the
// food itself" and leaked straight through the product to the far edge —
// the slow-adapting reference resists being dragged that far off its
// starting colour by a short run of small steps. A later version gated on
// low chroma instead, correctly refusing saturated colours — but that
// can't tell a saturated *backdrop* apart from saturated food/packaging,
// which is exactly the red-backdrop case the adaptive-reference approach
// above was written for.
//
// In practice the model produces *either* pattern depending on the call,
// and each heuristic alone regresses on the other's case: a checkerboard's
// tiles butt up against each other with a hard edge, not a gradient, so
// adaptive-reference chaining stops dead at every tile boundary and leaves
// most of the checkerboard opaque; chroma-gating alone leaves the red
// backdrop patches untouched exactly as described above. A pixel is
// accepted into the fill if it satisfies *either* test — low chroma (any
// brightness, any adjacent jump) or closeness to its region's adaptive
// reference (any saturation, as long as it's reached smoothly) — which
// covers both failure modes at once.
function forceTransparentBackground(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // A per-pixel flood fill over a phone photo's native resolution
      // (often 4000px+ on a side) is millions of pixels — confirmed live,
      // it took several seconds and froze the tab solid for the duration,
      // reading as "nothing happened" until it finally finished. readAndCompress
      // only downscales an *upload* whose raw file size already exceeds
      // COMPRESS_THRESHOLD_BYTES, so a well-compressed but large-dimension
      // photo (very common — phones compress hard) can sail through under
      // that budget at full pixel dimensions. The output gets downscaled to
      // MAX_DIMENSION by compressDataUrl regardless, so working at that same
      // size here costs nothing in final quality and keeps this near-instant.
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      if (!width || !height) { resolve(dataUrl); return; }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      const { data } = imageData;

      const CHROMA_MAX = 22;
      // A single hop may drift this far from its region's current
      // reference colour — comfortably more than typical backdrop lighting
      // variance, comfortably less than the jump from a studio backdrop to
      // the product itself (measured ~90 between a red backdrop and this
      // product's fried-chicken colouring).
      const STEP_THRESHOLD = 55;
      const visited = new Uint8Array(width * height);
      const stack = []; // flat [x, y, refR, refG, refB, ...]
      const seed = (x, y) => {
        const i = (y * width + x) * 4;
        stack.push(x, y, data[i], data[i + 1], data[i + 2]);
      };
      // Seed every border pixel with its own colour as its region's
      // starting reference — product photography always frames the
      // subject with clear space around it, so this only misfires in the
      // rare case where the subject itself touches the very edge.
      for (let x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1); }
      for (let y = 0; y < height; y++) { seed(0, y); seed(width - 1, y); }

      while (stack.length) {
        const refB = stack.pop(), refG = stack.pop(), refR = stack.pop();
        const y = stack.pop(), x = stack.pop();
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const p = y * width + x;
        if (visited[p]) continue;
        const i = p * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const lowChroma = Math.max(r, g, b) - Math.min(r, g, b) <= CHROMA_MAX;
        const dr = r - refR, dg = g - refG, db = b - refB;
        const nearReference = Math.sqrt(dr * dr + dg * dg + db * db) <= STEP_THRESHOLD;
        if (!lowChroma && !nearReference) continue;
        visited[p] = 1;
        data[i + 3] = 0;
        const nr = refR * 0.9 + r * 0.1;
        const ng = refG * 0.9 + g * 0.1;
        const nb = refB * 0.9 + b * 0.1;
        stack.push(x + 1, y, nr, ng, nb, x - 1, y, nr, ng, nb, x, y + 1, nr, ng, nb, x, y - 1, nr, ng, nb);
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/webp', 0.92));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Video providers don't understand alpha the way this app's own preview
// does — confirmed live on a cut-out product photo (barbecue beans), the
// provider rendered the see-through area as solid black with stray odd
// colouring instead of leaving it blank, since the model has to put
// *something* there and was never told what. Flattening onto plain white
// before the call — the same white the rest of the catalog's own product
// photography is shot against — gives it an ordinary opaque photo instead
// of leaving that decision to the model. Only ever applied to the copy of
// the image sent to the Video provider; the asset's own stored src (and
// its transparency) is untouched.
function flattenToWhite(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Enhance used to call the Image provider with an instruction to "keep
// composition and background exactly as they are" — but a generative model
// regenerates the whole photo from scratch on every call, and confirmed
// live, it doesn't reliably honour that: the product visibly warped.
// Real pixel filters can't have that failure mode, since they only ever
// adjust the existing pixels rather than recreating them, so this replaces
// the provider call for Enhance specifically: a contrast/saturation/
// brightness lift via the canvas's own filter pipeline, plus a manual
// unsharp-mask-style convolution for the sharpening CSS filter has no
// operator for. Runs entirely client-side — no network round trip, no
// Image provider needed.
function enhanceImageLocally(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // Same reasoning as forceTransparentBackground's — the manual
      // convolution below is a per-pixel loop, so working at a phone
      // photo's native resolution (often 4000px+ on a side, and not
      // necessarily caught by readAndCompress's byte-size-only check)
      // measured several seconds of a fully frozen tab. compressDataUrl
      // downscales the output to MAX_DIMENSION regardless, so pre-scaling
      // here first costs nothing in final quality.
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      if (!width || !height) { resolve(dataUrl); return; }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.filter = 'contrast(112%) saturate(118%) brightness(103%)';
      ctx.drawImage(img, 0, 0, width, height);
      ctx.filter = 'none';

      const src = ctx.getImageData(0, 0, width, height);
      const dst = ctx.createImageData(width, height);
      const sd = src.data, dd = dst.data;
      // A gentle unsharp-mask kernel (centre-weighted, sums to 1) —
      // strong enough to read as "sharper" without haloing.
      const k = [0, -0.5, 0, -0.5, 3, -0.5, 0, -0.5, 0];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const di = (y * width + x) * 4;
          if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
            dd[di] = sd[di]; dd[di + 1] = sd[di + 1]; dd[di + 2] = sd[di + 2]; dd[di + 3] = sd[di + 3];
            continue;
          }
          for (let c = 0; c < 3; c++) {
            let sum = 0, ki = 0;
            for (let ky = -1; ky <= 1; ky++) {
              for (let kx = -1; kx <= 1; kx++) {
                sum += sd[((y + ky) * width + (x + kx)) * 4 + c] * k[ki++];
              }
            }
            dd[di + c] = sum < 0 ? 0 : sum > 255 ? 255 : sum;
          }
          dd[di + 3] = sd[di + 3];
        }
      }
      ctx.putImageData(dst, 0, 0);
      resolve(canvas.toDataURL('image/webp', 0.9));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Reads a raw File as a data URL, then runs it through the same adaptive,
// budget-aware compressor every other image path uses (compressDataUrl
// above) — used to duplicate this file's own multi-pass downscale logic
// here, capped against the flat COMPRESS_THRESHOLD_BYTES regardless of how
// much of the document was actually free; a fresh upload deserves the same
// real per-document headroom check as a Replace or an AI-edited result,
// not a separate, less accurate one. `budgetBytes` is the caller's actual
// computed headroom (see computeImageBudget) — falls back to the flat
// threshold if the caller doesn't have a real document to check against.
function readAndCompress(file, budgetBytes = COMPRESS_THRESHOLD_BYTES) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(compressDataUrl(reader.result, budgetBytes));
    reader.readAsDataURL(file);
  });
}

// Scheduling now lives on each individual targeting group (TargetingBuilder's
// own Schedule from/until per AND block) rather than on the asset as a flat
// field, so an asset can carry several independently time-boxed rules
// instead of one schedule applying to all of them. `anyGroupScheduled` is
// the asset-level "does this need a Scheduled badge at all" check used by
// both the Tile badge and the toolbar's Scheduled indicator below; the
// per-group detail itself is only ever shown in the targeting rules
// section, not summarised here (multiple groups could each have a
// different window, too much to compress into one compact tooltip).
function anyGroupScheduled(targeting) {
  return (targeting || []).some((g) => g.scheduleFrom || g.scheduleUntil);
}
// A group can now be schedule-only — present in `targeting` (so the asset
// is still "conditioned", can't be default) but with zero conditions of
// its own. That shouldn't count as "targeted" for badge purposes; only a
// group that actually carries at least one value condition does.
function hasRealTargeting(targeting) {
  return (targeting || []).some((g) => (g.conditions || []).length > 0);
}

function Tile({ img, selected, onClick }) {
  const state = img.rightsOn ? licenceState(img.rights?.expiry) : 'ok';
  const expired = state === 'expired';
  let badge = null;
  if (expired) badge = { text: 'EXPIRED', bg: '#ff4d4f', color: '#fff' };
  else if (state === 'soon') badge = { text: `${daysUntil(img.rights.expiry)}D`, bg: '#faad14', color: '#3d2800' };
  else if (img.type === '3d') badge = { text: '3D', bg: '#fff7e6', color: '#ad4e00' };
  else if (img.type === 'video') badge = { text: 'VIDEO', bg: 'rgba(0,0,0,.7)', color: '#fff' };

  return (
    <div style={{ flex: '1 1 88px', minWidth: 88, cursor: 'pointer' }} onClick={onClick}>
      <div
        style={{
          width: '100%', height: 88, borderRadius: 6, overflow: 'hidden', position: 'relative',
          border: '1px solid ' + (selected ? '#169bc2' : '#f0f0f0'),
          boxShadow: selected ? '0 0 0 2px rgba(22,155,194,.25)' : 'none',
          opacity: expired ? 0.5 : 1,
        }}
      >
        {img.src && (
          img.type === 'video'
            ? <video src={img.src} muted autoPlay loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <img src={img.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        )}
        <span style={{ position: 'absolute', top: 4, left: 4, fontSize: 10, lineHeight: '16px', padding: '0 5px', borderRadius: 3, background: 'rgba(255,255,255,.94)', border: '1px solid #87d9ec', color: '#09759c', fontWeight: 600 }}>
          {img.variant}
        </span>
        <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 3 }}>
          {(img.targeting || []).length ? (
            // Targeted and scheduled are independent — a group can carry
            // either or both at once (both together means that group only
            // matches when BOTH currently hold), so both badges show side
            // by side here, same as the toolbar's own Targeted/Scheduled
            // indicators below. Either replaces the default star outright
            // rather than dimming it: a conditioned asset (real conditions,
            // a schedule, or both) can never also be the default (see the
            // Default button in the toolbar), so the star wouldn't mean
            // anything here.
            <>
              {hasRealTargeting(img.targeting) ? (
                <span
                  title={`Targeted — ${describeTargeting(img.targeting)}`}
                  style={{ width: 20, height: 20, borderRadius: 4, background: 'rgba(232,253,255,.97)', border: '1px solid #87d9ec', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#169bc2' }}
                >
                  <MaterialIcon name="my_location" style={{ fontSize: 12 }} />
                </span>
              ) : null}
              {anyGroupScheduled(img.targeting) ? (
                <span
                  title="Scheduled — one or more of this asset's targeting rules has its own window (see below)"
                  style={{ width: 20, height: 20, borderRadius: 4, background: 'rgba(255,247,230,.97)', border: '1px solid #ffd591', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ad6800' }}
                >
                  <MaterialIcon name="schedule" style={{ fontSize: 12 }} />
                </span>
              ) : null}
            </>
          ) : (
            <span
              title={img.isDefault ? `Default ${img.type === 'video' ? 'video' : 'image'}` : `Not the default ${img.type === 'video' ? 'video' : 'image'}`}
              style={{ width: 20, height: 20, borderRadius: 4, background: 'rgba(255,255,255,.95)', border: '1px solid rgba(0,0,0,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: img.isDefault ? '#faad14' : '#cfcfcf' }}
            >
              <BespokeIcon name={img.isDefault ? 'starFill' : 'starOutline'} size={12} />
            </span>
          )}
          <span
            title={img.availableForTesting ? 'Available for testing' : 'Not available for testing'}
            style={{ width: 20, height: 20, borderRadius: 4, background: img.availableForTesting ? 'rgba(232,253,255,.97)' : 'rgba(255,255,255,.95)', border: '1px solid ' + (img.availableForTesting ? '#87d9ec' : 'rgba(0,0,0,.08)'), display: 'flex', alignItems: 'center', justifyContent: 'center', color: img.availableForTesting ? '#169bc2' : '#c4c4c4' }}
          >
            <BespokeIcon name="ab" size={12} />
          </span>
        </div>
        {badge && (
          <span style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 9, lineHeight: '16px', padding: '0 5px', borderRadius: 3, fontWeight: 600, background: badge.bg, color: badge.color }}>
            {badge.text}
          </span>
        )}
      </div>
    </div>
  );
}

export default function ProductAssetsTab({ draft, baseline, patch }) {
  const images = draft.images || [];
  const aiProviders = useAiProviders();
  // Selection is tracked by asset id, not raw array position — toItemDoc()
  // (migration.js) moves the default image to index 0 on every save, and
  // Save replaces `images` wholesale from the server's response
  // (ProductPage.jsx's setDraft(saved)). A plain index would then silently
  // point at whichever asset now happens to sit at that position — the
  // exact bug reported live: marking a non-first asset as Default, saving,
  // and still seeing the (now differently-positioned) previous asset's
  // schedule/targeting section instead of the new default's "this is the
  // default" message. Deriving the index from the id every render means
  // any reordering, from any cause, can never desync selection from asset.
  const [selectedId, setSelectedId] = useState(images[0]?.id ?? null);
  const selectedIndex = images.findIndex((img) => img.id === selectedId);
  const selected = selectedIndex === -1 ? 0 : selectedIndex;
  const [dragOver, setDragOver] = useState(false);
  const [newTagText, setNewTagText] = useState('');
  const fileInput = useRef(null);
  const fileIntent = useRef('upload'); // 'upload' | 'replace' — which action opened the picker

  // Which image-editing call is in flight, if any — 'bg' | 'enhance' | null.
  // Only one of Remove Background / Enhance can run at a time; both are
  // disabled while the other is busy so a second click can't race the
  // first's response into overwriting it.
  const [imageBusy, setImageBusy] = useState(null);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  // Written for LTX-2 (docs.ltx.io): its prompt field is free text describing
  // motion, not a shot list, and camera_motion is sent separately as 'static'
  // (see functions/index.js) — a single flat photo has no depth data for a
  // real camera orbit, so the rotation described here is the product turning
  // in place, turntable-style, which these models render convincingly from
  // one image where an actual camera-orbit-around-3D-geometry wouldn't.
  const [videoPrompt, setVideoPrompt] = useState('The product rotates slowly in a smooth, continuous 360-degree turntable spin, studio lighting unchanged.');
  const [videoBusy, setVideoBusy] = useState(false);

  // Generated video is meant for the Local Feature Highlight board's hero
  // panel (menu-board.html's _pickHeroSrc) — a clip whose own length
  // doesn't match how long that board actually displays it for (its
  // Rotation Speed, set per brand in hq-admin.html's Template editor)
  // either loops mid-motion or sits on a frozen last frame for the
  // remainder of the slot. Falls back to the same 5s menu-board.html
  // itself falls back to when a brand has no Local Feature Highlight
  // template configured at all.
  const heroTemplate = (getBrandById(draft.brand)?.templates || []).find((t) => t.templateType === 'feature-hero-board');
  const videoDurationSeconds = parseInt(heroTemplate?.rotationSeconds, 10) || DEFAULT_ROTATION_SECONDS;

  // The "+ Add tag" input was uncontrolled, cleared imperatively via
  // e.currentTarget.value = ''. With no key of its own it sits right after
  // a .map() of Tag chips whose count changes on every add/remove — React
  // reconciles that whole run of siblings by position, so once the chip
  // count shifts, the previously-typed text could resurface in the input
  // on the next render instead of staying cleared. A controlled input,
  // reset here whenever the selected image changes, removes the need for
  // React to guess which DOM node is "the same one" at all.
  useEffect(() => {
    setNewTagText('');
  }, [selected]);

  // Reset the selected tile whenever the product itself changes (navigating
  // straight from one product's Assets tab to another's, e.g. via a direct
  // link) — otherwise `selected` can stay pointed at an index that belongs
  // to the previous product's image list.
  useEffect(() => {
    setSelectedId(images[0]?.id ?? null);
  }, [draft.id]);

  // Warms the background-removal model up the moment this tab mounts,
  // well before anyone's clicked Background — confirmed live, the first
  // real removeBackground call (model download + single-threaded WASM
  // init, since GitHub Pages doesn't send the COOP/COEP headers needed
  // for multi-threading) took 30+ seconds, long enough that it looked
  // like nothing was happening at all. Fire-and-forget: any failure here
  // just means the model isn't warm yet, and the real call still runs (and
  // still surfaces its own error) when the user actually clicks Background.
  useEffect(() => {
    imglyPreload(BG_REMOVAL_CONFIG).catch(() => {});
  }, []);

  // The image being viewed/edited is read directly from images[selected] —
  // there is deliberately no separate "working copy" state to keep in sync
  // with it. That used to exist (a local draft only committed into images
  // on request), and every edit here silently lived only in that draft
  // until the moment "Commit changes" was clicked — including toggles like
  // Testing, where the toolbar button looked active immediately but nothing
  // was actually saved until Commit *and* the page-level Save Changes were
  // both remembered. A single source of truth removes that whole failure
  // mode: every field below patches images[selected] the instant it
  // changes, and the shared Save Changes / Cancel bar (ProductPage.jsx)
  // is the only save step left, same as every other field on this product.
  const current = images[selected] || null;

  // Enhance and Remove Background are undo-able toggles right up until
  // they're actually saved — once Save Changes commits one to the last-
  // saved baseline, it's permanent (chaining another treatment on top of a
  // saved cutout can't cleanly un-chain just its own contribution, the same
  // reason turning either off already clears every treatment — see
  // applyImageTreatment's comment), so the toggle itself is disabled the
  // moment its flag is also true in baseline, and the before/after slider
  // — nothing left to compare once there's no pending, revertible edit —
  // gives way to a single flat view of the saved result.
  const baselineCurrent = current && (baseline?.images || []).find((img) => img.id === current.id);
  const isTreatmentLocked = (flagKey) => !!(current?.[flagKey] && baselineCurrent?.[flagKey]);
  const enhanceLocked = isTreatmentLocked('enhanced');
  const bgLocked = isTreatmentLocked('bgRemoved');
  const pendingTreatment = current && TREATMENT_FLAGS.some((f) => current[f] && !baselineCurrent?.[f]);

  const updateSelected = (fields) => {
    const next = images.map((img, i) => (i === selected ? { ...img, ...fields } : img));
    patch({ images: next });
  };
  const updateRights = (fields) => updateSelected({ rights: { ...(current?.rights || {}), ...fields } });

  const handleUpload = (files) => {
    // Purely additive — none of these files replace an existing asset —
    // so every file in this batch shares the same remaining headroom,
    // computed once against the document as it stands right now.
    const budget = computeImageBudget(draft, images, null);
    Promise.all([...files].map((file) => readAndCompress(file, budget).then((src) => ({ file, src })))).then((loaded) => {
      const startLen = images.length;
      const next = [...images];
      loaded.forEach(({ file, src }) => {
        const type = file.type.startsWith('video') ? 'video' : 'image';
        // readAndCompress -> compressDataUrl re-encodes an over-budget
        // image until it fits, but its <img> load fails silently for a
        // video src (see compressDataUrl's own onerror) and just resolves
        // with the original, full-size file — so an oversized video would
        // otherwise sail straight through here at any size and only fail
        // much later, confusingly, when Save hits Firestore's whole-document
        // limit (a real live failure: a second, undownscaled video pushed
        // this exact product from ~1.0MB to ~1.78MB and Firestore rejected
        // the write outright). Reject it here instead, immediately, naming
        // the actual numbers, rather than letting it become unsaveable
        // asset state the user has to somehow notice and undo later.
        if (type === 'video' && rawBytes(src) > budget) {
          message.error(`"${file.name || 'Video'}" is too large to add (${Math.round(rawBytes(src) / 1024)}KB, only ${Math.round(budget / 1024)}KB free in this product) — videos aren't compressed the way images are, so use a shorter or lower-resolution clip.`, 6);
          return;
        }
        // A brand-new product's very first image (or video) becomes its
        // default automatically, rather than leaving every new product
        // one manual "set as default" click away from being ready — there
        // being no default image yet is exactly the case (as opposed to
        // "no assets at all") since a default image and a default video
        // are independent (setDefault's own comment above). Re-checked
        // fresh per file, not just once for the whole batch: uploading
        // several images at once must still only default the first,
        // matching what a one-at-a-time upload would do.
        const sameType = (img) => (img.type === 'video') === (type === 'video');
        const isDefault = !next.some((img) => img.isDefault && sameType(img));
        next.push({
          id: 'img-' + Date.now() + Math.random().toString(36).slice(2, 7),
          src,
          type,
          name: '',
          tags: [],
          isDefault,
          availableForTesting: false,
          bgRemoved: false,
          enhanced: false,
          customEdited: false,
          rightsOn: false,
          rights: {},
          targeting: [],
          variant: nextVariantLabel(next, type),
        });
      });
      patch({ images: next });
      // Some files in the batch may have been rejected above (an oversized
      // video) — select the first one that actually got added, if any,
      // rather than assuming every loaded file made it into `next`.
      if (next.length > startLen) setSelectedId(next[startLen].id);
    });
  };

  // Swaps the file underneath the currently-selected tile in place — the
  // id, variant label, tags and rights all stay exactly as they were, only
  // src/type change. This used to share the same upload handler as "add a
  // new image," so clicking Replace actually appended a brand new tile and
  // silently left the old file untouched instead of replacing it.
  const handleReplace = (files) => {
    const file = files[0];
    if (!file || !current) return;
    // Excludes the asset being replaced from the "rest of the document"
    // calculation — its own current size shouldn't count against the
    // budget for what's about to take its place.
    const budget = computeImageBudget(draft, images, selected);
    readAndCompress(file, budget).then((src) => {
      updateSelected({ src, type: file.type.startsWith('video') ? 'video' : 'image' });
    });
  };

  const onFileInputChange = (e) => {
    const files = e.target.files;
    if (files && files.length) {
      if (fileIntent.current === 'replace') handleReplace(files);
      else handleUpload(files);
    }
    e.target.value = ''; // allow picking the same file again next time
  };
  const openUpload = () => { fileIntent.current = 'upload'; fileInput.current?.click(); };
  const openReplace = () => { fileIntent.current = 'replace'; fileInput.current?.click(); };

  const deleteAsset = () => {
    const next = images.filter((_, i) => i !== selected);
    patch({ images: next });
    // Keep the same index where possible so the item that shifts up into
    // this slot is what's shown next, rather than always jumping back one —
    // only clamp when the deleted tile was the last one in the list.
    const clampedIdx = Math.max(0, Math.min(selected, next.length - 1));
    setSelectedId(next[clampedIdx]?.id ?? null);
  };

  // Adds a copy of the current asset as a brand new tile — its own id and
  // variant label, but never default or targeted: silently carrying over
  // either would mean the copy immediately overrides something (the
  // product's default, or whichever store/visitor the original's rule
  // matched) the moment it's saved, which isn't what "duplicate this
  // asset" implies. Re-compressed against its own real remaining budget
  // like every other asset here — a straight byte-for-byte copy of an
  // already-large image is exactly as likely to tip the document over as
  // any other new asset would be. Skipped for video: compressDataUrl only
  // knows how to re-encode an image (it loads the src into an <img>,
  // which can't decode video), so a video's src is carried over as-is.
  const duplicateAsset = async () => {
    if (!current) return;
    // A duplicated video is carried over byte-for-byte (see the comment
    // above) with no re-encoding to shrink it — so unlike an image, which
    // always re-fits itself against computeImageBudget, an already-large
    // video's copy can't be brought under budget at all here. Confirmed
    // live: duplicating this product's one existing video (753KB) pushed
    // the whole document from ~1.0MB to ~1.78MB, well past Firestore's
    // 1,048,576-byte document limit, and only failed later at Save with a
    // raw Firestore error naming an internal document path. Block it here
    // instead, immediately, with the actual numbers.
    if (current.type === 'video') {
      const budget = computeImageBudget(draft, images, null);
      if (rawBytes(current.src) > budget) {
        message.error(`Can't duplicate — this video is ${Math.round(rawBytes(current.src) / 1024)}KB and only ${Math.round(budget / 1024)}KB is free in this product's document. Videos aren't compressed the way images are, so remove or replace another asset first to make room.`, 6);
        return;
      }
    }
    const src = current.type === 'video'
      ? current.src
      : await compressDataUrl(current.src, computeImageBudget(draft, images, null));
    const copy = {
      ...current,
      id: 'img-' + Date.now() + Math.random().toString(36).slice(2, 7),
      src,
      isDefault: false,
      // Clearing targeting (rather than carrying it over) also clears any
      // per-group schedule the original had, since scheduling now lives
      // inside each targeting group — this is meant to become a
      // deliberately conditioned variant, not an accidental clone of
      // whichever rule(s)/window(s) the original happened to carry.
      targeting: [],
      variant: nextVariantLabel(images, current.type),
    };
    const next = [...images, copy];
    patch({ images: next });
    setSelectedId(copy.id);
  };

  // Default applies immediately — a single binary switch a user expects to
  // take effect the moment they click it, same as Featured on Product
  // Details — and also handles clearing any other same-type asset's
  // Default flag. "Same-type" (not "any other asset") deliberately: a
  // product can carry one default image AND one default video at once —
  // the image is what every standard panel/thumbnail/table shows, the
  // video is only ever used in the Feature Hero Spotlight's own primary
  // panel (menu-board.html's _pickHeroSrc) — so marking a video default
  // must not clear an existing default image, and vice versa.
  const setDefault = () => {
    if (!current) return;
    const newVal = !current.isDefault;
    const sameType = (img) => (img.type === 'video') === (current.type === 'video');
    const next = images.map((img, i) => {
      if (i === selected) return { ...img, isDefault: newVal };
      return newVal && img.isDefault && sameType(img) ? { ...img, isDefault: false } : img;
    });
    patch({ images: next });
  };
  const toggleTesting = () => current && updateSelected({ availableForTesting: !current.availableForTesting });

  // Remove Background used to call the configured Image provider (Gemini) —
  // a generative image editor repurposed for the job, not a real
  // segmentation model, and confirmed live it didn't reliably tell "product"
  // apart from "background" at the pixel level: sometimes leaving backdrop
  // patches opaque, sometimes eating into the product itself. It's now
  // @imgly/background-removal instead — a real subject-segmentation model
  // (ONNX/WASM) running entirely client-side, no Image provider or network
  // call involved. Enhance made the same move earlier for a related reason
  // (Gemini's regeneration doesn't reliably stay pixel-stable either).
  // `original` is captured the first time any treatment is applied and
  // never overwritten again, so turning one back off can restore the
  // untouched upload.
  //
  // Combining more than one at once chains each call on top of whatever is
  // currently displayed (so the after-image genuinely reflects every edit
  // applied so far) — but only one intermediate result is ever kept, so
  // switching one flag off while another is still on can't cleanly
  // un-chain just its own contribution. Rather than show a result that's
  // silently wrong, that case reverts to the untouched original and clears
  // every flag, with a toast explaining why.
  const applyImageTreatment = async (kind) => {
    if (!current || imageBusy) return;
    const isBg = kind === 'bg';
    const flagKey = isBg ? 'bgRemoved' : 'enhanced';
    const turningOn = !current[flagKey];

    if (!turningOn) {
      const otherFlagsOn = TREATMENT_FLAGS.some((f) => f !== flagKey && current[f]);
      if (otherFlagsOn) {
        message.warning('Turning this off also clears the other treatments — edits can’t be cleanly un-chained. Reapply as needed.');
        updateSelected({ bgRemoved: false, enhanced: false, customEdited: false, src: current.original || current.src });
      } else {
        updateSelected({ [flagKey]: false, src: current.original || current.src });
      }
      return;
    }

    setImageBusy(kind);
    try {
      let fixed;
      if (isBg) {
        const blob = await imglyRemoveBackground(current.src, BG_REMOVAL_CONFIG);
        fixed = await blobToDataUrl(blob);
      } else {
        fixed = await enhanceImageLocally(current.src);
      }
      const nextOriginal = current.original || current.src;
      const compressed = await compressDataUrl(fixed, computeImageBudget(draft, images, selected, { original: nextOriginal }));
      updateSelected({ [flagKey]: true, src: compressed, original: nextOriginal });
    } catch (e) {
      message.error(`Image edit failed: ${e.message}`);
    } finally {
      setImageBusy(null);
    }
  };
  const toggleBg = () => applyImageTreatment('bg');
  const toggleEnhance = () => applyImageTreatment('enhance');

  // Touch Up — a manual, non-AI complement to Background removal, added
  // after finding (and failing to fully fix by switching model tiers — see
  // BG_REMOVAL_CONFIG's comment above) a real segmentation gap: a light-
  // coloured prop next to the backdrop sometimes gets cut away with it.
  // Modelled on Canva's own Eraser tool, which offers exactly this same
  // Restore/Erase pair for exactly this same class of mistake. Unlike the
  // toggles above, it directly edits `src` in place rather than chaining a
  // new treatment — there's no separate flag to track or lock, since a
  // manual, deterministic brush stroke carries none of the "can't cleanly
  // un-chain a generative result" risk that governs bgRemoved/enhanced/
  // customEdited, and stays available even after Background removal itself
  // has been saved and locked.
  const [touchUpOpen, setTouchUpOpen] = useState(false);
  const openTouchUp = () => { if (!current || imageBusy) return; setTouchUpOpen(true); };
  const applyTouchUp = async (dataUrl) => {
    const compressed = await compressDataUrl(dataUrl, computeImageBudget(draft, images, selected));
    updateSelected({ src: compressed });
    setTouchUpOpen(false);
    message.success('Touch-up applied');
  };

  // Request Changes — a free-text sibling of Enhance/Remove Background:
  // same Image provider, but the instruction is whatever the user types (or
  // dictates) instead of one of the two canned ones. Opens a prompt modal
  // rather than acting immediately, since there's no fixed instruction to
  // just toggle on.
  const [requestChangesModalOpen, setRequestChangesModalOpen] = useState(false);
  const [requestChangesPrompt, setRequestChangesPrompt] = useState('');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  const openRequestChangesModal = () => {
    if (!current || imageBusy) return;
    setRequestChangesPrompt('');
    setRequestChangesModalOpen(true);
  };
  const closeRequestChangesModal = () => {
    recognitionRef.current?.stop();
    setRequestChangesModalOpen(false);
  };

  // Dictation is a nice-to-have on top of typing, not a replacement for
  // it — SpeechRecognition isn't implemented in every browser (notably
  // Firefox), so the mic button simply doesn't render when it's absent
  // rather than trying to polyfill browser speech recognition here.
  const SpeechRecognitionCtor = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const toggleListening = () => {
    if (!SpeechRecognitionCtor) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new SpeechRecognitionCtor();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim();
      if (transcript) setRequestChangesPrompt((prev) => (prev.trim() ? prev.trim() + ' ' + transcript : transcript));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  const confirmRequestChanges = async () => {
    if (!current || !requestChangesPrompt.trim()) return;
    if (!isProviderConfigured(aiProviders.image)) {
      message.error('No Image provider configured — add one in Settings → AI Integrations.');
      return;
    }
    recognitionRef.current?.stop();
    setImageBusy('custom');
    try {
      const edited = await editProductImage({ imageDataUrl: current.src, prompt: requestChangesPrompt.trim() });
      // A free-text request has no reason to mention "keep the background
      // transparent" unless the user thinks to say so — confirmed live: the
      // Image provider flattens an incoming transparent cutout to solid
      // black rather than preserving alpha it wasn't told to keep. If this
      // asset was already a cutout, recover transparency the same way
      // Remove Background does (chroma-gated flood fill from the border —
      // works regardless of whether "no background" comes back as a fake
      // grey/white checker or, here, flattened solid black; both are
      // near-zero chroma).
      const fixed = current.bgRemoved ? await forceTransparentBackground(edited) : edited;
      const nextOriginal = current.original || current.src;
      const compressed = await compressDataUrl(fixed, computeImageBudget(draft, images, selected, { original: nextOriginal }));
      updateSelected({ customEdited: true, src: compressed, original: nextOriginal });
      setRequestChangesModalOpen(false);
      message.success('Changes applied');
    } catch (e) {
      message.error(`Request failed: ${e.message}`);
    } finally {
      setImageBusy(null);
    }
  };

  const openVideoModal = () => {
    if (!current) return;
    setVideoModalOpen(true);
  };

  const confirmGenerateVideo = async () => {
    if (!current) return;
    if (!isProviderConfigured(aiProviders.video)) {
      message.error('No Video provider configured — add one in Settings → AI Integrations.');
      return;
    }
    setVideoBusy(true);
    try {
      const imageForVideo = current.bgRemoved ? await flattenToWhite(current.src) : current.src;
      // Belt-and-braces alongside the flattening above — the provider is
      // regenerating the whole scene from this single frame, not just
      // animating the exact pixels, so it can still drift the backdrop
      // over the course of the clip unless it's told what to hold steady.
      const promptForVideo = current.bgRemoved
        ? `${videoPrompt.trim()} Plain white studio background throughout, matching the product's own cut-out.`
        : videoPrompt.trim();
      const videoSrc = await generateProductVideo({ imageDataUrl: imageForVideo, prompt: promptForVideo, durationSeconds: videoDurationSeconds });
      // A generated clip comes back from the provider as a real video file
      // too, with nothing here to shrink it — same failure mode as an
      // oversized upload or duplicate (see handleUpload/duplicateAsset's own
      // comments), just from a different source. Caught here, before the
      // asset is ever added, rather than only at Save.
      const budget = computeImageBudget(draft, images, null);
      if (rawBytes(videoSrc) > budget) {
        message.error(`The generated video is too large to add (${Math.round(rawBytes(videoSrc) / 1024)}KB, only ${Math.round(budget / 1024)}KB free in this product) — try a shorter duration.`, 6);
        return;
      }
      const next = [...images];
      // Same "first asset of its type becomes the default automatically"
      // rule handleUpload uses above.
      const newAsset = {
        id: 'img-' + Date.now() + Math.random().toString(36).slice(2, 7),
        src: videoSrc,
        type: 'video',
        name: '',
        tags: [],
        isDefault: !next.some((img) => img.isDefault && img.type === 'video'),
        availableForTesting: false,
        bgRemoved: false,
        enhanced: false,
        rightsOn: false,
        rights: {},
        targeting: [],
        variant: nextVariantLabel(next, 'video'),
        generatedFrom: current.id,
        generationPrompt: videoPrompt.trim(),
      };
      next.push(newAsset);
      patch({ images: next });
      setSelectedId(newAsset.id);
      setVideoModalOpen(false);
      message.success('Video generated');
    } catch (e) {
      message.error(`Video generation failed: ${e.message}`);
    } finally {
      setVideoBusy(false);
    }
  };

  const expired = current?.rightsOn && licenceState(current.rights?.expiry) === 'expired';
  const soon = current?.rightsOn && licenceState(current.rights?.expiry) === 'soon';
  // A targeted asset always overrides the default the instant its rule
  // matches (menu-board.html's _pickTargetedAssetIndex) — "default" and
  // "targeted" are mutually exclusive roles, so Default is disabled the
  // moment this asset carries any targeting rule at all.
  const isTargeted = hasRealTargeting(current?.targeting);
  // Same mutual-exclusivity rule as targeting, just on schedule instead —
  // scheduling now lives on each targeting group rather than on the asset
  // itself (menu-board.html's _inSchedule/_offerTargetingMatches gate the
  // same _pickTargetedAssetIndex/_defaultImageIndex/_defaultVideoIndex
  // chain), so "scheduled" here means at least one of this asset's groups
  // carries its own window.
  const isScheduled = anyGroupScheduled(current?.targeting);
  // Background removal and Enhance are photo-editing operations — neither
  // has any meaning for a video file, and the before/after slider below
  // is built entirely around comparing two still frames.
  const isVideo = current?.type === 'video';

  const rightsSummary = current?.rightsOn
    ? [current.rights.type, current.rights.territory, current.rights.expiry ? `Expires ${dayjs(current.rights.expiry).format('D MMM YYYY, HH:mm')}` : 'No expiry', current.rights.release ? 'release on file' : null]
        .filter(Boolean)
        .join(' · ')
    : 'Off — no licence terms recorded. Turn on for licensed, stock or talent-bearing assets.';

  return (
    <div>
      {/* Sticky so the thumbnail strip stays reachable while scrolling
          through a long asset panel (Rights & licensing, Targeting) —
          switching assets from here doesn't reset scroll position, since
          nothing here does anything but flip `selected`. */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(255,255,255,.98)', paddingTop: 4, paddingBottom: 4, marginTop: -4 }}>
        <div
          style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '8px 4px' }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
        >
          <div
            onClick={openUpload}
            style={{
              width: 88, height: 88, flexShrink: 0, border: '2px dashed ' + (dragOver ? '#169bc2' : '#d9d9d9'),
              borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: dragOver ? '#169bc2' : 'rgba(0,0,0,.45)', background: dragOver ? '#e8fdff' : '#fafafa',
            }}
          >
            <MaterialIcon name="add_photo_alternate" style={{ fontSize: 22 }} />
          </div>
          {images.map((img, idx) => (
            <Tile key={img.id} img={img} selected={idx === selected} onClick={() => setSelectedId(img.id)} />
          ))}
        </div>
        {/* Deliberately a sibling of the "+" tile, not nested inside it —
            fileInput.current.click() (called by both openUpload and
            openReplace) fires a real DOM click on this element, which
            bubbles. Nested inside the "+" tile's own onClick={openUpload}
            div, that bubble re-fired openUpload right after openReplace
            had just set fileIntent to 'replace', silently turning every
            Replace into an Upload (a new tile appended, old one left
            untouched) — the exact bug Replace's own tooltip claims not
            to have. */}
        <input ref={fileInput} type="file" multiple={fileIntent.current === 'upload'} accept="image/*,video/*" style={{ display: 'none' }} onChange={onFileInputChange} />
      </div>
      <div style={{ height: 8 }} />

      <div className="ph-sect" style={{ padding: 0 }}>
        {!current ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
            onClick={openUpload}
            style={{ border: '2px dashed #d9d9d9', borderRadius: 8, minHeight: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', margin: 20 }}
          >
            <MaterialIcon name="add_photo_alternate" style={{ fontSize: 36, color: '#169bc2' }} />
            <span>Drag &amp; drop an image or video here</span>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 4, padding: '11px 16px', borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap' }}>
              <IconAction
                ai
                busy={imageBusy === 'enhance'}
                icon={<MaterialIcon name="auto_fix_high" />}
                caption={imageBusy === 'enhance' ? 'Enhancing…' : 'Enhance'}
                active={current.enhanced}
                disabled={expired || isVideo || !!imageBusy || enhanceLocked}
                onClick={toggleEnhance}
                tooltipTitle={enhanceLocked ? 'Enhancement saved' : current.enhanced ? 'Undo enhancement' : 'Enhance quality'}
                tooltipDesc={
                  isVideo
                    ? 'Not available for video.'
                    : enhanceLocked
                    ? 'Saved changes can’t be undone from here — replace the asset to start over.'
                    : current.enhanced
                    ? 'Reverts to the original upload.'
                    : 'Sharpens, colour-corrects and lifts contrast — real image processing, applied locally, so it can never warp or regenerate the photo.'
                }
              />
              <IconAction
                ai
                busy={imageBusy === 'bg'}
                icon={<BespokeIcon name="removeBg" />}
                caption={imageBusy === 'bg' ? 'Removing…' : 'Background'}
                active={current.bgRemoved}
                disabled={expired || isVideo || !!imageBusy || bgLocked}
                onClick={toggleBg}
                tooltipTitle={bgLocked ? 'Background removal saved' : current.bgRemoved ? 'Restore background' : 'Remove background'}
                tooltipDesc={
                  isVideo
                    ? 'Not available for video.'
                    : expired
                    ? undefined
                    : bgLocked
                    ? 'Saved changes can’t be undone from here — replace the asset to start over.'
                    : current.bgRemoved
                    ? 'Puts the original background back. The cut-out is discarded.'
                    : 'Cuts the product out to a transparent PNG so it can sit on any campaign layout — real subject segmentation, run locally. First use on this device downloads a model in the background and can take a while.'
                }
              />
              <IconAction
                icon={<MaterialIcon name="healing" />}
                caption="Touch Up"
                disabled={expired || isVideo || !!imageBusy || !current.bgRemoved}
                onClick={openTouchUp}
                tooltipTitle="Touch Up"
                tooltipDesc={
                  isVideo
                    ? 'Not available for video.'
                    : !current.bgRemoved
                    ? 'Available once Background removal has been applied — there’s nothing to touch up before then.'
                    : 'Manually restore or erase parts of the cut-out by hand — for when the automatic background removal gets something wrong. Not AI — a plain brush, applied instantly, always available even after saving.'
                }
              />
              <IconAction
                ai
                icon={<MaterialIcon name="movie" />}
                caption="Video"
                disabled={expired || isVideo || !!imageBusy}
                onClick={openVideoModal}
                tooltipTitle="Generate video"
                tooltipDesc={isVideo ? 'Already a video.' : 'Calls the configured Video provider to animate this photo into a short hero clip, using a prompt you control.'}
              />
              <div style={{ width: 1, background: '#f0f0f0', margin: '4px 8px' }} />
              {(isTargeted || isScheduled) ? (
                // A targeted or scheduled asset can never also be default —
                // it already overrides the default whenever its rule
                // matches (or its window is active) — so the Default toggle
                // is replaced outright by a clearly-active status indicator
                // here, not just disabled next to a star that no longer
                // means anything for this asset. Both can show at once —
                // an asset can be targeted AND scheduled simultaneously.
                <>
                  {isTargeted && (
                    <IconAction
                      icon={<MaterialIcon name="my_location" />}
                      caption="Targeted"
                      active
                      tooltipTitle="This asset is targeted"
                      tooltipDesc="It overrides the default automatically whenever its targeting rules (below) match — it can't also be set as the default."
                    />
                  )}
                  {isScheduled && (
                    <IconAction
                      icon={<MaterialIcon name="schedule" />}
                      caption="Scheduled"
                      active
                      tooltipTitle="This asset is scheduled"
                      tooltipDesc="It overrides the default automatically during its own targeting rule's window (see below — each rule can carry its own schedule) — it can't also be set as the default."
                    />
                  )}
                </>
              ) : (
                <IconAction
                  icon={<MaterialIcon name={current.isDefault ? 'star' : 'star_border'} />}
                  caption="Default"
                  gold
                  active={current.isDefault}
                  disabled={expired}
                  onClick={setDefault}
                  tooltipTitle={current.isDefault ? 'Remove as default' : (isVideo ? 'Set as default video' : 'Set as default image')}
                  tooltipDesc={
                    expired
                      ? 'Renew the licence before making this the default.'
                      : current.isDefault
                      ? `Another ${isVideo ? 'video' : 'image'} can be chosen as the default ${isVideo ? 'video' : 'image'} instead.`
                      : isVideo
                      ? 'Used only in the Feature Hero Spotlight board’s primary panel — every other panel, thumbnail and table always shows the default image instead.'
                      : 'Personalisation Hub uses this image unless a campaign specifies otherwise.'
                  }
                />
              )}
              <IconAction
                icon={<BespokeIcon name="ab" />}
                caption="Testing"
                active={current.availableForTesting}
                disabled={expired}
                onClick={toggleTesting}
                tooltipTitle={expired ? 'Not available' : current.availableForTesting ? 'Remove from testing' : 'Make available for testing'}
                tooltipDesc={expired ? 'Renew the licence before making this available for testing.' : current.availableForTesting ? 'Personalisation Hub will stop selecting this variant for A/B testing.' : 'Lets Personalisation Hub select this variant in A/B tests.'}
              />
            </div>

            <div style={{ display: 'flex', gap: 24, padding: '20px 20px 22px', flexWrap: 'wrap' }}>
              <div style={{ width: 470, flexShrink: 0, maxWidth: '100%' }}>
                {isVideo ? (
                  <video
                    key={current.id}
                    src={current.src}
                    controls
                    style={{ width: '100%', aspectRatio: '1 / 1', background: '#fff', borderRadius: 6, display: 'block' }}
                  />
                ) : (
                  // The slider is only meaningful while there's something
                  // pending to weigh up — once a treatment is saved there's
                  // nothing left to revert, so this shows a single flat view
                  // of the current (saved) result instead. Achieved without
                  // a second code path: with hasChange false, the slider
                  // component only ever renders its own beforeSrc, so
                  // passing current.src there (instead of the original)
                  // is what makes that flat view show the saved edit, not
                  // the pre-edit upload.
                  <BeforeAfterSlider
                    beforeSrc={pendingTreatment ? (current.original || current.src) : current.src}
                    afterSrc={current.src}
                    hasChange={pendingTreatment}
                  />
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 14, borderTop: '1px solid #f0f0f0' }}>
                  <IconAction icon={<MaterialIcon name="delete" />} caption="Delete" row danger tooltipTitle="Delete" tooltipDesc="Removes this asset from the product." onClick={deleteAsset} />
                  <IconAction icon={<MaterialIcon name="cached" />} caption="Replace" row tooltipTitle="Replace" tooltipDesc="Swaps the underlying file; variant label, tags and settings are kept." onClick={openReplace} />
                  <IconAction icon={<MaterialIcon name="content_copy" />} caption="Duplicate" row tooltipTitle="Duplicate" tooltipDesc="Adds a copy of this asset as a new tile — its own id and variant label, never default, targeted, or scheduled." onClick={duplicateAsset} />
                  {/* Hidden once the panel below is open — verified live
                      against demo.personalisationhub.com's own Storyboard &
                      Copy "Request changes": the trigger disappears in favour
                      of the expanded panel rather than sitting redundantly
                      above it. */}
                  {!isVideo && !requestChangesModalOpen && (
                    <IconAction
                      ai
                      row
                      icon={<MaterialIcon name="smart_toy" />}
                      caption="Request changes"
                      disabled={expired || !!imageBusy}
                      onClick={openRequestChangesModal}
                      tooltipTitle="Request changes"
                      tooltipDesc="Describe (or dictate) any change you want and the configured Image provider will apply it — not limited to Enhance or Background."
                    />
                  )}
                </div>
                {!isVideo && requestChangesModalOpen && (
                  // Verified live against demo.personalisationhub.com's own
                  // Storyboard & Copy tab: "Request changes" there expands
                  // into an inline bordered card directly under the image
                  // preview, in the same column — not a side drawer or a
                  // centred modal — so this matches that exactly rather
                  // than the drawer tried previously.
                  <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 16, marginTop: 14 }}>
                    <p style={{ fontSize: 15, fontWeight: 500, color: 'rgba(0,0,0,.85)', margin: '0 0 10px' }}>
                      What changes would you like me to make?
                    </p>
                    <div style={{ position: 'relative' }}>
                      <Input
                        autoFocus
                        value={requestChangesPrompt}
                        onChange={(e) => setRequestChangesPrompt(e.target.value)}
                        disabled={imageBusy === 'custom'}
                        placeholder="e.g., remove label, change background…"
                        onPressEnter={() => requestChangesPrompt.trim() && imageBusy !== 'custom' && confirmRequestChanges()}
                        style={{ paddingRight: SpeechRecognitionCtor ? 40 : undefined }}
                      />
                      {SpeechRecognitionCtor && (
                        <span
                          onClick={imageBusy === 'custom' ? undefined : toggleListening}
                          title={listening ? 'Stop dictating' : 'Dictate your request'}
                          style={{
                            position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)', width: 26, height: 26,
                            borderRadius: listening ? 6 : '50%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: imageBusy === 'custom' ? 'default' : 'pointer',
                            background: listening ? '#f0f0f0' : 'transparent', color: listening ? '#ff4d4f' : '#169bc2',
                          }}
                        >
                          <MaterialIcon name={listening ? 'pause' : 'mic'} style={{ fontSize: 15 }} />
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                      <Button onClick={closeRequestChangesModal} disabled={imageBusy === 'custom'}>
                        Cancel
                      </Button>
                      <IconAction
                        ai
                        row
                        busy={imageBusy === 'custom'}
                        icon={<MaterialIcon name="smart_toy" />}
                        caption={imageBusy === 'custom' ? 'Applying…' : 'Request changes'}
                        disabled={!requestChangesPrompt.trim() || imageBusy === 'custom'}
                        onClick={confirmRequestChanges}
                      />
                    </div>
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 260, maxWidth: 382, display: 'flex', flexDirection: 'column' }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 6, display: 'block' }}>Variant name</label>
                  <Input value={current.name} onChange={(e) => updateSelected({ name: e.target.value })} placeholder="e.g. Hero — front view" />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 6, display: 'block' }}>Tags</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(current.tags || []).map((t) => (
                      <Tag key={t} closable onClose={() => updateSelected({ tags: current.tags.filter((x) => x !== t) })}>
                        {t}
                      </Tag>
                    ))}
                    <Input
                      size="small"
                      style={{ width: 120 }}
                      placeholder="+ Add tag"
                      value={newTagText}
                      onChange={(e) => setNewTagText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newTagText.trim()) {
                          updateSelected({ tags: [...(current.tags || []), newTagText.trim()] });
                          setNewTagText('');
                        }
                      }}
                    />
                  </div>
                </div>
                <div style={{ height: 1, background: '#f0f0f0', margin: '4px 0 14px' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: current.rightsOn ? 10 : 0 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14 }}>Rights &amp; licensing</div>
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginTop: 1 }}>{rightsSummary}</div>
                  </div>
                  <Switch checked={current.rightsOn} onChange={(v) => updateSelected({ rightsOn: v })} />
                </div>
                {current.rightsOn && (
                  <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, background: '#fafafa', padding: '14px 16px', marginBottom: 14 }}>
                    {expired && (
                      <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', color: '#a8071a', borderRadius: 6, padding: '10px 12px', fontSize: 13, marginBottom: 12 }}>
                        Licence expired — Default and Testing are disabled until renewed.
                      </div>
                    )}
                    {!expired && soon && (
                      <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', color: '#874d00', borderRadius: 6, padding: '10px 12px', fontSize: 13, marginBottom: 12 }}>
                        Expires in {daysUntil(current.rights.expiry)} day(s) — renew soon.
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={{ fontSize: 12, color: 'rgba(0,0,0,.65)' }}>Licence type</label>
                        <Select
                          style={{ width: '100%', marginTop: 4 }}
                          value={current.rights.type}
                          onChange={(v) => updateRights({ type: v })}
                          options={['Owned', 'Licensed', 'Royalty-free'].map((s) => ({ value: s, label: s }))}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: 'rgba(0,0,0,.65)' }}>Territory</label>
                        <Select
                          style={{ width: '100%', marginTop: 4 }}
                          value={current.rights.territory}
                          onChange={(v) => updateRights({ territory: v })}
                          options={['Global', 'AU / NZ', 'AU only', 'APAC'].map((s) => ({ value: s, label: s }))}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: 'rgba(0,0,0,.65)', display: 'block', marginBottom: 4 }}>Expiry date &amp; time</label>
                        <ClearableDate
                          showTime
                          value={current.rights.expiry}
                          onChange={(v) => updateRights({ expiry: v })}
                          blankHint={{ blank: 'No expiry', set: '' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: 'rgba(0,0,0,.65)' }}>Rights holder</label>
                        <Input
                          style={{ marginTop: 4 }}
                          value={current.rights.holder}
                          onChange={(e) => updateRights({ holder: e.target.value })}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                      <Switch size="small" checked={!!current.rights.release} onChange={(v) => updateRights({ release: v })} />
                      <span style={{ fontSize: 13 }}>Talent / property release on file</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ borderTop: '1px solid #f0f0f0', padding: '20px 20px 22px' }}>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,.45)', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 8, textTransform: 'uppercase' }}>
                Asset Scheduling &amp; Targeting Rules
              </div>
              {current.isDefault ? (
                // The default is always the fallback Personalisation Hub
                // falls back to once every targeted and scheduled asset has
                // been ruled out (menu-board.html's _defaultImageIndex /
                // _defaultVideoIndex) — it has to stay unconditional for
                // that to mean anything, so it can't carry its own schedule
                // or targeting rules. Duplicate (below) to get a copy that
                // isn't default and can have either set on it.
                <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', margin: 0 }}>
                  This is the default {isVideo ? 'video' : 'image'} — the fallback shown whenever no other asset&rsquo;s schedule or targeting rules apply. It can&rsquo;t carry its own schedule or targeting; use Duplicate above to create a scheduled or targeted variant instead.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', margin: '0 0 14px' }}>
                    These apply only to &ldquo;{current.name.trim() || current.variant}&rdquo; — not to any other image or video on this product. Each rule below (an &ldquo;AND&rdquo; block) can carry its own Schedule from/until, so different rules can be time-boxed independently instead of sharing one schedule.
                  </p>
                  <TargetingBuilder
                    groups={current.targeting || []}
                    onChange={(groups) => {
                      // A targeted asset can't also be the default (Default
                      // is disabled above once targeting exists) — if rules
                      // are added to the asset that's currently default,
                      // clear that flag in the same update rather than
                      // leaving the two in an inconsistent state until the
                      // next unrelated edit touches isDefault.
                      const next = images.map((img, i) => {
                        if (i !== selected) return img;
                        const stillDefault = groups.length > 0 ? false : img.isDefault;
                        return { ...img, targeting: groups, isDefault: stillDefault };
                      });
                      patch({ images: next });
                    }}
                    emptyDescription="No targeting rules defined. This asset can be shown at every store, to every visitor."
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>

      <Modal
        title="Generate Video"
        open={videoModalOpen}
        onCancel={() => !videoBusy && setVideoModalOpen(false)}
        okText="Generate"
        okButtonProps={{ loading: videoBusy, disabled: !videoPrompt.trim() }}
        cancelButtonProps={{ disabled: videoBusy }}
        onOk={confirmGenerateVideo}
      >
        <p style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 12 }}>
          The configured Video provider will animate the currently selected image into a short hero clip using the prompt below. The result is added as a new video asset, rendered at {videoDurationSeconds}s to match the Local Feature Highlight board's Rotation Speed{heroTemplate ? '' : ' (default — this brand has no Local Feature Highlight template configured)'}.
        </p>
        <Input.TextArea
          rows={4}
          value={videoPrompt}
          onChange={(e) => setVideoPrompt(e.target.value)}
          disabled={videoBusy}
          placeholder="Describe the animation you want…"
        />
      </Modal>


      <TouchUpModal
        open={touchUpOpen}
        src={current?.src}
        originalSrc={current?.original}
        onCancel={() => setTouchUpOpen(false)}
        onApply={applyTouchUp}
      />
    </div>
  );
}
