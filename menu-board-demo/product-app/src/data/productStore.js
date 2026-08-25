import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, ITEMS_COLL } from './firebase.js';
import { migrateItem, toItemDoc } from './migration.js';
import { getBrandById } from './registries.js';

export function genId(prefix = 'item') {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
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
    offerDescription: '',
    offerRecurrence: null,
    offers: [],
    // menuBoardNote is the one the Pricing tab UI actually edits — the
    // fallback note used when no live offer has a note of its own.
    // showOnMenuBoard is the flat field menu-board.html/hq-admin.html
    // actually read; confirmSave derives it fresh on every save (an
    // offer's own note, else menuBoardNote) and it must never be read
    // back into an editable field, or a save made while an offer's note
    // was overriding it would bake that override in as the new
    // "fallback," permanently masking menuBoardNote from then on.
    menuBoardNote: '',
    // Which badge template (Settings → Menu Board Badge Templates,
    // registries.js's getBadgeTemplateById) renders the "Show on Menu
    // Board" note as a pill on the board — set once at HQ level, not
    // overridable per store (the store-level field only ever overrides
    // the note's *text*). Offers on this product use it too — there's no
    // separate per-offer template, by design, so a product's badge always
    // looks the same no matter which note is currently showing.
    menuBoardNoteTemplateId: 'default',
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
    descriptionTranslations: {},
    menuTypes: [],
    storeMode: 'all',
    stores: [],
    // Separate from storeMode/stores above (the Stock tab's flat store-
    // code picker, StorePicker.jsx) — this is the rule-based Distribution
    // control on Product Details, matching the brand modal's own
    // Distribution section (hq-admin.html) and offer/asset targeting's
    // AND/OR shape. Authoring only for now — nothing evaluates it yet, the
    // same starting point offer and asset targeting had before their own
    // evaluation logic was wired in.
    distributionMode: 'all',
    distributionTargeting: [],
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

// Status is a page-level property visible (and toggleable) on every tab,
// not just Details — same treatment as HQ Admin's own grid row
// Activate/Deactivate action (hq-admin.html's bulkSetActive), which
// writes immediately rather than waiting on a separate Save Changes
// click. A merge write here (not upsertProduct's full setDoc) means
// toggling Status can never clobber an in-progress, not-yet-saved edit
// on another field the user is mid-way through on Details/Assets/Stock.
export async function setProductStatus(id, status) {
  const patch = { status, active: status === 'Active', updatedAt: new Date().toISOString() };
  if (status !== 'Active') patch.featured = false;
  await setDoc(doc(db, ITEMS_COLL, id), patch, { merge: true });
  return patch;
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
