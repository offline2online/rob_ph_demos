// node tools/check-personal-emails.test.js — no dependencies.
"use strict";
const assert = require("assert");
const { scanText, isAllowed } = require("./check-personal-emails.js");
// Addresses are assembled at run time so this file passes its own check.
const at = (local, domain) => `${local}@${domain}`;
const allow = { exact: new Set([at("listed", "company.com")]), patterns: [/@your(company)?domain\.com$/i] };
const flagged = (t) => scanText(t, allow).map((h) => h.addr);

// Personal addresses are caught, whatever the case.
assert.deepStrictEqual(flagged(`const ADMINS = ["${at("jane.doe", "company.com")}"];`), [at("jane.doe", "company.com")]);
assert.deepStrictEqual(flagged(`Mail ${at("Jane.Doe", "Gmail.com")}.`), [at("Jane.Doe", "Gmail.com")]);
assert.deepStrictEqual(flagged(`avatars/${at("jane", "company.com")}.jpg`), [at("jane", "company.com.jpg")]);
// Fixtures, services, roles, placeholders and URL user-info are not.
for (const ok of ["owner@example.com", "minh@ph.example", "a@x.test", "x@sub.example.org", "deploy@proj.iam.gserviceaccount.com", "123456789-compute@developer.gserviceaccount.com",
  "board-automation@backlog-tracker-e4ed2.firebaseapp.com", "1+bot@users.noreply.github.com", "support@company.com",
  "you@company.com", "git@github.com", at("listed", "company.com"), "itadmin@yourdomain.com", "logo@2x.png", "owner@example.com.jpg"]) {
  assert.ok(isAllowed(ok, allow), ok);
}
assert.ok(!isAllowed(at("jane", "developer.gserviceaccount.com.evil.io"), allow), "service-domain look-alike");
assert.deepStrictEqual(flagged(`o/avatars%2F${"jane"}%40${"company.com"}.jpg`).length, 1, "URL-encoded");
assert.deepStrictEqual(flagged("https://user:pw@host.com/x and https://name@host.com/"), []);
console.log("check-personal-emails self-test: ok");
