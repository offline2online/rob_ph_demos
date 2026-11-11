#!/usr/bin/env node
// Is the Leads / Prospects (TAM) research agent working? Runs the real agent
// call from functions/lead-enrich.js (claudeResearch) for one company, with the
// real ANTHROPIC_API_KEY, and reports what came back: how long each request
// took, how it ended, and which findings were filled. It writes nothing.
//
//   ANTHROPIC_API_KEY=... node backlog-tracker/scripts/lead-enrich-probe.js "Tesco" [website] [country]
//
// Run on a runner by .github/workflows/lead-enrich-probe.yml, where the key
// already is. Actions logs on this repo are public, so only field names, sizes
// and timings are printed, never what was found. Exit 1 when the agent fails.
"use strict";
const path = require("path");
const fn = path.join(__dirname, "..", "functions");
const { claudeResearch, cleanFindings, parseAgentJson, agentError } = require(path.join(fn, "lead-enrich.js"));
const sdk = require(path.join(fn, "node_modules", "@anthropic-ai", "sdk"));
const Real = sdk.default || sdk;

const [company = "Tesco", website = "", country = ""] = process.argv.slice(2);
const key = process.env.ANTHROPIC_API_KEY || "";
if (!key || key === "unset") { console.error("ANTHROPIC_API_KEY is not set: the agent cannot run."); process.exit(1); }

const t0 = Date.now();
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
let calls = 0;
// The real client, with each request timed and summarised.
class Probe {
  constructor(opts) {
    const real = new Real(opts);
    const report = (n, started, res) => {
      const blocks = {};
      for (const b of res.content || []) blocks[b.type] = (blocks[b.type] || 0) + 1;
      const texts = (res.content || []).filter((b) => b.type === "text").map((b) => b.text);
      console.log(`request ${n}: ${secs(Date.now() - started)}, stop_reason=${res.stop_reason}, model=${res.model}, blocks=${JSON.stringify(blocks)}, usage=${JSON.stringify({ in: res.usage && res.usage.input_tokens, out: res.usage && res.usage.output_tokens, tools: res.usage && res.usage.server_tool_use })}`);
      if (texts.length) console.log(`  answer: ${texts.length} text block(s); readable joined as written: ${Boolean(parseAgentJson(texts.join("")))}; readable joined with newlines (how it was read before 11 Nov 2026): ${Boolean(parseAgentJson(texts.join("\n")))}`);
      return res;
    };
    this.beta = { messages: {
      stream: (params) => ({ finalMessage: async () => { const n = ++calls, s = Date.now(); return report(n, s, await real.beta.messages.stream(params).finalMessage()); } }),
      create: async (params) => { const n = ++calls, s = Date.now(); return report(n, s, await real.beta.messages.create(params)); },
    } };
  }
}

(async () => {
  console.log(`Researching one company with ${require(path.join(fn, "lead-enrich.js")).AGENT_MODEL}, SDK ${require(path.join(fn, "node_modules", "@anthropic-ai", "sdk", "package.json")).version}…`);
  let raw;
  try { raw = await claudeResearch({ apiKey: key, Anthropic: Probe, company, website, country }); } catch (err) {
    console.error(`FAILED after ${secs(Date.now() - t0)} and ${calls} request(s): status=${err && err.status} ${String(err && err.message ? err.message : err).slice(0, 600)}`);
    console.error(`The record would say: The research agent failed: ${agentError(err)}`);
    process.exit(1);
  }
  const f = cleanFindings(raw);
  const size = (v) => (Array.isArray(v) ? `${v.length} item(s)` : v && typeof v === "object" ? "yes" : typeof v === "number" ? "a number" : v ? `${String(v).length} chars` : "—");
  console.log(`\nDone in ${secs(Date.now() - t0)} over ${calls} request(s). Findings (sizes only):`);
  for (const [k, v] of Object.entries(f)) console.log(`  ${k.padEnd(16)} ${size(v)}`);
  const filled = Object.values(f).filter((v) => (Array.isArray(v) ? v.length : v != null && v !== "")).length;
  console.log(`\n${filled} of ${Object.keys(f).length} fields filled.`);
  if (filled < 8) { console.error("Too little came back for a well-known company."); process.exit(1); }
})();
