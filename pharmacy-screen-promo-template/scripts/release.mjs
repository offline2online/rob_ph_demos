// Release package for the miPharmacy Google Shared Drive (docs/RELEASING.md).
//
//   npm run release                       # version from package.json; writes release/v<version>/ and tags the commit
//   npm run release -- --version 0.2.0 --no-tag --out <dir>
//   npm run release -- --dry-run          # build and scan in a temporary folder, write nothing, tag nothing
//   npm run release:verify -- release/v0.1.0/pharmacy-screen-v0.1.0.zip   # checksum, contents and secret scan
//
// What it does:
//   1. reads this folder's files from the last COMMIT (git), never the working tree, so an uncommitted or untracked
//      file (a local .env, a key, node_modules, a staged deploy) cannot reach the package;
//   2. leaves out every .env file except .env.example (our own environment's settings), and refuses outright a
//      path that must never ship (a key file, credentials, node_modules, a staged deploy);
//   3. adds the built screen and admin front ends (dist/web/: the same allow-list both deploys publish, with sw.js
//      stamped) and RELEASE-NOTES.md (this version's CHANGELOG section, the commit, what is in the package);
//   4. scans every file for tokens, keys and personal email addresses, checks the handover files are all there and
//      that the only pharmacies in it are the five launch pharmacies, and stops before writing anything if not;
//   5. writes release/v<version>/: pharmacy-screen-v<version>.zip, its .sha256 (sha256sum format),
//      START-HERE.md and RELEASE-NOTES.md: the four files that go into the Shared Drive's v<version> folder;
//   6. tags the commit pharmacy-screen-v<version> (annotated, local; push it with the printed command).
//
// The zip is reproducible: every entry carries the commit's time, so the same commit gives the same bytes and the
// same checksum. No dependencies: the zip writer and reader below use only node:zlib.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { PUBLIC_SOURCE, PUBLIC_ENTRIES, STAGE_SKIP, stampServiceWorker } from "./deploy.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PRODUCT = "Pharmacy Screen";
export const TAG_PREFIX = "pharmacy-screen-v";
export const OUT_DIR = "release";
export const BUILT_WEB = "dist/web";
export const NOTES_FILE = "RELEASE-NOTES.md";

/** Files every package must carry (paths inside the package folder). */
export const REQUIRED = [
  "START-HERE.md", "README.md", "AGENTS.md", "CLAUDE.md", ".env.example", "CHANGELOG.md", NOTES_FILE,
  "docs/DEPLOYMENT.md", "docs/CONFIGURATION.md", "docs/DATA-CONTRACT.md", "docs/TEST-CHECKLIST.md", "docs/USER-GUIDE.md",
  "docs/RELEASING.md", "package.json",
  // back end, infrastructure, seed and mock data
  "pharmacy-screen/config-api/index.js", "pharmacy-screen/ph-proxy/index.js", "aws/infra/stack.js", "aws/scripts/deploy.mjs",
  "aws/package-lock.json", "pharmacy-screen/seed/seed.js", "pharmacy-screen/seed/fixtures/pharmacies.json",
  "pharmacy-screen/fixtures/campaign-data.json",
  // built front ends
  `${BUILT_WEB}/pharmacy-screen.html`, `${BUILT_WEB}/sw.js`, `${BUILT_WEB}/admin/index.html`,
];

/** The only pharmacies a package may carry: the five launch pharmacies' branding and content. */
export const LAUNCH_STORE_CODES = ["VIC-MP-001", "VIC-MP-002", "VIC-MP-003", "VIC-MP-004", "VIC-MP-005"];

export const packageName = (version) => `${TAG_PREFIX}${version}`;

// ── what may ship ────────────────────────────────────────────────────────────────────────────────────────────────

// .env, .env.<anything> and direnv's .envrc; only .env.example ships.
const isEnvFile = (p) => /(^|\/)\.env($|\.|rc$)/.test(p) && !/(^|\/)\.env\.example$/.test(p);

/** A committed file the package leaves out on purpose (returns why), or null. */
export function leftOut(path) {
  if (isEnvFile(path)) return "environment file (only .env.example ships)";
  return null;
}

/** A path that must never be in a package (returns why), or null. */
export function forbiddenPath(path) {
  if (isEnvFile(path)) return ".env file";
  const segs = path.split("/");
  if (segs.some((s) => ["node_modules", ".git", ".deploy", ".deploy-aws", "cdk.out"].includes(s))) return "dependency, build or deploy folder";
  const name = segs[segs.length - 1];
  if (/\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|ppk|asc|gpg)$/i.test(name)) return "key or certificate file";
  if (/^(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/.test(name)) return "SSH key";
  if (/^(\.npmrc|\.netrc|\.pgpass|\.htpasswd|cdk\.context\.json)$/.test(name)) return "credentials or local context file";
  if (/(credential|service[-_]?account|secret)s?[^/]*\.json$/i.test(name)) return "credentials file";
  return null;
}

// Each pattern is a credential's own shape, not a word that happens to appear in docs ("token", "secret").
const SECRET_PATTERNS = [
  ["private key", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ["AWS access key id", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["AWS secret access key", /aws_secret_access_key\s*[=:]\s*["']?[A-Za-z0-9/+]{40}/i],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Google OAuth client secret", /\bGOCSPX-[0-9A-Za-z_-]{20,}/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/],
  ["Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["Stripe key", /\b[sr]k_live_[0-9A-Za-z]{16,}/],
  ["API key (sk-)", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/],
  ["JSON web token", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["x-api-key value", /x-api-key["']?\s*[:=]\s*["']?(?![<$`{])[A-Za-z0-9_\-]{16,}/i],
];

// Addresses that are not a person's: reserved example domains, fixture domains, GitHub's no-reply and the
// templated Google service-account names in the deploy docs.
const SAFE_EMAIL_DOMAIN = /(^|\.)(example(\.(com|org|net))?|test|invalid|localhost|local|users\.noreply\.github\.com|noreply\.github\.com|gserviceaccount\.com)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

/** Findings in one text file: [{path, line, what}]. Values are never echoed, only what kind they are. */
export function scanText(path, text) {
  const out = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const [what, re] of SECRET_PATTERNS) if (re.test(line)) out.push({ path, line: i + 1, what });
    for (const m of line.matchAll(EMAIL)) {
      if (!SAFE_EMAIL_DOMAIN.test(m[1])) {
        out.push({ path, line: i + 1, what: "email address (personal addresses never ship)" });
      }
    }
  });
  return out;
}

const looksBinary = (buf) => buf.subarray(0, 8000).includes(0);

/** Every reason a set of package files [{path, data}] must not ship. Paths are relative to the package folder. */
export function scanPackage(files) {
  const findings = [];
  for (const f of files) {
    const why = forbiddenPath(f.path);
    if (why) findings.push({ path: f.path, line: 0, what: why });
    if (!looksBinary(f.data)) findings.push(...scanText(f.path, f.data.toString("utf8")));
  }
  const have = new Set(files.map((f) => f.path));
  for (const p of REQUIRED) if (!have.has(p)) findings.push({ path: p, line: 0, what: "required file missing" });
  const seed = files.find((f) => f.path === "pharmacy-screen/seed/fixtures/pharmacies.json");
  if (seed) {
    let codes = [];
    try { codes = JSON.parse(seed.data.toString("utf8")).pharmacies.map((p) => p.storeCode); } catch { codes = null; }
    if (!codes) findings.push({ path: seed.path, line: 0, what: "seed pharmacies could not be read" });
    else if ([...codes].sort().join() !== LAUNCH_STORE_CODES.join()) {
      findings.push({ path: seed.path, line: 0, what: `pharmacies other than the five launch pharmacies (${codes.join(", ")})` });
    }
  }
  return findings;
}

// ── CHANGELOG and release notes ──────────────────────────────────────────────────────────────────────────────────

export const isVersion = (v) => /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v || "");

/** The body of CHANGELOG.md's "## [<version>] …" section, or null. */
export function changelogSection(md, version) {
  const lines = md.split("\n");
  const esc = version.replace(/[.+-]/g, "\\$&");
  const start = lines.findIndex((l) => new RegExp(`^## \\[${esc}\\]`).test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return { heading: lines[start].replace(/^## /, ""), body: lines.slice(start + 1, end).join("\n").trim() };
}

// Relative links in the CHANGELOG point from the package root; RELEASE-NOTES.md sits there too, so they still work.
export function releaseNotes({ version, date, commit, tag, changes }) {
  return `# ${PRODUCT} ${version} — release notes

| | |
|---|---|
| Version | ${version} |
| Date | ${date} |
| Package | \`${packageName(version)}.zip\` (checksum in \`${packageName(version)}.zip.sha256\`) |
| Source | commit \`${commit}\`, tag \`${tag}\` |

## Install or upgrade

Follow [START-HERE.md](START-HERE.md): one command to deploy into your AWS account, then the
[test checklist](docs/TEST-CHECKLIST.md). Upgrading an existing install: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) → Upgrade.

Check the download first, in the folder holding both files:

\`\`\`bash
sha256sum -c ${packageName(version)}.zip.sha256        # macOS: shasum -a 256 -c ${packageName(version)}.zip.sha256
\`\`\`

## What changed

${changes.heading}

${changes.body}

## What is in the package

| Path | What |
|---|---|
| \`START-HERE.md\`, \`README.md\` | One-page quick start; the full overview |
| \`docs/\` | Deployment, configuration, data contract, test checklist, user guide, releasing |
| \`AGENTS.md\`, \`CLAUDE.md\` | Instructions for coding and deployment agents |
| \`.env.example\` | Every function setting, placeholders only |
| \`CHANGELOG.md\`, \`${NOTES_FILE}\` | What changed, per version; these notes |
| \`pharmacy-screen/\` | The screen page and admin editor (source), the config API and PH API proxy (back end), seed data and mock fixtures |
| \`aws/\` | The AWS deployment: CDK stack, Lambda entries, adapters, \`deploy:aws\` / \`destroy:aws\` / \`seed:aws\` |
| \`scripts/\`, \`firebase.json\`, \`.firebaserc\`, \`ci/\` | Our Firebase test environment's deploy, kept for reference (its environment files are not included) |
| \`${BUILT_WEB}/\` | The built screen and admin front ends, exactly as a deploy publishes them (\`npm run deploy:aws\` builds them again from source) |
| \`test/\` and each folder's \`test/\` | The offline checks (\`npm run check:all\`) |

## What is not in the package

No secrets of any kind: no PH API token (it is entered in Admin → Settings after install and stored encrypted), no
\`.env\` files (only \`.env.example\`), no keys or certificates, no personal email addresses, no customer data
beyond the five launch pharmacies' branding and content. The release script refuses to build a package that
fails this scan; \`npm run release:verify -- <zip>\` runs it again on the zip.
`;
}

// ── zip ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date fields (UTC): time = hour<<11 | minute<<5 | second/2; date = (year-1980)<<9 | month<<5 | day. */
export function dosTime(date) {
  const d = new Date(Math.max(date.getTime(), Date.UTC(1980, 0, 1)));
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

/** The UTC date a pair of MS-DOS time and date fields stands for (the inverse of dosTime, to 2-second precision). */
export function fromDosTime(time, date) {
  return new Date(Date.UTC(1980 + (date >>> 9), ((date >>> 5) & 0x0f) - 1, date & 0x1f, time >>> 11, (time >>> 5) & 0x3f, (time & 0x1f) * 2));
}

/** A zip of [{path, data, mode?}] (files only; folders are implied), every entry dated `mtime`. */
export function createZip(entries, mtime = new Date(Date.UTC(1980, 0, 1))) {
  const { time, date } = dosTime(mtime);
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const name = Buffer.from(e.path, "utf8");
    const raw = e.data;
    const deflated = deflateRawSync(raw, { level: 9 });
    const store = deflated.length >= raw.length;
    const body = store ? raw : deflated;
    const crc = crc32(raw);
    const mode = (e.mode || 0o100644) & 0xffff;
    if (offset + body.length > 0xfffffff0 || raw.length > 0xfffffff0) throw new Error("package too large for a zip without zip64");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(store ? 0 : 8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE((3 << 8) | 20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(store ? 0 : 8, 10); central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** The files in a zip: [{path, data, mode, mtime}] (mtime from the central directory's DOS fields). Checks every entry's CRC. */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20);
    const mtime = fromDosTime(buf.readUInt16LE(p + 12), buf.readUInt16LE(p + 14));
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const mode = buf.readUInt32LE(p + 38) >>> 16, local = buf.readUInt32LE(p + 42);
    const path = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + size);
    const data = method === 0 ? Buffer.from(body) : method === 8 ? inflateRawSync(body) : null;
    if (!data) throw new Error(`${path}: unsupported zip method ${method}`);
    if (crc32(data) !== crc) throw new Error(`${path}: CRC mismatch`);
    if (!path.endsWith("/")) out.push({ path, data, mode, mtime });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
/** One line in `sha256sum` format, so `sha256sum -c` / `shasum -a 256 -c` check it. */
export const checksumLine = (hex, fileName) => `${hex}  ${fileName}\n`;

// ── git ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function git(args, opts = {}) {
  const r = spawnSync("git", args, { cwd: opts.cwd || ROOT, input: opts.input, maxBuffer: 1 << 30, encoding: opts.encoding === "buffer" ? undefined : "utf8" });
  if (r.error) throw new Error(`git is needed to build a release (${r.error.message})`);
  if (r.status !== 0 && !opts.allowFail) throw new Error(`git ${args.join(" ")} failed: ${String(r.stderr).trim()}`);
  return r;
}

export function hasGit(root = ROOT) {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" });
  return !r.error && r.status === 0;
}

/** This folder's files at a commit: [{path (relative to the folder), data, mode}], read from git, not the disk. */
export function committedFiles(root = ROOT, commit = "HEAD") {
  const top = git(["rev-parse", "--show-toplevel"], { cwd: root }).stdout.trim();
  const prefix = relative(top, root).split("\\").join("/");
  const ls = git(["ls-tree", "-r", "-z", "--full-tree", commit, "--", prefix || "."], { cwd: root }).stdout.split("\0").filter(Boolean);
  const entries = ls.map((l) => {
    const [meta, path] = l.split("\t");
    const [mode, type, sha] = meta.split(" ");
    return { mode, type, sha, path };
  });
  for (const e of entries) {
    if (e.type !== "blob") throw new Error(`${e.path}: ${e.type} entries (submodules) are not supported in a release`);
    if (e.mode === "120000") throw new Error(`${e.path}: symbolic links are not supported in a release`);
  }
  const out = git(["cat-file", "--batch"], { cwd: root, input: entries.map((e) => e.sha).join("\n") + "\n", encoding: "buffer" }).stdout;
  let p = 0;
  return entries.map((e) => {
    const nl = out.indexOf(10, p);
    const size = Number(out.toString("utf8", p, nl).split(" ")[2]);
    const data = Buffer.from(out.subarray(nl + 1, nl + 1 + size));
    p = nl + 1 + size + 1;
    return { path: prefix ? e.path.slice(prefix.length + 1) : e.path, data, mode: parseInt(e.mode, 8) };
  });
}

// ── build ────────────────────────────────────────────────────────────────────────────────────────────────────────

function walkFiles(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, base, out);
    else out.push(relative(base, p).split("\\").join("/"));
  }
  return out;
}

/** The built front ends from a package's own files: the deploys' allow-list, sw.js stamped. [{path, data, mode}] */
export function builtWeb(files) {
  const tmp = mkdtempSync(join(tmpdir(), "ps-release-web-"));
  try {
    const src = join(tmp, "src"), web = join(tmp, "web");
    for (const f of files) {
      if (!f.path.startsWith(`${PUBLIC_SOURCE}/`)) continue;
      mkdirSync(dirname(join(src, f.path)), { recursive: true });
      writeFileSync(join(src, f.path), f.data);
    }
    for (const entry of PUBLIC_ENTRIES) {
      const from = join(src, PUBLIC_SOURCE, entry);
      cpSync(from, join(web, entry), { recursive: true, filter: (s) => s === from || !STAGE_SKIP.test(s.slice(from.length)) });
    }
    stampServiceWorker(web);
    return walkFiles(web).map((p) => ({ path: `${BUILT_WEB}/${p}`, data: readFileSync(join(web, p)), mode: 0o100644 }));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Builds the release. Returns {version, name, tag, commit, files, leftOut, findings, zip, outputs}. Writes nothing
 * and tags nothing when dryRun is set or the scan finds anything.
 */
export function buildRelease({ root = ROOT, version, outDir, tag = true, dryRun = false, log = () => {} } = {}) {
  const pkgJson = JSON.parse(git(["show", "HEAD:./package.json"], { cwd: root }).stdout);
  version = version || pkgJson.version;
  if (!isVersion(version)) throw new Error(`No valid version: pass --version x.y.z or set "version" in package.json (got ${JSON.stringify(version)})`);
  const name = packageName(version);
  const tagName = name;
  const commit = git(["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
  const committedAt = new Date(git(["log", "-1", "--format=%cI", commit], { cwd: root }).stdout.trim());
  const dirty = git(["status", "--porcelain", "--", "."], { cwd: root }).stdout.trim();
  if (dirty) log(`! ${dirty.split("\n").length} uncommitted change(s) in this folder are NOT in the package (it is built from commit ${commit.slice(0, 12)})`);

  const all = committedFiles(root, commit);
  const skipped = all.filter((f) => leftOut(f.path)).map((f) => ({ path: f.path, why: leftOut(f.path) }));
  const kept = all.filter((f) => !leftOut(f.path));

  const changelog = kept.find((f) => f.path === "CHANGELOG.md");
  const changes = changelog && changelogSection(changelog.data.toString("utf8"), version);
  if (!changes) throw new Error(`CHANGELOG.md (at ${commit.slice(0, 12)}) has no "## [${version}]" section: add one and commit it first (docs/RELEASING.md)`);

  const notes = releaseNotes({ version, date: committedAt.toISOString().slice(0, 10), commit, tag: tagName, changes });
  const files = [...kept, ...builtWeb(kept), { path: NOTES_FILE, data: Buffer.from(notes), mode: 0o100644 }];
  const findings = scanPackage(files);
  const result = { version, name, tag: tagName, commit, files, leftOut: skipped, findings, outputs: [] };
  if (findings.length) return result;

  result.zip = createZip(files.map((f) => ({ ...f, path: `${name}/${f.path}` })), committedAt);
  result.sha256 = sha256(result.zip);
  if (dryRun) return result;

  const dir = resolve(outDir || join(root, OUT_DIR), `v${version}`);
  mkdirSync(dir, { recursive: true });
  const write = (file, data) => { writeFileSync(join(dir, file), data); result.outputs.push(join(dir, file)); };
  write(`${name}.zip`, result.zip);
  write(`${name}.zip.sha256`, checksumLine(result.sha256, `${name}.zip`));
  write("START-HERE.md", kept.find((f) => f.path === "START-HERE.md").data);
  write(NOTES_FILE, notes);

  if (tag) {
    const existing = git(["rev-parse", "-q", "--verify", `refs/tags/${tagName}^{commit}`], { cwd: root, allowFail: true }).stdout.trim();
    if (existing && existing !== commit) throw new Error(`Tag ${tagName} already exists on ${existing.slice(0, 12)}, not ${commit.slice(0, 12)}: bump the version`);
    if (!existing) git(["tag", "-a", tagName, "-m", `${PRODUCT} ${version}`, commit], { cwd: root });
    result.tagged = existing ? "existing" : "created";
  }
  return result;
}

/** Checks a built zip: its .sha256 beside it (when present), one top folder, the scan. Returns {ok, problems}. */
export function verifyRelease(zipPath) {
  const problems = [];
  const buf = readFileSync(zipPath);
  const sumFile = `${zipPath}.sha256`;
  if (existsSync(sumFile)) {
    const [want, file] = readFileSync(sumFile, "utf8").trim().split(/\s+\*?/);
    if (file !== basename(zipPath)) problems.push(`${basename(sumFile)} names ${file}, not ${basename(zipPath)}`);
    if (want !== sha256(buf)) problems.push(`checksum mismatch: ${basename(sumFile)} says ${want}, the zip is ${sha256(buf)}`);
  } else problems.push(`no ${basename(sumFile)} beside the zip`);
  let entries = [];
  try { entries = readZip(buf); } catch (err) { problems.push(err.message); }
  const tops = new Set(entries.map((e) => e.path.split("/")[0]));
  if (tops.size !== 1) problems.push(`expected one top folder in the zip, found ${[...tops].join(", ") || "none"}`);
  const top = [...tops][0];
  if (top && `${top}.zip` !== basename(zipPath)) problems.push(`the zip's folder ${top}/ does not match its name`);
  const files = entries.map((e) => ({ ...e, path: e.path.slice(top.length + 1) }));
  for (const f of scanPackage(files)) problems.push(`${f.path}${f.line ? `:${f.line}` : ""}: ${f.what}`);
  return { ok: problems.length === 0, problems, files: files.length };
}

// ── command line ─────────────────────────────────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const opts = { version: undefined, out: undefined, tag: true, dryRun: false, verify: undefined, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === "--version") opts.version = value();
    else if (a.startsWith("--version=")) opts.version = a.slice(10);
    else if (a === "--out") opts.out = value();
    else if (a.startsWith("--out=")) opts.out = a.slice(6);
    else if (a === "--no-tag") opts.tag = false;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--verify") opts.verify = value();
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`Unknown option ${a}`);
  }
  if (opts.version !== undefined && !isVersion(opts.version)) throw new Error(`--version must look like 1.2.3 (got ${opts.version})`);
  return opts;
}

const USAGE = `Usage:
  npm run release -- [--version x.y.z] [--out <dir>] [--no-tag] [--dry-run]
  npm run release:verify -- <path to pharmacy-screen-v<version>.zip>
See docs/RELEASING.md.`;

function main() {
  // npm run release:verify -- <zip> runs "release.mjs --verify <zip>".
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(USAGE); return 0; }

  if (opts.verify) {
    const r = verifyRelease(resolve(opts.verify));
    if (!r.ok) {
      console.error(`✖ ${opts.verify} failed verification:\n  ${r.problems.join("\n  ")}`);
      return 1;
    }
    console.log(`✓ ${opts.verify}: checksum matches, ${r.files} files, required handover files present, no tokens, keys, .env files or personal addresses`);
    return 0;
  }

  const r = buildRelease({ version: opts.version, outDir: opts.out, tag: opts.tag, dryRun: opts.dryRun, log: (m) => console.warn(m) });
  console.log(`${PRODUCT} ${r.version} from commit ${r.commit.slice(0, 12)}${opts.dryRun ? " — dry run" : ""}`);
  for (const s of r.leftOut) console.log(`  left out ${s.path} (${s.why})`);
  if (r.findings.length) {
    console.error(`\n✖ Not packaged: ${r.findings.length} problem(s). Fix them, commit, and run again.`);
    for (const f of r.findings) console.error(`  ${f.path}${f.line ? `:${f.line}` : ""}: ${f.what}`);
    return 1;
  }
  console.log(`  ${r.files.length} files, ${(r.zip.length / 1024).toFixed(0)} KB zipped, sha256 ${r.sha256}`);
  if (opts.dryRun) { console.log("\nDry run: nothing written, nothing tagged."); return 0; }
  console.log(`\nWrote:\n  ${r.outputs.map((p) => relative(process.cwd(), p)).join("\n  ")}`);
  if (r.tagged) console.log(`\nTag ${r.tag} ${r.tagged === "created" ? "created" : "already on this commit"}. Publish it: git push origin ${r.tag}`);
  console.log(`\nNext: upload the four files above into the Shared Drive folder v${r.version}/ (docs/RELEASING.md → "Share it").`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`\n✖ ${err.message}`);
    process.exitCode = 1;
  }
}
