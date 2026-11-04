#!/usr/bin/env node
'use strict';

const { parseArgs } = require('node:util');
const path = require('node:path');
const { loadEnvFile, getConfig } = require('./config');
const { loadConsoleKeys } = require('./console-keys');
const { createStudio } = require('./studio');
const { FORMATS, STYLES } = require('./presets');

const HELP = `Media Studio — images and video for the website and blog.

  media-studio image "<prompt>" [options]     Nano Banana Pro
      --preset <name>       ${Object.keys(FORMATS).join(' | ')}
      --style <name>        ${Object.keys(STYLES).join(' | ')}
      --aspect <ratio>      1:1 2:3 3:2 3:4 4:3 4:5 5:4 9:16 16:9 21:9
      --size <1K|2K|4K>
      --ref <file|url|id>   reference image (repeatable, up to 14)
      --count <1-4>         variations
      --search              ground the image in Google Search (current facts)

  media-studio video "<prompt>" [options]     Veo 3.1 (default) or LTX 2.5
      --provider <id>       veo | veo-fast | ltx | ltx-fast
      --image <file|url|id> first frame (animate a still — a library id works)
      --last-frame <...>    last frame
      --ref <...>           Veo only: up to 3 "asset" references
      --duration <s>        Veo: 4 6 8 · LTX: e.g. 6 8 10, or "auto"
      --resolution <r>      720p 1080p 4k (LTX also 1440p or WxH)
      --aspect <16:9|9:16>
      --negative <text>     Veo: what to avoid
      --camera <motion>     LTX: static dolly_in dolly_out dolly_left dolly_right jib_up jib_down focus_shift
      --no-audio            LTX: silent clip (Veo always adds audio)
      --seed <n>

  Both: --preset, --style, --model <id>, --wordpress [--alt "..."] [--caption "..."], --json

  media-studio list [--kind image|video] [--limit n]
  media-studio publish <id> [--alt "..."] [--caption "..."]   upload to WordPress
  media-studio serve                                          API + web UI on http://127.0.0.1:8787
  media-studio check                                          which keys are set; tests the Gemini key
`;

const OPTIONS = {
  preset: { type: 'string' }, style: { type: 'string' }, aspect: { type: 'string' }, size: { type: 'string' },
  ref: { type: 'string', multiple: true }, count: { type: 'string' }, search: { type: 'boolean' },
  provider: { type: 'string' }, image: { type: 'string' }, 'last-frame': { type: 'string' }, duration: { type: 'string' },
  resolution: { type: 'string' }, negative: { type: 'string' }, camera: { type: 'string' }, 'no-audio': { type: 'boolean' },
  seed: { type: 'string' }, model: { type: 'string' }, wordpress: { type: 'boolean' }, alt: { type: 'string' },
  caption: { type: 'string' }, json: { type: 'boolean' }, kind: { type: 'string' }, limit: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

function toRequest(kind, prompt, v) {
  const req = {
    prompt, preset: v.preset, style: v.style, aspectRatio: v.aspect, model: v.model,
    references: v.ref, publish: v.wordpress ? 'wordpress' : undefined, altText: v.alt, caption: v.caption,
  };
  if (kind === 'image') Object.assign(req, { imageSize: v.size, count: v.count, groundWithSearch: v.search || undefined });
  else {
    Object.assign(req, {
      provider: v.provider, image: v.image, lastFrame: v['last-frame'], resolution: v.resolution, negativePrompt: v.negative,
      cameraMotion: v.camera, generateAudio: v['no-audio'] ? false : undefined, seed: v.seed,
      durationSeconds: v.duration === 'auto' ? 'auto' : v.duration ? Number(v.duration) : undefined,
    });
  }
  return Object.fromEntries(Object.entries(req).filter(([, x]) => x !== undefined));
}

async function main(argv) {
  const { values: v, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [cmd, ...rest] = positionals;
  if (!cmd || v.help) { process.stdout.write(HELP); return 0; }

  loadEnvFile();
  const fromConsole = await loadConsoleKeys();
  if (fromConsole.used && !v.json) {
    process.stderr.write(`· PH Agent Console: ${fromConsole.loaded.length ? `loaded ${fromConsole.loaded.join(', ')}` : 'no keys loaded'}\n`);
  }
  for (const p of fromConsole.problems) process.stderr.write(`! PH Agent Console: ${p}\n`);
  const config = getConfig();
  const studio = createStudio({ config, allowLocalPaths: true });
  const log = (m) => { if (!v.json) process.stderr.write(`· ${m}\n`); };

  if (cmd === 'image' || cmd === 'video') {
    const prompt = rest.join(' ').trim() || process.env.MEDIA_PROMPT || '';
    if (!prompt) throw Object.assign(new Error(`Give a prompt: media-studio ${cmd} "…"`), { status: 400 });
    const item = await studio.generate(cmd, toRequest(cmd, prompt, v), { onProgress: log });
    if (v.json) process.stdout.write(`${JSON.stringify(item, null, 2)}\n`);
    else {
      for (const f of item.files) process.stdout.write(`${path.join(config.outputDir, f.path)}\n`);
      for (const p of item.published || []) process.stdout.write(`WordPress: ${p.url}\n`);
      process.stderr.write(`· library id ${item.id} (${item.provider}, ${item.model})\n`);
    }
    return 0;
  }
  if (cmd === 'list') {
    const items = studio.library.list({ kind: v.kind, limit: Number(v.limit) || 30 });
    if (v.json) process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
    else for (const i of items) process.stdout.write(`${i.id}  ${i.createdAt.slice(0, 16).replace('T', ' ')}  ${i.kind.padEnd(5)}  ${i.provider.padEnd(11)}  ${i.prompt.slice(0, 70)}\n`);
    return 0;
  }
  if (cmd === 'publish') {
    const item = await studio.publish(rest[0], { altText: v.alt, caption: v.caption }, { onProgress: log });
    for (const p of item.published.slice(-item.files.length)) process.stdout.write(`${p.url}\n`);
    return 0;
  }
  if (cmd === 'serve') {
    const { listen } = require('./server');
    const server = await listen(config);
    const { address, port } = server.address();
    process.stderr.write(`Media Studio on http://${address.includes(':') ? `[${address}]` : address}:${port}  (output: ${config.outputDir})\n`);
    return null; // keep running
  }
  if (cmd === 'check') {
    const s = studio.status();
    for (const p of s.providers) process.stdout.write(`${p.configured ? '✓' : '✗'} ${p.label.padEnd(36)} ${s.models[p.id]}\n`);
    process.stdout.write(`${s.wordpress.configured ? '✓' : '✗'} WordPress upload${s.wordpress.site ? ` (${s.wordpress.site})` : ''}\n`);
    if (config.gemini.apiKey) {
      const resp = await fetch(`${config.gemini.baseUrl}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': config.gemini.apiKey } });
      if (!resp.ok) process.stdout.write(`✗ Gemini key rejected: HTTP ${resp.status}\n`);
      else {
        const names = ((await resp.json()).models || []).map((m) => m.name.replace('models/', ''));
        for (const m of [config.gemini.imageModel, config.gemini.veoModel, config.gemini.veoFastModel]) {
          process.stdout.write(`${names.includes(m) ? '✓' : '?'} ${m} ${names.includes(m) ? 'available to this key' : 'not listed for this key'}\n`);
        }
      }
    }
    return 0;
  }
  throw Object.assign(new Error(`Unknown command "${cmd}". Run with --help.`), { status: 400 });
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { if (code !== null) process.exitCode = code; }).catch((err) => {
    process.stderr.write(`✗ ${err.message}\n`);
    process.exitCode = err.status === 400 ? 2 : 1;
  });
}

module.exports = { main, toRequest };
