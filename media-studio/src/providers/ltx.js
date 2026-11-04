'use strict';
// LTX 2.5 (Lightricks), https://docs.ltx.io — the same async contract the
// menu-board prototype's generateProductVideo has used since Aug 2026:
//   POST {base}/v2/text-to-video  | /v2/image-to-video   (Bearer key)
//        { model, prompt, duration, resolution, generate_audio,
//          camera_motion?, fps?, image_uri?, last_frame_uri? }
//     -> 202 { id }
//   GET  {base}/v2/{endpoint}/{id}
//     -> { status: pending|processing|completed|failed, result?: { video_url }, error? }
// image_uri / last_frame_uri take an inline data: URI (≤ ~7 MB) or an https URL.
// Models: ltx-2-5-pro (best quality, up to 1080p) and ltx-2-5-fast (cheaper,
// up to 4K). The provider's video_url is temporary, so we download it at once.

const { ProviderError, sleep, errorFromResponse, download } = require('./common');

const CAMERA_MOTIONS = ['static', 'dolly_in', 'dolly_out', 'dolly_left', 'dolly_right', 'jib_up', 'jib_down', 'focus_shift'];
const RES_BY_ASPECT = {
  '16:9': { '720p': '1280x720', '1080p': '1920x1080', '1440p': '2560x1440', '4k': '3840x2160' },
  '9:16': { '720p': '720x1280', '1080p': '1080x1920', '1440p': '1440x2560', '4k': '2160x3840' },
};

// Accept either an explicit WxH ("1920x1080") or a named tier + aspect ratio.
function resolveResolution(resolution, aspectRatio) {
  const r = String(resolution || '1080p').toLowerCase();
  if (/^\d+x\d+$/.test(r)) return r;
  const table = RES_BY_ASPECT[aspectRatio || '16:9'];
  if (!table) throw new ProviderError('LTX aspectRatio must be 16:9 or 9:16', { status: 400 });
  if (!table[r]) throw new ProviderError(`LTX resolution must be one of ${Object.keys(table).join(', ')} or WIDTHxHEIGHT`, { status: 400 });
  return table[r];
}

const toDataUri = (img) => (img.url ? img.url : `data:${img.mimeType};base64,${img.data}`);

function buildRequest(input, config) {
  const body = {
    model: input.model || (input.fast ? config.ltx.fastModel : config.ltx.model),
    prompt: String(input.prompt).trim(),
    // LTX requires the field; null means "let the model choose".
    duration: input.durationSeconds == null || input.durationSeconds === '' ? 6 : Number(input.durationSeconds),
    resolution: resolveResolution(input.resolution, input.aspectRatio),
    generate_audio: input.generateAudio !== false,
  };
  if (input.durationSeconds === 'auto') body.duration = null;
  if (input.cameraMotion) body.camera_motion = input.cameraMotion;
  if (input.fps) body.fps = Number(input.fps);
  if (input.image) body.image_uri = toDataUri(input.image);
  if (input.lastFrame) body.last_frame_uri = toDataUri(input.lastFrame);
  return body;
}

function validate(input) {
  if (!input.prompt || !String(input.prompt).trim()) throw new ProviderError('prompt is required', { status: 400 });
  if (input.cameraMotion && !CAMERA_MOTIONS.includes(input.cameraMotion)) {
    throw new ProviderError(`cameraMotion must be one of ${CAMERA_MOTIONS.join(', ')}`, { status: 400 });
  }
  if (input.lastFrame && !input.image) throw new ProviderError('LTX needs a first frame (image) to use a last frame', { status: 400 });
  resolveResolution(input.resolution, input.aspectRatio);
}

function makeLtx({ id, label, fast }) {
  return {
    id,
    label,
    kind: 'video',
    CAMERA_MOTIONS,
    isConfigured: (config) => Boolean(config.ltx.apiKey),
    validate,
    buildRequest: (input, config) => buildRequest({ ...input, fast }, config),
    async generate(input, { config, fetch: fetchImpl, onProgress = () => {}, signal }) {
      validate(input);
      const { apiKey, baseUrl } = config.ltx;
      const endpoint = input.image ? 'image-to-video' : 'text-to-video';
      const body = buildRequest({ ...input, fast }, config);
      const auth = { Authorization: `Bearer ${apiKey}` };
      const resp = await fetchImpl(`${baseUrl}/v2/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(body),
      });
      if (!resp.ok) throw await errorFromResponse(resp, 'LTX');
      let job = await resp.json();
      const jobId = job?.id;
      if (!jobId) throw new ProviderError('LTX did not return a job id', { status: 502, provider: 'LTX' });
      onProgress(`LTX job ${jobId} started (${body.model}, ${body.resolution})`);

      const interval = config.pollIntervalMs || 4000;
      const started = Date.now();
      while (job?.status !== 'completed' && job?.status !== 'failed') {
        if (Date.now() - started > config.maxWaitMs) throw new ProviderError('LTX did not finish in time', { status: 504, provider: 'LTX' });
        await sleep(interval, signal);
        const poll = await fetchImpl(`${baseUrl}/v2/${endpoint}/${encodeURIComponent(jobId)}`, { headers: auth });
        if (!poll.ok) throw await errorFromResponse(poll, 'LTX');
        job = await poll.json();
        onProgress(`LTX ${job?.status || 'working'}… ${Math.round((Date.now() - started) / 1000)}s`);
      }
      if (job.status === 'failed') {
        const msg = job?.error?.message || (typeof job?.error === 'string' ? job.error : 'generation failed');
        throw new ProviderError(`LTX failed: ${msg}`, { status: 502, provider: 'LTX' });
      }
      const videoUrl = job?.result?.video_url || job?.video_url;
      if (!videoUrl) throw new ProviderError('LTX finished without a video_url', { status: 502, provider: 'LTX' });
      onProgress('Downloading video');
      // The result URL is pre-signed; sending our key to a CDN host is unnecessary.
      const file = await download(fetchImpl, videoUrl, {}, 'LTX');
      return { model: body.model, files: [file] };
    },
  };
}

module.exports = {
  ltx: makeLtx({ id: 'ltx', label: 'LTX 2.5 Pro', fast: false }),
  ltxFast: makeLtx({ id: 'ltx-fast', label: 'LTX 2.5 Fast', fast: true }),
  resolveResolution,
  CAMERA_MOTIONS,
};
