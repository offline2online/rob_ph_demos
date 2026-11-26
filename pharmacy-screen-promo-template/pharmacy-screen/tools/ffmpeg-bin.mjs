// Where the local stack and its tests find ffmpeg and ffprobe for Download MP4 (admin/tools/dev-server.mjs,
// test/e2e/video.test.mjs, admin/test/editor.e2e.mjs). In order:
//   1. FFMPEG_PATH / FFPROBE_PATH, when set;
//   2. ffmpeg / ffprobe on the PATH (a developer's own install, apt-get install ffmpeg);
//   3. the static builds from npm (ffmpeg-static, ffprobe-static) in tools/.ffmpeg/, put there by
//      `node tools/ffmpeg-bin.mjs --ensure`, which `npm run test:e2e` runs first. That is how the CI runner gets them:
//      its workflow installs only Playwright's Chromium, and Playwright's own ffmpeg cannot encode H.264.
// Nothing found is a plain error at once ("ffmpeg/ffprobe not found: …"), never a render left at 0% until it times out.
//
//   node tools/ffmpeg-bin.mjs            print what it finds, exit 1 if nothing
//   node tools/ffmpeg-bin.mjs --ensure   the same, installing the npm builds into tools/.ffmpeg/ when nothing is found
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LOCAL_DIR = path.join(HERE, '.ffmpeg');
// Pinned, as the cloud workers' ffmpeg-static is (config-api/package.json).
export const NPM_PACKAGES = ['ffmpeg-static@5.3.0', 'ffprobe-static@3.1.0'];

const runs = (bin) => {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore', timeout: 15000 });
    return true;
  } catch {
    return false;
  }
};

function fromLocalInstall() {
  const req = createRequire(path.join(LOCAL_DIR, 'package.json'));
  const out = {};
  try { out.ffmpeg = req('ffmpeg-static'); } catch { /* not installed */ }
  try { out.ffprobe = req('ffprobe-static').path; } catch { /* not installed */ }
  return out;
}

/** {ffmpeg, ffprobe}: each a path or command that runs, or null. */
export function locateFfmpeg() {
  const local = fromLocalInstall();
  const pick = (...candidates) => candidates.find((c) => c && runs(c)) || null;
  return {
    ffmpeg: pick(process.env.FFMPEG_PATH, 'ffmpeg', local.ffmpeg),
    ffprobe: pick(process.env.FFPROBE_PATH, 'ffprobe', local.ffprobe),
  };
}

/** Both, or a plain error naming what is missing and how to fix it. */
export function requireFfmpeg() {
  const found = locateFfmpeg();
  const missing = Object.entries(found).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error(`${missing.join('/')} not found: Download MP4's tests need ffmpeg and ffprobe. Install them (apt-get install ffmpeg, brew install ffmpeg), set FFMPEG_PATH / FFPROBE_PATH, or run \`node tools/ffmpeg-bin.mjs --ensure\` in pharmacy-screen/ to fetch the npm builds.`);
  }
  return found;
}

/** Install the npm builds into tools/.ffmpeg/ when ffmpeg or ffprobe is not found; returns requireFfmpeg(). */
export function ensureFfmpeg({ log = console.error } = {}) {
  const found = locateFfmpeg();
  if (found.ffmpeg && found.ffprobe) return found;
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  if (!fs.existsSync(path.join(LOCAL_DIR, 'package.json'))) fs.writeFileSync(path.join(LOCAL_DIR, 'package.json'), '{ "private": true }\n');
  log(`ffmpeg/ffprobe not on this machine: installing ${NPM_PACKAGES.join(', ')} into ${path.relative(process.cwd(), LOCAL_DIR) || LOCAL_DIR}`);
  try {
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-save', '--no-audit', '--no-fund', '--no-package-lock', ...NPM_PACKAGES], { cwd: LOCAL_DIR, stdio: ['ignore', 'inherit', 'inherit'], timeout: 300000 });
  } catch (e) {
    throw new Error(`ffmpeg/ffprobe not found, and installing ${NPM_PACKAGES.join(', ')} failed: ${e.message}`);
  }
  return requireFfmpeg();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const found = process.argv.includes('--ensure') ? ensureFfmpeg() : requireFfmpeg();
    console.log(`ffmpeg: ${found.ffmpeg}\nffprobe: ${found.ffprobe}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
