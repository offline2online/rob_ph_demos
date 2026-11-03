// Unit tests for the WordPress publish-status logic (FAQ Management).
import assert from "node:assert";
import crypto from "node:crypto";
import { contentHashOf, parsePublished, articleStatus, liveUrlFor, lastSyncLabel, fetchPublished } from "../public/js/wp-publish-status.js";

const body = "# Hello\n\nSome **body** text — with unicode é.";
const expected = crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);
assert.strictEqual(await contentHashOf(body), expected, "same digest as faq-export.js");
assert.strictEqual(await contentHashOf(undefined), crypto.createHash("sha256").update("").digest("hex").slice(0, 16));

const pub = parsePublished({ lastSync: "2026-11-03T10:00:00Z", pending: 1, failed: ["f1"], articles: [
  { id: "a1", url: "https://personalisationhub.com/support-centre/cat/a1/", wpId: 5, hash: expected, updatedAt: "x" },
  { id: "a2", url: "https://personalisationhub.com/support-centre/cat/a2/", wpId: 6, hash: "old", updatedAt: "x" },
] });
const art = (o) => ({ id: "a1", status: "published", ...o });

assert.strictEqual(articleStatus({ article: art(), inRange: true, hash: expected, published: pub }), "live");
assert.strictEqual(articleStatus({ article: art({ id: "a2" }), inRange: true, hash: expected, published: pub }), "waiting", "older hash");
assert.strictEqual(articleStatus({ article: art({ id: "zz" }), inRange: true, hash: expected, published: pub }), "waiting", "absent");
assert.strictEqual(articleStatus({ article: art({ id: "f1" }), inRange: true, hash: expected, published: pub }), "failed");
assert.strictEqual(articleStatus({ article: art({ status: "draft" }), inRange: true, hash: expected, published: pub }), "not-published", "draft");
assert.strictEqual(articleStatus({ article: art({ retiredAt: 1 }), inRange: true, hash: expected, published: pub }), "not-published", "retired");
assert.strictEqual(articleStatus({ article: art(), inRange: false, hash: expected, published: pub }), "not-published", "out of range");
assert.strictEqual(articleStatus({ article: art({ status: "draft", id: "f1" }), inRange: true, hash: expected, published: pub }), "not-published", "draft beats failed");
assert.strictEqual(articleStatus({ article: art(), inRange: true, hash: expected, published: null }), "unavailable");

assert.strictEqual(liveUrlFor("a1", pub), "https://personalisationhub.com/support-centre/cat/a1/", "uses the endpoint url");
assert.strictEqual(liveUrlFor("nope x", pub), "https://personalisationhub.com/support-centre/article.html?id=nope%20x", "falls back");
assert.strictEqual(liveUrlFor("a1", null), "https://personalisationhub.com/support-centre/article.html?id=a1");

const now = Date.parse("2026-11-03T10:30:00Z");
assert.strictEqual(lastSyncLabel(pub, now), "Last WordPress sync: 30 min ago");
assert.strictEqual(lastSyncLabel(null, now), "Last WordPress sync: unavailable");

assert.throws(() => parsePublished({}), /unexpected/);
assert.throws(() => parsePublished(null));
await assert.rejects(fetchPublished(async () => ({ ok: false, status: 503 })), /503/);
await assert.rejects(fetchPublished(async () => { throw new Error("blocked"); }), /blocked/);
const got = await fetchPublished(async () => ({ ok: true, json: async () => ({ articles: [], failed: [] }) }));
assert.strictEqual(got.byId.size, 0);
console.log("wp-publish-status: all passed");
