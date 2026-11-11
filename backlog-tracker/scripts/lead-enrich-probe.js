#!/usr/bin/env node
// Is the Leads / Prospects (TAM) research agent working? Runs the real agent
// call from functions/lead-enrich.js (claudeResearch) for one company, with the
// real ANTHROPIC_API_KEY, and reports what came back: how long each request
// took, how it ended, and which findings were filled. It writes nothing.
//
//   ANTHROPIC_API_KEY=... node backlog-tracker/scripts/lead-enrich-probe.js "Tesco" [website] [country]
//
// To test a real record without naming it in a public log:
//   LEAD_ID=<leads doc id> PROBE_PUBLIC_KEY="<RSA public key, PEM>" node …/lead-enrich-probe.js
// reads the company and website from that lead (Firestore, application default
// credentials), never prints them, and prints the full findings encrypted to
// that public key (AES-256-GCM, the key wrapped with RSA-OAEP); only the
// holder of the private key can read them.
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

let [company = "Tesco", website = "", country = ""] = process.argv.slice(2);
const leadId = (process.env.LEAD_ID || "").trim();
const publicKey = (process.env.PROBE_PUBLIC_KEY || "").trim();
const crypto = require("crypto");

// The company behind a lead id, kept out of the log.
async function fromLead(id) {
  const fnRequire = require("module").createRequire(path.join(fn, "index.js"));
  const { initializeApp, applicationDefault } = fnRequire("firebase-admin/app");
  const { getFirestore } = fnRequire("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault(), projectId: "backlog-tracker-e4ed2" });
  const snap = await getFirestore().collection("leads").doc(id).get();
  if (!snap.exists) throw new Error("no such lead");
  const c = (snap.data() || {}).company || {};
  for (const v of [c.name, c.website]) if (v) console.log(`::add-mask::${v}`);
  return { name: String(c.name || ""), website: String(c.website || "") };
}
function sealed(obj) {
  const key32 = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const ci = crypto.createCipheriv("aes-256-gcm", key32, iv);
  const body = Buffer.concat([ci.update(JSON.stringify(obj), "utf8"), ci.final()]);
  const wrapped = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key32);
  return [wrapped, iv, ci.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}
const key = process.env.ANTHROPIC_API_KEY || "";
if (!key || key === "unset") { console.error("ANTHROPIC_API_KEY is not set: the agent cannot run."); process.exit(1); }

const t0 = Date.now();
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
let calls = 0;
let needsWorkspace = false;
// The real client, with each request timed and summarised.
class Probe {
  constructor(opts) {
    const real = new Real(opts);
    const report = (n, started, res) => {
      const blocks = {};
      for (const b of res.content || []) blocks[b.type] = (blocks[b.type] || 0) + 1;
      const texts = (res.content || []).filter((b) => b.type === "text").map((b) => b.text);
      console.log(`request ${n}: ${secs(Date.now() - started)}, stop_reason=${res.stop_reason}, model=${res.model}, blocks=${JSON.stringify(blocks)}, usage=${JSON.stringify({ in: res.usage && res.usage.input_tokens, cacheRead: res.usage && res.usage.cache_read_input_tokens, cacheWrite: res.usage && res.usage.cache_creation_input_tokens, out: res.usage && res.usage.output_tokens, tools: res.usage && res.usage.server_tool_use })}`);
      if (texts.length) console.log(`  answer: ${texts.length} text block(s); readable joined as written: ${Boolean(parseAgentJson(texts.join("")))}; readable joined with newlines (how it was read before 11 Nov 2026): ${Boolean(parseAgentJson(texts.join("\n")))}`);
      return res;
    };
    this.beta = { messages: {
      stream: (params) => ({ finalMessage: async () => { const n = ++calls, s = Date.now(); return report(n, s, await real.beta.messages.stream(params).finalMessage()); } }),
      create: async (params) => { const n = ++calls, s = Date.now(); return report(n, s, await real.beta.messages.create(params)); },
    } };
  }
}

// A key made for the whole organisation needs a workspace named. When none is
// configured, see whether the key itself can list the organisation's
// workspaces, and try the research in one, so the rest of the run is still
// checked. The ID is masked in the log; nothing is saved.
async function findWorkspace() {
  for (const version of ["2026-10-21", "2023-06-01"]) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/organizations/workspaces?limit=100", { headers: { "x-api-key": key, "anthropic-version": version } });
      if (!r.ok) { console.log(`  listing workspaces (API version ${version}): HTTP ${r.status}`); continue; }
      const list = ((await r.json()).data || []).filter((w) => w && w.id && !w.archived_at);
      console.log(`  the key can list workspaces: ${list.length} active.`);
      if (list.length) { console.log(`::add-mask::${list[0].id}`); return list[0].id; }
    } catch (err) { console.log(`  listing workspaces failed: ${String(err && err.message || err).slice(0, 120)}`); }
  }
  return "";
}

(async () => {
  if (leadId) {
    try { const l = await fromLead(leadId); company = l.name; website = l.website; country = ""; } catch (err) { console.error(`Couldn't read that lead: ${String(err && err.message || err).slice(0, 200)}`); process.exit(1); }
    if (!company) { console.error("That lead has no company name."); process.exit(1); }
    console.log("Researching the company on that lead (its name is not printed).");
  }
  console.log(`Workspace header: ${process.env.ANTHROPIC_WORKSPACE_ID ? "sent (ANTHROPIC_WORKSPACE_ID is set)" : "not sent (ANTHROPIC_WORKSPACE_ID is not set)"}`);
  console.log(`Researching one company with ${require(path.join(fn, "lead-enrich.js")).AGENT_MODEL}, SDK ${require(path.join(fn, "node_modules", "@anthropic-ai", "sdk", "package.json")).version}…`);
  let raw;
  const run = (workspaceId) => claudeResearch({ apiKey: key, workspaceId, Anthropic: Probe, company, website, country });
  try {
    try { raw = await run(process.env.ANTHROPIC_WORKSPACE_ID || ""); } catch (err) {
      if (!/not scoped to a workspace/i.test(String(err && err.message))) throw err;
      console.log(`The key is not tied to a workspace and ${process.env.ANTHROPIC_WORKSPACE_ID ? "the configured workspace was not accepted" : "ANTHROPIC_WORKSPACE_ID is not set"}: this is why live runs fail.`);
      console.log(`The record would say: The research agent failed: ${agentError(err)}`);
      const ws = await findWorkspace();
      if (!ws) throw err;
      console.log("Trying the research in the first workspace the key can see, to check the rest of the run…");
      needsWorkspace = true;
      raw = await run(ws);
    }
  } catch (err) {
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
  if (publicKey) {
    const blob = sealed({ at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), requests: calls, findings: f });
    console.log("\n-----BEGIN SEALED FINDINGS-----");
    for (let i = 0; i < blob.length; i += 120) console.log(blob.slice(i, i + 120));
    console.log("-----END SEALED FINDINGS-----");
  }
  if (needsWorkspace) { console.error("The research works, but only with a workspace named: set the ANTHROPIC_WORKSPACE_ID repository secret (or use a key created inside a workspace) and redeploy."); process.exit(1); }
  if (filled < 8) { console.error("Too little came back for a well-known company."); process.exit(1); }
})();
