#!/usr/bin/env node
// Post-deploy check: the console at LIVE_URL must serve the build we just deployed.
//
//   EXPECT_TREE=<content fingerprint> EXPECT_VERSION=<APP_VERSION> [LIVE_URL=...] node verify-live-deploy.js
//
// Fetches /build-info.json (written by build-console.js, served no-store) with a cache-busting
// query, and /js/version.js, and retries for up to ~3 minutes while the CDN catches up. Exits 1
// when the live site still serves something else, so a "successful" deploy that did not reach
// the live console fails the run instead of being recorded as live (ticket Cq6isfkFAIBSxXpUucNp).
const LIVE_URL = (process.env.LIVE_URL || "https://backlog-tracker-e4ed2.web.app").replace(/\/$/, "");
const { EXPECT_TREE, EXPECT_VERSION } = process.env;
const ATTEMPTS = Number(process.env.VERIFY_ATTEMPTS || 18);
const DELAY_MS = Number(process.env.VERIFY_DELAY_MS || 10000);

async function get(p) {
  const r = await fetch(`${LIVE_URL}${p}${p.includes("?") ? "&" : "?"}v=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } });
  if (!r.ok) throw new Error(`${p} answered ${r.status}`);
  return r.text();
}

async function check() {
  const info = JSON.parse(await get("/build-info.json"));
  const ver = (await get("/js/version.js")).match(/"(\d+\.\d+\.\d+)"/)?.[1] || null;
  const problems = [];
  if (EXPECT_TREE && info.tree !== EXPECT_TREE) problems.push(`live tree ${info.tree} != deployed ${EXPECT_TREE}`);
  if (EXPECT_VERSION && info.version !== EXPECT_VERSION) problems.push(`live build version ${info.version} != ${EXPECT_VERSION}`);
  if (EXPECT_VERSION && ver !== EXPECT_VERSION) problems.push(`live js/version.js ${ver} != ${EXPECT_VERSION}`);
  return { info, problems };
}

(async () => {
  let last = "";
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      const { info, problems } = await check();
      if (!problems.length) {
        console.log(`Live console verified: ${LIVE_URL} serves version ${info.version}, tree ${info.tree}, commit ${info.commit}.`);
        return;
      }
      last = problems.join("; ");
    } catch (e) { last = e.message; }
    console.log(`Attempt ${i}/${ATTEMPTS}: not live yet (${last})`);
    if (i < ATTEMPTS) await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  console.error(`::error title=Deploy did not reach the live console::${last}`);
  process.exit(1);
})();
