import { httpsCallable } from 'firebase/functions';
import { functions } from '../data/firebase.js';

// Thin wrappers around the AI provider Cloud Functions (see
// menu-board-demo/functions/index.js, "AI PROVIDERS" section). Every
// token lives encrypted in Firestore and is only ever decrypted inside
// those functions, using a key held in Firebase Secret Manager — this
// module never sees, derives, or reconstructs a plaintext token. All it
// sends is the operation payload (image bytes, a prompt, target language);
// all it gets back is the result.
//
// `provider` objects from registries.js's getAiProviders()/useAiProviders()
// still carry a `baseUrl`/`authToken` pair, but only so the UI can show
// "is this configured?" — that check never needs the token's plaintext,
// just whether the (opaque, encrypted) field is non-empty.
export function isProviderConfigured(provider) {
  return !!(provider && provider.baseUrl && provider.authToken);
}

// Generating a video can take a couple of minutes — the client SDK's
// default callable timeout (70s) would abort a healthy in-progress render,
// so this one gets a longer one explicitly. Translation and image edits
// finish quickly and are left on the default.
const translateProductCopyFn = httpsCallable(functions, 'translateProductCopy');
const editProductImageFn = httpsCallable(functions, 'editProductImage');
const generateProductVideoFn = httpsCallable(functions, 'generateProductVideo', { timeout: 300000 });

export async function translateProductCopy({ targetLangName, displayName, shortDescription, longDescription }) {
  const { data } = await translateProductCopyFn({ targetLangName, displayName, shortDescription, longDescription });
  return data;
}

// Only Request Changes calls this now — Remove Background moved to
// @imgly/background-removal (a real client-side segmentation model) and
// Enhance to a deterministic local filter (see ProductAssetsTab.jsx's
// enhanceImageLocally), both for the same reason: Gemini's generative edit
// doesn't reliably behave like the fixed operation each used to ask for.
export async function editProductImage({ imageDataUrl, prompt }) {
  const { data } = await editProductImageFn({ imageDataUrl, prompt });
  return data.imageDataUrl;
}

export async function generateProductVideo({ imageDataUrl, prompt }) {
  const { data } = await generateProductVideoFn({ imageDataUrl, prompt });
  return data.videoUrl;
}
