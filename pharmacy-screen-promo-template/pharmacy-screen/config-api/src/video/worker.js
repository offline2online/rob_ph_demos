"use strict";

// The render step for a cloud worker (Firebase's pharmacyScreenVideoWorker, AWS's VideoWorker Lambda): Chromium
// from @sparticuz/chromium (a build made for serverless Linux), driven by playwright-core, and ffmpeg from
// ffmpeg-static. Locally and in the tests the same renderVideo() runs with the machine's own Chromium and ffmpeg.

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { renderVideo } = require("./render");

function cloudLaunch() {
  const chromium = require("@sparticuz/chromium");
  const { chromium: pw } = require("playwright-core");
  return async () => pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
}

/**
 * render(job, onProgress) → {file, seconds}: the MP4 in the temp folder (removed by the caller once stored).
 * Chromium and ffmpeg are loaded when a job renders, not when this is called: a package that fails to load then
 * fails inside runVideoJob(), which writes the failure on the job, instead of leaving it "queued" until the lease ends.
 */
function cloudRender({ launch, ffmpegPath, tmp = os.tmpdir() } = {}) {
  return async (job, onProgress) => {
    const file = path.join(tmp, `video-${process.pid}-${Date.now()}.mp4`);
    try {
      const r = await renderVideo({ launch: launch || cloudLaunch(), url: job.pageUrl, orientation: job.orientation, out: file, ffmpegPath: ffmpegPath || require("ffmpeg-static"), onProgress });
      return { file, seconds: r.seconds };
    } catch (e) {
      removeFile(file);
      throw e;
    }
  };
}

const removeFile = (file) => { try { fs.unlinkSync(file); } catch { /* already gone */ } };

module.exports = { cloudRender, cloudLaunch, removeFile };
