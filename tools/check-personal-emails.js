#!/usr/bin/env node
// Fails when a personal email address appears in a tracked file.
//
// This repository is public, and Routine sessions that hand work back as
// patchFiles are refused outright by the privacy plugin when a file holds a
// person's address — which once blocked six tickets at once. So addresses
// never go in the code, docs, tests or fixtures: owners are the `owner`
// custom claim (backlog-tracker/scripts/set-owner-claim.js), configuration
// that must name someone lives in repository secrets / Secret Manager /
// Firestore, and tests use fixture identities on reserved domains.
//
// Allowed without listing:
//   - reserved domains (RFC 2606 / 6761): example, example.com|org|net,
//     *.example, *.test, *.invalid, *.localhost
//   - service identities: *.iam.gserviceaccount.com,
//     *.developer.gserviceaccount.com (Compute Engine default), *.firebaseapp.com,
//     *.noreply.github.com, noreply.github.com
//   - role mailboxes on any domain (support@, you@, noreply@ …; ROLE_LOCALS)
// Anything else must be listed in .personal-email-allowlist at the repo root
// (one address or /regex/ per line, # comments) — for an address that is
// genuinely public and not a person's, e.g. a brand's published contact.
//
// Usage:
//   node tools/check-personal-emails.js            every tracked file
//   node tools/check-personal-emails.js --staged   staged content (pre-commit)
//   node tools/check-personal-emails.js FILE...    just those files
// Exit 0 clean, 1 found, 2 couldn't run. Matches are printed masked
// (first letter of the local part only) so the check never re-publishes them.
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const EMAIL_RE = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;

const RESERVED_DOMAIN_RE = /(^|\.)(example|test|invalid|localhost)$|(^|\.)example\.(com|org|net)$/i;
const SERVICE_DOMAIN_RE = /(^|\.)(iam\.gserviceaccount\.com|developer\.gserviceaccount\.com|firebaseapp\.com|noreply\.github\.com)$/i;
const ROLE_LOCALS = new Set([
  "support", "help", "helpdesk", "info", "hello", "contact", "enquiries", "sales", "admin", "administrator",
  "noreply", "no-reply", "donotreply", "do-not-reply", "notifications", "alerts", "you", "your", "yourname",
  "your.name", "me", "teammate", "name", "user", "username", "email", "someone", "privacy", "security",
  "billing", "accounts", "team", "partners", "marketing", "careers", "jobs", "press", "media", "legal",
  "abuse", "postmaster", "webmaster", "hostmaster", "hr", "office", "feedback", "dpo", "compliance",
  "git", "mailer-daemon", "first.last", "firstname.lastname",
]);
// File types where an "@" is almost never an address (binary-ish, generated).
const SKIP_FILE_RE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|eot|mp4|mov|webm|mp3|wav|zip|gz|min\.js|map)$/i;
// Not an address: retina asset names (logo@2x.png), or an image file named
// after an address — the address part is checked on its own (see below).
const NOT_ADDRESS_RE = /@\d+x\.[a-z]+$/i;
const FILE_EXT_RE = /\.(jpe?g|png|gif|webp|svg|json|txt|md)$/i;

function repoRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

function loadAllowlist(root) {
  const file = path.join(root, ".personal-email-allowlist");
  const exact = new Set();
  const patterns = [];
  if (!fs.existsSync(file)) return { exact, patterns };
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^\/(.+)\/([a-z]*)$/);
    if (m) patterns.push(new RegExp(m[1], m[2].includes("i") ? m[2] : m[2] + "i"));
    else exact.add(line.toLowerCase());
  }
  return { exact, patterns };
}

function isAllowed(addr, allow) {
  let lower = addr.toLowerCase();
  // "someone@domain.com.jpg": judge the address, not the file name.
  while (FILE_EXT_RE.test(lower) && lower.slice(lower.lastIndexOf("@")).split(".").length > 2) lower = lower.replace(FILE_EXT_RE, "");
  const at = lower.lastIndexOf("@");
  const local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  if (NOT_ADDRESS_RE.test(lower)) return true;
  if (RESERVED_DOMAIN_RE.test(domain) || SERVICE_DOMAIN_RE.test(domain)) return true;
  if (ROLE_LOCALS.has(local)) return true;
  if (allow.exact.has(lower)) return true;
  return allow.patterns.some((re) => re.test(lower));
}

function mask(addr) {
  const at = addr.lastIndexOf("@");
  return `${addr[0]}***@${addr.slice(at + 1)}`;
}

function scanText(text, allow) {
  const hits = [];
  // A URL-encoded address (an at-sign written as percent-40) is still one.
  // A regex form (name@domain\\.com) and a URL-encoded at-sign are still addresses.
  const lines = text.replace(/%40/gi, "@").replace(/\\\./g, ".").split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(EMAIL_RE)) {
      // URL user-info (https://user:pw@host, https://name@host) is not an address.
      const before = lines[i].slice(Math.max(0, m.index - 2), m.index);
      if (before.endsWith(":") || before === "//") continue;
      // Trailing dots from prose (an address ending a sentence) are not part of it.
      const addr = m[0].replace(/\.+$/, "");
      if (!isAllowed(addr, allow)) hits.push({ line: i + 1, addr });
    }
  }
  return hits;
}

function listFiles(root, mode, args) {
  if (mode === "files") return args;
  const out = execFileSync("git", mode === "staged"
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
    : ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

function readContent(root, file, mode) {
  if (mode === "staged") {
    try { return execFileSync("git", ["show", `:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); } catch { return null; }
  }
  try { return fs.readFileSync(path.resolve(root, file), "utf8"); } catch { return null; }
}

function main(argv) {
  let root;
  try { root = repoRoot(); } catch { console.error("check-personal-emails: not in a git repository"); return 2; }
  const args = argv.slice(2);
  const mode = args.includes("--staged") ? "staged" : args.filter((a) => !a.startsWith("--")).length ? "files" : "all";
  const allow = loadAllowlist(root);
  const files = listFiles(root, mode, args.filter((a) => !a.startsWith("--"))).filter((f) => !SKIP_FILE_RE.test(f));
  let total = 0;
  for (const f of files) {
    const text = readContent(root, f, mode);
    if (text == null || text.includes("\0")) continue; // missing or binary
    for (const h of scanText(text, allow)) {
      total++;
      console.log(`${f}:${h.line}: personal email address ${mask(h.addr)}`);
    }
  }
  if (total) {
    console.log(`\ncheck-personal-emails: ${total} personal email address${total === 1 ? "" : "es"} in tracked files.`);
    console.log("Replace with a role (the `owner` claim), configuration (a secret / Firestore), or a fixture identity on a reserved domain (owner@example.com).");
    console.log("Only a genuinely public, non-personal address belongs in .personal-email-allowlist. See root CLAUDE.md → \"Never hard-code a person's address\".");
    return 1;
  }
  console.log(`check-personal-emails: clean (${files.length} files)`);
  return 0;
}

module.exports = { scanText, isAllowed, loadAllowlist, mask };
if (require.main === module) process.exit(main(process.argv));
