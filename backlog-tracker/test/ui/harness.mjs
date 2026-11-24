// Browser harness for the console's click-through tests.
//
// Loads the REAL, unchanged backlog-tracker/public/ files (index.html,
// auth-gate.js, app.js) in Chromium and replaces only what lives off the
// box: the four Firebase SDK modules (served from firebase-stub.mjs), Quill
// (from the quill dev dependency), Google Fonts (empty CSS) and the console's
// own /mcp/* endpoints (answered here). firestore.googleapis.com is refused,
// so app.js's REST prime fails and the listeners carry the data, as they do
// when the prime loses the race in production.
//
// A run FAILS, with the URL or message in it, on: a page error, a console
// error (other than the refused REST prime), or a request to any host that is
// neither local nor routed here. No test reaches the network.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
// HARNESS_PUBLIC_DIR points the run at the minified Hosting build instead
// (ui/minified.test.mjs), so a minifier fault can't reach production unseen.
export const publicDir = process.env.HARNESS_PUBLIC_DIR ? path.resolve(process.env.HARNESS_PUBLIC_DIR) : path.join(here, "..", "..", "public");
export const outDir = path.join(here, "out");
export const stubPath = path.join(here, "firebase-stub.mjs");

const SDK_BASE = "https://www.gstatic.com/firebasejs/10.13.2/";
export const SDK_MODULES = ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js", "firebase-storage.js"];
const quillDist = path.dirname(fileURLToPath(import.meta.resolve("quill")));
// AG Grid (the Docs page lists) is served from the ag-grid-community dev dependency, not jsDelivr.
const agDist = path.resolve(path.dirname(fileURLToPath(import.meta.resolve("ag-grid-community"))), "..", "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon", ".woff2": "font/woff2" };

function staticServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.normalize(path.join(publicDir, rel === "/" ? "index.html" : rel));
    if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

export async function launchChromium() {
  const launch = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM;
  else if (fs.existsSync("/opt/pw-browsers/chromium")) launch.executablePath = "/opt/pw-browsers/chromium";
  return chromium.launch(launch).catch(() => chromium.launch({ headless: true, channel: "chrome" }));
}

// Engines other than Chromium are optional (the Staff Kanban viewport matrix asks for them):
// `harness.engine(name)` returns the launched browser, or null when that engine isn't installed.
export async function startHarness() {
  const server = await staticServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchChromium();
  const engines = new Map([["chromium", browser]]);
  const missing = new Map();
  async function engine(name) {
    if (engines.has(name)) return engines.get(name);
    if (missing.has(name)) return null;
    try { const b = await { firefox, webkit }[name].launch({ headless: true }); engines.set(name, b); return b; }
    catch (e) { missing.set(name, String(e.message || e).split("\n")[0]); return null; }
  }
  const stubSource = fs.readFileSync(stubPath, "utf8");

  // seed: { docs: { collection: { id: fields } }, user: { email, role } }
  // init: { fn, arg } — an extra init script (e.g. a speech-recognition stub).
  // hash defaults to "#board", the Agent Board: a load with no hash lands on the
  // Dashboard (dashboard-page.js), so a case that wants it passes hash: "".
  async function open({ seed = {}, width = 1280, height = 900, hash = "#board", colorScheme, contextOptions = {}, init, engine: engineName = "chromium", waitForApp = true } = {}) {
    const context = await (engines.get(engineName) || browser).newContext({ viewport: { width, height }, ...(colorScheme ? { colorScheme } : {}), ...contextOptions });
    const problems = [];
    const refused = [];
    const mediaKeyWrites = [];
    const aceWrites = [];
    const pcAgentCalls = [];
    const enrichCalls = [];
    const supportCalls = [];
    const agentSendCalls = [];
    const voiceMentionCalls = [];
    // Settings → My Claude Routine (/mcp/me/routine-binding): seed.routineBinding
    // is { hasRoutineBinding }; a POST is recorded in routineWrites and flips it.
    const routineWrites = [];
    let routineBound = !!(seed.routineBinding && seed.routineBinding.hasRoutineBinding);
    const aceStore = (seed.aceOpportunities || []).map((o) => ({ ...o }));
    // Hot Lead → ACE opportunity draft (functions/ace-draft.js): seed.leadAce[leadId] is what
    // GET /partnerCentral/v1/leads/{id}/ace answers; seed.aceSyncPending is the queued stage changes.
    const leadAce = JSON.parse(JSON.stringify(seed.leadAce || {}));
    let aceSync = (seed.aceSyncPending || []).map((x) => ({ ...x }));
    const addProblem = (p) => problems.push(p);
    await context.addInitScript((s) => { window.__FB_SEED = s; }, seed);
    if (init) await context.addInitScript(init.fn, init.arg);
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) {
        if (url.pathname === "/mcp/me/routine-binding") {
          const req = route.request();
          if (req.method() === "POST") {
            const body = JSON.parse(req.postData() || "{}");
            routineWrites.push(body);
            routineBound = !!(body.fireUrl && body.token);
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(routineBound ? { registered: true, hasRoutineBinding: true } : { cleared: true, hasRoutineBinding: false }) });
          }
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hasRoutineBinding: routineBound, boundAt: null, bootstrapPrompt: "Fetch backlog-tracker/ROUTINE_INSTRUCTIONS.md and follow it.", routinesUrl: "https://claude.ai/code/routines" }) });
        }
        if (url.pathname.startsWith("/mcp/") && !url.pathname.startsWith("/mcp/kanban/")) {
          // /mcp/claims/sync is the background membership check.
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ role: (seed.user && seed.user.role) || "editor", email: (seed.user && seed.user.email) || "editor@ph.example", claimUpdated: false }) });
        }
        // Staff Kanban's endpoints (functions/kanban.js). The agent fill is
        // unconfigured by default, as in production without a key, so the page
        // falls back to its local fill; seed.agentDraft stands in for Claude.
        if (url.pathname === "/mcp/kanban/directory-sync") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ members: 0 }) });
        // The cards are seeded in step with the tickets; a case that seeds them behind answers { done: true } here after the page's own fill.
        if (url.pathname === "/mcp/kanban/backfill-links") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ done: true, after: "", tickets: 0, links: 0 }) });
        if (url.pathname === "/mcp/kanban/backfill") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ done: true, after: "", tickets: 0 }) });
        // Send to Agent (functions/kanban-agent.js): propose answers seed.agentSplit (else
        // the ticket as one), confirm answers ids agent-1… ; every call is returned as agentSendCalls.
        if (url.pathname === "/mcp/kanban/send-to-agent") {
          const body = JSON.parse(route.request().postData() || "{}");
          agentSendCalls.push(body);
          const answer = body.action === "propose"
            ? (seed.agentSplit || { proposal: [{ title: "The whole ticket", description: "", acceptanceCriteria: [] }], source: "ticket", projectId: "" })
            : { created: (body.tickets || []).map((x, i) => ({ id: `agent-${i + 1}`, title: x.title, projectId: body.projectId })), agentTotal: (body.tickets || []).length, agentDone: 0 };
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) });
        }
        // Spoken names in a dictated comment (functions/kanban.js handleVoiceMentions): seed.voiceMentions(text) stands in
        // for the server's match (it alone holds the pronunciations); without it the answer is "no segments" and the
        // page matches against the names it shows. Every text asked about is returned as voiceMentionCalls.
        if (url.pathname === "/mcp/kanban/voice-mentions") {
          const body = JSON.parse(route.request().postData() || "{}");
          voiceMentionCalls.push(body.text);
          const hit = (seed.voiceMentions || []).find((x) => x.text === body.text);
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hit ? { segments: hit.segments, source: "server" } : { segments: null, reason: "error" }) });
        }
        if (url.pathname === "/mcp/kanban/agent-fill") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(seed.agentDraft ? { draft: seed.agentDraft, source: "claude" } : { draft: null, reason: "not-configured" }) });
        }
        // Media Studio key settings (functions/media-keys.js). seed.mediaKeys is
        // the status answer; every other call is answered OK and returned to the
        // test as mediaKeyWrites.
        // AWS Partner Central status (functions/partner-central.js): not linked yet, no calls.
        // One opportunity (the detail dialog): GET/PATCH /v1/ace/{id}, POST /v1/ace to create. Changes are kept in
        // `aceStore` and a save bumps the score, as AWS would; the test reads aceWrites.
        if (url.pathname === "/partnerCentral/v1/ace" && route.request().method() === "POST") {
          const input = JSON.parse(route.request().postData() || "{}"); aceWrites.push({ method: "POST", path: url.pathname, body: input });
          const opp = { id: `N${aceStore.length + 1}`, name: input.name, customer: input.customer, stage: "Prospect", reviewStatus: "Pending Submission", score: 10, expectedMonthly: null, targetCloseDate: input.targetCloseDate || null, nextSteps: input.nextSteps || "", description: input.description || "", createdDate: "2026-11-07T10:00:00Z", lastModifiedDate: "2026-11-07T10:00:00Z", awsSeller: null, partnerCentralUrl: "" };
          aceStore.unshift(opp);
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: opp.id, opportunity: opp }) });
        }
        const aceOne = /^\/partnerCentral\/v1\/ace\/([^/]+)$/.exec(url.pathname);
        if (aceOne) {
          const opp = aceStore.find((o) => o.id === decodeURIComponent(aceOne[1]));
          if (!opp) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) });
          if (route.request().method() === "PATCH") {
            const input = JSON.parse(route.request().postData() || "{}"); aceWrites.push({ method: "PATCH", path: url.pathname, body: input });
            for (const [k, v] of Object.entries(input)) { if (k === "monthlyAmount") opp.expectedMonthly = { amount: Number(v), currency: input.currency || "USD" }; else if (k !== "currency") opp[k] = v; }
            opp.score = (opp.score || 50) + 10; opp.lastModifiedDate = "2026-11-07T12:00:00Z";
          }
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ opportunity: opp }) });
        }
        if (url.pathname === "/partnerCentral/v1/ace") {
          if (seed.aceStatus && seed.aceStatus !== 200) return route.fulfill({ status: seed.aceStatus, contentType: "application/json", body: JSON.stringify({ error: seed.aceError || "Server error" }) });
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ catalog: "Sandbox", truncated: false, opportunities: aceStore }) });
        }
        // Hot Lead → ACE opportunity draft: the lead summary's read (not recorded), Draft (a create held
        // for approval, predicted score 64) and Sync ACE stages (one call); writes go in pcAgentCalls.
        const aceLead = /^\/partnerCentral\/v1\/leads\/([^/]+)\/ace(\/draft)?$/.exec(url.pathname);
        if (aceLead || url.pathname === "/partnerCentral/v1/ace-sync") {
          const method = route.request().method();
          const json = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
          if (method !== "GET") pcAgentCalls.push({ method, path: url.pathname, body: JSON.parse(route.request().postData() || "{}") });
          if (!aceLead) {
            if (method === "GET") return json({ pending: aceSync });
            const n = aceSync.filter((x) => x.opportunityId).length;
            aceSync = aceSync.filter((x) => !x.opportunityId);
            const session = { sessionId: "sess-sync-1", catalog: "Sandbox", status: "requires_approval", lastReply: "I will update the stages. Approve to continue.", createdAt: "2026-11-24T10:00:00Z", updatedAt: "2026-11-24T10:00:00Z", expiresAt: "2026-11-26T10:00:00Z", leadId: null, leadName: null, opportunityId: null, approvals: [{ toolUseId: "tu-sync-1", toolName: "UpdateOpportunity", parameters: { Identifier: "O7654321", LifeCycle: { Stage: "Technical Validation" } }, state: "pending" }] };
            return json({ sent: n, waiting: aceSync.length, session, message: `${n} ACE stage ${n === 1 ? "change waits" : "changes wait"} for your approval.` });
          }
          const id = decodeURIComponent(aceLead[1]);
          const cur = leadAce[id] || { leadId: id, eligible: { ok: false, reason: "No Prospects (TAM) company record for this company, so its primary cloud is not known." }, primaryCloud: null, attachments: [], draft: null, opportunityId: null, opportunity: null, score: null, targetScore: 60, insights: [] };
          if (aceLead[2]) {
            leadAce[id] = { ...cur, draft: { status: "awaiting-approval", reason: "", catalog: "Sandbox", sessionId: "sess-ace-1", predictedScore: 64, recommendations: ["Add the expected monthly spend", "Name the AWS account manager"], pendingApprovals: 1, aceStage: null, stageSync: null, at: "2026-11-24T10:00:00Z", by: "admin@ph.example", auto: false }, score: { value: 64, source: "predicted" } };
            return json({ ok: true, status: "awaiting-approval", reason: "", ace: leadAce[id] });
          }
          return json(cur);
        }
        // Partner Central agent (functions/partner-central.js /v1/agent/*). A message that mentions "draft"
        // comes back holding one write for approval; an approval decides it. Calls are returned as pcAgentCalls.
        if (url.pathname.startsWith("/partnerCentral/v1/agent")) {
          const method = route.request().method();
          const body = method === "GET" ? null : JSON.parse(route.request().postData() || "{}");
          pcAgentCalls.push({ method, path: url.pathname, body });
          const json = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
          if (url.pathname === "/partnerCentral/v1/agent") return json({ catalog: "Sandbox", sessions: [], leads: seed.pcAgentLeads || [{ id: "L1", name: "Demo Brand" }] });
          const base = { sessionId: "sess-1", catalog: "Sandbox", createdAt: "2026-11-24T10:00:00Z", updatedAt: "2026-11-24T10:00:00Z", expiresAt: "2026-11-26T10:00:00Z", leadId: body && body.leadId || null, leadName: body && body.leadId ? "Demo Brand" : null, opportunityId: body && body.opportunityId || null };
          if (url.pathname === "/partnerCentral/v1/agent/messages") {
            const draft = /draft/i.test(body.text || "");
            const session = { ...base, status: draft ? "requires_approval" : "complete", lastReply: draft ? "I will create this draft opportunity. Approve to continue." : "You have 2 open opportunities.", approvals: draft ? [{ toolUseId: "tu-1", toolName: "CreateOpportunity", parameters: { Title: "Test opportunity", Stage: "Prospect" }, state: "pending" }] : [] };
            return json({ session, reply: { sessionId: "sess-1", status: session.status, text: session.lastReply, approvals: session.approvals } });
          }
          if (/\/approvals\//.test(url.pathname)) {
            const approved = body.decision === "approve";
            const session = { ...base, leadName: "Demo Brand", leadId: "L1", status: "complete", lastReply: approved ? "Draft opportunity created (not submitted)." : "Cancelled.", approvals: [{ toolUseId: "tu-1", toolName: "CreateOpportunity", parameters: {}, state: approved ? "approved" : "rejected", decidedBy: "admin@ph.example", decidedAt: "2026-11-24T10:01:00Z" }] };
            return json({ session, reply: { sessionId: "sess-1", status: "complete", text: session.lastReply, approvals: [] } });
          }
          return json({ session: { ...base, status: "complete", lastReply: "Session read.", approvals: [] } });
        }
        // License Manager (functions/marketplace-agreements.js): sync and link are answered OK and
        // returned to the test in aceWrites, like the ACE writes.
        if (url.pathname.startsWith("/partnerCentral/v1/licences/")) {
          const input = JSON.parse(route.request().postData() || "{}"); aceWrites.push({ method: route.request().method(), path: url.pathname, body: input });
          const body = url.pathname.endsWith("/sync") ? { ok: true, count: 2, contactErrors: 0, truncated: false } : { ok: true, agreementId: input.agreementId, prospectId: input.prospectId };
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        }
        // AWS funding for a lead (functions/partner-central.js /v1/funding/{leadId}/*): a check answers
        // seed.fundingAnswer (else POC + Innovation Sandbox eligible, two drafts waiting); calls go in pcAgentCalls.
        const fund = /^\/partnerCentral\/v1\/funding\/([^/]+)\/(check|refresh|poc-approved)$/.exec(url.pathname);
        if (fund) {
          const body = JSON.parse(route.request().postData() || "{}");
          pcAgentCalls.push({ method: route.request().method(), path: url.pathname, body });
          const checked = seed.fundingAnswer || { leadId: fund[1], catalog: "Sandbox", sessionId: "fund-1", opportunityId: "O-TEST-1", status: "requires_approval", structured: true, pendingApprovals: 2, checkedAt: "2026-11-24T10:00:00Z", checkedBy: "admin@ph.example", replyText: "",
            programs: [
              { key: "poc", name: "POC funding", eligible: true, reason: "Technical validation on AWS", estimatedAmount: 25000, currency: "USD", budgetAvailable: 80000, draftId: null },
              { key: "sandbox", name: "Innovation Sandbox credits", eligible: true, reason: "", estimatedAmount: 5000, currency: "USD", budgetAvailable: null, draftId: null },
              { key: "map", name: "MAP", eligible: false, reason: "No migration in scope", estimatedAmount: null, currency: "USD", budgetAvailable: null, draftId: null },
            ], pocApproved: null };
          const funding = fund[2] === "poc-approved" ? { ...checked, pocApproved: body.clear ? null : { at: "2026-11-24T11:00:00Z", by: "admin@ph.example", amount: null, currency: "USD", reference: null } } : checked;
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ funding }) });
        }
        if (url.pathname.startsWith("/partnerCentral/")) {
          const body = url.pathname.endsWith("/audit") ? { entries: [] } : { state: "not-linked", catalog: "Sandbox", roleArn: "arn:aws:iam::817173160653:role/PH-Console-PartnerCentral", lastSuccessAt: null, lastError: null, note: "Not linked yet" };
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        }
        // Company enrichment (functions/lead-enrich.js): the button only queues a run; the
        // test writes what the trigger would. Every call is returned as enrichCalls.
        if (url.pathname === "/leadEnrich/v1/enrich") {
          enrichCalls.push(JSON.parse(route.request().postData() || "{}"));
          return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, queued: true }) });
        }
        // Support Inbox (functions/support-mail.js). seed.supportStatus is the status answer (not connected by
        // default); every other call is answered OK (seed.supportAnswer overrides) and returned as supportCalls.
        if (url.pathname.startsWith("/supportMail/")) {
          const req = route.request();
          if (url.pathname === "/supportMail/v1/status") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(seed.supportStatus || { encryptionReady: true, aiReady: true, clientSet: false, clientId: "", connected: false, connectedEmail: "", connectionError: "", lastSyncAt: null, lastSyncOk: true, lastSyncError: "", redirectUri: `${origin}/supportMail/v1/oauth/callback`, settings: { autoReply: false, autoReplyThreshold: 0.8, escalationAssignee: "", signature: "Personalisation Hub Support", fromName: "Personalisation Hub Support", vipDomains: [], importDays: 7 } }) });
          const callPath = url.pathname.replace("/supportMail/v1/", "");
          supportCalls.push({ method: req.method(), path: callPath, body: JSON.parse(req.postData() || "{}") });
          // seed.supportAnswers: an answer per path (a function gets the call and the calls so far), for a page that makes several kinds of call.
          const per = seed.supportAnswers && seed.supportAnswers[callPath];
          const answer = typeof per === "function" ? per(supportCalls[supportCalls.length - 1], supportCalls) : per;
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer || seed.supportAnswer || { ok: true, newMessages: 0, newTickets: 0 }) });
        }
        if (url.pathname.startsWith("/mediaKeys/")) {
          const req = route.request();
          if (url.pathname === "/mediaKeys/v1/status") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(seed.mediaKeys || { encryptionReady: true, providers: [] }) });
          mediaKeyWrites.push({ method: req.method(), path: url.pathname, body: req.postData() });
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, message: "Key works" }) });
        }
        return route.fallback();
      }
      if (url.href.startsWith(SDK_BASE) && SDK_MODULES.includes(url.pathname.split("/").pop())) {
        return route.fulfill({ status: 200, contentType: "text/javascript", body: stubSource });
      }
      if (url.hostname === "cdnjs.cloudflare.com" && url.pathname.endsWith("/quill/1.3.7/quill.min.js")) return route.fulfill({ status: 200, contentType: "text/javascript", path: path.join(quillDist, "quill.min.js") });
      if (url.hostname === "cdnjs.cloudflare.com" && url.pathname.endsWith("/quill/1.3.7/quill.snow.min.css")) return route.fulfill({ status: 200, contentType: "text/css", path: path.join(quillDist, "quill.snow.css") });
      if (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/ag-grid-community@")) {
        const rel = url.pathname.replace(/^\/npm\/ag-grid-community@[^/]+\//, "");
        const file = path.join(agDist, rel);
        if (!file.startsWith(agDist) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
        return route.fulfill({ status: 200, contentType: file.endsWith(".css") ? "text/css" : "text/javascript", path: file });
      }
      // HARNESS_FONTS_DIR (screenshots only): a folder holding ms.css + ms.woff2, a saved copy of the
      // Material Symbols stylesheet and font, so icons render as glyphs instead of ligature text.
      const fontsDir = process.env.HARNESS_FONTS_DIR;
      if (url.hostname === "fonts.googleapis.com") return fontsDir ? route.fulfill({ status: 200, contentType: "text/css", path: path.join(fontsDir, "ms.css") }) : route.fulfill({ status: 200, contentType: "text/css", body: "" });
      if (fontsDir && url.hostname === "fonts.gstatic.com") return route.fulfill({ status: 200, contentType: "font/woff2", path: path.join(fontsDir, "ms.woff2") });
      // WordPress publish-status endpoint (read-only, FAQ Management). seed.wpPublished is its JSON;
      // seed.wpPublishedDown makes it unreachable, which the page must survive.
      if (url.hostname === "personalisationhub.com" && url.pathname === "/wp-json/ph-help/v1/published") {
        if (seed.wpPublishedDown) return route.fulfill({ status: 503, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(seed.wpPublished || { lastSync: new Date().toISOString(), pending: 0, failed: [], articles: [] }) });
      }
      if (url.hostname === "firestore.googleapis.com") { refused.push(url.href); return route.abort("failed"); }
      // Storage downloads (the stub's upload URLs): a 1x1 PNG stands in.
      if (url.hostname === "firebasestorage.googleapis.com") return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64") });
      addProblem(`request to unrouted host: ${url.href}`);
      return route.abort("failed");
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => addProblem(`page error: ${err && err.message}`));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const where = (msg.location() && msg.location().url) || "";
      if (where.includes("firestore.googleapis.com")) return; // the refused REST prime
      if (where.includes("/wp-json/ph-help/v1/published")) return; // the WordPress status endpoint, seeded as down
      addProblem(`console error: ${msg.text()}${where ? ` (${where})` : ""}`);
    });
    page.on("dialog", (d) => { addProblem(`native ${d.type()} dialog: ${d.message()}`); d.dismiss().catch(() => {}); });
    await page.goto(`${origin}/${hash}`, { waitUntil: "domcontentloaded" });
    // Wait for the console to have started before the test's first selector:
    // on a loaded runner the sign-in stub and app.js's import took longer than
    // a case's own 8 s wait, and the case failed on a page that was still
    // starting (Modals @820px, Promote Leads, mobile-shell; 24 Oct-14 Nov 2026).
    if (waitForApp) await appRendered(page).catch(() => {});
    return { page, context, problems, refused, mediaKeyWrites, aceWrites, pcAgentCalls, enrichCalls, supportCalls, agentSendCalls, voiceMentionCalls, routineWrites, origin, close: () => context.close() };
  }

  return {
    open, origin, engine, missing,
    async close() { for (const b of engines.values()) await b.close(); await new Promise((r) => server.close(r)); },
  };
}

// Poll a condition; never a fixed sleep. Resolves with the truthy value.
export async function until(fn, what, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 40));
  }
}

// The console has started: signed in and app.js evaluated (auth-gate.js drops
// <html data-booting> after the import), or the sign-in wall / a start-up
// error is showing (a case about those has nothing more to wait for). Up to
// 30 s, and a page that never gets there is left to the case's own assertion.
export async function appRendered(page, ms = 30000) {
  await page.waitForFunction(() => {
    const root = document.documentElement;
    if (root.classList.contains("signed-in") && !("booting" in root.dataset)) return true;
    const gate = document.getElementById("auth-gate");
    return !!(gate && !gate.hidden && !("booting" in root.dataset));
  }, null, { timeout: ms });
}
