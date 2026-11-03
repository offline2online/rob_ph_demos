// Publish approved help articles to the Support Centre on personalisationhub.com
// (WordPress) — the push publisher (LYbxv1nqC3EaJ53ryaa8). Logic lives in
// functions/help-publisher.js; this is the thin runner.
//
//   node faq-wp-publish.js                       dry run of the whole batch (default, writes nothing)
//   node faq-wp-publish.js --apply               publish the batch
//   node faq-wp-publish.js --apply --only id,id  publish single approved fixes
//   node faq-wp-publish.js --rollback <id> [--apply]
//   --record     also store the wpPublish record on faqArticles/<id> (needs Firestore creds)
//   --report f   write the run report JSON (default: faq-wp-report.json), plus faq-wp-url-map.json
//
// Env: WP_AUTH = base64("<wp-username>:<application-password>") (same value as
// ELEMENTOR_MCP_AUTH); WP_BASE (default https://personalisationhub.com);
// WP_PROGRAMME / WP_PROJECT (scope stamped on articles that carry none).
// Never commit the credential — the repo is public.
const fs = require("fs");
const path = require("path");
const P = require("../functions/help-publisher");

const DATA = path.resolve(__dirname, "../../faq/data");
const arg = (n) => { const i = process.argv.indexOf(n); return i < 0 ? null : (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true); };
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch { return d; } };

function client(base, auth) {
  return async (method, p, body) => {
    const res = await fetch(`${base}/wp-json${p}`, { method, headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, json };
  };
}

async function main() {
  const apply = !!arg("--apply");
  const base = (process.env.WP_BASE || "https://personalisationhub.com").replace(/\/$/, "");
  if (!process.env.WP_AUTH) { console.error("faq-wp-publish: WP_AUTH is not set (base64 of user:application-password)"); process.exit(2); }
  const wp = client(base, process.env.WP_AUTH);

  if (arg("--rollback")) {
    const r = await P.rollbackArticle({ id: arg("--rollback"), wp, dryRun: !apply });
    console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1);
  }

  const index = read("index.json", { categories: [], articles: [] });
  const releases = read("releases.json", []);
  const retiredIds = read("retired.json", []);
  const articles = index.articles.map((m) => ({ ...m, ...read(`articles/${m.id}.json`, {}) }));
  const uploadMedia = async (url) => {
    const img = await fetch(url); if (!img.ok) return null;
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "image");
    const res = await fetch(`${base}/wp-json/wp/v2/media`, { method: "POST", headers: { Authorization: `Basic ${process.env.WP_AUTH}`, "Content-Disposition": `attachment; filename="${name}"`, "Content-Type": img.headers.get("content-type") || "application/octet-stream" }, body: Buffer.from(await img.arrayBuffer()) });
    const j = await res.json().catch(() => null); return res.ok && j ? j.source_url : null;
  };
  const only = arg("--only");
  const { report, records, urlById } = await P.publishBatch({
    articles, categories: index.categories, releases, retiredIds, wp, uploadMedia, mediaHost: new URL(base).hostname, dryRun: !apply,
    onlyIds: only && only !== true ? only.split(",") : null,
    scope: { programme: process.env.WP_PROGRAMME || "", project: process.env.WP_PROJECT || "" },
  });
  // Counts per category, compared with the console (the migration report).
  const consoleCounts = {}; for (const a of P.selectArticles({ articles, releases, retiredIds }).publish) consoleCounts[a.categoryId] = (consoleCounts[a.categoryId] || 0) + 1;
  report.consoleCountsPerCategory = consoleCounts;
  fs.writeFileSync(arg("--report") && arg("--report") !== true ? arg("--report") : "faq-wp-report.json", JSON.stringify(report, null, 2));
  fs.writeFileSync("faq-wp-url-map.json", JSON.stringify(P.buildUrlMap({ articles, urlById }), null, 2));
  if (apply && arg("--record")) {
    const { initializeApp, applicationDefault } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    initializeApp({ credential: applicationDefault() });
    const db = getFirestore();
    for (const [id, rec] of Object.entries(records)) await db.collection("faqArticles").doc(id).set({ wpPublish: rec }, { merge: true });
  }
  console.log(`faq-wp-publish${apply ? "" : " (dry run)"}: ${report.created.length} created, ${report.updated.length} updated, ${report.unchanged.length} unchanged, ${report.retired.length} retired, ${report.failed.length} failed`);
  if (report.failed.length) process.exit(1);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
