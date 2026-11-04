'use strict';
// Nano Banana Pro — Gemini 3 Pro Image, via the Gemini API (AI Studio key).
//   POST {base}/v1beta/models/{model}:generateContent
//   { contents:[{parts:[{text}, {inlineData:{mimeType,data}}...]}],
//     generationConfig:{ responseModalities:["TEXT","IMAGE"],
//                        imageConfig:{ aspectRatio, imageSize } } }
// The response carries the image(s) as base64 inlineData parts. Parts flagged
// `thought: true` are the model's interim drafts and are skipped.
// Reference images (product shots, logos, a style to match) go in as extra
// inlineData parts; the model takes up to 14.

const { ProviderError, errorFromResponse } = require('./common');

const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const IMAGE_SIZES = ['1K', '2K', '4K'];
const MAX_REFERENCES = 14;

function validate(input) {
  if (!input.prompt || !String(input.prompt).trim()) throw new ProviderError('prompt is required', { status: 400 });
  if (input.aspectRatio && !ASPECT_RATIOS.includes(input.aspectRatio)) {
    throw new ProviderError(`aspectRatio must be one of ${ASPECT_RATIOS.join(', ')}`, { status: 400 });
  }
  if (input.imageSize && !IMAGE_SIZES.includes(String(input.imageSize).toUpperCase())) {
    throw new ProviderError(`imageSize must be one of ${IMAGE_SIZES.join(', ')}`, { status: 400 });
  }
  if ((input.references || []).length > MAX_REFERENCES) {
    throw new ProviderError(`at most ${MAX_REFERENCES} reference images`, { status: 400 });
  }
}

function buildRequest(input) {
  const parts = [{ text: String(input.prompt).trim() }];
  for (const ref of input.references || []) parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
  const imageConfig = {};
  if (input.aspectRatio) imageConfig.aspectRatio = input.aspectRatio;
  if (input.imageSize) imageConfig.imageSize = String(input.imageSize).toUpperCase();
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig },
  };
  if (input.groundWithSearch) body.tools = [{ googleSearch: {} }];
  return body;
}

async function generateOne(input, { config, fetch: fetchImpl }) {
  const { apiKey, baseUrl } = config.gemini;
  const model = input.model || config.gemini.imageModel;
  const resp = await fetchImpl(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(buildRequest(input)),
  });
  if (!resp.ok) throw await errorFromResponse(resp, 'Nano Banana Pro');
  const data = await resp.json();
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const images = parts.filter((p) => p.inlineData?.data && !p.thought);
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('\n').trim();
  if (!images.length) {
    const reason = data?.promptFeedback?.blockReason || candidate?.finishReason || 'no image returned';
    throw new ProviderError(`Nano Banana Pro returned no image (${reason})${text ? `: ${text.slice(0, 300)}` : ''}`, {
      status: 422, provider: 'Nano Banana Pro',
    });
  }
  return {
    model,
    text,
    files: images.map((p) => ({ buffer: Buffer.from(p.inlineData.data, 'base64'), mimeType: p.inlineData.mimeType || 'image/png' })),
  };
}

module.exports = {
  id: 'nano-banana',
  label: 'Nano Banana Pro (Gemini 3 Pro Image)',
  kind: 'image',
  ASPECT_RATIOS,
  IMAGE_SIZES,
  MAX_REFERENCES,
  isConfigured: (config) => Boolean(config.gemini.apiKey),
  validate,
  buildRequest,
  async generate(input, ctx) {
    validate(input);
    const count = Math.min(4, Math.max(1, parseInt(input.count, 10) || 1));
    // One call returns one image; variations are separate calls in parallel.
    const results = await Promise.all(Array.from({ length: count }, () => generateOne(input, ctx)));
    return {
      model: results[0].model,
      text: results.map((r) => r.text).filter(Boolean).join('\n\n'),
      files: results.flatMap((r) => r.files),
    };
  },
};
