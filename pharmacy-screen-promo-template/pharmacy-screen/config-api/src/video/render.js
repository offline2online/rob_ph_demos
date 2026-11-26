"use strict";

// Renders one loop of a promotion to the signage MP4 (format.js): the real screen page (pharmacy-screen.html with
// capture=1, so its own player.js and js/render.js draw every frame) in headless Chromium, stepped 40 ms at a time
// under clock.js, each frame captured and piped into ffmpeg. Framework-neutral: the caller passes how to start
// Chromium (Playwright's chromium.launch with the platform's binary) and where ffmpeg is.

const { spawn } = require("node:child_process");
const { CLOCK_SCRIPT } = require("./clock");
const { FPS, MAX_SECONDS, sizeOf, ffmpegArgs, frameCount } = require("./format");

/** A failure the person clicking Download MP4 can act on: `message` is shown as it is. */
class VideoError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function startFfmpeg(ffmpegPath, args) {
  const ff = spawn(ffmpegPath, args, { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  ff.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
  ff.stdin.on("error", () => {}); // ffmpeg exiting early is reported by its exit code below
  const done = new Promise((resolve, reject) => {
    ff.on("error", (e) => reject(new Error(`ffmpeg could not start: ${e.message}`)));
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${err.trim()}`))));
  });
  const write = (buf) => new Promise((resolve) => { if (ff.stdin.write(buf)) resolve(); else ff.stdin.once("drain", resolve); });
  return { write, end: () => ff.stdin.end(), kill: () => ff.kill("SIGKILL"), done };
}

/**
 * opts: {
 *   launch: () => Promise<Browser>  (Playwright),
 *   url: the screen page URL with device, promo, orientation and capture=1,
 *   orientation: "portrait" | "landscape",
 *   out: path of the MP4 to write,
 *   ffmpegPath: default "ffmpeg",
 *   maxSeconds: default MAX_SECONDS,
 *   loadTimeoutMs: how long the screen may take to draw its first scene (default 60 s),
 *   onProgress(fraction 0..1), optional; may return a promise (it is awaited every 25 frames),
 * }
 * Returns { seconds, frames }.
 */
async function renderVideo(opts) {
  const { w, h } = sizeOf(opts.orientation);
  const maxSeconds = opts.maxSeconds || MAX_SECONDS;
  const browser = await opts.launch();
  let ff = null;
  try {
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: "no-preference", serviceWorkers: "block" });
    await context.addInitScript({ content: CLOCK_SCRIPT });
    const page = await context.newPage();
    await page.goto(opts.url, { waitUntil: "load", timeout: opts.loadTimeoutMs || 60000 });
    try {
      await page.waitForFunction(() => window.pharmacyScreen && window.pharmacyScreen.ready, null, { timeout: opts.loadTimeoutMs || 60000, polling: 100 });
    } catch (e) {
      throw new VideoError("screen-timeout", "The screen did not finish loading, so no video was made. Try again in a minute.");
    }
    await page.evaluate(() => Promise.all([window.pharmacyScreen.settled(), document.fonts.ready]));
    // A message instead of a promotion (store not set up, no data): say what the screen says.
    const msg = await page.evaluate(() => {
      if (window.pharmacyScreen.info) return null;
      // Its heading and lines, without the icon's ligature text ("tv_off").
      const lines = [...document.querySelectorAll("#screen h1, #screen h2, #screen h3, #screen p")].map((e) => e.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
      return lines.length ? lines.join(". ").replace(/\.\./g, ".") : "nothing";
    });
    if (msg !== null) throw new VideoError("screen-message", `The screen shows a message instead of the promotion: "${msg.slice(0, 200)}"`);
    const seconds = await page.evaluate(() => { window.__psClock.freeze(); const s = window.pharmacyScreen.capture(); window.__psClock.sync(); return s; });
    if (!seconds) throw new VideoError("nothing-to-play", "The screen has nothing to play for this promotion.");
    if (seconds > maxSeconds) throw new VideoError("too-long", `This promotion runs ${seconds} seconds; a video can be at most ${maxSeconds} seconds. Shorten its scenes and try again.`);
    const frames = frameCount(seconds);
    const cdp = await context.newCDPSession(page);
    ff = startFfmpeg(opts.ffmpegPath || "ffmpeg", ffmpegArgs(opts.orientation, opts.out));
    for (let i = 0; i < frames; i++) {
      await page.evaluate((ms) => window.__psClock.advance(ms), i === 0 ? 0 : 1000 / FPS);
      const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
      await ff.write(Buffer.from(shot.data, "base64"));
      if (opts.onProgress && (i % FPS === FPS - 1 || i === frames - 1)) await opts.onProgress((i + 1) / frames);
    }
    ff.end();
    await ff.done;
    ff = null;
    return { seconds, frames };
  } finally {
    if (ff) ff.kill();
    await browser.close().catch(() => {});
  }
}

module.exports = { renderVideo, VideoError };
