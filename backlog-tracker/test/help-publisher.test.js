// Help-article WordPress publisher: pure logic against an in-memory WordPress.
// Run with: node test/help-publisher.test.js
const assert = require("assert");
const P = require("../functions/help-publisher");

(async () => {
  // sanitiser
  const dirty = '<p onclick="x()">Hi <script>alert(1)</script><a href="javascript:bad()">a</a><a href="https://e.com/x">b</a></p><iframe src="https://evil.com/x"></iframe><iframe src="https://www.youtube.com/embed/1"></iframe><style>p{}</style><foo>kept</foo><img src="https://e.com/i.png" alt="i">';
  const clean = P.sanitizeHtml(dirty);
  assert.ok(!/script|onclick|javascript:|evil|<style|<foo/i.test(clean), clean);
  assert.ok(clean.includes("kept") && clean.includes("youtube.com/embed/1") && /rel="noopener noreferrer"/.test(clean));
  assert.strictEqual(P.renderBody("## Head\n- one\npara"), "<h2>Head</h2><ul><li>one</li></ul><p>para</p>");

  // link rewrite
  const un = [];
  assert.strictEqual(P.rewriteArticleLinks('<a href="article.html?id=a2#x">', { a2: "https://w/a2/" }, un), '<a href="https://w/a2/#x">');
  P.rewriteArticleLinks('<a href="article.html?id=zz">', {}, un); assert.deepStrictEqual(un, ["article.html?id=zz"]);

  // selection: drafts, tombstones, out-of-range are never published
  const releases = [{ id: "r1", order: 1, status: "live", version: "4.2" }, { id: "r2", order: 2, status: "draft", version: "5.0" }];
  const cats = [{ id: "c1", name: "Start", order: 0, parentId: null }, { id: "c2", name: "Folder", order: 1, parentId: "c1" }];
  const art = (id, o = {}) => ({ id, categoryId: "c2", order: 1, title: "T" + id, slug: "s" + id, summary: "sum", keywords: ["k"], docType: "faq", status: "published", updatedAt: "2026-11-01T00:00:00Z", bodyMd: `<p>${id} <a href="article.html?id=a2">x</a></p>`, introducedInReleaseId: "r1", seoTitle: "SEO " + id, metaDescription: "md", directAnswer: "da", questionVariants: ["q?"], ...o });
  const articles = [art("a1"), art("a2"), art("draft", { status: "draft" }), art("future", { introducedInReleaseId: "r2" }), art("tomb")];
  const sel = P.selectArticles({ articles, releases, retiredIds: ["tomb"] });
  assert.deepStrictEqual(sel.publish.map((a) => a.id), ["a1", "a2"]);
  assert.deepStrictEqual(sel.retire.map((a) => a.id).sort(), ["draft", "future", "tomb"]);

  // in-memory WordPress
  const posts = []; const terms = []; const writes = [];
  const wp = async (m, p, body) => {
    if (m !== "GET") writes.push([m, p]);
    if (p.startsWith("/wp/v2/help-categories")) {
      if (m === "GET") return { status: 200, json: terms };
      const t = { id: 100 + terms.length, link: "https://w/cat", meta: body.meta, ...body }; terms.push(t); return { status: 201, json: t };
    }
    if (m === "GET" && p.includes("/revisions")) return { status: 200, json: posts[0].revs || [] };
    if (m === "GET") { const id = decodeURIComponent((p.match(/meta_value=([^&]+)/) || p.match(/search=([^&]+)/) || [])[1] || ""); return { status: 200, json: posts.filter((x) => x.meta.ph_help_id === id) }; }
    const pid = (p.match(/help-articles\/(\d+)/) || [])[1];
    let post = pid && posts.find((x) => x.id === +pid);
    if (!post) { post = { id: 500 + posts.length, link: `https://w/${body.slug}/`, revs: [] }; posts.push(post); }
    post.revs.push({ id: 900 + post.revs.length, title: { raw: post.title }, excerpt: { raw: post.excerpt }, content: { raw: post.content } });
    Object.assign(post, body, { meta: { ...(post.meta || {}), ...body.meta } });
    return { status: 200, json: post };
  };
  const run = (o) => P.publishBatch({ articles, categories: cats, releases, retiredIds: ["tomb"], wp, ...o });

  // 1. dry run writes nothing (other than reading) and reports
  let r = await run({ dryRun: true });
  assert.strictEqual(writes.length, 0); assert.deepStrictEqual(r.report.created.sort(), ["a1", "a2"]);

  // 2. apply creates with every field, category parent/child and console order
  r = await run({ dryRun: false });
  assert.deepStrictEqual(r.report.failed, []);
  assert.strictEqual(posts.length, 2);
  const p1 = posts.find((x) => x.meta.ph_help_id === "a1");
  assert.strictEqual(p1.meta._seopress_titles_title, "SEO a1"); assert.strictEqual(p1.meta.ph_help_release_from, "4.2");
  assert.deepStrictEqual(p1.meta.ph_help_questions, ["q?"]); assert.strictEqual(p1.menu_order, 1); assert.strictEqual(p1.meta.ph_help_version, 1);
  assert.strictEqual(terms.length, 2); assert.strictEqual(terms[1].parent, terms[0].id);
  assert.ok(p1.content.includes('href="https://w/s2/"') || p1.content.includes("https://w/"), p1.content);
  assert.ok(!posts.some((x) => ["draft", "future", "tomb"].includes(x.meta.ph_help_id)));

  // 3. unchanged re-run writes nothing; an edit updates and bumps the version
  writes.length = 0; r = await run({ dryRun: false });
  assert.strictEqual(writes.length, 0); assert.deepStrictEqual(r.report.unchanged.sort(), ["a1", "a2"]);
  articles[0] = art("a1", { bodyMd: "<p>edited</p>" });
  r = await run({ dryRun: false, previous: {} });
  assert.deepStrictEqual(r.report.updated, ["a1"]); assert.strictEqual(r.records.a1.version, 2);

  // 4. single approved fix only touches that article
  articles[1] = art("a2", { title: "New" });
  writes.length = 0; r = await run({ dryRun: false, onlyIds: ["a2"] });
  assert.deepStrictEqual(r.report.updated, ["a2"]);

  // 5. rollback restores the previous revision
  const rb = await P.rollbackArticle({ id: "a1", wp, dryRun: false });
  assert.ok(rb.ok); assert.ok(posts.find((x) => x.meta.ph_help_id === "a1").content.includes("a1"));

  // 6. retire: article leaves the export -> unpublished with a redirect target
  articles.splice(0, 1, art("a1", { status: "draft" }));
  r = await run({ dryRun: false });
  assert.deepStrictEqual(r.report.retired, ["a1"]); assert.strictEqual(posts.find((x) => x.meta.ph_help_id === "a1").status, "draft");
  assert.ok(r.report.redirects[0].to.includes("w/"));

  // 7. url map covers help centre and freshdesk ids
  const map = P.buildUrlMap({ articles: [{ id: "faq-art-123" }], urlById: { "faq-art-123": "https://w/x/" } });
  assert.strictEqual(map.length, 2); assert.ok(map[1].from.endsWith("/support/solutions/articles/123"));
  console.log("help-publisher.test.js: ok");
})().catch((e) => { console.error(e); process.exit(1); });
