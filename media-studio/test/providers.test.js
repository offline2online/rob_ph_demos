'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStudio } = require('../src/studio');
const { resolveResolution } = require('../src/providers/ltx');
const { parseEnvFile } = require('../src/config');
const { basicAuth } = require('../src/wordpress');
const { PNG_1PX, tmpConfig, fakeFetch, imageResponse } = require('./helpers');

test('Nano Banana Pro: request shape, preset + style, skips thought parts, saves with sidecar', async () => {
  const config = tmpConfig();
  const fetch = fakeFetch([['POST', /gemini-3-pro-image-preview:generateContent$/, () => imageResponse()]]);
  const studio = createStudio({ config, fetch });
  const item = await studio.generate('image', { prompt: 'Shopper scanning a QR code on a menu board', preset: 'blog-hero', style: 'photo', references: [`data:image/png;base64,${PNG_1PX}`] });

  const req = fetch.calls[0];
  assert.equal(req.headers['x-goog-api-key'], 'g-key');
  const body = req.json();
  assert.deepEqual(body.generationConfig, { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' } });
  assert.match(body.contents[0].parts[0].text, /^Shopper scanning.*\n\nStyle: Photorealistic/s);
  assert.deepEqual(body.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: PNG_1PX } });

  assert.equal(item.files.length, 1);
  assert.equal(item.prompt, 'Shopper scanning a QR code on a menu board');
  assert.equal(item.text, 'Here you go');
  assert.match(item.files[0].path, /^\d{4}-\d{2}\/\d{4}-\d{2}-\d{2}-blog-hero-shopper-scanning-a-qr-code-on-[0-9a-f]{8}\.png$/);
  const saved = fs.readFileSync(path.join(config.outputDir, item.files[0].path));
  assert.deepEqual(saved, Buffer.from(PNG_1PX, 'base64'));
  assert.equal(studio.library.get(item.id).params.aspectRatio, '16:9');
  assert.equal(studio.library.get(item.id).params.referenceCount, 1);
});

test('Nano Banana Pro: count makes parallel calls; explicit settings beat the preset', async () => {
  const fetch = fakeFetch([['POST', /generateContent$/, () => imageResponse()]]);
  const studio = createStudio({ config: tmpConfig(), fetch });
  const item = await studio.generate('image', { prompt: 'x', preset: 'blog-hero', aspectRatio: '1:1', imageSize: '4k', count: 3 });
  assert.equal(fetch.calls.length, 3);
  assert.deepEqual(fetch.calls[0].json().generationConfig.imageConfig, { aspectRatio: '1:1', imageSize: '4K' });
  assert.equal(item.files.length, 3);
  assert.match(item.files[2].path, /-3\.png$/);
});

test('Nano Banana Pro: a blocked prompt and an API error surface clearly', async () => {
  const blocked = fakeFetch([['POST', /generateContent$/, () => ({ json: { promptFeedback: { blockReason: 'SAFETY' } } })]]);
  await assert.rejects(createStudio({ config: tmpConfig(), fetch: blocked }).generate('image', { prompt: 'x' }), /no image \(SAFETY\)/);
  const bad = fakeFetch([['POST', /generateContent$/, () => ({ status: 403, json: { error: { message: 'API key not valid' } } })]]);
  await assert.rejects(createStudio({ config: tmpConfig(), fetch: bad }).generate('image', { prompt: 'x' }), /HTTP 403: API key not valid/);
});

test('validation: bad aspect ratio, missing key, unknown preset', async () => {
  const studio = createStudio({ config: tmpConfig(), fetch: fakeFetch([]) });
  await assert.rejects(studio.generate('image', { prompt: 'x', aspectRatio: '7:3' }), /aspectRatio must be one of/);
  await assert.rejects(studio.generate('image', { prompt: 'x', preset: 'nope' }), /Unknown preset/);
  await assert.rejects(studio.generate('video', { prompt: 'x', aspectRatio: '1:1' }), /Veo aspectRatio/);
  await assert.rejects(studio.generate('video', { prompt: 'x', provider: 'nano-banana' }), /makes images, not videos/);
  const noKey = createStudio({ config: tmpConfig({ GEMINI_API_KEY: '' }), fetch: fakeFetch([]) });
  await assert.rejects(noKey.generate('image', { prompt: 'x' }), /set GEMINI_API_KEY/);
});

test('Veo: predictLongRunning, polls the operation, downloads with the key', async () => {
  let polls = 0;
  const fetch = fakeFetch([
    ['POST', /veo-3\.1-generate-preview:predictLongRunning$/, () => ({ json: { name: 'models/veo-3.1-generate-preview/operations/op1' } })],
    ['GET', /\/v1beta\/models\/veo-3\.1-generate-preview\/operations\/op1$/, () => (++polls < 2 ? { json: { name: 'op1', done: false } }
      : { json: { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://gemini.test/files/abc:download?alt=media' } }] } } } })],
    ['GET', /files\/abc:download/, (req) => { assert.equal(req.headers['x-goog-api-key'], 'g-key'); return { body: 'MP4BYTES' }; }],
  ]);
  const studio = createStudio({ config: tmpConfig(), fetch });
  const item = await studio.generate('video', { prompt: 'Slow push-in on a digital menu board', preset: 'blog-hero', durationSeconds: 8, negativePrompt: 'text' });
  assert.deepEqual(fetch.calls[0].json(), {
    instances: [{ prompt: 'Slow push-in on a digital menu board' }],
    parameters: { aspectRatio: '16:9', resolution: '1080p', durationSeconds: 8, negativePrompt: 'text' },
  });
  assert.equal(polls, 2);
  assert.equal(fs.readFileSync(path.join(studio.library.outputDir, item.files[0].path), 'utf8'), 'MP4BYTES');
  assert.equal(item.provider, 'veo');
});

test('Veo: animates a library still; retries with the other image encoding if rejected', async () => {
  const config = tmpConfig();
  const imgFetch = fakeFetch([['POST', /generateContent$/, () => imageResponse()]]);
  const still = await createStudio({ config, fetch: imgFetch }).generate('image', { prompt: 'still' });

  const bodies = [];
  const fetch = fakeFetch([
    ['POST', /veo-3\.1-fast-generate-preview:predictLongRunning$/, (req) => {
      bodies.push(req.json());
      return bodies.length === 1
        ? { status: 400, json: { error: { message: 'Invalid JSON payload received. Unknown name "bytesBase64Encoded" at instances[0].image' } } }
        : { json: { name: 'op2', done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://gemini.test/v.mp4' } }] } } } };
    }],
    ['GET', /v\.mp4$/, () => ({ body: 'V' })],
  ]);
  const item = await createStudio({ config, fetch }).generate('video', { prompt: 'make it move', provider: 'veo-fast', image: still.id });
  assert.deepEqual(bodies[0].instances[0].image, { bytesBase64Encoded: PNG_1PX, mimeType: 'image/png' });
  assert.deepEqual(bodies[1].instances[0].image, { inlineData: { mimeType: 'image/png', data: PNG_1PX } });
  assert.deepEqual(item.source, { animatedFrom: still.id });
  assert.equal(item.params.firstFrame, true);
});

test('Veo: a safety-filtered result explains why', async () => {
  const fetch = fakeFetch([['POST', /predictLongRunning$/, () => ({ json: { name: 'op', done: true, response: { generateVideoResponse: { raiMediaFilteredReasons: ['celebrity likeness'] } } } })]]);
  await assert.rejects(createStudio({ config: tmpConfig(), fetch }).generate('video', { prompt: 'x' }), /filtered: celebrity likeness/);
});

test('LTX: text-to-video and image-to-video contract, polling, download', async () => {
  let n = 0;
  const fetch = fakeFetch([
    ['POST', /ltx\.test\/v2\/image-to-video$/, (req) => { assert.equal(req.headers.Authorization, 'Bearer l-key'); return { status: 202, json: { id: 'j1', status: 'pending' } }; }],
    ['GET', /ltx\.test\/v2\/image-to-video\/j1$/, () => (++n < 2 ? { json: { status: 'processing' } } : { json: { status: 'completed', result: { video_url: 'https://cdn.ltx.test/out.mp4' } } })],
    ['GET', /cdn\.ltx\.test\/out\.mp4$/, (req) => { assert.equal(req.headers.Authorization, undefined); return { body: 'LTXV' }; }],
  ]);
  const studio = createStudio({ config: tmpConfig(), fetch });
  const item = await studio.generate('video', {
    prompt: 'Product turns slowly', provider: 'ltx', preset: 'story', image: `data:image/png;base64,${PNG_1PX}`, durationSeconds: 8, cameraMotion: 'dolly_in', generateAudio: false,
  });
  assert.deepEqual(fetch.calls[0].json(), {
    model: 'ltx-2-5-pro', prompt: 'Product turns slowly', duration: 8, resolution: '1080x1920', generate_audio: false,
    camera_motion: 'dolly_in', image_uri: `data:image/png;base64,${PNG_1PX}`,
  });
  assert.equal(item.model, 'ltx-2-5-pro');
  assert.equal(fs.readFileSync(path.join(studio.library.outputDir, item.files[0].path), 'utf8'), 'LTXV');

  const t2v = fakeFetch([
    ['POST', /v2\/text-to-video$/, () => ({ json: { id: 'j2' } })],
    ['GET', /v2\/text-to-video\/j2$/, () => ({ json: { status: 'failed', error: { message: 'insufficient balance' } } })],
  ]);
  await assert.rejects(createStudio({ config: tmpConfig(), fetch: t2v }).generate('video', { prompt: 'x', provider: 'ltx-fast' }), /LTX failed: insufficient balance/);
  assert.equal(t2v.calls[0].json().model, 'ltx-2-5-fast');
  assert.equal(t2v.calls[0].json().duration, 6);
});

test('LTX resolution mapping', () => {
  assert.equal(resolveResolution('4k', '16:9'), '3840x2160');
  assert.equal(resolveResolution('720p', '9:16'), '720x1280');
  assert.equal(resolveResolution('2560x1440'), '2560x1440');
  assert.throws(() => resolveResolution('8k', '16:9'), /resolution must be one of/);
});

test('WordPress publish uploads bytes then sets alt text, and records it on the item', async () => {
  const config = tmpConfig({ WP_SITE_URL: 'https://wp.test/', WP_AUTH: 'rob:abcd efgh ijkl' });
  const fetch = fakeFetch([
    ['POST', /generateContent$/, () => imageResponse()],
    ['POST', /wp\.test\/wp-json\/wp\/v2\/media$/, (req) => {
      assert.equal(req.headers.Authorization, `Basic ${Buffer.from('rob:abcdefghijkl').toString('base64')}`);
      assert.match(req.headers['Content-Disposition'], /filename=".*\.png"/);
      assert.ok(Buffer.isBuffer(req.body));
      return { status: 201, json: { id: 42, source_url: 'https://wp.test/up/a.png', link: 'https://wp.test/?p=42' } };
    }],
    ['POST', /wp\/v2\/media\/42$/, (req) => ({ json: { id: 42, source_url: 'https://wp.test/up/a.png', link: 'https://wp.test/?p=42', alt_text: req.json().alt_text } })],
  ]);
  const studio = createStudio({ config, fetch });
  const item = await studio.generate('image', { prompt: 'hero', publish: 'wordpress', altText: 'A shopper at a screen' });
  assert.equal(item.published[0].url, 'https://wp.test/up/a.png');
  assert.equal(fetch.calls[2].json().alt_text, 'A shopper at a screen');
  assert.equal(studio.library.get(item.id).published[0].id, 42);
});

test('helpers: .env parsing and basic auth', () => {
  assert.deepEqual(parseEnvFile('# c\nA=1\nexport B="two words"\n\nC=\'x=y\''), { A: '1', B: 'two words', C: 'x=y' });
  assert.equal(basicAuth('cm9iOnB3'), 'cm9iOnB3');
});
