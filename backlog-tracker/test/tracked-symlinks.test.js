// No symbolic link may be tracked in this repository.
//
// GitHub Pages builds the site by archiving the whole checkout with
// `tar --dereference`, which follows every link. A link whose target does
// not exist on the runner (an absolute path on someone's machine, or a
// folder that is not committed) makes tar fail, and the Pages build with it:
// every push to main from 16 to 18 Nov 2026 failed that way on
// backlog-tracker/functions/node_modules, so nothing served from GitHub
// Pages was updated in that time. This workflow never saw it, because Pages
// has its own.
//   node tracked-symlinks.test.js
"use strict";
const assert = require("assert");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
// Mode 120000 is a symbolic link.
const links = execFileSync("git", ["ls-files", "-s"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n").filter((l) => l.startsWith("120000 ")).map((l) => l.split("\t")[1]);
assert.deepStrictEqual(links, [], `tracked symbolic links break the GitHub Pages build; remove them with \`git rm --cached\`: ${links.join(", ")}`);

// The ignore rule that lets a node_modules symlink through is the one with a trailing slash.
const ignored = (p) => { try { execFileSync("git", ["check-ignore", "-q", "--no-index", p], { cwd: ROOT }); return true; } catch { return false; } };
assert.ok(ignored("backlog-tracker/functions/node_modules"), "backlog-tracker/functions/node_modules is ignored whether it is a folder or a link");

console.log("tracked-symlinks: ok");
