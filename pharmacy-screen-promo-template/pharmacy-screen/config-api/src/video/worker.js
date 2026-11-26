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

/** render(job, onProgress) → {file, seconds}: the MP4 in the temp folder (removed by the caller once stored). */
function cloudRender({ launch = cloudLaunch(), ffmpegPath = require("ffmpeg-static"), tmp = os.tmpdir() } = {}) {
  return async (job, onProgress) => {
    const file = path.join(tmp, `video-${process.pid}-${Date.now()}.mp4`);
    try {
      const r = await renderVideo({ launch, url: job.pageUrl, orientation: job.orientation, out: file, ffmpegPath, onProgress });
      return { file, seconds: r.seconds };
    } catch (e) {
      removeFile(file);
      throw e;
    }
  };
}

const removeFile = (file) => { try { fs.unlinkSync(file); } catch { /* already gone */ } };

module.exports = { cloudRender, cloudLaunch, removeFile };
