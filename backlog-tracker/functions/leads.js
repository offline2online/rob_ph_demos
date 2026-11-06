"use strict";
// Promote › Leads, the MCP side (the page is public/js/leads-page.js). Two
// tools only: read the pipeline, and move one company between stages. The
// rules come from leads-core.js, a generated copy of the page's module, so
// the board and the agent agree on the stage names.
const { FieldValue } = require("firebase-admin/firestore");
const core = require("./leads-core");

const db = () => require("firebase-admin/firestore").getFirestore();
const COLLECTION = "leads";
const iso = (v) => (v && typeof v.toDate === "function" ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : null);

function view(id, data) {
  const l = core.normaliseLead(id, data);
  return {
    id,
    company: l.company.name,
    website: l.company.website || null,
    industry: l.company.industry || null,
    countries: l.company.countries,
    storeCount: l.company.storeCount,
    awsAccountId: l.company.awsAccountId || null,
    stage: l.stage,
    stageLabel: core.stageLabel(l.stage),
    source: l.source || null,
    assignee: l.assignee || null,
    customerAccount: l.customerAccount,
    prospectId: l.prospectId || null,
    contacts: l.contacts.map((c) => ({ name: c.name, jobTitle: c.jobTitle || null, buyingRole: c.buyingRole || null, email: c.email || null, linkedin: c.linkedin || null, awsAccountId: c.awsAccountId || null })),
    techStack: l.enrichment && Array.isArray(l.enrichment.techStack) ? l.enrichment.techStack : [],
    enrichedAt: l.enrichment ? iso(l.enrichment.at) || l.enrichment.at || null : null,
    updatedAt: iso((data || {}).updatedAt),
  };
}

function leadsTools(h) {
  const { textResult, toolError, audit } = h;
  return [
    {
      name: "list_leads",
      description: `The Leads pipeline (Promote › Leads): one entry per company with its stage, contacts, buying roles, source, assignee and customer account. Stages: ${core.STAGES.map((s) => `${s.key} (${s.label})`).join(", ")}. Use it to find the leadId update_lead_stage needs.`,
      scope: "board.read",
      inputSchema: {
        type: "object",
        properties: {
          stage: { type: "string", enum: core.STAGE_KEYS, description: "Only leads in this stage. Omit for every stage." },
          company: { type: "string", description: "Only companies whose name contains this text (case-insensitive)." },
        },
        additionalProperties: false,
      },
      async run(args) {
        const a = args || {};
        const snap = await db().collection(COLLECTION).get();
        const want = String(a.company || "").trim().toLowerCase();
        const leads = [];
        snap.forEach((d) => {
          if (d.data().test === true) return; // test leads stay out of reporting
          const v = view(d.id, d.data());
          if (a.stage && v.stage !== a.stage) return;
          if (want && !v.company.toLowerCase().includes(want)) return;
          leads.push(v);
        });
        leads.sort((x, y) => core.STAGE_KEYS.indexOf(x.stage) - core.STAGE_KEYS.indexOf(y.stage) || x.company.localeCompare(y.company));
        return textResult({ count: leads.length, leads });
      },
    },
    {
      name: "update_lead_stage",
      description: "Move one company to another stage of the Leads pipeline, exactly as dragging its card on the board does. Name the company by leadId (from list_leads) or by company name (an exact name, or a unique part of one). Nothing else on the lead changes; linking a converted lead to a customer account is done on the board.",
      scope: "board.write",
      inputSchema: {
        type: "object",
        properties: {
          leadId: { type: "string", description: "From list_leads." },
          company: { type: "string", description: "The company's name, when you don't have its leadId." },
          stage: { type: "string", enum: core.STAGE_KEYS, description: `One of: ${core.STAGE_KEYS.join(", ")}.` },
        },
        required: ["stage"], additionalProperties: false,
      },
      async run(args, session) {
        const a = args || {};
        if (!core.isStage(a.stage)) return toolError(`stage must be one of: ${core.STAGE_KEYS.join(", ")}.`);
        let ref;
        if (a.leadId) {
          ref = db().collection(COLLECTION).doc(String(a.leadId));
        } else if (a.company) {
          const name = String(a.company).trim().toLowerCase();
          const all = (await db().collection(COLLECTION).get()).docs;
          const exact = all.filter((d) => String((d.data().company || {}).name || "").trim().toLowerCase() === name);
          const hits = exact.length ? exact : all.filter((d) => String((d.data().company || {}).name || "").toLowerCase().includes(name));
          if (!hits.length) return toolError(`No lead for a company called "${a.company}". Call list_leads first.`);
          if (hits.length > 1) return toolError(`More than one lead matches "${a.company}": ${hits.map((d) => `${(d.data().company || {}).name} (${d.id})`).join(", ")}. Pass the leadId.`);
          ref = hits[0].ref;
        } else {
          return toolError("Give a leadId or a company name.");
        }
        const snap = await ref.get();
        if (!snap.exists) return toolError(`No lead with id ${ref.id}. Call list_leads first.`);
        const before = core.normaliseLead(snap.id, snap.data());
        if (before.stage === a.stage) return textResult({ updated: false, leadId: snap.id, company: before.company.name, stage: a.stage, note: "Already in that stage." });
        await ref.update({
          stage: a.stage,
          stageChangedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedByEmail: session.email,
        });
        await audit(session, "update_lead_stage", { leadId: snap.id, from: before.stage, to: a.stage });
        return textResult({ updated: true, leadId: snap.id, company: before.company.name, from: before.stage, stage: a.stage, stageLabel: core.stageLabel(a.stage), movedBy: session.email });
      },
    },
  ];
}

module.exports = { leadsTools, view, COLLECTION };
