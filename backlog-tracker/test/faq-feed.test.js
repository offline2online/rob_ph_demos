// Live help data feed (GET /help-api/data/*) and the Support Centre refresh
// ping: field allow-list shared with faq-export.js, published-only, ETag,
// and the debounce. Run with: node test/faq-feed.test.js
const assert = require("assert");
const { createHelpApi } = require("../functions/help-search");
const feed = require("../functions/faq-feed");

let passed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { failures.push(name); console.log(`FAIL  ${name}\n      ${e && e.stack}`); }
}

const ts = (iso) => ({ toDate: () => new Date(iso) });
const docs = {
  faqArticles: {
    a1: { title: "View a display's status", summary: "s", keywords: ["display"], categoryId: "c1", status: "published", slug: "view", bodyMd: "<p>Body</p>", docType: "how-to", order: 2, updatedAt: ts("2026-11-04T10:00:00.123Z"), directAnswer: "Open Displays.", introducedInReleaseId: "r1",
      pendingRevision: { title: "SECRET PENDING", bodyMd: "SECRET PENDING BODY" }, retireProposal: { reason: "SECRET RETIRE" }, internalNote: "SECRET INTERNAL", authorEmail: "x@y.z" },
    a2: { title: "Draft thing", categoryId: "c1", status: "draft", bodyMd: "SECRET DRAFT BODY" },
    a3: { title: "Second", categoryId: "c1", status: "published", bodyMd: "b", order: 1, updatedAt: "2026-11-01T00:00:00Z" },
  },
  faqCategories: { c1: { name: "Displays", icon: "tv", order: 1 }, c0: { name: "Start", order: 0 } },
  releases: { r1: { name: "Sept", version: "4.2", status: "live", order: 1 }, r2: { name: "Next", status: "weird", order: 2 } },
};
const snap = (name, f = () => true) => { const rows = Object.entries(docs[name]).filter(([, v]) => f(v)); return { forEach: (fn) => rows.forEach(([id, v]) => fn({ id, data: () => v })) }; };
const db = { collection: (name) => ({
  where: () => ({ get: async () => snap(name, (a) => a.status === "published") }),
  get: async () => snap(name),
  add: async () => {},
}) };
let t = 5_000_000;
const api = () => createHelpApi({ db, now: () => t, fetchImpl: null, rateMax: 3 });
function call(a, path, headers = {}) {
  return new Promise((resolve) => {
    const out = { headers: {}, code: 200 };
    const res = { set(k, v) { if (typeof k === "object") Object.assign(out.headers, k); else out.headers[k.toLowerCase()] = v; return res; },
      status(c) { out.code = c; return res; }, type(x) { out.headers["content-type"] = x; return res; },
      json(b) { out.body = JSON.stringify(b); resolve(out); }, send(b) { out.body = b; resolve(out); } };
    a.handle({ method: "GET", path: `/help-api${path}`, query: {}, ip: "1.1.1.1", get: (h) => headers[h.toLowerCase()] }, res);
  });
}

(async () => {
  await test("articles/<id>.json equals the record faq-export writes, published fields only", async () => {
    const r = await call(api(), "/data/articles/a1.json");
    assert.strictEqual(r.code, 200);
    assert.strictEqual(r.body, feed.serializeArticle(feed.articleRecord("a1", docs.faqArticles.a1)));
    const j = JSON.parse(r.body);
    assert.deepStrictEqual(Object.keys(j), ["id", "categoryId", "order", "title", "slug", "summary", "keywords", "docType", "status", "sectionPicker", "sectionPickerLabel", "directAnswer", "introducedInReleaseId", "updatedAt", "contentHash", "bodyMd"]);
    assert.strictEqual(j.updatedAt, "2026-11-04T10:00:00Z");
    for (const secret of ["SECRET", "pendingRevision", "retireProposal", "internalNote", "authorEmail"]) assert.ok(!r.body.includes(secret), secret);
  });
  await test("index.json lists published articles only, in export order, with categories", async () => {
    const r = await call(api(), "/data/index.json");
    const j = JSON.parse(r.body);
    assert.deepStrictEqual(j.articles.map((a) => a.id), ["a3", "a1"]);
    assert.ok(j.articles.every((a) => a.status === "published" && !("bodyMd" in a)));
    assert.deepStrictEqual(j.categories.map((c) => c.id), ["c0", "c1"]);
    assert.ok(!r.body.includes("SECRET"));
    assert.strictEqual(r.body, feed.serializeIndex(j));
  });
  await test("a draft is a 404; releases.json matches the export shape", async () => {
    assert.strictEqual((await call(api(), "/data/articles/a2.json")).code, 404);
    assert.strictEqual((await call(api(), "/data/articles/..%2Fx.json")).code, 404);
    const r = await call(api(), "/data/releases.json");
    assert.deepStrictEqual(JSON.parse(r.body), [{ id: "r1", name: "Sept", version: "4.2", status: "live", order: 1 }, { id: "r2", name: "Next", version: null, status: "draft", order: 2 }]);
  });
  await test("Cache-Control max-age=60 and ETag; If-None-Match gives 304", async () => {
    const a = api();
    const r = await call(a, "/data/index.json");
    assert.strictEqual(r.headers["cache-control"], "public, max-age=60");
    assert.ok(/^"[0-9a-f]{40}"$/.test(r.headers.etag));
    const n = await call(a, "/data/index.json", { "if-none-match": r.headers.etag });
    assert.strictEqual(n.code, 304);
  });
  await test("retiring an article removes it within the 60 s cache window", async () => {
    const a = api();
    assert.ok(JSON.parse((await call(a, "/data/index.json")).body).articles.some((x) => x.id === "a3"));
    docs.faqArticles.a3.status = "draft"; docs.faqArticles.a3.retiredAt = "2026-11-04T00:00:00Z";
    t += 61_000;
    assert.ok(!JSON.parse((await call(a, "/data/index.json")).body).articles.some((x) => x.id === "a3"));
    assert.strictEqual((await call(a, "/data/articles/a3.json")).code, 404);
    docs.faqArticles.a3.status = "published"; delete docs.faqArticles.a3.retiredAt;
  });
  await test("the help API's rate limit covers the feed", async () => {
    const a = api();
    for (let i = 0; i < 3; i++) assert.strictEqual((await call(a, "/data/index.json")).code, 200);
    assert.strictEqual((await call(a, "/data/index.json")).code, 429);
  });

  await test("only published-content changes count: pendingRevision / draft edits do not", () => {
    const base = docs.faqArticles.a1;
    assert.strictEqual(feed.articleChangesPublished("a1", base, { ...base, pendingRevision: { title: "other" } }), false);
    assert.strictEqual(feed.articleChangesPublished("a1", docs.faqArticles.a2, { ...docs.faqArticles.a2, bodyMd: "new draft body" }), false);
    assert.strictEqual(feed.articleChangesPublished("a1", base, { ...base, updatedAt: ts("2026-12-01T00:00:00Z") }), false);
    for (const change of [{ bodyMd: "x" }, { title: "T" }, { order: 9 }, { categoryId: "c0" }, { status: "draft" }, { removedInReleaseId: "r2" }, { introducedInReleaseId: "r2" }]) {
      assert.strictEqual(feed.articleChangesPublished("a1", base, { ...base, ...change }), true, JSON.stringify(change));
    }
    assert.strictEqual(feed.articleChangesPublished("a1", null, base), true); // created published
    assert.strictEqual(feed.articleChangesPublished("a1", base, null), true); // deleted
    assert.strictEqual(feed.categoryChangesPublished("c1", docs.faqCategories.c1, { ...docs.faqCategories.c1, order: 5 }), true);
    assert.strictEqual(feed.categoryChangesPublished("c1", docs.faqCategories.c1, { ...docs.faqCategories.c1, updatedAt: "x" }), false);
  });

  // Debounce: memory store with the same claim/done contract as Firestore's.
  function memoryStore() {
    const s = { pendingUntil: 0, lastPingAt: 0 };
    return { s,
      async claim(now, co, gap) { if (s.pendingUntil > now) return null; const f = Math.max(now + co, s.lastPingAt + gap); s.pendingUntil = f; return f; },
      async done(now) { s.lastPingAt = now; s.pendingUntil = 0; } };
  }
  function pinger(clock) {
    const calls = []; const logs = [];
    const store = memoryStore();
    const p = feed.createRefreshPinger({ store, now: () => clock.t, sleep: async (ms) => { clock.t += ms; },
      fetchImpl: async (url, opts) => { calls.push({ url, opts, at: clock.t }); if (clock.fail) throw new Error("boom"); return { status: 200 }; },
      logger: { info: (m) => logs.push(["info", m]), warn: (m) => logs.push(["warn", m]) } });
    return { p, calls, logs, store };
  }
  await test("two quick edits make one ping: POST, no body, to the refresh endpoint", async () => {
    const clock = { t: 1_000_000 }; const { p, calls } = pinger(clock);
    // the second edit arrives while the first still sleeps in its coalescing window
    const first = p.request();
    const second = await p.request();
    await first;
    assert.strictEqual(second.skipped, true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, "https://personalisationhub.com/wp-json/ph-help/v1/refresh");
    assert.strictEqual(calls[0].opts.method, "POST");
    assert.ok(!("body" in calls[0].opts));
  });
  await test("an edit after a ping waits for the 60 s gap; never more than one call per 60 s", async () => {
    const clock = { t: 1_000_000 }; const { p, calls } = pinger(clock);
    await p.request(); const sentAt = calls[0].at;
    clock.t += 8_000;
    await p.request();
    assert.strictEqual(calls.length, 2);
    assert.ok(calls[1].at - sentAt >= 60_000, `${calls[1].at - sentAt}`);
    clock.t += 120_000;
    await p.request();
    assert.ok(calls[2].at - calls[1].at >= 60_000);
  });
  await test("a failed ping is logged once, not retried", async () => {
    const clock = { t: 1_000_000, fail: true }; const { p, calls, logs } = pinger(clock);
    const r = await p.request();
    assert.strictEqual(r.sent, false);
    assert.strictEqual(calls.length, 1);
    assert.ok(logs.some(([l, m]) => l === "warn" && /failed/.test(m)));
  });
  await test("the ping has a 4 s timeout that aborts the request", async () => {
    assert.strictEqual(feed.REFRESH_TIMEOUT_MS, 4000);
    let signal; const store = memoryStore();
    const p = feed.createRefreshPinger({ store, sleep: async () => {}, now: () => 1e6, fetchImpl: (u, o) => { signal = o.signal; return new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted")))); }, logger: null });
    const started = Date.now();
    const r = await p.request();
    assert.strictEqual(r.sent, false);
    assert.ok(signal.aborted && Date.now() - started < 6000);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
