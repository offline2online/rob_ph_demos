import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { db, ITEMS_COLL, STORE_PRICING_COLL } from './firebase.js';
import { migrateItem, toItemDoc } from './migration.js';
import { getBrandById, getBrands } from './registries.js';

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
  // Defaults to the first brand in the registry (and that brand's own
  // currency, below) rather than leaving Brand blank — a brand-new
  // product almost always belongs to whichever brand HQ Admin is
  // currently managing, and an unset Brand was otherwise just an extra
  // required click before anything else on the page could be filled in.
  // Still just a default: the Select can be changed immediately if this
  // guess is wrong, and doing so re-syncs currency to match (see
  // ProductDetailsTab.jsx's Brand onChange).
  const firstBrand = getBrands()[0];
  return {
    id: genId(),
    brand: firstBrand?.id || '',
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
    // The badge's own look (Settings → Menu Board Badge Templates → Offer
    // Badge) is fixed for every product now — no per-product template id
    // to default here anymore.
    showOnMenuBoard: '',
    // Follows the default brand above, not a bare '$' — a product's RRP/
    // offer price are shown with this prefix (ProductDetailsTab.jsx,
    // PricingTab.jsx) and there's no currency-editing control anywhere in
    // this app; a brand's own currency (set in hq-admin.html's brand
    // modal) is the only real source for it.
    currency: firstBrand?.currency || '$',
    taxClass: '',
    currencyLocked: true,
    // New products start Inactive — Product Details' required fields
    // (brand, name, SKU, category, menu type) must be filled in before
    // ProductPage.jsx's Status toggle will let it go Active, so an
    // incomplete product can never reach a live board.
    status: 'Inactive',
    featured: false,
    featurePriority: '',
    featuredFrom: '',
    featuredUntil: '',
    shortDescription: '',
    longDescription: '',
    descriptionTranslations: {},
    descriptionLanguages: ['en'],
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
    ingredients: [],
    attributes: [],
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
// Every store's own storePricing/{storeCode} doc, filtered down to just
// this SKU's entry — so a product's Stock tab can show "which stores are
// running their own price for this item and what it is" without needing
// its own per-store collection (retail-admin.html's local-offer records
// are the only place this data already lives; there's no separate
// "stores" registry with human-readable names anywhere in this app, so
// the store's own code is the only identifier shown).
export async function getLocalOffersForSku(sku) {
  if (!sku) return [];
  const snap = await getDocs(collection(db, STORE_PRICING_COLL));
  const rows = [];
  snap.forEach((d) => {
    const override = (d.data() || {})[sku];
    if (override) rows.push({ storeCode: d.id, ...override });
  });
  return rows.sort((a, b) => a.storeCode.localeCompare(b.storeCode));
}

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
