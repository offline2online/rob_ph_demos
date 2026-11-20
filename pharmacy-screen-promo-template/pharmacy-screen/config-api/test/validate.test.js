"use strict";

// Unit checks for the validators the API relies on.

const test = require("node:test");
const assert = require("node:assert/strict");
const v = require("../src/validate");

test("store codes and promo IDs are normalised and checked", () => {
  assert.equal(v.normaliseStoreCode(" vic-mp-001 "), "VIC-MP-001");
  assert.throws(() => v.normaliseStoreCode("A"), /storeCode/);
  assert.throws(() => v.normaliseStoreCode("VIC MP"), /storeCode/);
  assert.throws(() => v.normaliseStoreCode("../x"), /storeCode/);
  assert.equal(v.normalisePromoId("Morning"), "morning");
  assert.throws(() => v.normalisePromoId("-x"), /promoId/);
  assert.throws(() => v.normalisePromoId("a/b"), /promoId/);
});

test("pharmacy normaliser keeps only known fields and the stored logo", () => {
  const stored = { storeCode: "VIC-MP-001", name: "B", colours: { primary: "#000000", accent: "#ffffff" }, logo: { path: "p", url: "u", contentType: "image/png" }, content: {} };
  const out = v.normalisePharmacy({ name: "B2", logo: null, extra: 1, colours: { primary: "#ABCDEF" } }, stored);
  assert.deepEqual(out, { storeCode: "VIC-MP-001", name: "B2", colours: { primary: "#abcdef", accent: "#ffffff" }, logo: { path: "p", url: "u", contentType: "image/png" }, content: {} });
});

test("content: JSON only, bounded, no prototype keys, no script markup", () => {
  assert.throws(() => v.normalisePharmacy({ storeCode: "AB", name: "n", colours: { primary: "#000000", accent: "#000000" }, content: { p: JSON.parse('{"__proto__":{"x":1}}') } }), /reserved key/);
  let deep = {};
  const root = deep;
  for (let i = 0; i < 20; i++) deep = deep.a = {};
  assert.throws(() => v.safeJson(root, "c"), /nested too deeply/);
  assert.throws(() => v.safeJson({ a: "<SCRIPT src=x>" }, "c"), /not allowed/);
  assert.throws(() => v.safeJson({ a: "<a href='x' onclick='y'>" }, "c"), /event handler/);
  assert.deepEqual(v.safeJson({ a: ["one = two", 1, true, null] }, "c"), { a: ["one = two", 1, true, null] });
  const big = { s: "x".repeat(v.LIMITS.content + 10) };
  assert.throws(() => v.normalisePharmacy({ storeCode: "AB", name: "n", colours: { primary: "#000000", accent: "#000000" }, content: { p: big } }), /larger than/);
});

test("template normaliser: kind required, backgrounds only from the stored record", () => {
  assert.throws(() => v.normaliseTemplate({ name: "x" }), /kind/);
  const out = v.normaliseTemplate({ name: "x", kind: "opening-hours", backgrounds: { portrait: { path: "evil", url: "evil" } } });
  assert.deepEqual(out.backgrounds, { portrait: null, landscape: null });
});
