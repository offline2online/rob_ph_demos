// Promote › Leads: website lead submissions.
//   POST /leadIngest/v1/submit   header X-Lead-Key: <LEAD_INGEST_KEY>   JSON or form body
// Called server-to-server by personalisationhub.com (the key never reaches a
// browser). Creates or updates one lead per company, source "website", with the
// page and industry it came from. A submission with test=true is stored as a
// test lead: it is never matched with a real lead, is excluded from enrichment
// (lead-enrich.js), the MCP tools (leads.js) and the board, and is removed in
// one click from the Leads page's Test view.
"use strict";
const crypto = require("crypto");
const { FieldValue } = require("firebase-admin/firestore");
const core = require("./leads-core");

const keyMatches = (given, want) => {
  const a = crypto.createHash("sha256").update(String(given || "")).digest();
  const b = crypto.createHash("sha256").update(String(want || "")).digest();
  // "unset" is the placeholder deploy-backlog-tracker.yml stores when the
  // LEAD_INGEST_KEY repo secret is empty: it means no key, never a key.
  return Boolean(want) && want !== "unset" && crypto.timingSafeEqual(a, b);
};

function createLeadIngest({ db, key, logger }) {
  const send = (res, status, body) => res.status(status).set("Cache-Control", "no-store").json(body);
  const nameKey = (n) => String(n || "").trim().toLowerCase();

  async function handle(req, res) {
    if (req.method !== "POST") { res.set("Allow", "POST"); return send(res, 405, { error: "POST only" }); }
    if (!/\/v1\/submit\/?$/.test(req.path || "")) return send(res, 404, { error: "not found" });
    if (!keyMatches(req.get("x-lead-key"), key())) return send(res, 401, { error: "invalid key" });
    const r = core.leadFromWebsite(req.body && typeof req.body === "object" ? req.body : {});
    if (r.errors.length) return send(res, 400, { error: r.errors.join(" ") });

    const col = db.collection("leads");
    const existing = (await col.get()).docs
      .find((d) => (d.data().test === true) === r.test && nameKey((d.data().company || {}).name) === nameKey(r.fields.company.name));
    try {
      if (!existing) {
        const ref = await col.add({
          ...r.fields, customerAccount: null,
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), stageChangedAt: FieldValue.serverTimestamp(),
          createdByEmail: "website", updatedByEmail: "website",
        });
        return send(res, 201, { ok: true, leadId: ref.id, created: true, test: r.test });
      }
      // Same company again: keep what is there, fill blanks, add a new contact.
      const cur = core.normaliseLead(existing.id, existing.data());
      const contacts = cur.contacts.map(({ enrichment, ...c }) => (enrichment ? { ...c, enrichment } : c));
      const c = r.contact;
      if (c && !contacts.some((k) => (c.email && k.email.toLowerCase() === c.email.toLowerCase()) || (!c.email && k.name.toLowerCase() === c.name.toLowerCase()))) contacts.push(c);
      const company = { ...cur.company };
      for (const f of ["website", "industry"]) if (!company[f] && r.fields.company[f]) company[f] = r.fields.company[f];
      if (company.storeCount == null && r.fields.company.storeCount != null) company.storeCount = r.fields.company.storeCount;
      company.countries = core.parseCountries([...company.countries, ...r.fields.company.countries]);
      await existing.ref.update({
        company, contacts: contacts.slice(0, core.LIMITS.contacts),
        ...(cur.sourcePage ? {} : { sourcePage: r.fields.sourcePage, sourceIndustry: r.fields.sourceIndustry }),
        updatedAt: FieldValue.serverTimestamp(), updatedByEmail: "website",
      });
      return send(res, 200, { ok: true, leadId: existing.id, created: false, test: r.test });
    } catch (err) {
      if (logger) logger.error("leadIngest failed", { error: String(err && err.message || err) });
      return send(res, 500, { error: "could not save the lead" });
    }
  }
  return { handle };
}

module.exports = { createLeadIngest, keyMatches };
