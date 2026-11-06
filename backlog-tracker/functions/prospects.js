"use strict";
// Promote › Prospects (TAM), the MCP side (the page is public/js/prospects-page.js).
// Two tools: read the database, and add or enrich companies in it. The rules
// come from prospects-core.js, a generated copy of the page's module, so the
// board and the agent agree on the fields. There is deliberately no delete and
// no way to set leadId or the converted status: converting stays a board action.
const { FieldValue } = require("firebase-admin/firestore");
const core = require("./prospects-core");

const db = () => require("firebase-admin/firestore").getFirestore();
const COLLECTION = "prospects";
const WRITABLE = ["name", "country", "website", "priority", "storePresence", "ownership", "insights", "decisionMakers", "linkedinUrl", "linkedinOrgId", "linkedinVerified", "awsAccountId", "contacts", "industry", "subIndustry", "hqCountry", "markets", "awsRegion", "storeCount", "sizeBand", "vendors", "campaigns", "status", "source", "notes"];

function view(id, data) {
  const p = core.normaliseProspect(id, data);
  return {
    id, company: p.name, country: p.country || null, priority: p.priority || null, storePresence: p.storePresence || null, ownership: p.ownership || null,
    insights: p.insights || null, decisionMakers: p.decisionMakers || null, linkedinUrl: p.linkedinUrl || null, linkedinOrgId: p.linkedinOrgId || null,
    linkedinVerified: p.linkedinVerified, awsAccountId: p.awsAccountId || null, contacts: p.contacts, website: p.website || null, industry: p.industry || null, subIndustry: p.subIndustry || null,
    hqCountry: p.hqCountry || null, markets: p.markets, awsRegion: p.awsRegion || null, storeCount: p.storeCount,
    sizeBand: p.sizeBand, vendors: p.vendors, campaigns: p.campaigns, status: p.status, statusLabel: core.statusLabel(p.status),
    leadId: p.leadId || null, source: p.source || null, notes: p.notes || null,
  };
}

const PROP = {
  name: { type: "string", description: "The company's name. A prospect is one company in one country: the same name (ignoring case and punctuation) with the same country is the same record." },
  country: { type: "string", description: "The country this record covers, e.g. Australia. Required to add a company (ALDI is three records: ALDI · Australia, ALDI · Netherlands, ALDI · Germany)." },
  priority: { type: "string", enum: ["", ...core.PRIORITY_KEYS] }, storePresence: { type: "string", description: "The store count as written, e.g. \"100+ stores\" or \"~2,800\". storeCount is parsed from it when you don't send one." },
  ownership: { type: "string" }, insights: { type: "string", description: "Up to 2000 characters: priority rationale, notes." },
  decisionMakers: { type: "string", description: "The target decision-maker roles." },
  linkedinUrl: { type: "string", description: "The company page, linkedin.com/company/<name> or /showcase/<name>; stored as https://www.linkedin.com/company/<slug>/. Search and profile URLs are rejected." },
  linkedinOrgId: { type: "string", description: "Digits only." }, linkedinVerified: { type: "boolean" },
  awsAccountId: { type: "string", description: "The company's AWS account ID, if known: exactly 12 digits (dashes and spaces are tidied). \"\" clears it. Anything else is rejected." },
  contacts: { type: "array", maxItems: core.LIMITS.contacts, items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, lastContact: { type: "string" }, awsAccountId: { type: "string", description: "The person's AWS account ID if known: exactly 12 digits." } }, additionalProperties: false }, description: "Replaces the stored contacts (text only)." },
  website: { type: "string" }, industry: { type: "string", description: "e.g. Grocery, Pharmacy, Fashion, Convenience and fuel, Telco, QSR, Electronics." },
  subIndustry: { type: "string" }, hqCountry: { type: "string", description: "Head-office country, e.g. United Kingdom (not the record's country)." },
  markets: { type: "array", items: { type: "string" }, description: "Other countries it operates in." },
  awsRegion: { type: "string", description: "e.g. eu-west-2. Defaults from country (else hqCountry) when blank." },
  storeCount: { type: ["number", "null"] }, sizeBand: { type: "string", enum: core.SIZE_BAND_KEYS, description: "Defaults from storeCount." },
  vendors: { type: "array", items: { type: "string" }, description: "Current vendors where known." },
  campaigns: { type: "array", items: { type: "string" }, description: "Campaigns the company is in." },
  status: { type: "string", enum: core.STATUS_KEYS.filter((k) => k !== "converted"), description: "Converting to a lead is done on the board." },
  source: { type: "string" }, notes: { type: "string" },
};

function prospectsTools(h) {
  const { textResult, toolError, audit } = h;
  return [
    {
      name: "list_prospects",
      description: "The Prospects (TAM) database (Promote › Prospects): every target company, one record per company per country, with country, priority, industry, HQ country, markets, LinkedIn page, contacts, insights, AWS region, store count, size band, vendors, campaigns, status and the lead it became. Every filter is optional and they combine.",
      scope: "board.read",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "Text to find in the name, website, industry, countries, vendors or campaigns." },
          industry: { type: "string" }, country: { type: "string", description: "The record's country." }, priority: { type: "string", enum: core.PRIORITY_KEYS },
          market: { type: "string", description: "A country: matches the record's country, HQ country or any market." },
          awsRegion: { type: "string" }, campaign: { type: "string" },
          sizeBand: { type: "string", enum: core.SIZE_BAND_KEYS }, status: { type: "string", enum: core.STATUS_KEYS },
          minStores: { type: "number" }, maxStores: { type: "number" },
          limit: { type: "number", description: "At most this many (default 200, max 1000)." },
        },
        additionalProperties: false,
      },
      async run(args) {
        const a = args || {};
        const snap = await db().collection(COLLECTION).get();
        const f = {};
        for (const k of core.FILTER_KEYS) if (a[k] != null) f[k] = a[k];
        const all = snap.docs.map((d) => view(d.id, d.data()));
        const rows = snap.docs.map((d) => core.normaliseProspect(d.id, d.data()));
        const keep = new Set(core.filterProspects(rows, f).map((p) => p.id));
        const limit = Math.min(Math.max(Number(a.limit) || 200, 1), 1000);
        const out = all.filter((v) => keep.has(v.id)).sort((x, y) => x.company.localeCompare(y.company));
        return textResult({ total: all.length, count: out.length, prospects: out.slice(0, limit) });
      },
    },
    {
      name: "upsert_prospects",
      description: `Add or enrich companies in the Prospects (TAM) database, up to ${core.LIMITS.batch} per call. Records match on name + country (or on id): the same company in a new country is a new record. A record that already exists is updated with only the fields you send, so enrichment never blanks what is already known; a new one is created with status "new". Lists (markets, vendors, campaigns, contacts) replace the stored list, so send the full list. Nothing is deleted, and converting to a lead stays a board action.`,
      scope: "board.write",
      inputSchema: {
        type: "object",
        properties: { prospects: { type: "array", minItems: 1, maxItems: core.LIMITS.batch, items: { type: "object", properties: { id: { type: "string", description: "From list_prospects, to update that exact record." }, ...PROP }, required: ["name"], additionalProperties: false } } },
        required: ["prospects"], additionalProperties: false,
      },
      async run(args, session) {
        const list = (args || {}).prospects;
        if (!Array.isArray(list) || !list.length) return toolError("Send a non-empty prospects array.");
        if (list.length > core.LIMITS.batch) return toolError(`Send at most ${core.LIMITS.batch} prospects per call.`);
        const snap = await db().collection(COLLECTION).get();
        const byKey = new Map();
        snap.forEach((d) => { const q = core.normaliseProspect(d.id, d.data()); byKey.set(core.prospectKey(q.name, q.country), d); });
        const byId = new Map(snap.docs.map((d) => [d.id, d]));
        const plan = [];
        const errors = [];
        const seen = new Set();
        list.forEach((item, i) => {
          const x = item || {};
          const input = {};
          for (const k of WRITABLE) if (Object.prototype.hasOwnProperty.call(x, k)) input[k] = x[k];
          if (input.status === "converted") { errors.push(`#${i + 1}: converting to a lead is done on the board.`); return; }
          const byIdHit = x.id ? byId.get(String(x.id)) : null;
          if (x.id && !byIdHit) { errors.push(`#${i + 1} ${x.name || ""}: no prospect has the id ${x.id}.`); return; }
          const hit = byIdHit || byKey.get(core.prospectKey(input.name, input.country));
          const r = core.prospectFromInput(input, hit ? core.normaliseProspect(hit.id, hit.data()) : null);
          if (r.errors.length) { errors.push(`#${i + 1} ${x.name || ""}: ${r.errors.join(" ")}`); return; }
          if (!core.slugId(r.fields.name) || !core.slugId(r.fields.country)) { errors.push(`#${i + 1}: the name and country need letters or numbers.`); return; }
          const id = hit ? hit.id : core.prospectIdFor(r.fields.name, r.fields.country);
          if (!hit && byId.has(id)) { errors.push(`#${i + 1} ${r.fields.name} · ${r.fields.country}: the id ${id} is already used by another record; send that record's id to update it.`); return; }
          if (seen.has(id)) { errors.push(`#${i + 1} ${r.fields.name} · ${r.fields.country}: listed twice in this call.`); return; }
          seen.add(id);
          plan.push({ id, hit, fields: r.fields });
        });
        if (errors.length) return toolError(`Nothing was written. ${errors.join(" ")}`);
        const batch = db().batch();
        let created = 0, updated = 0;
        for (const p of plan) {
          const ref = db().collection(COLLECTION).doc(p.id);
          if (p.hit) {
            batch.update(ref, { ...p.fields, updatedAt: FieldValue.serverTimestamp(), updatedByEmail: session.email });
            updated++;
          } else {
            batch.set(ref, { ...p.fields, leadId: "", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdByEmail: session.email, updatedByEmail: session.email });
            created++;
          }
        }
        await batch.commit();
        await audit(session, "upsert_prospects", { created, updated, ids: plan.map((p) => p.id).slice(0, 50) });
        return textResult({ created, updated, prospects: plan.map((p) => ({ id: p.id, company: p.fields.name, country: p.fields.country, created: !p.hit })) });
      },
    },
  ];
}

module.exports = { prospectsTools, view, COLLECTION };
