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

// instructionKey is 'removeBackground' | 'enhance' — the actual instruction
// text sent to the image model is chosen server-side (functions/index.js's
// IMAGE_INSTRUCTIONS), not passed through from here, since these two are
// fixed operations rather than free text.
export async function editProductImage({ imageDataUrl, instructionKey }) {
  const { data } = await editProductImageFn({ imageDataUrl, instructionKey });
  return data.imageDataUrl;
}

export async function generateProductVideo({ imageDataUrl, prompt }) {
  const { data } = await generateProductVideoFn({ imageDataUrl, prompt });
  return data.videoUrl;
}
