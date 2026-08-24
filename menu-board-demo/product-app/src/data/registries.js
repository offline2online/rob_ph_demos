import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { db, MB, STOCK_COLL_NAME } from './firebase.js';

// Same fallback defaults as menu-board-demo/hq-admin.html (lines 1461-1469) —
// used only when the live Firestore docs are empty, exactly like the
// vanilla page's own getTypes()/getCats() do.
export const DEFAULT_TYPES = [
  { id: 'breakfast', label: 'Breakfast', color: '#f59e0b' },
  { id: 'lunch', label: 'Lunch', color: '#16a34a' },
  { id: 'dinner', label: 'Dinner', color: '#7c3aed' },
  { id: 'drinks', label: 'Drinks', color: '#2563eb' },
  { id: 'specials', label: "Today's Specials", color: '#e11d48' },
];

export const DEFAULT_CATS = [
  'Mains', 'Starters', 'Sides', 'Desserts', 'Hot Drinks', 'Cold Drinks',
  'Cocktails', 'Wines', 'Beers', 'Sandwiches', 'Salads', 'Pasta', 'Burgers',
];

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

let _brands = [];
let _types = [];
let _cats = [];
let _languages = [];
let _storeCodes = [];
let _loaded = false;

export async function loadRegistries() {
  const [brandsSnap, typesSnap, catsSnap, languagesSnap, stockSnap] = await Promise.all([
    getDoc(doc(db, MB, 'brands')),
    getDoc(doc(db, MB, 'types')),
    getDoc(doc(db, MB, 'categories')),
    getDoc(doc(db, MB, 'languages')),
    getDocs(collection(db, STOCK_COLL_NAME)),
  ]);
  _brands = brandsSnap.exists() ? brandsSnap.data().data || [] : [];
  _types = typesSnap.exists() ? typesSnap.data().data || [] : [];
  // Same normalization as the vanilla page's getCats() (hq-admin.html:2146) —
  // some legacy imports stored categories as objects, not strings.
  const rawCats = catsSnap.exists() ? catsSnap.data().data || [] : [];
  _cats = rawCats.map((c) => (typeof c === 'object' ? c.name || c.id || String(c) : String(c))).filter(Boolean);
  _languages = languagesSnap.exists() ? languagesSnap.data().data || [] : [];
  _storeCodes = stockSnap.docs.map((d) => d.id).sort();
  _loaded = true;
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

export function getLanguages() {
  return _languages.length ? _languages : DEFAULT_LANGUAGES;
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

export function getKnownStoreCodes() {
  return _storeCodes;
}
