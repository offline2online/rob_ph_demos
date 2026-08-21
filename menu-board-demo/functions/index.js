const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

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
    const p = patchFor({ id: doc.id, ref: doc.ref, priceLog: item.priceLog });
    p.priceLog = [{
      when: now.toISOString(), src: 'HQ Admin', store: '', by: 'System',
      fieldName: 'Offer price', old: currency + offerNum.toFixed(2), neu: '—',
      reason: `Offer expired (was scheduled until ${fmtDate(item.offerUntil)}) — automatically reverted to RRP ${currency}${rrp.toFixed(2)}`,
    }, ...p.priceLog];
    Object.assign(p.fieldPatch, { offerPrice: null, offerFrom: '', offerUntil: '', updatedAt: now.toISOString() });
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
      const p = patchFor(item);
      p.priceLog = [{
        when: now.toISOString(), src: storeCode, store: storeCode, by: 'System',
        fieldName: 'Offer price', old: currency + offerNum.toFixed(2), neu: '—',
        reason: `Offer expired (was scheduled until ${fmtDate(o.offerUntil)}) — automatically reverted to RRP ${currency}${rrp.toFixed(2)}`,
      }, ...p.priceLog];

      patch[`${sku}.offerPrice`] = null;
      patch[`${sku}.offerFrom`] = '';
      patch[`${sku}.offerUntil`] = '';
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
