const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
setGlobalOptions({ maxInstances: 1 });

const db = admin.firestore();

// A "Schedule offer until" date only ever controlled whether isLive()
// treated the offer as live for display — the stale offerPrice/offerFrom/
// offerUntil fields sat on the record forever after expiry, with no record
// that anything had happened. This runs server-side on a schedule so it
// fires the moment an offer expires, independent of anyone having HQ Admin
// open (the client-side version this replaced only ran while that tab was
// open — see menu-board-demo/hq-admin.html git history).
function fmtDate(v) {
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

async function currencyByBrandId() {
  const snap = await db.doc('menuboard/brands').get();
  const brands = snap.exists ? (snap.data().data || []) : [];
  const map = {};
  brands.forEach((b) => { map[b.id] = b.currency; });
  return { map, fallback: (brands[0] && brands[0].currency) || '$' };
}

// Commits queued writes in chunks under Firestore's 500-ops-per-batch limit.
async function commitInChunks(db_, ops) {
  const CHUNK = 450;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = db_.batch();
    ops.slice(i, i + CHUNK).forEach(({ ref, data }) => batch.update(ref, data));
    await batch.commit();
  }
}

async function sweepExpiredOffers() {
  const now = new Date();
  const { map: currencyByBrand, fallback: fallbackCurrency } = await currencyByBrandId();
  const currencyFor = (item) => currencyByBrand[item.brand] || fallbackCurrency;

  const itemsSnap = await db.collection('items').get();
  const itemsBySku = {};
  itemsSnap.forEach((d) => { itemsBySku[d.data().sku] = { id: d.id, ref: d.ref, ...d.data() }; });

  // Accumulate everything per item id first — an item can have both an
  // expired HQ-level offer and an expired store-level offer in the same
  // sweep, and Firestore batches reject two writes to the same document,
  // so every change to one item's priceLog has to land in a single update.
  const itemPatches = {}; // id -> { ref, priceLog: [...], fieldPatch: {...} }
  const patchFor = (item) => {
    if (!itemPatches[item.id]) {
      itemPatches[item.id] = { ref: item.ref, priceLog: item.priceLog || [], fieldPatch: {} };
    }
    return itemPatches[item.id];
  };

  // HQ's own offer, set directly on the shared item.
  for (const doc of itemsSnap.docs) {
    const item = doc.data();
    const offerNum = parseFloat(item.offerPrice);
    const until = item.offerUntil ? new Date(item.offerUntil) : null;
    if (!(offerNum > 0) || !until || !(until < now)) continue;

    const currency = currencyFor(item);
    const rrp = parseFloat(item.price || 0);
    const hadMenuBoardCopy = !!item.showOnMenuBoard;
    const p = patchFor({ id: doc.id, ref: doc.ref, priceLog: item.priceLog });
    p.priceLog = [{
      when: now.toISOString(), src: 'HQ Admin', store: '', by: 'System',
      fieldName: 'Offer price', old: currency + offerNum.toFixed(2), neu: '—',
      reason: `Offer expired (was scheduled until ${fmtDate(item.offerUntil)}) — automatically reverted to RRP ${currency}${rrp.toFixed(2)}`
        + (hadMenuBoardCopy ? '; menu board promo copy cleared' : ''),
    }, ...p.priceLog];
    Object.assign(p.fieldPatch, { offerPrice: null, offerFrom: '', offerUntil: '', showOnMenuBoard: '', updatedAt: now.toISOString() });
  }

  // Every store's own override, scoped to that store's own storePricing
  // doc — the log entry still lands on the shared item.priceLog (same
  // shape as a manual store-level price edit) so HQ sees it in the same
  // history as everything else.
  const storeOps = [];
  const storePricingSnap = await db.collection('storePricing').get();
  for (const storeDoc of storePricingSnap.docs) {
    const storeCode = storeDoc.id;
    const overrides = storeDoc.data() || {};
    const patch = {};
    let storeChanged = false;

    for (const sku of Object.keys(overrides)) {
      const o = overrides[sku];
      const offerNum = parseFloat(o.offerPrice);
      const until = o.offerUntil ? new Date(o.offerUntil) : null;
      if (!(offerNum > 0) || !until || !(until < now)) continue;
      const item = itemsBySku[sku];
      if (!item) continue;

      const currency = currencyFor(item);
      const rrp = parseFloat(o.price != null ? o.price : (item.price || 0));
      const hadMenuBoardCopy = !!o.showOnMenuBoard;
      const p = patchFor(item);
      p.priceLog = [{
        when: now.toISOString(), src: storeCode, store: storeCode, by: 'System',
        fieldName: 'Offer price', old: currency + offerNum.toFixed(2), neu: '—',
        reason: `Offer expired (was scheduled until ${fmtDate(o.offerUntil)}) — automatically reverted to RRP ${currency}${rrp.toFixed(2)}`
          + (hadMenuBoardCopy ? '; menu board promo copy cleared' : ''),
      }, ...p.priceLog];

      patch[`${sku}.offerPrice`] = null;
      patch[`${sku}.offerFrom`] = '';
      patch[`${sku}.offerUntil`] = '';
      patch[`${sku}.showOnMenuBoard`] = '';
      patch[`${sku}.updatedAt`] = now.toISOString();
      storeChanged = true;
    }

    if (storeChanged) storeOps.push({ ref: storeDoc.ref, data: patch });
  }

  const itemOps = Object.values(itemPatches).map((p) => ({
    ref: p.ref,
    data: { ...p.fieldPatch, priceLog: p.priceLog },
  }));

  await commitInChunks(db, itemOps);
  await commitInChunks(db, storeOps);

  const revertedCount = itemOps.length + storeOps.length;
  if (revertedCount > 0) logger.info(`Reverted ${itemOps.length} item offer(s), ${storeOps.length} store override(s).`);
  return revertedCount;
}

exports.sweepExpiredOffers = onSchedule('every 1 minutes', async () => {
  await sweepExpiredOffers();
});

// ═════════════════════════════════════════════════════════════════════════
// AI PROVIDERS — token custody + provider calls, server-side only
// ═════════════════════════════════════════════════════════════════════════
//
// menu-board-demo/hq-admin.html's Settings → AI Integrations used to
// encrypt provider tokens client-side with a passphrase baked into that
// page's own JS source — real protection against a casual glance at the
// Firestore console, but not against anyone reading the page. Everything
// below moves both custody of the encryption key AND every call that needs
// the decrypted token onto the server: the key lives only in Secret
// Manager (via defineSecret, never checked into this repo or shipped to a
// browser), tokens are decrypted only in a Cloud Function's memory for the
// duration of one outbound call, and the plaintext token is never returned
// to, or reconstructable by, product-app or hq-admin.html.
//
// One-time setup this needs before first deploy:
//   openssl rand -base64 32 | firebase functions:secrets:set AI_TOKEN_ENC_KEY
// (32 random bytes, base64-encoded — AES-256 needs exactly a 32-byte key.)
// Firebase prompts you to grant these functions access to the secret; say
// yes. Re-running `firebase functions:secrets:set` rotates the key, which
// makes every token already saved under the old key undecryptable — any
// rotation has to be followed by re-entering every provider's token in
// Settings → AI Integrations.
const AI_TOKEN_ENC_KEY = defineSecret('AI_TOKEN_ENC_KEY');
const AI_PROVIDER_KINDS = ['translation', 'image', 'video'];

function _aiKeyBuf() {
  const buf = Buffer.from(AI_TOKEN_ENC_KEY.value(), 'base64');
  if (buf.length !== 32) {
    throw new HttpsError('failed-precondition', 'AI_TOKEN_ENC_KEY is misconfigured (must decode to exactly 32 bytes).');
  }
  return buf;
}

function encryptAiToken(plaintext) {
  const key = _aiKeyBuf();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

function decryptAiToken(b64) {
  const key = _aiKeyBuf();
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

async function loadAiProviderConfig(kind) {
  if (!AI_PROVIDER_KINDS.includes(kind)) {
    throw new HttpsError('invalid-argument', `kind must be one of ${AI_PROVIDER_KINDS.join(', ')}`);
  }
  const snap = await db.doc('menuboard/settings').get();
  const cfg = snap.exists ? (snap.data().aiProviders || {})[kind] : null;
  if (!cfg || !cfg.baseUrl || !cfg.authToken) {
    throw new HttpsError('failed-precondition', `No ${kind} provider configured — add one in Settings → AI Integrations.`);
  }
  return cfg;
}

// Canned instructions live here, not in the client — Remove Background and
// Enhance are fixed operations (the client only ever sends which one it
// wants), unlike video generation's prompt, which is deliberately
// user-authored free text.
const IMAGE_INSTRUCTIONS = {
  removeBackground:
    'Remove the background from this product photo and replace it with a fully transparent background. Keep the product itself pixel-for-pixel unchanged — do not alter its shape, colour or position.',
  enhance:
    'Sharpen this product photo, correct its colour and lighting, and remove minor blemishes. Keep the composition and background exactly as they are — only improve image quality.',
};

// ── Settings — save a provider's config, encrypting a freshly-pasted token server-side ──
exports.saveAiProviderToken = onCall({ secrets: [AI_TOKEN_ENC_KEY], maxInstances: 10 }, async (request) => {
  const { kind, name, baseUrl, model, token } = request.data || {};
  if (!AI_PROVIDER_KINDS.includes(kind)) {
    throw new HttpsError('invalid-argument', `kind must be one of ${AI_PROVIDER_KINDS.join(', ')}`);
  }
  const settingsRef = db.doc('menuboard/settings');
  const snap = await settingsRef.get();
  const existing = (snap.exists && snap.data().aiProviders && snap.data().aiProviders[kind]) || {};
  const authToken = token ? encryptAiToken(token) : (existing.authToken || '');

  // A dotted, single-kind path via merge:true — not a full settings
  // overwrite — so this can't clobber the other two providers, or any of
  // this doc's unrelated fields (phApi, stockApiKey, bagLabel, …), if
  // another save lands in between reading and writing here.
  await settingsRef.set({
    aiProviders: { [kind]: { name: name || '', baseUrl: baseUrl || '', model: model || '', authToken } },
  }, { merge: true });

  return { ok: true, hasToken: !!authToken };
});

// ── Settings — "Test" button: verify the already-saved config, never a token still sitting in the form ──
exports.testAiProviderConnection = onCall({ secrets: [AI_TOKEN_ENC_KEY], maxInstances: 10 }, async (request) => {
  const { kind } = request.data || {};
  const cfg = await loadAiProviderConfig(kind);
  const token = decryptAiToken(cfg.authToken);
  const baseUrl = (cfg.baseUrl || '').replace(/\/+$/, '');

  let resp;
  try {
    if (kind === 'image') {
      resp = await fetch(`${baseUrl}/v1beta/models`, { headers: { 'x-goog-api-key': token } });
    } else if (kind === 'translation') {
      resp = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${token}` } });
    } else {
      resp = await fetch(baseUrl, { method: 'HEAD' });
    }
  } catch (e) {
    throw new HttpsError('unavailable', e.message);
  }
  return { ok: resp.ok, status: resp.status };
});

// ── Product Details → Add New Language (e.g. GPT-5.2 via an OpenAI-compatible Chat Completions API) ──
exports.translateProductCopy = onCall({ secrets: [AI_TOKEN_ENC_KEY], maxInstances: 10, timeoutSeconds: 60 }, async (request) => {
  const { targetLangName, displayName, shortDescription, longDescription } = request.data || {};
  if (!targetLangName) throw new HttpsError('invalid-argument', 'targetLangName is required');

  const cfg = await loadAiProviderConfig('translation');
  const token = decryptAiToken(cfg.authToken);
  const baseUrl = (cfg.baseUrl || '').replace(/\/+$/, '');
  const model = cfg.model || 'gpt-5.2';

  const source = { displayName: displayName || '', shortDescription: shortDescription || '', longDescription: longDescription || '' };
  const prompt = [
    `Translate the JSON object below from English into ${targetLangName}.`,
    'Keep the same three keys. Keep placeholders, numbers and brand/product names as-is where translating them would be wrong.',
    'Reply with ONLY a JSON object with the same three keys — no markdown fencing, no commentary.',
    '',
    JSON.stringify(source),
  ].join('\n');

  let resp;
  try {
    resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a precise product-copy translator for a restaurant menu board.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      }),
    });
  } catch (e) {
    throw new HttpsError('unavailable', e.message);
  }
  if (!resp.ok) throw new HttpsError('unavailable', `Translation provider returned HTTP ${resp.status}`);

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content || '';
  const jsonText = text.trim().replace(/^```(json)?\s*|```\s*$/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new HttpsError('internal', 'Could not parse the translation response');
  }
  return {
    displayName: parsed.displayName || '',
    shortDescription: parsed.shortDescription || '',
    longDescription: parsed.longDescription || '',
  };
});

// ── Product Assets → Remove Background / Enhance / Request Changes (e.g. Nano Banana Pro via the Gemini generateContent API) ──
// Remove Background and Enhance are still fixed operations, chosen via
// instructionKey; Request Changes is free-text authored by the user in the
// product-app modal (optionally dictated via the browser's own speech-to-
// text, never transcribed server-side), sent as `prompt` instead.
exports.editProductImage = onCall({ secrets: [AI_TOKEN_ENC_KEY], maxInstances: 10, timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const { imageDataUrl, instructionKey, prompt } = request.data || {};
  const instruction = instructionKey ? IMAGE_INSTRUCTIONS[instructionKey] : (prompt || '').trim();
  if (!instruction) throw new HttpsError('invalid-argument', 'Provide instructionKey ("removeBackground" or "enhance") or a non-empty prompt');
  const match = /^data:([^;]+);base64,(.*)$/s.exec(imageDataUrl || '');
  if (!match) throw new HttpsError('invalid-argument', 'imageDataUrl must be a base64 data URL');
  const [, mimeType, base64] = match;

  const cfg = await loadAiProviderConfig('image');
  const token = decryptAiToken(cfg.authToken);
  const baseUrl = (cfg.baseUrl || '').replace(/\/+$/, '');
  const model = cfg.model || 'gemini-3-pro-image-preview';

  let resp;
  try {
    resp = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': token },
      body: JSON.stringify({
        contents: [{ parts: [{ text: instruction }, { inlineData: { mimeType, data: base64 } }] }],
      }),
    });
  } catch (e) {
    throw new HttpsError('unavailable', e.message);
  }
  if (!resp.ok) throw new HttpsError('unavailable', `Image provider returned HTTP ${resp.status}`);

  const data = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart) throw new HttpsError('internal', 'Image provider did not return an edited image');
  return { imageDataUrl: `data:${imagePart.inlineData.mimeType || 'image/png'};base64,${imagePart.inlineData.data}` };
});

// ── Product Assets → Generate Video (LTX-2, https://docs.ltx.io) ──
// Real LTX-2 async contract, confirmed against docs.ltx.io 29 Aug 2026
// (the sync /v1/image-to-video returns the video file directly, which
// doesn't fit this prototype's "store a URL, not bytes" asset model —
// this uses the async /v2/image-to-video job instead):
//   POST {baseUrl}/v2/image-to-video  { model, prompt, image_uri, duration, resolution, generate_audio }
//     -> 202 { id }
//   GET  {baseUrl}/v2/image-to-video/{id}  every ~3s
//     -> { status: pending|processing|completed|failed, result?: { video_url }, error? }
// image_uri accepts an inline `data:` URI directly (docs.ltx.io/input-formats,
// up to 7MB encoded) as well as a hosted https URL — no Cloud Storage upload
// needed, the client's already-compressed imageDataUrl is passed straight
// through.
exports.generateProductVideo = onCall({ secrets: [AI_TOKEN_ENC_KEY], maxInstances: 10, timeoutSeconds: 300 }, async (request) => {
  const { imageDataUrl, prompt } = request.data || {};
  if (!/^data:[^;]+;base64,/.test(imageDataUrl || '')) throw new HttpsError('invalid-argument', 'imageDataUrl must be a base64 data URL');
  if (!prompt || !prompt.trim()) throw new HttpsError('invalid-argument', 'prompt is required');

  const cfg = await loadAiProviderConfig('video');
  const token = decryptAiToken(cfg.authToken);
  const baseUrl = (cfg.baseUrl || '').replace(/\/+$/, '');
  const model = cfg.model || 'ltx-2-5-fast';

  let createResp;
  try {
    createResp = await fetch(`${baseUrl}/v2/image-to-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      // camera_motion: 'static' — the camera itself doesn't move; any
      // rotation (e.g. the default turntable-style prompt below) is the
      // product turning in place, described in `prompt` text, since a
      // single flat photo has no depth data for a real camera orbit.
      body: JSON.stringify({ model, prompt, image_uri: imageDataUrl, duration: null, resolution: '1920x1080', generate_audio: false, camera_motion: 'static' }),
    });
  } catch (e) {
    throw new HttpsError('unavailable', e.message);
  }
  if (!createResp.ok) throw new HttpsError('unavailable', `Video provider returned HTTP ${createResp.status}: ${await createResp.text()}`);
  let job = await createResp.json();
  const jobId = job?.id;
  if (!jobId) throw new HttpsError('internal', 'Video provider did not return a job id');

  let polls = 0;
  while (job?.status !== 'completed' && job?.status !== 'failed' && polls < 90) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const pollResp = await fetch(`${baseUrl}/v2/image-to-video/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!pollResp.ok) throw new HttpsError('unavailable', `Video provider returned HTTP ${pollResp.status} while checking progress`);
    job = await pollResp.json();
    polls += 1;
  }

  if (job?.status === 'failed') throw new HttpsError('internal', job?.error?.message || job?.error || 'Video generation failed');
  const videoUrl = job?.result?.video_url;
  if (!videoUrl) throw new HttpsError('deadline-exceeded', 'Video provider did not return a video in time');
  return { videoUrl };
});
