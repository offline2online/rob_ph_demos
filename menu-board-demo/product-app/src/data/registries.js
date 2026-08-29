import { doc, getDoc, setDoc, collection, getDocs, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db, MB, STOCK_COLL_NAME, ITEMS_COLL } from './firebase.js';

// Same fallback defaults as menu-board-demo/hq-admin.html (lines 1461-1469) —
// used only when the live Firestore docs are empty, exactly like the
// vanilla page's own getTypes()/getCats() do.
export const DEFAULT_TYPES = [
  { id: 'breakfast', label: 'Breakfast', color: '#f59e0b' },
  { id: 'lunch', label: 'Lunch', color: '#16a34a' },
  { id: 'dinner', label: 'Dinner', color: '#7c3aed' },
  { id: 'drinks', label: 'Drinks', color: '#2563eb' },
  { id: 'specials', label: 'Meal Deals', color: '#e11d48' },
];

export const DEFAULT_CATS = [
  'Mains', 'Starters', 'Sides', 'Desserts', 'Hot Drinks', 'Cold Drinks',
  'Cocktails', 'Wines', 'Beers', 'Sandwiches', 'Salads', 'Pasta', 'Burgers',
];

// Unlike DEFAULT_CATS, sub-categories aren't a curated platform-wide set —
// every brand's own products define what sub-categories make sense for it
// (see addSubCategoryToRegistry below), so there's nothing sensible to
// seed here before anyone's added one.
export const DEFAULT_SUB_CATS = [];

// Same fallback default as hq-admin.html's own DEFAULT_LANGUAGES (line
// ~1275) — its first 18 entries specifically, before the comment there
// marks "Expanded to cover the real 'Languages Spoken by Staff' field (72
// entries)". Those first 18 are the platform's curated, commonly-used
// language set; the remaining ~54 exist only to satisfy the free-text
// staff-language matching field and aren't meant to populate a content
// dropdown like this one. Trimmed to {code, name} — this dropdown only
// ever needs a code to key translated content by and a label to show,
// not the flag/script/direction metadata the Languages On Shift display
// template needs.
export const DEFAULT_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'pl', name: 'Polish' },
  { code: 'ur', name: 'Urdu' },
  { code: 'es', name: 'Spanish' },
  { code: 'zh', name: 'Mandarin' },
  { code: 'ar', name: 'Arabic' },
  { code: 'ro', name: 'Romanian' },
  { code: 'bsl', name: 'British Sign Language' },
  { code: 'fr', name: 'French' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'so', name: 'Somali' },
  { code: 'it', name: 'Italian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'tr', name: 'Turkish' },
];

// Fixed set of exactly 4 badge types — one default style per type, set
// once under Settings → Menu Board Badge Templates (hq-admin.html) and
// used everywhere that badge appears; nothing here picks a template by id
// per product anymore. Mirrored in hq-admin.html (authored), menu-board.html
// and order.html (rendered).
export const DEFAULT_BADGE_TEMPLATES = [
  { id: 'offer',    name: 'Offer Badge',    size: 'medium', uppercase: false, outlined: false, borderWidth: 'none', radius: 'rounded', bg: '#fff7e6', color: '#ad4e00', borderColor: '#ad4e00', pricePosition: 'below' },
  { id: 'location', name: 'Location Badge', size: 'medium', uppercase: false, outlined: false, borderWidth: 'none', radius: 'rounded', bg: '#e8fdff', color: '#0e7a9c', borderColor: '#0e7a9c', pricePosition: 'below' },
  { id: 'soldOut',  name: 'Sold Out Badge', size: 'medium', uppercase: true,  outlined: false, borderWidth: 'thin', radius: 'square',  bg: '#ffffff', color: '#c0392b', borderColor: '#c0392b' },
  { id: 'category', name: 'Category Badge', size: 'small',  uppercase: true,  outlined: false, borderWidth: 'none', radius: 'square',  bg: '#006241', color: '#ffffff', borderColor: '#006241' },
];

let _brands = [];
let _types = [];
let _cats = [];
let _subCats = [];
let _languages = [];
let _storeCodes = [];
let _badgeTemplates = [];
let _knownIngredients = [];
let _aiProviders = {};
let _loaded = false;

export async function loadRegistries() {
  const [brandsSnap, typesSnap, catsSnap, subCatsSnap, languagesSnap, stockSnap, badgeTemplatesSnap, itemsSnap, settingsSnap] = await Promise.all([
    getDoc(doc(db, MB, 'brands')),
    getDoc(doc(db, MB, 'types')),
    getDoc(doc(db, MB, 'categories')),
    getDoc(doc(db, MB, 'subCategories')),
    getDoc(doc(db, MB, 'languages')),
    getDocs(collection(db, STOCK_COLL_NAME)),
    getDoc(doc(db, MB, 'badgeTemplates')),
    getDocs(collection(db, ITEMS_COLL)),
    getDoc(doc(db, MB, 'settings')),
  ]);
  _brands = brandsSnap.exists() ? brandsSnap.data().data || [] : [];
  _types = typesSnap.exists() ? typesSnap.data().data || [] : [];
  // Same normalization as the vanilla page's getCats() (hq-admin.html:2146) —
  // some legacy imports stored categories as objects, not strings.
  const rawCats = catsSnap.exists() ? catsSnap.data().data || [] : [];
  _cats = rawCats.map((c) => (typeof c === 'object' ? c.name || c.id || String(c) : String(c))).filter(Boolean);
  const rawSubCats = subCatsSnap.exists() ? subCatsSnap.data().data || [] : [];
  _subCats = rawSubCats.map((c) => (typeof c === 'object' ? c.name || c.id || String(c) : String(c))).filter(Boolean);
  _languages = languagesSnap.exists() ? languagesSnap.data().data || [] : [];
  _storeCodes = stockSnap.docs.map((d) => d.id).sort();
  _badgeTemplates = badgeTemplatesSnap.exists() ? badgeTemplatesSnap.data().data || [] : [];
  // Not a separate authored registry (nobody manages an "Ingredients"
  // list under Settings) — just every distinct ingredient any product has
  // ever had, so the Ingredients field's dropdown can suggest ones
  // already in use instead of only ever accepting fresh free text.
  const seen = new Set();
  itemsSnap.docs.forEach((d) => (d.data().ingredients || []).forEach((i) => i && seen.add(i)));
  _knownIngredients = [...seen].sort((a, b) => a.localeCompare(b));
  // AI provider configs authored in hq-admin.html's Settings → AI
  // Integrations (Prototype Only) — authToken stays AES-256-GCM encrypted
  // here and is only ever decrypted inside the Cloud Functions in
  // functions/index.js that use it, never in this app.
  _aiProviders = settingsSnap.exists() ? settingsSnap.data().aiProviders || {} : {};
  _loaded = true;

  // Kept live rather than loaded once like the registries above: HQ Admin
  // can edit AI Integrations while a Product page is already open, and
  // there's no security reason not to — this field never holds a
  // plaintext token, so syncing it live costs nothing that a one-time
  // load would have avoided. _notifyAiProviderListeners lets any mounted
  // useAiProviders() hook re-render the instant this changes, rather than
  // only picking up the fresh value on whatever's next incidental re-render.
  onSnapshot(doc(db, MB, 'settings'), (snap) => {
    _aiProviders = snap.exists() ? snap.data().aiProviders || {} : {};
    _notifyAiProviderListeners();
  });
}

export function registriesLoaded() {
  return _loaded;
}

export function getBrands() {
  return _brands;
}

export function getBrandById(id) {
  return _brands.find((b) => b.id === id) || null;
}

export function getTypes() {
  return _types.length ? _types : DEFAULT_TYPES;
}

export function getCats() {
  return _cats.length ? _cats : DEFAULT_CATS;
}

export function getSubCats() {
  return _subCats.length ? _subCats : DEFAULT_SUB_CATS;
}

export function getBadgeTemplates() {
  return _badgeTemplates.length ? _badgeTemplates : DEFAULT_BADGE_TEMPLATES;
}

export function getBadgeTemplateById(id) {
  const templates = getBadgeTemplates();
  return templates.find((t) => t.id === id) || DEFAULT_BADGE_TEMPLATES.find((t) => t.id === id) || DEFAULT_BADGE_TEMPLATES[0];
}

export function getLanguages() {
  return _languages.length ? _languages : DEFAULT_LANGUAGES;
}

export function getAiProviders() {
  return _aiProviders;
}

const _aiProviderListeners = new Set();
function _notifyAiProviderListeners() {
  _aiProviderListeners.forEach((cb) => cb(_aiProviders));
}

// React hook version of getAiProviders() — subscribes so the calling
// component re-renders the moment Settings → AI Integrations changes,
// instead of only seeing the fresh value whenever something else happens
// to re-render it. Safe to call from any already-mounted component (Assets
// tab, Details tab, …) since loadRegistries() has always run first (see
// App.jsx) and started the onSnapshot listener above before any tab mounts.
export function useAiProviders() {
  const [providers, setProviders] = useState(() => getAiProviders());
  useEffect(() => {
    setProviders(getAiProviders()); // pick up anything that changed between initial render and this effect running
    _aiProviderListeners.add(setProviders);
    return () => _aiProviderListeners.delete(setProviders);
  }, []);
  return providers;
}

// Mirrors the vanilla page's addCategory() (hq-admin.html:3634) — writes
// straight back to the same menuboard/categories doc.
export async function addCategoryToRegistry(name) {
  const cats = getCats();
  if (cats.includes(name)) return cats;
  const next = [...cats, name];
  _cats = next;
  await setDoc(doc(db, MB, 'categories'), { data: next });
  return next;
}

// Same shape/pattern as addCategoryToRegistry above, own Firestore doc —
// sub-categories are managed the same way as categories on Product
// Details, just a separate registry since they're a different taxonomy.
export async function addSubCategoryToRegistry(name) {
  const subCats = getSubCats();
  if (subCats.includes(name)) return subCats;
  const next = [...subCats, name];
  _subCats = next;
  await setDoc(doc(db, MB, 'subCategories'), { data: next });
  return next;
}

export function getKnownStoreCodes() {
  return _storeCodes;
}

export function getKnownIngredients() {
  return _knownIngredients;
}
