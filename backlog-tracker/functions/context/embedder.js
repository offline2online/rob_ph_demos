// PH Agent Context — the semantic vector.
//
// Every indexed record always has a local vector (core.localVector), so
// search works with no network at all. This adds a real embedding on top:
// Vertex AI's text embedding model, called with the function's own service
// account, in the console's own Google Cloud project. Nothing is sent
// anywhere else.
//
// It is best-effort by design. When the API is not enabled, the call is
// refused, or it takes too long, the record (or the query) simply has no
// semantic vector and the local one is used; after a failure the embedder
// stays quiet for COOL_OFF_MS instead of failing every write. Outside Cloud
// Functions (tests, scripts without CONTEXT_EMBEDDINGS=vertex) it is off.
"use strict";

const { DIM } = require("./core");

const MODEL = "text-embedding-005";
const LOCATION = process.env.CONTEXT_EMBEDDINGS_LOCATION || "us-central1";
const BATCH = 16;                 // texts per request
const INPUT_CHARS = 6000;         // per text (the model reads about 2,000 tokens)
const DOCUMENT_TIMEOUT_MS = 20000;
const QUERY_TIMEOUT_MS = 400;     // a search never waits longer than this for its query vector
const COOL_OFF_MS = 10 * 60 * 1000;

function enabled() {
  const mode = String(process.env.CONTEXT_EMBEDDINGS || "").toLowerCase();
  if (mode === "off" || mode === "local") return false;
  if (mode === "vertex") return true;
  return Boolean(process.env.K_SERVICE || process.env.FUNCTION_TARGET);   // on by default only inside Cloud Functions
}

// deps: { projectId, logger, fetchImpl?, getToken? }
// Returns { name, available(), embed(texts, kind) } where kind is "document"
// or "query" and embed resolves an array of unit vectors (number[] of DIM),
// or null when no semantic vector could be had.
function vertexEmbedder({ projectId, logger, fetchImpl = null, getToken = null }) {
  let offUntil = 0;
  let auth = null;
  async function token() {
    if (getToken) return getToken();
    if (!auth) {
      const { GoogleAuth } = require("google-auth-library");
      auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    }
    return auth.getAccessToken();
  }
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${LOCATION}/publishers/google/models/${MODEL}:predict`;
  async function call(texts, kind, timeoutMs) {
    const doFetch = fetchImpl || fetch;
    const res = await doFetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: texts.map((t) => ({ content: String(t).slice(0, INPUT_CHARS) || " ", task_type: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT" })),
        parameters: { outputDimensionality: DIM, autoTruncate: true },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Vertex AI embeddings answered ${res.status}`);
    const body = await res.json();
    const out = (body.predictions || []).map((p) => {
      const v = p && p.embeddings && p.embeddings.values;
      if (!Array.isArray(v) || v.length !== DIM) throw new Error("Vertex AI embeddings returned an unexpected shape");
      let n = 0;
      for (const x of v) n += x * x;
      n = Math.sqrt(n) || 1;
      return v.map((x) => x / n);
    });
    if (out.length !== texts.length) throw new Error("Vertex AI embeddings returned the wrong number of vectors");
    return out;
  }
  return {
    name: `vertex:${MODEL}:${DIM}`,
    available: () => Date.now() >= offUntil,
    async embed(texts, kind = "document") {
      if (!Array.isArray(texts) || !texts.length || Date.now() < offUntil) return null;
      try {
        const out = [];
        for (let i = 0; i < texts.length; i += BATCH) out.push(...await call(texts.slice(i, i + BATCH), kind, kind === "query" ? QUERY_TIMEOUT_MS : DOCUMENT_TIMEOUT_MS));
        return out;
      } catch (err) {
        // A slow query vector is just skipped; anything else rests the embedder.
        const slow = err && (err.name === "TimeoutError" || err.name === "AbortError");
        if (!(slow && kind === "query")) {
          offUntil = Date.now() + COOL_OFF_MS;
          // The message only: never the text that was being embedded.
          logger.warn("context: semantic vectors unavailable, using local vectors", { error: String(err && err.message ? err.message : err) });
        }
        return null;
      }
    },
  };
}

module.exports = { vertexEmbedder, enabled, MODEL, QUERY_TIMEOUT_MS, COOL_OFF_MS };
