import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, ITEMS_COLL } from './firebase.js';
import { migrateItem, toItemDoc } from './migration.js';
import { getBrandById } from './registries.js';

function genId() {
  return 'item-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

export async function getProduct(id) {
  const snap = await getDoc(doc(db, ITEMS_COLL, id));
  if (!snap.exists()) return null;
  const raw = { id: snap.id, ...snap.data() };
  const brand = getBrandById(raw.brand);
  return migrateItem(raw, brand?.currency);
}

export function blankProduct() {
  return {
    id: genId(),
    brand: '',
    sku: '',
    name: '',
    displayName: '',
    category: '',
    subCategory: '',
    rrp: '',
    offerPrice: '',
    offerFrom: '',
    offerUntil: '',
    showOnMenuBoard: '',
    currency: '$',
    taxClass: '',
    currencyLocked: true,
    status: 'Active',
    featured: false,
    featurePriority: '',
    featuredFrom: '',
    featuredUntil: '',
    shortDescription: '',
    longDescription: '',
    menuTypes: [],
    storeMode: 'all',
    stores: [],
    lowStockThreshold: '',
    attrGroups: [],
    optionGroups: [],
    images: [],
    priceLog: [],
  };
}

// Firestore's setDoc() rejects the *entire* write if any field, at any
// depth, is `undefined` — a single stray field silently fails the whole
// save with no indication which field caused it. Strip them defensively
// (arrays keep their length; a missing value there becomes null instead,
// since Firestore arrays can't contain undefined either).
function stripUndefined(value) {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : stripUndefined(v)));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

// Firestore security rules (firestore.rules:24-38) require id/sku/name as
// non-empty bounded strings, price as a number >= 0, category non-empty,
// menuTypes a list — every write must satisfy this or it's rejected.
export async function upsertProduct(product) {
  const doc_ = toItemDoc(product);
  const price = typeof doc_.price === 'number' && !isNaN(doc_.price) && doc_.price >= 0 ? doc_.price : 0;
  const payload = stripUndefined({
    ...doc_,
    price,
    sku: doc_.sku || 'SKU-' + doc_.id,
    name: doc_.name || 'Untitled product',
    category: doc_.category || 'Uncategorised',
    menuTypes: Array.isArray(doc_.menuTypes) ? doc_.menuTypes : [],
    createdAt: product.createdAt || new Date().toISOString(),
  });
  await setDoc(doc(db, ITEMS_COLL, product.id), payload);
  return migrateItem({ id: product.id, ...payload }, getBrandById(payload.brand)?.currency);
}

// `when` is stored as a real ISO timestamp (not a pre-formatted locale
// string) so the log can be sorted chronologically and so the table can
// render date and time as two independent, correctly-parsed pieces
// instead of guessing where one ends and the other starts.
export function appendPriceLogEntries(product, changes, reason, actor = 'HQ Admin User') {
  const when = new Date().toISOString();
  const entries = changes.map((c) => ({
    when,
    src: 'HQ Admin',
    store: '',
    by: actor,
    fieldName: c.fieldName,
    old: c.oldValue,
    neu: c.newValue,
    reason,
  }));
  return { ...product, priceLog: [...entries, ...(product.priceLog || [])] };
}
