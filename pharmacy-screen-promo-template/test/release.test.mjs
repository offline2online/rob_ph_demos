// The Shared Drive release package (scripts/release.mjs, docs/RELEASING.md): the zip writer and reader, what may
// ship, the secret scan, the CHANGELOG section and release notes, and, where git is available (the repo, not an
// unzipped package), a full build from HEAD.
//
//   cd pharmacy-screen-promo-template && npm run check

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  ROOT, REQUIRED, LAUNCH_STORE_CODES, BUILT_WEB, NOTES_FILE, packageName, leftOut, forbiddenPath, scanText, scanPackage,
  changelogSection, releaseNotes, crc32, createZip, readZip, sha256, checksumLine, parseArgs, hasGit, buildRelease,
  verifyRelease, isVersion,
} from "../scripts/release.mjs";

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test("a zip reads back byte for byte, with modes, and the same input gives the same bytes", () => {
  const files = [
    { path: "p/b.txt", data: Buffer.from("hello ".repeat(200)) },
    { path: "p/a/run.sh", data: Buffer.from("#!/bin/sh\necho hi\n"), mode: 0o100755 },
    { path: "p/empty", data: Buffer.alloc(0) },
    { path: "p/bin", data: Buffer.from([0, 1, 2, 255, 0, 7]) },
  ];
  const when = new Date("2026-11-20T06:37:51Z");
  const zip = createZip(files, when);
  const back = readZip(zip);
  assert.deepEqual(back.map((f) => f.path), ["p/a/run.sh", "p/b.txt", "p/bin", "p/empty"], "sorted");
  for (const f of files) assert.deepEqual(back.find((b) => b.path === f.path).data, f.data, f.path);
  assert.equal(back.find((b) => b.path === "p/a/run.sh").mode, 0o100755);
  assert.equal(back.find((b) => b.path === "p/b.txt").mode, 0o100644);
  assert.deepEqual(createZip([...files].reverse(), when), zip, "reproducible");
  const bad = Buffer.from(zip);
  bad[bad.indexOf("#!/bin/sh")] ^= 1;
  assert.throws(() => readZip(bad), /CRC/);
});

test("the system unzip (where installed) opens our zip", { skip: spawnSync("unzip", ["-v"]).error && "no unzip here" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "ps-unzip-"));
  writeFileSync(join(dir, "t.zip"), createZip([{ path: "t/x/y.txt", data: Buffer.from("ok ".repeat(50)) }]));
  const r = spawnSync("unzip", ["-q", "t.zip"], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(dir, "t/x/y.txt"), "utf8"), "ok ".repeat(50));
});

test("only .env.example ships; env files are left out and key, credential and dependency paths are forbidden", () => {
  for (const p of [".env", "a/.env", "pharmacy-screen/ph-proxy/.env.rob-ph-demos", ".env.local"]) {
    assert.ok(leftOut(p), p);
    assert.ok(forbiddenPath(p), p);
  }
  for (const p of [".env.example", "pharmacy-screen/ph-proxy/.env.example", "docs/CONFIGURATION.md", "aws/package-lock.json", "env.js"]) {
    assert.equal(leftOut(p), null, p);
    assert.equal(forbiddenPath(p), null, p);
  }
  for (const p of ["certs/site.pem", "x/server.key", "id_rsa", "a/.npmrc", "gcp-service-account.json", "credentials.json",
    "aws/node_modules/x/index.js", "aws/cdk.out/t.json", ".deploy/public/sw.js", "aws/cdk.context.json"]) {
    assert.ok(forbiddenPath(p), p);
  }
});

test("the scan finds tokens, keys and personal addresses, and names the kind, never the value", () => {
  const key = "AKIA" + "ABCDEFGHIJKLMNOP";
  const cases = {
    "private key": "-----BEGIN " + "RSA PRIVATE KEY-----",
    "AWS access key id": `id = ${key}`,
    "Google API key": "key: AIza" + "SyA1234567890abcdefghijklmnopqrstuv",
    "GitHub token": "ghp_" + "a".repeat(36),
    "JSON web token": "eyJ" + "hbGciOiJIUzI1NiJ9" + ".eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0" + ".abcdefghijklmnop",
    "x-api-key value": "curl -H 'x-api-key: " + "abcdef0123456789abcdef'",
    "email address": "contact: jane.citizen@" + "gmail.com",
  };
  for (const [what, line] of Object.entries(cases)) {
    const f = scanText("f.txt", `ok\n${line}\n`);
    assert.equal(f.length, 1, what);
    assert.ok(f[0].what.startsWith(what), `${what}: ${f[0].what}`);
    assert.equal(f[0].line, 2);
    assert.ok(!JSON.stringify(f).includes(line.slice(-12)), "the value is not echoed");
  }
  for (const fine of ["x-api-key: <token>", "the proxy adds `x-api-key` itself", "admin@example.com, a@ph.example, b@x.test",
    "x-api-key: ${token}", "123-compute@developer.gserviceaccount.com", "PH_TOKEN_KMS_KEY=projects/<project-id>/keys"]) {
    assert.deepEqual(scanText("f.md", fine), [], fine);
  }
});

test("a package needs every handover file, and no pharmacy beyond the five launch pharmacies", () => {
  const seed = (codes) => ({ path: "pharmacy-screen/seed/fixtures/pharmacies.json", data: Buffer.from(JSON.stringify({ pharmacies: codes.map((storeCode) => ({ storeCode })) })) });
  const base = REQUIRED.filter((p) => !p.endsWith("pharmacies.json")).map((path) => ({ path, data: Buffer.from("x") }));
  assert.deepEqual(scanPackage([...base, seed(LAUNCH_STORE_CODES)]), []);
  assert.match(scanPackage([...base, seed([...LAUNCH_STORE_CODES, "NSW-XX-001"])])[0].what, /other than the five launch pharmacies/);
  const missing = scanPackage([...base.filter((f) => f.path !== "START-HERE.md"), seed(LAUNCH_STORE_CODES)]);
  assert.deepEqual(missing.map((f) => [f.path, f.what]), [["START-HERE.md", "required file missing"]]);
  assert.ok(scanPackage([...base, seed(LAUNCH_STORE_CODES), { path: "x/.env", data: Buffer.from("A=1") }]).some((f) => f.what === ".env file"));
  // Binary files are not text-scanned (a logo's bytes can look like anything).
  assert.deepEqual(scanPackage([...base, seed(LAUNCH_STORE_CODES), { path: "l.png", data: Buffer.from([0, ...Buffer.from("AKIA" + "ABCDEFGHIJKLMNOP")]) }]), []);
});

test("package.json carries a version, and CHANGELOG.md has its section", () => {
  assert.ok(isVersion(pkg.version), pkg.version);
  const s = changelogSection(changelog, pkg.version);
  assert.ok(s, `CHANGELOG.md has ## [${pkg.version}]`);
  assert.match(s.body, /Release package/);
  assert.equal(changelogSection(changelog, "9.9.9"), null);
  assert.equal(pkg.scripts.release, "node scripts/release.mjs");
  assert.equal(pkg.scripts["release:verify"], "node scripts/release.mjs --verify");
});

test("changelogSection takes one version's section only", () => {
  const md = "# C\n\n## [Unreleased]\n\n- next\n\n## [1.1.0] — 2026-12-01\n\n### Fixed\n\n- a\n\n## [1.0.0] — 2026-11-20\n\n- b\n";
  assert.deepEqual(changelogSection(md, "1.1.0"), { heading: "[1.1.0] — 2026-12-01", body: "### Fixed\n\n- a" });
  assert.equal(changelogSection(md, "1.0.0").body, "- b");
  assert.equal(changelogSection(md, "1.0"), null);
});

test("release notes name the version, commit, tag and checksum file, and carry the changes", () => {
  const md = releaseNotes({ version: "1.2.3", date: "2026-11-20", commit: "c".repeat(40), tag: "pharmacy-screen-v1.2.3", changes: { heading: "[1.2.3]", body: "- did a thing" } });
  for (const want of ["1.2.3", "c".repeat(40), "pharmacy-screen-v1.2.3.zip.sha256", "- did a thing", "START-HERE.md", BUILT_WEB]) assert.ok(md.includes(want), want);
  assert.equal(packageName("1.2.3"), "pharmacy-screen-v1.2.3");
  assert.equal(checksumLine("ab", "f.zip"), "ab  f.zip\n");
});

test("command line options", () => {
  assert.deepEqual(parseArgs([]), { version: undefined, out: undefined, tag: true, dryRun: false, verify: undefined, help: false });
  assert.deepEqual(parseArgs(["--version", "1.0.0", "--out=o", "--no-tag", "--dry-run"]), { version: "1.0.0", out: "o", tag: false, dryRun: true, verify: undefined, help: false });
  assert.equal(parseArgs(["--verify", "a.zip"]).verify, "a.zip");
  assert.throws(() => parseArgs(["--version", "v1"]), /1\.2\.3/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown option/);
});

test("a release built from HEAD: zip, checksum, START-HERE and notes; no env files; verifiable; reproducible", { skip: !hasGit(ROOT) && "no git here (an unzipped package): the build needs the repository" }, () => {
  const out = mkdtempSync(join(tmpdir(), "ps-release-"));
  // The version is the one HEAD's CHANGELOG and package.json carry (a commit before this feature has none: skip).
  const head = spawnSync("git", ["show", "HEAD:./package.json"], { cwd: ROOT, encoding: "utf8" });
  const version = head.status === 0 ? JSON.parse(head.stdout).version : undefined;
  if (!isVersion(version)) return;
  const r = buildRelease({ version, outDir: out, tag: false });
  assert.deepEqual(r.findings, []);
  const dir = join(out, `v${version}`), name = packageName(version);
  assert.deepEqual(r.outputs.map((p) => basename(p)).sort(), [`${name}.zip`, `${name}.zip.sha256`, NOTES_FILE, "START-HERE.md"].sort());
  const zip = readFileSync(join(dir, `${name}.zip`));
  assert.equal(readFileSync(join(dir, `${name}.zip.sha256`), "utf8"), checksumLine(sha256(zip), `${name}.zip`));
  const v = verifyRelease(join(dir, `${name}.zip`));
  assert.ok(v.ok, v.problems.join("\n"));

  const paths = readZip(zip).map((e) => e.path);
  assert.ok(paths.every((p) => p.startsWith(`${name}/`)), "one top folder");
  for (const want of REQUIRED) assert.ok(paths.includes(`${name}/${want}`), want);
  assert.ok(paths.some((p) => p.startsWith(`${name}/docs/`)) && paths.some((p) => p.startsWith(`${name}/aws/infra/`)));
  assert.ok(!paths.some((p) => /\/\.env(?!\.example$)/.test(p)), "no .env files");
  assert.ok(r.leftOut.some((s) => s.path.endsWith(".env.rob-ph-demos")));
  const sw = readZip(zip).find((e) => e.path === `${name}/${BUILT_WEB}/sw.js`).data.toString("utf8");
  assert.match(sw, /const BUILD = '[0-9a-f]{16}'/, "built sw.js is stamped");
  assert.ok(!paths.some((p) => p.startsWith(`${name}/${BUILT_WEB}/`) && /(config-api|ph-proxy|\/test\/|package\.json)/.test(p)), "no server code in the built web");
  assert.match(readFileSync(join(dir, NOTES_FILE), "utf8"), new RegExp(`${r.commit}`));

  // Same commit, same bytes.
  assert.deepEqual(buildRelease({ version, dryRun: true }).zip, zip);
  // A tampered zip fails verification.
  writeFileSync(join(dir, `${name}.zip`), Buffer.concat([zip, Buffer.from("x")]));
  assert.ok(!verifyRelease(join(dir, `${name}.zip`)).ok);
  assert.ok(!existsSync(join(ROOT, "release", `v${version}`, "never-written")));
});
