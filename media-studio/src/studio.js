'use strict';
// The one entry point the CLI, the HTTP API and the workflow all share:
// normalise the request, apply a preset/style, resolve any input images,
// call the provider, save to the library, optionally publish to WordPress.

const fs = require('node:fs');
const path = require('node:path');
const { getProvider, PROVIDERS } = require('./providers');
const { applyPreset } = require('./presets');
const { createLibrary } = require('./library');
const wordpress = require('./wordpress');

const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function createStudio({ config, fetch: fetchImpl = globalThis.fetch, allowLocalPaths = false } = {}) {
  const library = createLibrary(config.outputDir);

  // An input image may be: a data: URL, {mimeType,data}, an https URL, the id
  // of something already in the library (e.g. animate a still you just made),
  // or — from the CLI only — a path on disk.
  async function resolveImage(spec) {
    if (spec == null || spec === '') return null;
    if (typeof spec === 'object') {
      if (spec.data && spec.mimeType) return { mimeType: spec.mimeType, data: spec.data };
      if (spec.dataUrl) return resolveImage(spec.dataUrl);
      if (spec.libraryId) return resolveImage(spec.libraryId);
      if (spec.url) return resolveImage(spec.url);
      throw badRequest('image must be a data URL, {mimeType,data}, {libraryId} or {url}');
    }
    const s = String(spec).trim();
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(s);
    if (m) return { mimeType: m[1], data: m[2] };
    if (/^https:\/\//i.test(s)) {
      const resp = await fetchImpl(s);
      if (!resp.ok) throw badRequest(`Could not fetch image ${s}: HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES) throw badRequest('image is larger than 20 MB');
      return { mimeType: (resp.headers.get('content-type') || 'image/png').split(';')[0], data: buf.toString('base64'), url: s };
    }
    if (/^[0-9a-f]{8}$/.test(s)) {
      const item = library.get(s);
      if (!item) throw badRequest(`No library item ${s}`);
      const file = item.files.find((f) => f.mimeType.startsWith('image/'));
      if (!file) throw badRequest(`Library item ${s} is not an image`);
      return { mimeType: file.mimeType, data: fs.readFileSync(library.resolveFile(file.path)).toString('base64') };
    }
    if (allowLocalPaths) {
      const full = path.resolve(s);
      const mimeType = MIME_BY_EXT[path.extname(full).toLowerCase()];
      if (!mimeType) throw badRequest(`Unsupported image type: ${s}`);
      return { mimeType, data: fs.readFileSync(full).toString('base64') };
    }
    throw badRequest('image must be a data URL, an https URL or a library id');
  }

  async function prepare(kind, raw) {
    const input = applyPreset(kind, raw || {});
    if (!input.prompt) throw badRequest('prompt is required');
    const provider = getProvider(input.provider, kind);
    if (!provider.isConfigured(config)) {
      throw badRequest(`${provider.label} has no API key — set ${provider.id.startsWith('ltx') ? 'LTX_API_KEY' : 'GEMINI_API_KEY'}`);
    }
    const refs = [].concat(input.references || []).filter(Boolean);
    input.references = await Promise.all(refs.map(resolveImage));
    input.image = await resolveImage(input.image);
    input.lastFrame = await resolveImage(input.lastFrame);
    provider.validate(input);
    return { input, provider, sources: { image: typeof raw?.image === 'string' && /^[0-9a-f]{8}$/.test(raw.image) ? raw.image : undefined } };
  }

  // Only plain, reproducible settings go in the sidecar — never image bytes.
  function recordedParams(input) {
    const keep = ['preset', 'style', 'aspectRatio', 'imageSize', 'count', 'resolution', 'durationSeconds', 'negativePrompt',
      'generateAudio', 'cameraMotion', 'fps', 'seed', 'personGeneration', 'groundWithSearch', 'model'];
    const out = {};
    for (const k of keep) if (input[k] != null && input[k] !== '') out[k] = input[k];
    if (input.references?.length) out.referenceCount = input.references.length;
    if (input.image) out.firstFrame = true;
    if (input.lastFrame) out.lastFrame = true;
    return out;
  }

  async function generate(kind, raw, { onProgress = () => {}, signal } = {}) {
    const { input, provider, sources } = await prepare(kind, raw);
    onProgress(`Sending to ${provider.label}`);
    const result = await provider.generate(input, { config, fetch: fetchImpl, onProgress, signal });
    let item = library.save({
      kind,
      provider: provider.id,
      model: result.model,
      prompt: input.prompt,
      originalPrompt: input.originalPrompt,
      params: recordedParams(input),
      text: result.text,
      files: result.files,
      source: sources.image ? { animatedFrom: sources.image } : undefined,
    });
    onProgress(`Saved ${item.files.map((f) => f.path).join(', ')}`);
    if (raw?.publish === 'wordpress' || raw?.publish === true) {
      item = await publish(item.id, { altText: raw.altText, caption: raw.caption, title: raw.title }, { onProgress });
    }
    return item;
  }

  async function publish(id, { altText, caption, title } = {}, { onProgress = () => {} } = {}) {
    const item = library.get(id);
    if (!item) throw badRequest(`No library item ${id}`);
    const published = [...(item.published || [])];
    for (const f of item.files) {
      onProgress(`Uploading ${path.basename(f.path)} to WordPress`);
      published.push(await wordpress.uploadToWordPress({
        config, fetch: fetchImpl,
        buffer: fs.readFileSync(library.resolveFile(f.path)),
        filename: path.basename(f.path),
        mimeType: f.mimeType,
        title: title || item.prompt.slice(0, 80),
        altText: altText || (item.kind === 'image' ? item.prompt.slice(0, 200) : undefined),
        caption,
      }));
    }
    return library.update(item, { published });
  }

  function status() {
    return {
      providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, kind: p.kind, configured: p.isConfigured(config) })),
      wordpress: { configured: wordpress.isConfigured(config), site: config.wordpress.siteUrl || null },
      models: {
        'nano-banana': config.gemini.imageModel,
        veo: config.gemini.veoModel,
        'veo-fast': config.gemini.veoFastModel,
        ltx: config.ltx.model,
        'ltx-fast': config.ltx.fastModel,
      },
    };
  }

  return { library, generate, publish, prepare, resolveImage, status };
}

module.exports = { createStudio };
