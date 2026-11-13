// Promote › Leads: website lead submissions.
//   POST /leadIngest/v1/submit   header X-Lead-Key: <LEAD_INGEST_KEY>   JSON or form body
// Called server-to-server by personalisationhub.com (the key never reaches a
// browser). Each submission is matched to a Prospects (TAM) record by the
// company name and the contact's business email domain, in the country it
// gives (prospects-core.js planInbound). One lead per TAM record: the first
// person creates it (source "website", with the page and industry), the next
// one from the same company and country is added to it as a contact and counted
// in inboundCount. No matching record: a new one is made for that company and
// country and linked to the lead; creating it starts enrichment (lead-enrich.js
// onEnrichWrite runs on every new TAM record and lead).
//   POST /leadIngest/v1/brand    same key   {company, email?, country?}
// The company's logos for a branded walkthrough demo, when the company is in
// the Prospects (TAM) database or is a lead: {found, name, industry,
// logos: {light, dark, icon}}. light is the logo for light backgrounds, dark
// the one for dark backgrounds, icon the square site icon; each is an image
// address or "". A separate dark-background file is rare: when dark is "" and
// light is set, darkFromLight is true and the demo can show the light logo in
// white (CSS filter: brightness(0) invert(1)) or on a white tile. Nothing else about the record is returned, and a company
// that is not listed answers {found: false}. Called server-to-server like
// /submit, so the key and the list of companies never reach a browser.
// Anyone from AWS is added as a contact on the AWS record instead of a lead.
// A submission with test=true is stored as a test lead: it is never matched
// with a real lead or a TAM record, and is excluded from enrichment
// (lead-enrich.js) and the MCP tools (leads.js).
// A submission with lead_type (or leadType) "operator" or "Network operator inquiry"
// (the Be Your Own Boss page's product tour gate) is an individual, not a company:
// it becomes a network operator inquiry (leadType "operator", Applied stage) with the person as its contact,
// and never touches Prospects (TAM), the AWS record, company matching or
// enrichment. The same email again (same test flag) is the same person: the
// submission is added to their lead's website activity and inbound count.
"use strict";
const crypto = require("crypto");
const { FieldValue } = require("firebase-admin/firestore");
const core = require("./leads-core");
const tam = require("./prospects-core");

const keyMatches = (given, want) => {
  const a = crypto.createHash("sha256").update(String(given || "")).digest();
  const b = crypto.createHash("sha256").update(String(want || "")).digest();
  // "unset" is the placeholder deploy-backlog-tracker.yml stores when the
  // LEAD_INGEST_KEY repo secret is empty: it means no key, never a key.
  return Boolean(want) && want !== "unset" && crypto.timingSafeEqual(a, b);
};

function createLeadIngest({ db, key, logger, now = () => new Date() }) {
  const send = (res, status, body) => res.status(status).set("Cache-Control", "no-store").json(body);
  const nameKey = (n) => String(n || "").trim().toLowerCase();
  const BY = "website";
  const stamps = () => ({ updatedAt: FieldValue.serverTimestamp(), updatedByEmail: BY });

  // The lead as the website first creates it.
  const newLead = (r, entry, extra) => ({
    ...r.fields, websiteActivity: [entry], customerAccount: null, ...(extra || {}),
    createdAt: FieldValue.serverTimestamp(), stageChangedAt: FieldValue.serverTimestamp(), createdByEmail: BY, ...stamps(),
  });
  // The same company and country again: keep what is there, fill blanks, add the contact, count it.
  async function addToLead(ref, cur, r, entry, extra) {
    const m = core.mergeInbound(cur, r.fields, r.contact ? [r.contact] : []);
    await ref.update({
      company: m.company, contacts: m.contacts, inboundCount: m.inboundCount,
      ...(cur.sourcePage ? {} : { sourcePage: r.fields.sourcePage, sourceIndustry: r.fields.sourceIndustry }),
      ...(cur.sourceLabel ? {} : { sourceLabel: r.fields.sourceLabel }),
      ...(cur.sourceDetail ? {} : { sourceDetail: r.fields.sourceDetail }),
      websiteActivity: [...cur.websiteActivity.map(({ atMs, ...a }) => a), entry].slice(-core.LIMITS.activity),
      ...(extra || {}), ...stamps(),
    });
  }

  // A test lead (and a company name no TAM record can hold) keeps the old by-name merge.
  async function byName(r, entry) {
    const col = db.collection("leads");
    const existing = (await col.get()).docs
      .find((d) => (d.data().test === true) === r.test && nameKey((d.data().company || {}).name) === nameKey(r.fields.company.name));
    if (!existing) {
      const ref = await col.add(newLead(r, entry, { inboundCount: 1 }));
      return [201, { ok: true, leadId: ref.id, created: true, test: r.test }];
    }
    await addToLead(existing.ref, core.normaliseLead(existing.id, existing.data()), r, entry);
    return [200, { ok: true, leadId: existing.id, created: false, test: r.test }];
  }

  async function intoTam(r, entry) {
    const [pSnap, lSnap] = await Promise.all([db.collection("prospects").get(), db.collection("leads").get()]);
    const prospects = pSnap.docs.map((d) => tam.normaliseProspect(d.id, d.data()));
    const leads = lSnap.docs.map((d) => core.normaliseLead(d.id, d.data()));
    const plan = tam.planInbound({ prospects, leads, company: r.fields.company, contact: r.contact });
    if (plan.kind === "none") return byName(r, entry);
    const pRef = db.collection("prospects").doc(plan.prospectId);

    if (plan.kind === "aws") {
      const contact = tam.awsContactFrom(r.contact, now().toISOString().slice(0, 10));
      const contacts = tam.mergeContact(plan.prospect ? plan.prospect.contacts : [], contact);
      if (plan.createProspect) await pRef.set({ ...plan.createProspect, contacts, createdAt: FieldValue.serverTimestamp(), createdByEmail: BY, ...stamps() });
      else await pRef.update({ contacts, ...stamps() });
      return [200, { ok: true, aws: true, leadId: null, prospectId: plan.prospectId, created: false, test: false }];
    }

    const link = { leadId: plan.leadId, status: "converted" };
    if (plan.createProspect) {
      await pRef.set({ ...plan.createProspect, ...link, createdAt: FieldValue.serverTimestamp(), createdByEmail: BY, ...stamps() });
    } else if (plan.linkProspect) await pRef.update({ ...link, ...stamps() });
    const out = { ok: true, leadId: plan.leadId, prospectId: plan.prospectId, prospectCreated: Boolean(plan.createProspect), matchedBy: plan.how, test: false };
    if (plan.lead) {
      const ref = lSnap.docs.find((d) => d.id === plan.lead.id).ref;
      await addToLead(ref, plan.lead, r, entry, plan.lead.prospectId ? {} : { prospectId: plan.prospectId });
      return [200, { ...out, created: false }];
    }
    await db.collection("leads").doc(plan.leadId).set(newLead(r, entry, { prospectId: plan.prospectId, inboundCount: 1 }));
    return [201, { ...out, created: true }];
  }

  // A network operator inquiry: matched to an earlier one only by email.
  async function operator(r, entry) {
    const col = db.collection("leads");
    const email = nameKey(r.contact.email);
    const existing = email ? (await col.get()).docs.find((d) => {
      const x = d.data() || {};
      return x.leadType === "operator" && (x.test === true) === r.test && (x.contacts || []).some((c) => nameKey(c && c.email) === email);
    }) : null;
    if (!existing) {
      const ref = await col.add(newLead(r, entry, { inboundCount: 1 }));
      return [201, { ok: true, leadId: ref.id, created: true, leadType: "operator", test: r.test }];
    }
    const cur = core.normaliseLead(existing.id, existing.data());
    const was = cur.operator || { region: "", background: "" };
    const contacts = cur.contacts.map(({ enrichment, ...c }) => (enrichment ? { ...c, enrichment } : c));
    const i = contacts.findIndex((c) => nameKey(c.email) === email);
    if (i >= 0) for (const k of ["name", "linkedin"]) if (!contacts[i][k] && r.contact[k]) contacts[i][k] = r.contact[k];
    await existing.ref.update({
      contacts, inboundCount: (cur.inboundCount || 0) + 1,
      operator: { region: was.region || r.fields.operator.region, background: was.background || r.fields.operator.background },
      ...(cur.sourcePage ? {} : { sourcePage: r.fields.sourcePage }),
      ...(cur.sourceLabel ? {} : { sourceLabel: r.fields.sourceLabel }),
      websiteActivity: [...cur.websiteActivity.map(({ atMs, ...a }) => a), entry].slice(-core.LIMITS.activity),
      ...stamps(),
    });
    return [200, { ok: true, leadId: existing.id, created: false, leadType: "operator", test: r.test }];
  }

  const httpUrl = (v) => { try { const u = new URL(String(v || "")); return u.protocol === "https:" || u.protocol === "http:" ? u.href : ""; } catch { return ""; } };
  // The logos one record carries: research's full logos and icon, and a logo a person set on the company profile.
  const logosOf = (e, profileLogo) => {
    const x = e && typeof e === "object" ? e : {};
    const l = x.logos && typeof x.logos === "object" ? x.logos : {};
    return { light: httpUrl(profileLogo) || httpUrl(l.light), dark: httpUrl(l.dark), icon: httpUrl(x.logoUrl) };
  };
  async function brand(body) {
    const name = String(body.company || "").trim().slice(0, 120);
    const email = String(body.email || "").trim().slice(0, 200);
    if (!name && !email) return [400, { error: "company or email is required" }];
    const [pSnap, lSnap] = await Promise.all([db.collection("prospects").get(), db.collection("leads").get()]);
    const raw = new Map(pSnap.docs.map((d) => [d.id, d.data() || {}]));
    const prospects = pSnap.docs.map((d) => tam.normaliseProspect(d.id, d.data()));
    const m = tam.matchProspect(prospects, { name, email, country: String(body.country || "") });
    let out = null;
    if (m && m.prospect) {
      const p = m.prospect, data = raw.get(p.id) || {};
      let profileLogo = "";
      const ckey = tam.slugId(p.name);
      if (ckey) { try { const c = await db.collection("prospectCompanies").doc(ckey).get(); profileLogo = c.exists ? (((c.data() || {}).profile || {}).logoUrl || "") : ""; } catch { /* none */ } }
      out = { name: p.name, industry: p.industry || "", logos: logosOf(data.enrichment, profileLogo) };
      // The lead it became may hold logos the TAM record lacks.
      const ld = p.leadId && lSnap.docs.find((d) => d.id === p.leadId);
      if (ld) { const more = logosOf((ld.data() || {}).enrichment); for (const k of ["light", "dark", "icon"]) if (!out.logos[k]) out.logos[k] = more[k]; }
    } else if (name) {
      // A lead that is not in the TAM yet, by company name.
      const hit = lSnap.docs.find((d) => (d.data() || {}).test !== true && (d.data() || {}).leadType !== "operator" && (d.data() || {}).archived !== true && tam.companyKey(((d.data() || {}).company || {}).name) === tam.companyKey(name));
      if (hit) { const d = hit.data() || {}; out = { name: String((d.company || {}).name || ""), industry: String((d.company || {}).industry || ""), logos: logosOf(d.enrichment) }; }
    }
    if (!out) return [200, { found: false }];
    return [200, { found: true, ...out, darkFromLight: Boolean(out.logos.light && !out.logos.dark) }];
  }

  async function handle(req, res) {
    if (req.method !== "POST") { res.set("Allow", "POST"); return send(res, 405, { error: "POST only" }); }
    const isBrand = /\/v1\/brand\/?$/.test(req.path || "");
    if (!isBrand && !/\/v1\/submit\/?$/.test(req.path || "")) return send(res, 404, { error: "not found" });
    if (!keyMatches(req.get("x-lead-key"), key())) return send(res, 401, { error: "invalid key" });
    if (isBrand) {
      try { const [status, body] = await brand(req.body && typeof req.body === "object" ? req.body : {}); return send(res, status, body); } catch (err) {
        if (logger) logger.error("leadIngest brand failed", { error: String(err && err.message || err) });
        return send(res, 500, { error: "could not look the company up" });
      }
    }
    const r = core.leadFromWebsite(req.body && typeof req.body === "object" ? req.body : {});
    if (r.errors.length) return send(res, 400, { error: r.errors.join(" ") });

    const entry = { at: now().toISOString(), label: r.fields.sourceLabel, detail: r.fields.sourceDetail, page: r.fields.sourcePage };
    try {
      const [status, body] = r.fields.leadType === "operator" ? await operator(r, entry) : r.test ? await byName(r, entry) : await intoTam(r, entry);
      return send(res, status, body);
    } catch (err) {
      if (logger) logger.error("leadIngest failed", { error: String(err && err.message || err) });
      return send(res, 500, { error: "could not save the lead" });
    }
  }
  return { handle };
}

module.exports = { createLeadIngest, keyMatches };
