'use strict';
// Veo 3.1 — Google's video model, via the Gemini API (same AI Studio key as
// Nano Banana Pro). Long-running:
//   POST {base}/v1beta/models/{model}:predictLongRunning
//        { instances:[{ prompt, image?, lastFrame?, referenceImages? }],
//          parameters:{ aspectRatio, resolution, durationSeconds, negativePrompt, ... } }
//     -> { name: "models/.../operations/..." }
//   GET  {base}/v1beta/{name}   until { done: true }
//     -> response.generateVideoResponse.generatedSamples[0].video.uri
//   GET  {uri} with the API key -> the MP4 (Google keeps it ~2 days; we save it).
// Veo 3.x generates synchronised audio with every clip.
//
// The API has accepted two encodings for an input image over time
// ({bytesBase64Encoded, mimeType} and {inlineData:{mimeType,data}}). We send
// the first and, if the API rejects the field, retry once with the other —
// so a schema change on Google's side costs one extra request, not an outage.

const { ProviderError, sleep, errorFromResponse, download } = require('./common');

const ASPECT_RATIOS = ['16:9', '9:16'];
const RESOLUTIONS = ['720p', '1080p', '4k'];
const DURATIONS = [4, 6, 8];
const ENCODINGS = ['bytesBase64Encoded', 'inlineData'];

function encodeImage(img, encoding) {
  return encoding === 'inlineData'
    ? { inlineData: { mimeType: img.mimeType, data: img.data } }
    : { bytesBase64Encoded: img.data, mimeType: img.mimeType };
}

function validate(input) {
  if (!input.prompt || !String(input.prompt).trim()) throw new ProviderError('prompt is required', { status: 400 });
  if (input.aspectRatio && !ASPECT_RATIOS.includes(input.aspectRatio)) {
    throw new ProviderError(`Veo aspectRatio must be ${ASPECT_RATIOS.join(' or ')}`, { status: 400 });
  }
  if (input.resolution && !RESOLUTIONS.includes(String(input.resolution).toLowerCase())) {
    throw new ProviderError(`Veo resolution must be one of ${RESOLUTIONS.join(', ')}`, { status: 400 });
  }
  if (input.durationSeconds != null && !DURATIONS.includes(Number(input.durationSeconds))) {
    throw new ProviderError(`Veo durationSeconds must be one of ${DURATIONS.join(', ')}`, { status: 400 });
  }
  if ((input.references || []).length > 3) throw new ProviderError('Veo takes at most 3 reference images', { status: 400 });
}

function buildRequest(input, encoding = ENCODINGS[0]) {
  const instance = { prompt: String(input.prompt).trim() };
  if (input.image) instance.image = encodeImage(input.image, encoding);
  if (input.lastFrame) instance.lastFrame = encodeImage(input.lastFrame, encoding);
  if (input.references?.length) {
    instance.referenceImages = input.references.map((r) => ({ image: encodeImage(r, encoding), referenceType: 'asset' }));
  }
  const parameters = {};
  if (input.aspectRatio) parameters.aspectRatio = input.aspectRatio;
  if (input.resolution) parameters.resolution = String(input.resolution).toLowerCase();
  if (input.durationSeconds != null) parameters.durationSeconds = Number(input.durationSeconds);
  if (input.negativePrompt) parameters.negativePrompt = input.negativePrompt;
  if (input.personGeneration) parameters.personGeneration = input.personGeneration;
  if (input.seed != null && input.seed !== '') parameters.seed = Number(input.seed);
  return { instances: [instance], parameters };
}

const hasImages = (input) => Boolean(input.image || input.lastFrame || input.references?.length);
const looksLikeEncodingError = (err) => err.status === 400
  && /inlineData|bytesBase64Encoded|Unknown name|Invalid JSON payload|not supported for this model/i.test(err.message + (err.details || ''));

function makeVeo({ id, label, fast }) {
  return {
    id,
    label,
    kind: 'video',
    ASPECT_RATIOS,
    RESOLUTIONS,
    DURATIONS,
    isConfigured: (config) => Boolean(config.gemini.apiKey),
    validate,
    buildRequest,
    async generate(input, { config, fetch: fetchImpl, onProgress = () => {}, signal }) {
      validate(input);
      const { apiKey, baseUrl } = config.gemini;
      const model = input.model || (fast ? config.gemini.veoFastModel : config.gemini.veoModel);
      const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
      const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:predictLongRunning`;

      let op;
      for (const encoding of hasImages(input) ? ENCODINGS : ENCODINGS.slice(0, 1)) {
        const resp = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(buildRequest(input, encoding)) });
        if (resp.ok) { op = await resp.json(); break; }
        const err = await errorFromResponse(resp, 'Veo');
        if (encoding === ENCODINGS[ENCODINGS.length - 1] || !hasImages(input) || !looksLikeEncodingError(err)) throw err;
        onProgress(`Veo rejected the ${encoding} image encoding, retrying with the alternative`);
      }
      if (!op?.name) throw new ProviderError('Veo did not return an operation name', { status: 502, provider: 'Veo' });
      const opName = op.name; // poll the name we were given, whatever later polls echo back
      onProgress(`Veo job started (${model})`);

      const interval = config.pollIntervalMs || 10000;
      const started = Date.now();
      while (!op.done) {
        if (Date.now() - started > config.maxWaitMs) throw new ProviderError('Veo did not finish in time', { status: 504, provider: 'Veo' });
        await sleep(interval, signal);
        const poll = await fetchImpl(`${baseUrl}/v1beta/${opName}`, { headers: { 'x-goog-api-key': apiKey } });
        if (!poll.ok) throw await errorFromResponse(poll, 'Veo');
        op = await poll.json();
        onProgress(`Veo rendering… ${Math.round((Date.now() - started) / 1000)}s`);
      }
      if (op.error) throw new ProviderError(`Veo failed: ${op.error.message || JSON.stringify(op.error)}`, { status: 502, provider: 'Veo' });

      const res = op.response?.generateVideoResponse || op.response || {};
      const samples = res.generatedSamples || res.generatedVideos || [];
      const uri = samples[0]?.video?.uri;
      if (!uri) {
        const why = (res.raiMediaFilteredReasons || []).join('; ');
        throw new ProviderError(`Veo returned no video${why ? ` (filtered: ${why})` : ''}`, { status: 422, provider: 'Veo' });
      }
      onProgress('Downloading video');
      const file = await download(fetchImpl, uri, { 'x-goog-api-key': apiKey }, 'Veo');
      return { model, files: [file] };
    },
  };
}

module.exports = {
  veo: makeVeo({ id: 'veo', label: 'Veo 3.1', fast: false }),
  veoFast: makeVeo({ id: 'veo-fast', label: 'Veo 3.1 Fast', fast: true }),
  encodeImage,
};
