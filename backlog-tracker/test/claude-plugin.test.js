// The Claude plugin that packages the MCP server (backlog-tracker/claude-plugin
// and the repository's .claude-plugin/marketplace.json): the manifests are
// well-formed, the plugin points at this server and holds no credential, and
// every tool a skill names is a tool the server really has.
//   node claude-plugin.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { install } = require("./mcp-stubs");

install();
const mcp = require("../functions/mcp-server.js");

const BT = path.join(__dirname, "..");
const ROOT = path.join(BT, "..");
const PLUGIN = path.join(BT, "claude-plugin");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.message}`); }
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

const manifest = readJson(path.join(PLUGIN, ".claude-plugin", "plugin.json"));
const market = readJson(path.join(ROOT, ".claude-plugin", "marketplace.json"));
const servers = readJson(path.join(PLUGIN, ".mcp.json")).mcpServers;

test("plugin.json: a kebab-case name, a semantic version, a description and an author", () => {
  assert.match(manifest.name, KEBAB);
  assert.strictEqual(manifest.name, "ph-agent-console");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.description && manifest.description.length < 400);
  assert.ok(manifest.author && typeof manifest.author.name === "string" && manifest.author.name);
  // Only plugin.json belongs inside .claude-plugin/.
  assert.deepStrictEqual(fs.readdirSync(path.join(PLUGIN, ".claude-plugin")), ["plugin.json"]);
});

test("marketplace.json sits at the repository root and offers the plugin from its folder", () => {
  assert.match(market.name, KEBAB);
  assert.ok(market.owner && market.owner.name);
  assert.strictEqual(market.plugins.length, 1);
  const entry = market.plugins[0];
  assert.strictEqual(entry.name, manifest.name, "the marketplace entry and plugin.json agree on the name");
  assert.ok(entry.source.startsWith("./") && !entry.source.includes(".."), "a relative source starts with ./ and never climbs");
  assert.strictEqual(path.resolve(ROOT, entry.source), PLUGIN);
  assert.strictEqual(entry.version, undefined, "the version lives in plugin.json only");
});

test(".mcp.json: one remote HTTP server, at this server's own address", () => {
  assert.deepStrictEqual(Object.keys(servers), ["console"]);
  const s = servers.console;
  assert.strictEqual(s.type, "http");
  const meta = mcp.__test.protectedResourceMetadata();
  assert.strictEqual(s.url, meta.resource, "the plugin connects to the resource the server announces");
  assert.ok(s.url.startsWith("https://"));
  assert.deepStrictEqual(Object.keys(s).sort(), ["type", "url"], "nothing but a type and a url: no headers, no command, no env");
});

test("the plugin holds no credential and nothing that runs on the person's machine", () => {
  const files = walk(PLUGIN);
  for (const dir of ["bin", "hooks", "agents"]) assert.ok(!fs.existsSync(path.join(PLUGIN, dir)), `${dir}/ is not part of this plugin`);
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    assert.ok(!/authorization|bearer |api[_-]?key\s*[:=]|client_secret|password\s*[:=]|BOARD_API_KEY|X-Board-Key/i.test(text), `${path.relative(PLUGIN, f)} looks like it carries a credential`);
    assert.ok(/\.(json|md)$/.test(f), `${path.relative(PLUGIN, f)}: only JSON and Markdown ship in the plugin`);
  }
  assert.ok(files.length < 20);
});

test("each skill has a name matching its folder and a description; every tool it names exists", () => {
  const skills = fs.readdirSync(path.join(PLUGIN, "skills"));
  assert.deepStrictEqual(skills.sort(), ["console", "status"]);
  const real = new Set(mcp.__test.TOOLS.map((t) => t.name));
  // Named as "if the server offers …": Code Mode's tools and insight names, which a server may not have yet.
  const OPTIONAL = new Set(["get_insight", "run_script", "pipeline_status", "project_status"]);
  for (const s of skills) {
    const text = fs.readFileSync(path.join(PLUGIN, "skills", s, "SKILL.md"), "utf8");
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(fm, `${s}: has frontmatter`);
    assert.match(fm[1], new RegExp(`^name: ${s}$`, "m"));
    const desc = /^description: (.+)$/m.exec(fm[1]);
    assert.ok(desc && desc[1].length > 40 && desc[1].length < 500, `${s}: a one-paragraph description`);
    const named = [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]);
    assert.ok(named.length >= 3, `${s} names the tools it uses`);
    for (const n of named) assert.ok(real.has(n) || OPTIONAL.has(n), `${s}/SKILL.md names \`${n}\`, which is not an MCP tool`);
    for (const n of named.filter((x) => OPTIONAL.has(x) && /^(get_insight|run_script)$/.test(x))) assert.match(text, /If the server offers|may\s+offer/, `${s}: ${n} is presented as optional`);
    assert.ok(!text.includes("mcp__"), `${s}: tools are named bare, since the prefix differs per client`);
  }
});

test("the status skill is read-only: it names no write tool", () => {
  const text = fs.readFileSync(path.join(PLUGIN, "skills", "status", "SKILL.md"), "utf8");
  const write = mcp.__test.TOOLS.filter((t) => t.scope === "board.write").map((t) => t.name);
  for (const w of write) assert.ok(!text.includes("`" + w + "`"), `status names ${w}`);
});

test("MCP.md gives the install commands with the real marketplace and plugin names", () => {
  const md = fs.readFileSync(path.join(BT, "MCP.md"), "utf8");
  assert.ok(md.includes("/plugin marketplace add offline2online/rob_ph_demos"));
  assert.ok(md.includes(`/plugin install ${manifest.name}@${market.name}`));
  assert.ok(md.includes(`/${manifest.name}:status`));
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
