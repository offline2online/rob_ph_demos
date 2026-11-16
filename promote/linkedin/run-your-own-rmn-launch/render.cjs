// Captures renderAt(t) frame by frame at 30 fps and encodes a LinkedIn-ready MP4 (H.264, yuv420p,
// 1080x1350, or 1080x1920 / 1920x1080 with the ratio argument 9x16 / 16x9; silent AAC track, faststart). Also writes a cover frame for the post thumbnail.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
(async () => {
  const [file, outMp4, coverPng, coverAt, ratio] = process.argv.slice(2);
  const W = ratio === '16x9' ? 1920 : 1080, H = ratio === '9x16' ? 1920 : ratio === '16x9' ? 1080 : 1350;
  const FPS = 30;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.resolve(file) + '?render' + (ratio ? '&ratio=' + ratio : ''));
  await page.evaluate(() => document.fonts.ready);
  const dur = await page.evaluate(() => window.DURATION);
  const frames = Math.round(dur * FPS);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-map', '0:v', '-map', '1:a', '-shortest',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outMp4], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))));
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.renderAt(t), i / FPS);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.log(`frame ${i}/${frames}`);
  }
  ff.stdin.end();
  await done;
  await page.evaluate((t) => window.renderAt(t), parseFloat(coverAt));
  await page.screenshot({ path: coverPng });
  await browser.close();
  console.log('done', outMp4, coverPng);
})().catch((e) => { console.error(e); process.exit(1); });
