import { useEffect, useRef, useState } from 'react';
import { Input, Switch, Select, Tag, Modal, message } from 'antd';
import dayjs from 'dayjs';
import { removeBackground as imglyRemoveBackground, preload as imglyPreload } from '@imgly/background-removal';
import MaterialIcon from '../../components/MaterialIcon.jsx';
import BespokeIcon from '../../components/BespokeIcon.jsx';
import IconAction from '../../components/IconAction.jsx';
import BeforeAfterSlider from '../../components/BeforeAfterSlider.jsx';
import ClearableDate from '../../components/ClearableDate.jsx';
import TargetingBuilder, { describeTargeting } from '../../components/TargetingBuilder.jsx';
import { useAiProviders } from '../../data/registries.js';
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
// docs) was eroding fine product detail on real photos. Shared by both the
// background preload below and the actual removeBackground call so they
// always agree on — and reuse the same cached — model.
const BG_REMOVAL_CONFIG = { model: 'isnet_fp16' };

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
const JPEG_QUALITY = 0.75;

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
function compressDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const sizeOf = (s) => Math.round((s.length - s.indexOf(',') - 1) * 0.75);
    if (sizeOf(dataUrl) <= COMPRESS_THRESHOLD_BYTES) { resolve(dataUrl); return; }
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
      const passes = [[MAX_DIMENSION, 0.82], [800, 0.76], [600, 0.7], [450, 0.6]];
      let out = render(...passes[0]);
      for (let i = 1; i < passes.length && sizeOf(out) > COMPRESS_THRESHOLD_BYTES; i++) {
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

function readAndCompress(file) {
  const readAsDataUrl = () =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });

  if (!file.type.startsWith('image') || file.size <= COMPRESS_THRESHOLD_BYTES) {
    return readAsDataUrl();
  }

  return readAsDataUrl().then(
    (dataUrl) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
          const width = Math.round(img.width * scale);
          const height = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          // Flattens transparency to white — matches how the rest of the
          // catalog's photography is shot (plain white background), and
          // JPEG can't carry an alpha channel anyway.
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      })
  );
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
            // A targeted asset can never also be default (it already
            // overrides the default whenever its rule matches — see the
            // Default button in the toolbar below) — so the default
            // star is replaced outright by the targeting pin here, not
            // just dimmed, to make the two states unambiguous at a glance.
            <span
              title={`Targeted — ${describeTargeting(img.targeting)}`}
              style={{ width: 20, height: 20, borderRadius: 4, background: 'rgba(232,253,255,.97)', border: '1px solid #87d9ec', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#169bc2' }}
            >
              <MaterialIcon name="my_location" style={{ fontSize: 12 }} />
            </span>
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
  const [selected, setSelected] = useState(0);
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
    setSelected(0);
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
    Promise.all([...files].map((file) => readAndCompress(file).then((src) => ({ file, src })))).then((loaded) => {
      const next = [...images];
      loaded.forEach(({ file, src }) => {
        const type = file.type.startsWith('video') ? 'video' : 'image';
        next.push({
          id: 'img-' + Date.now() + Math.random().toString(36).slice(2, 7),
          src,
          type,
          name: '',
          tags: [],
          isDefault: false,
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
      setSelected(next.length - loaded.length);
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
    readAndCompress(file).then((src) => {
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
    setSelected((s) => Math.max(0, Math.min(s, next.length - 1)));
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
      const compressed = await compressDataUrl(fixed);
      updateSelected({ [flagKey]: true, src: compressed, original: current.original || current.src });
    } catch (e) {
      message.error(`Image edit failed: ${e.message}`);
    } finally {
      setImageBusy(null);
    }
  };
  const toggleBg = () => applyImageTreatment('bg');
  const toggleEnhance = () => applyImageTreatment('enhance');

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
      const compressed = await compressDataUrl(fixed);
      updateSelected({ customEdited: true, src: compressed, original: current.original || current.src });
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
      const videoSrc = await generateProductVideo({ imageDataUrl: current.src, prompt: videoPrompt.trim() });
      const next = [...images];
      const newAsset = {
        id: 'img-' + Date.now() + Math.random().toString(36).slice(2, 7),
        src: videoSrc,
        type: 'video',
        name: '',
        tags: [],
        isDefault: false,
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
      setSelected(next.length - 1);
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
  const isTargeted = !!(current?.targeting && current.targeting.length);
  // Background removal and Enhance are photo-editing operations — neither
  // has any meaning for a video file, and the before/after slider below
  // is built entirely around comparing two still frames.
  const isVideo = current?.type === 'video';

  const rightsSummary = current?.rightsOn
    ? [current.rights.type, current.rights.territory, current.rights.expiry ? `Expires ${dayjs(current.rights.expiry).format('D MMM YYYY, HH:mm')}` : 'No expiry', current.rights.release ? 'release on file' : null]
        .filter(Boolean)
        .join(' · ')
    : 'Off — no licence terms recorded. Turn on for licensed, stock or talent-bearing assets.';

  const hasAnyTreatment = current && (current.bgRemoved || current.enhanced || current.customEdited);

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
            <Tile key={img.id} img={img} selected={idx === selected} onClick={() => setSelected(idx)} />
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
                ai
                busy={imageBusy === 'custom'}
                icon={<MaterialIcon name="edit" />}
                caption={imageBusy === 'custom' ? 'Applying…' : 'Request'}
                active={current.customEdited}
                disabled={expired || isVideo || !!imageBusy}
                onClick={openRequestChangesModal}
                tooltipTitle="Request changes"
                tooltipDesc={isVideo ? 'Not available for video.' : 'Describe (or dictate) any change you want and the configured Image provider will apply it — not limited to Enhance or Background.'}
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
              {isTargeted ? (
                // A targeted asset can never also be default — it already
                // overrides the default whenever its rule matches — so the
                // Default toggle is replaced outright by a clearly-active
                // status indicator here, not just disabled next to a star
                // that no longer means anything for this asset.
                <IconAction
                  icon={<MaterialIcon name="my_location" />}
                  caption="Targeted"
                  active
                  tooltipTitle="This asset is targeted"
                  tooltipDesc="It overrides the default automatically whenever its targeting rules (below) match — it can't also be set as the default."
                />
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
                    style={{ width: '100%', aspectRatio: '1 / 1', background: '#000', borderRadius: 6, display: 'block' }}
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
                    transparent={current.bgRemoved}
                  />
                )}
                <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginTop: 8 }}>
                  {isVideo
                    ? 'Background removal and Enhance aren’t available for video.'
                    : pendingTreatment
                    ? 'Drag the slider to compare before/after.'
                    : hasAnyTreatment
                    ? 'Saved — this edit is permanent.'
                    : 'No treatment applied yet.'}
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 14, borderTop: '1px solid #f0f0f0' }}>
                  <IconAction icon={<MaterialIcon name="cached" />} caption="Replace" row tooltipTitle="Replace" tooltipDesc="Swaps the underlying file; variant label, tags and settings are kept." onClick={openReplace} />
                  <IconAction icon={<MaterialIcon name="delete" />} caption="Delete" row danger tooltipTitle="Delete" tooltipDesc="Removes this asset from the product." onClick={deleteAsset} />
                </div>
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
                Asset Targeting Rules
              </div>
              <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', margin: '0 0 14px' }}>
                These rules apply only to &ldquo;{current.name.trim() || current.variant}&rdquo; — not to any other image or video on this product.
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
          The configured Video provider will animate the currently selected image into a short hero clip using the prompt below. The result is added as a new video asset.
        </p>
        <Input.TextArea
          rows={4}
          value={videoPrompt}
          onChange={(e) => setVideoPrompt(e.target.value)}
          disabled={videoBusy}
          placeholder="Describe the animation you want…"
        />
      </Modal>

      <Modal
        title="Request Changes"
        open={requestChangesModalOpen}
        onCancel={() => !imageBusy && closeRequestChangesModal()}
        okText="Apply"
        okButtonProps={{ loading: imageBusy === 'custom', disabled: !requestChangesPrompt.trim() }}
        cancelButtonProps={{ disabled: imageBusy === 'custom' }}
        onOk={confirmRequestChanges}
      >
        <p style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 12 }}>
          Describe any change you want made to this image — not limited to Enhance or Background. The configured Image provider applies it to the currently displayed version.
        </p>
        <div style={{ position: 'relative' }}>
          <Input.TextArea
            rows={4}
            value={requestChangesPrompt}
            onChange={(e) => setRequestChangesPrompt(e.target.value)}
            disabled={imageBusy === 'custom'}
            placeholder="e.g. Make the sauce glossier and add a light steam effect…"
            style={{ paddingRight: SpeechRecognitionCtor ? 40 : undefined }}
          />
          {SpeechRecognitionCtor && (
            <span
              onClick={imageBusy === 'custom' ? undefined : toggleListening}
              title={listening ? 'Stop dictating' : 'Dictate your request'}
              style={{
                position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: imageBusy === 'custom' ? 'default' : 'pointer',
                background: listening ? '#ff4d4f' : '#f0f0f0', color: listening ? '#fff' : 'rgba(0,0,0,.55)',
              }}
            >
              <MaterialIcon name="mic" style={{ fontSize: 15 }} />
            </span>
          )}
        </div>
        {listening && <p style={{ fontSize: 12, color: '#ff4d4f', marginTop: 6 }}>Listening…</p>}
      </Modal>
    </div>
  );
}
