"use strict";
// Promote › Leads, the MCP side (the page is public/js/leads-page.js): the full
// lead lifecycle for an agent, with the same permissions as the board (editors
// write, viewers read, delete is admin only). The rules come from
// leads-core.js, a generated copy of the page's module, so the board and the
// agent agree on stages, fields and validation. Every write stamps
// updatedByEmail and adds a line to the lead's `history`, which the lead
// drawer shows, so a change from an agent reads like one from the board.
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
    sourceLabel: l.sourceLabel || "",
    sourceDetail: l.sourceDetail || "",
    websiteActivity: l.websiteActivity.map(({ at, label, detail, page }) => ({ at, label, detail, page })),
    assignee: l.assignee || null,
    customerAccount: l.customerAccount,
    prospectId: l.prospectId || null,
    contacts: l.contacts.map((c) => ({ name: c.name, jobTitle: c.jobTitle || null, buyingRole: c.buyingRole || null, email: c.email || null, linkedin: c.linkedin || null, awsAccountId: c.awsAccountId || null })),
    techStack: l.enrichment && Array.isArray(l.enrichment.techStack) ? l.enrichment.techStack : [],
    enrichedAt: l.enrichment ? iso(l.enrichment.at) || l.enrichment.at || null : null,
    updatedAt: iso((data || {}).updatedAt),
    archived: l.archived,
    historyCount: l.history.length,
  };
}

// get_lead: everything the drawer shows, plus the history.
function fullView(id, data) {
  const l = core.normaliseLead(id, data);
  const d = data || {};
  return {
    ...view(id, data),
    sourcePage: l.sourcePage || null,
    sourceIndustry: l.sourceIndustry || null,
    contacts: l.contacts.map((c) => ({ id: c.id, name: c.name, jobTitle: c.jobTitle || null, buyingRole: c.buyingRole || null, email: c.email || null, linkedin: c.linkedin || null, awsAccountId: c.awsAccountId || null })),
    enrichmentSummary: l.enrichment && l.enrichment.summary ? l.enrichment.summary : null,
    createdAt: iso(d.createdAt),
    createdBy: d.createdByEmail || null,
    updatedBy: d.updatedByEmail || null,
    archivedBy: d.archivedByEmail || null,
    history: l.history.map(({ at, by, kind, text }) => ({ at, by, kind, text })),
  };
}

const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();
const nameOf = (d) => String(((d.data() || {}).company || {}).name || "");

function leadsTools(h) {
  const { textResult, toolError, audit } = h;

  // A lead named by leadId or by company name (exact, else a unique part of it).
  async function resolve(a) {
    if (a.leadId) {
      const snap = await db().collection(COLLECTION).doc(String(a.leadId)).get();
      return snap.exists ? { snap } : { error: `No lead with id ${a.leadId}. Call list_leads first.` };
    }
    if (a.company) {
      const name = norm(a.company);
      const all = (await db().collection(COLLECTION).get()).docs;
      const exact = all.filter((d) => norm(nameOf(d)) === name);
      const hits = exact.length ? exact : all.filter((d) => norm(nameOf(d)).includes(name));
      if (!hits.length) return { error: `No lead for a company called "${a.company}". Call list_leads first.` };
      if (hits.length > 1) return { error: `More than one lead matches "${a.company}": ${hits.map((d) => `${nameOf(d)} (${d.id})`).join(", ")}. Pass the leadId.` };
      return { snap: hits[0] };
    }
    return { error: "Give a leadId or a company name." };
  }

  async function findByName(name) {
    const want = norm(name);
    return (await db().collection(COLLECTION).get()).docs.find((d) => norm(nameOf(d)) === want) || null;
  }

  // One write: the fields, who and when, and a line in the lead's history.
  async function change(session, snap, fields, kind, text) {
    const history = core.appendHistory((snap.data() || {}).history, core.historyEntry(session.email, kind, text));
    await snap.ref.update({ ...fields, history, updatedAt: FieldValue.serverTimestamp(), updatedByEmail: session.email });
  }

  const LEAD_PROPS = {
    company: { type: "string", description: "The company's name." },
    website: { type: "string" }, industry: { type: "string" },
    countries: { type: "array", items: { type: "string" }, description: "Countries it operates in." },
    storeCount: { type: ["number", "null"] },
    awsAccountId: { type: "string", description: "Exactly 12 digits (dashes and spaces are tidied)." },
    stage: { type: "string", enum: core.STAGE_KEYS, description: `One of: ${core.STAGE_KEYS.join(", ")}. Default ${core.DEFAULT_STAGE} when creating.` },
    source: { type: "string", description: 'Where it came from; "Manual" when blank.' },
    sourceDetail: { type: "string", description: "Which form or demo, up to 120 characters." },
    assignee: { type: "string", description: "A member's email, or \"\" for unassigned." },
  };
  const CONTACT_PROPS = {
    name: { type: "string" }, jobTitle: { type: "string" }, email: { type: "string" }, linkedin: { type: "string" },
    buyingRole: { type: "string", enum: ["", ...core.BUYING_ROLE_KEYS], description: `One of: ${core.BUYING_ROLE_KEYS.join(", ")}.` },
    awsAccountId: { type: "string", description: "Exactly 12 digits." },
  };
  const REF_PROPS = {
    leadId: { type: "string", description: "From list_leads." },
    company: { type: "string", description: "The company's name, when you don't have its leadId (exact, or a unique part of it)." },
  };
  const formOf = (a) => ({
    name: a.company, website: a.website, industry: a.industry, countries: a.countries, storeCount: a.storeCount,
    awsAccountId: a.awsAccountId, stage: a.stage, source: a.source, assignee: a.assignee, contacts: a.contacts || [],
  });

  async function createOne(a, session, seen) {
    const r = core.leadFromForm(formOf(a));
    if (r.errors.length) return { created: false, error: r.errors.join(" ") };
    const key = norm(r.fields.company.name);
    const dup = seen.get(key) || await findByName(r.fields.company.name);
    if (dup) {
      const data = typeof dup.data === "function" ? dup.data() : dup;
      return { created: false, duplicate: true, error: `A lead called "${r.fields.company.name}" already exists.`, existing: view(dup.id, data) };
    }
    const sourceDetail = String(a.sourceDetail == null ? "" : a.sourceDetail).trim().slice(0, core.LIMITS.sourceDetail);
    const doc = {
      ...r.fields, customerAccount: null,
      ...(sourceDetail ? { sourceDetail } : {}),
      history: [core.historyEntry(session.email, "created", `Created in ${core.stageLabel(r.fields.stage)} by an agent.`)],
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), stageChangedAt: FieldValue.serverTimestamp(),
      createdByEmail: session.email, updatedByEmail: session.email,
    };
    const ref = await db().collection(COLLECTION).add(doc);
    seen.set(key, { id: ref.id, ...doc });
    return { created: true, lead: view(ref.id, { ...doc, history: doc.history }) };
  }

  const tools = [
    {
      name: "list_leads",
      description: `The Leads pipeline (Promote › Leads): one entry per company with its stage, contacts, buying roles, source, assignee and customer account. Stages: ${core.STAGES.map((s) => `${s.key} (${s.label})`).join(", ")}. Every filter is optional and they combine. Archived leads are left out unless includeArchived is true. Use it to find the leadId the other lead tools need; get_lead returns one lead in full.`,
      scope: "board.read",
      inputSchema: {
        type: "object",
        properties: {
          stage: { type: "string", enum: core.STAGE_KEYS, description: "Only leads in this stage. Omit for every stage." },
          company: { type: "string", description: "Only companies whose name contains this text (case-insensitive)." },
          assignee: { type: "string", description: "A member's email, or \"unassigned\"." },
          source: { type: "string", description: "Only leads whose source contains this text." },
          industry: { type: "string", description: "Only leads whose industry contains this text." },
          q: { type: "string", description: "Free text found in the company name, website, industry, countries, source, contacts or assignee." },
          includeArchived: { type: "boolean", description: "Also list archived leads (each says archived: true)." },
          limit: { type: "integer", minimum: 1, maximum: 200, description: "Page size (default 100)." },
          offset: { type: "integer", minimum: 0, description: "Skip this many leads (use nextOffset from the last page)." },
        },
        additionalProperties: false,
      },
      async run(args) {
        const a = args || {};
        const snap = await db().collection(COLLECTION).get();
        const want = norm(a.company), q = norm(a.q), src = norm(a.source), ind = norm(a.industry), who = norm(a.assignee);
        const leads = [];
        snap.forEach((d) => {
          const data = d.data();
          if (data.test === true) return; // test leads stay out of reporting
          if (data.archivedAt && !a.includeArchived) return;
          const v = view(d.id, data);
          if (a.stage && v.stage !== a.stage) return;
          if (want && !v.company.toLowerCase().includes(want)) return;
          if (who && (who === "unassigned" ? v.assignee : norm(v.assignee) !== who)) return;
          if (src && !norm(`${v.source} ${v.sourceLabel} ${v.sourceDetail}`).includes(src)) return;
          if (ind && !norm(v.industry).includes(ind)) return;
          if (q && !norm([v.company, v.website, v.industry, v.countries.join(" "), v.source, v.sourceLabel, v.sourceDetail, v.assignee, v.contacts.map((c) => `${c.name} ${c.email || ""} ${c.jobTitle || ""}`).join(" ")].join(" ")).includes(q)) return;
          leads.push(v);
        });
        leads.sort((x, y) => core.STAGE_KEYS.indexOf(x.stage) - core.STAGE_KEYS.indexOf(y.stage) || x.company.localeCompare(y.company));
        const total = leads.length;
        const offset = Math.max(0, Number(a.offset) || 0);
        const limit = Math.min(200, Math.max(1, Number(a.limit) || 100));
        const page = leads.slice(offset, offset + limit);
        return textResult({ count: page.length, total, ...(offset + limit < total ? { nextOffset: offset + limit } : {}), leads: page });
      },
    },
    {
      name: "get_lead",
      description: "One lead in full: company fields, stage, source, assignee, every contact with buying role, website activity, tech stack, customer account, linked Prospects (TAM) record, and the history (notes and every change, with who made it).",
      scope: "board.read",
      inputSchema: { type: "object", properties: { ...REF_PROPS }, additionalProperties: false },
      async run(args) {
        const r = await resolve(args || {});
        if (r.error) return toolError(r.error);
        return textResult(fullView(r.snap.id, r.snap.data()));
      },
    },
    {
      name: "create_lead",
      description: "Add one company to the Leads pipeline, as the board's Add button does. Only the company is required; the stage defaults to lead. A company whose name already exists (case-insensitive, archived ones too) is refused and the existing lead is returned. Contacts can be given here or added later with add_lead_contact.",
      scope: "board.write",
      inputSchema: {
        type: "object",
        properties: { ...LEAD_PROPS, contacts: { type: "array", maxItems: core.LIMITS.contacts, items: { type: "object", properties: CONTACT_PROPS, required: ["name"], additionalProperties: false } } },
        required: ["company"], additionalProperties: false,
      },
      async run(args, session) {
        const out = await createOne(args || {}, session, new Map());
        if (!out.created) return toolError(JSON.stringify(out));
        await audit(session, "create_lead", { leadId: out.lead.id, company: out.lead.company, stage: out.lead.stage });
        return textResult(out);
      },
    },
    {
      name: "create_leads",
      description: "Add several companies at once (up to 50), each exactly as create_lead does. Each entry succeeds or fails on its own: the result lists created leads, and for a refused one the reason (and, for a duplicate name, the existing lead).",
      scope: "board.write",
      inputSchema: {
        type: "object",
        properties: { leads: { type: "array", minItems: 1, maxItems: 50, items: { type: "object", properties: { ...LEAD_PROPS, contacts: { type: "array", maxItems: core.LIMITS.contacts, items: { type: "object", properties: CONTACT_PROPS, required: ["name"], additionalProperties: false } } }, required: ["company"], additionalProperties: false } } },
        required: ["leads"], additionalProperties: false,
      },
      async run(args, session) {
        const list = Array.isArray((args || {}).leads) ? args.leads : [];
        if (!list.length) return toolError("Give at least one lead.");
        if (list.length > 50) return toolError("Up to 50 leads per call.");
        const seen = new Map();
        const results = [];
        for (const item of list) {
          const out = await createOne(item || {}, session, seen);
          results.push({ company: String((item || {}).company || ""), ...out });
        }
        const created = results.filter((r) => r.created).length;
        await audit(session, "create_leads", { requested: list.length, created });
        return textResult({ requested: list.length, created, refused: list.length - created, results });
      },
    },
    {
      name: "update_lead",
      description: "Edit a lead's own fields: company name, website, industry, countries, store count, AWS account ID, source, source detail, assignee and stage. Send only what changes; a field you omit is left alone (\"\" clears a text field). Contacts, notes, links and archiving have their own tools. Renaming to a name another lead already has is refused.",
      scope: "board.write",
      inputSchema: { type: "object", properties: { ...REF_PROPS, ...LEAD_PROPS, newCompany: { type: "string", description: "Rename the company to this." } }, additionalProperties: false },
      async run(args, session) {
        const a = args || {};
        const r = await resolve(a);
        if (r.error) return toolError(r.error);
        const before = core.normaliseLead(r.snap.id, r.snap.data());
        const has = (k) => Object.prototype.hasOwnProperty.call(a, k);
        const form = {
          name: a.newCompany != null ? a.newCompany : before.company.name,
          website: has("website") ? a.website : before.company.website,
          industry: has("industry") ? a.industry : before.company.industry,
          countries: has("countries") ? a.countries : before.company.countries,
          storeCount: has("storeCount") ? a.storeCount : before.company.storeCount,
          awsAccountId: has("awsAccountId") ? a.awsAccountId : before.company.awsAccountId,
          stage: has("stage") ? a.stage : before.stage,
          source: has("source") ? a.source : before.source,
          assignee: has("assignee") ? a.assignee : before.assignee,
          contacts: [],
        };
        const v = core.leadFromForm(form);
        if (v.errors.length) return toolError(v.errors.join(" "));
        if (norm(v.fields.company.name) !== norm(before.company.name)) {
          const dup = await findByName(v.fields.company.name);
          if (dup && dup.id !== r.snap.id) return toolError(`Another lead is already called "${v.fields.company.name}" (${dup.id}).`);
        }
        const fields = { company: v.fields.company, stage: v.fields.stage, source: v.fields.source, assignee: v.fields.assignee };
        if (has("sourceDetail")) fields.sourceDetail = String(a.sourceDetail == null ? "" : a.sourceDetail).trim().slice(0, core.LIMITS.sourceDetail);
        if (v.fields.stage !== before.stage) fields.stageChangedAt = FieldValue.serverTimestamp();
        const changed = [];
        const was = r.snap.data() || {};
        for (const k of ["name", "website", "industry", "storeCount", "awsAccountId"]) if (JSON.stringify(v.fields.company[k]) !== JSON.stringify(k === "name" ? before.company.name : before.company[k])) changed.push(k === "name" ? "company name" : k);
        if (JSON.stringify(v.fields.company.countries) !== JSON.stringify(before.company.countries)) changed.push("countries");
        if (v.fields.source !== before.source) changed.push("source");
        if (has("sourceDetail") && fields.sourceDetail !== String(was.sourceDetail || "")) changed.push("source detail");
        if (v.fields.assignee !== before.assignee) changed.push("assignee");
        if (v.fields.stage !== before.stage) changed.push(`stage ${before.stage} → ${v.fields.stage}`);
        if (!changed.length) return textResult({ updated: false, leadId: r.snap.id, company: before.company.name, note: "Nothing to change." });
        await change(session, r.snap, fields, v.fields.stage !== before.stage ? "stage" : "update", `Changed ${changed.join(", ")}.`);
        await audit(session, "update_lead", { leadId: r.snap.id, changed });
        const after = await r.snap.ref.get();
        return textResult({ updated: true, changed, lead: view(r.snap.id, after.data()) });
      },
    },
    {
      name: "update_lead_stage",
      description: "Move one company to another stage of the Leads pipeline, exactly as dragging its card on the board does. Name the company by leadId (from list_leads) or by company name (an exact name, or a unique part of one). Nothing else on the lead changes. To mark it converted, use link_lead_customer_account.",
      scope: "board.write",
      inputSchema: {
        type: "object",
        properties: { ...REF_PROPS, stage: { type: "string", enum: core.STAGE_KEYS, description: `One of: ${core.STAGE_KEYS.join(", ")}.` } },
        required: ["stage"], additionalProperties: false,
      },
      async run(args, session) {
        const a = args || {};
        if (!core.isStage(a.stage)) return toolError(`stage must be one of: ${core.STAGE_KEYS.join(", ")}.`);
        const r = await resolve(a);
        if (r.error) return toolError(r.error);
        const snap = r.snap;
        const before = core.normaliseLead(snap.id, snap.data());
        if (before.stage === a.stage) return textResult({ updated: false, leadId: snap.id, company: before.company.name, stage: a.stage, note: "Already in that stage." });
        await change(session, snap, { stage: a.stage, stageChangedAt: FieldValue.serverTimestamp() }, "stage", `Moved from ${core.stageLabel(before.stage)} to ${core.stageLabel(a.stage)}.`);
        await audit(session, "update_lead_stage", { leadId: snap.id, from: before.stage, to: a.stage });
        return textResult({ updated: true, leadId: snap.id, company: before.company.name, from: before.stage, stage: a.stage, stageLabel: core.stageLabel(a.stage), movedBy: session.email });
      },
    },
    {
      name: "add_lead_contact",
      description: "Add a contact (with an optional buying role) to a lead. A lead holds up to 25.",
      scope: "board.write",
      inputSchema: { type: "object", properties: { ...REF_PROPS, ...CONTACT_PROPS }, required: ["name"], additionalProperties: false },
      async run(args, session) {
        const a = args || {};
        const r = await resolve(a);
        if (r.error) return toolError(r.error);
        const lead = core.normaliseLead(r.snap.id, r.snap.data());
        const contact = { id: core.newContactId(), name: a.name, jobTitle: a.jobTitle, buyingRole: a.buyingRole, email: a.email, linkedin: a.linkedin, awsAccountId: a.awsAccountId };
        const v = core.leadFromForm({ name: lead.company.name, contacts: [...lead.contacts, contact] });
        if (v.errors.length) return toolError(v.errors.join(" "));
        await change(session, r.snap, { contacts: v.fields.contacts }, "contact", `Added contact ${String(a.name).trim()}${a.buyingRole ? ` (${core.roleLabel(a.buyingRole)})` : ""}.`);
        await audit(session, "add_lead_contact", { leadId: r.snap.id, contact: contact.id });
        return textResult({ added: true, leadId: r.snap.id, contact: v.fields.contacts[v.fields.contacts.length - 1] });
      },
    },
    {
      name: "update_lead_contact",
      description: "Edit one contact on a lead, including their buying role (\"\" clears it). Name the contact by contactId (from get_lead) or by name. Send only what changes.",
      scope: "board.write",
      inputSchema: { type: "object", properties: { ...REF_PROPS, contactId: { type: "string" }, contactName: { type: "string", description: "The contact's current name, when you don't have contactId." }, ...CONTACT_PROPS }, additionalProperties: false },
      async run(args, session) {
        const a = args || {};
        const r = await resolve(a);
        if (r.error) return toolError(r.error);
        const lead = core.normaliseLead(r.snap.id, r.snap.data());
        const m = findContact(lead, a);
        if (m.error) return toolError(m.error);
        const patch = {};
        for (const k of Object.keys(CONTACT_PROPS)) if (Object.prototype.hasOwnProperty.call(a, k)) patch[k] = a[k];
        if (!Object.keys(patch).length) return toolError("Send at least one contact field to change.");
        const contacts = lead.contacts.map((c) => (c.id === m.contact.id ? { ...c, ...patch } : c));
        const v = core.leadFromForm({ name: lead.company.name, contacts });
        if (v.errors.length) return toolError(v.errors.join(" "));
        await change(session, r.snap, { contacts: v.fields.contacts }, "contact", `Updated contact ${m.contact.name}: ${Object.keys(patch).join(", ")}.`);
        await audit(session, "update_lead_contact", { leadId: r.snap.id, contact: m.contact.id });
        return textResult({ updated: true, leadId: r.snap.id, contact: v.fields.contacts.find((c) => c.id === m.contact.id) });
      },
    },
    {
      name: "remove_lead_contact",
      description: "Remove one contact from a lead, by contactId (from get_lead) or by name.",
      scope: "board.write",
      inputSchema: { type: "object", properties: { ...REF_PROPS, contactId: { type: "string" }, contactName: { type: "string" } }, additionalProperties: false },
      async run(args, session) {
        const a = args || {};
        const r = await resolve(a);
        if (r.error) return toolError(r.error);
        const lead = core.normaliseLead(r.snap.id, r.snap.data());
        const m = findContact(lead, a);
        if (m.error) return toolError(m.error);
        const rest = lead.contacts.filter((c) => c.id !== m.contact.id).map((c) => ({ ...c }));
        const v = core.leadFromForm({ name: lead.company.name, contacts: rest });
        if (v.errors.length) return toolError(v.errors.join(" "));
        await change(session, r.snap, { contacts: v.fields.contacts }, "contact", `Removed contact ${m.contact.name}.`);
        await audit(session, "remove_lead_contact", { leadId: r.snap.id, contact: m.contact.id });
        return textResult({ removed: true, leadId: r.snap.id, contact: m.contact.name });
      },
    },
    {
      name: "add_lead_note",
      description: `Comment on a lead. The note is added to the lead's history, which the lead card shows, attributed to you. Up to ${core.NOTE_MAX} characters.`,
      scope: "board.write",
      inputSchema: { type: "object", properties: { ...REF_PROPS, text: { type: "string" } }, required: ["text"], additionalProperties: false },
      async run(args, session) {
        const a = args || {};
        const text = String(a.text == null ? "" : a.text).trim();
        if (!text) return toolError("The note is empty.");
        if (text.length > core.NOTE_MAX) return toolError(`A note holds up to ${core.NOTE_MAX} characters.`);
        const r = await resolve(a);
        if (r.error) return toolError(r.error);
        await change(session, r.snap, {}, "note", text);
        await audit(session, "add_lead_note", { leadId: r.snap.id });
        return textResult({ added: true, leadId: r.snap.id, by: session.email });
      },
    },
    {
      name: "link_lead_customer_account",
      description: "Convert a lead: record the customer account it became (an id, a name, or both). By default the lead also moves to Closed Won, as converting on the board does; pass moveToClosedWon false to link without moving it. Linking again replaces the previous account.",
      scope: "board.write",
      inputSchema: { type: "object", properties: { ...REF_PROPS, accountId: { type: "string" }, accountName: { type: "string" }, moveToClosedWon: { type: "boolean", description: "Default true." } }, additionalProperties: false },
      async run(args, session) {
        const a = args || {};
        const r = await resolve(a);
        if (r.error) return toolError(r.error);
        const c = core.conversionFields({ id: a.accountId, name: a.accountName });
        if (c.error) return toolError(c.error);
        const before = core.normaliseLead(r.snap.id, r.snap.data());
        const move = a.moveToClosedWon !== false && before.stage !== "closed-won";
        const fields = { customerAccount: c.fields.customerAccount };
        if (move) { fields.stage = "closed-won"; fields.stageChangedAt = FieldValue.serverTimestamp(); }
        await change(session, r.snap, fields, "customer-account", `Linked customer account ${c.fields.customerAccount.name}${c.fields.customerAccount.id && c.fields.customerAccount.id !== c.fields.customerAccount.name ? ` (${c.fields.customerAccount.id})` : ""}${move ? "; moved to Closed Won" : ""}.`);
        await audit(session, "link_lead_customer_account", { leadId: r.snap.id, account: c.fields.customerAccount.id || c.fields.customerAccount.name });
        return textResult({ linked: true, leadId: r.snap.id, customerAccount: c.fields.customerAccount, stage: move ? "closed-won" : before.stage });
      },
    },
    {
      name: "unlink_lead_customer_account",
      description: "Remove a lead's customer account link. The stage is left as it is; use update_lead_stage to move it.",
      scope: "board.write",
      inputSchema: { type: "object", properties: { ...REF_PROPS }, additionalProperties: false },
      async run(args, session) {
        const r = await resolve(args || {});
        if (r.error) return toolError(r.error);
        const before = core.normaliseLead(r.snap.id, r.snap.data());
        if (!before.customerAccount) return textResult({ unlinked: false, leadId: r.snap.id, note: "No customer account was linked." });
        await change(session, r.snap, { customerAccount: null }, "customer-account", `Unlinked customer account ${before.customerAccount.name || before.customerAccount.id}.`);
        await audit(session, "unlink_lead_customer_account", { leadId: r.snap.id });
        return textResult({ unlinked: true, leadId: r.snap.id });
      },
    },
    {
      name: "link_lead_prospect",
      description: "Link a lead to its Prospects (TAM) record (prospectId from list_prospects), on both sides. A prospect can be linked to one lead. The prospect's status is not changed.",
      scope: "board.write",
      inputSchema: { type: "object", properties: { ...REF_PROPS, prospectId: { type: "string", description: "From list_prospects." } }, required: ["prospectId"], additionalProperties: false },
      async run(args, session) {
        const a = args || {};
        const r = await resolve(a);
        if (r.error) return toolError(r.error);
        const pref = db().collection("prospects").doc(String(a.prospectId));
        const p = await pref.get();
        if (!p.exists) return toolError(`No prospect with id ${a.prospectId}. Call list_prospects first.`);
        const owner = String((p.data() || {}).leadId || "");
        if (owner && owner !== r.snap.id) return toolError(`That prospect is already linked to another lead (${owner}). Unlink it there first.`);
        const prev = String((r.snap.data() || {}).prospectId || "");
        if (prev && prev !== p.id) {
          const old = db().collection("prospects").doc(prev);
          const os = await old.get();
          if (os.exists && (os.data() || {}).leadId === r.snap.id) await old.update({ leadId: "", updatedAt: FieldValue.serverTimestamp(), updatedByEmail: session.email });
        }
        await pref.update({ leadId: r.snap.id, updatedAt: FieldValue.serverTimestamp(), updatedByEmail: session.email });
        await change(session, r.snap, { prospectId: p.id }, "prospect", `Linked Prospects (TAM) record ${(p.data() || {}).name || p.id}.`);
        await audit(session, "link_lead_prospect", { leadId: r.snap.id, prospectId: p.id });
        return textResult({ linked: true, leadId: r.snap.id, prospectId: p.id, prospect: (p.data() || {}).name || null });
      },
    },
    {
      name: "unlink_lead_prospect",
      description: "Remove a lead's link to its Prospects (TAM) record, on both sides.",
      scope: "board.write",
      inputSchema: { type: "object", properties: { ...REF_PROPS }, additionalProperties: false },
      async run(args, session) {
        const r = await resolve(args || {});
        if (r.error) return toolError(r.error);
        const pid = String((r.snap.data() || {}).prospectId || "");
        if (!pid) return textResult({ unlinked: false, leadId: r.snap.id, note: "No prospect was linked." });
        const pref = db().collection("prospects").doc(pid);
        const p = await pref.get();
        if (p.exists && (p.data() || {}).leadId === r.snap.id) await pref.update({ leadId: "", updatedAt: FieldValue.serverTimestamp(), updatedByEmail: session.email });
        await change(session, r.snap, { prospectId: "" }, "prospect", `Unlinked Prospects (TAM) record${p.exists && (p.data() || {}).name ? ` ${(p.data() || {}).name}` : ""}.`);
        await audit(session, "unlink_lead_prospect", { leadId: r.snap.id, prospectId: pid });
        return textResult({ unlinked: true, leadId: r.snap.id, prospectId: pid });
      },
    },
    {
      name: "archive_lead",
      description: "Archive a lead: it drops off the board and out of list_leads but keeps all its data, and restore_lead brings it back. Recoverable, unlike delete_lead.",
      scope: "board.write",
      inputSchema: { type: "object", properties: { ...REF_PROPS }, additionalProperties: false },
      async run(args, session) {
        const r = await resolve(args || {});
        if (r.error) return toolError(r.error);
        if ((r.snap.data() || {}).archivedAt) return textResult({ archived: false, leadId: r.snap.id, note: "Already archived." });
        await change(session, r.snap, { archivedAt: FieldValue.serverTimestamp(), archivedByEmail: session.email }, "archive", "Archived.");
        await audit(session, "archive_lead", { leadId: r.snap.id });
        return textResult({ archived: true, leadId: r.snap.id, company: nameOf(r.snap) });
      },
    },
    {
      name: "restore_lead",
      description: "Bring an archived lead back onto the board, in the stage it was in.",
      scope: "board.write",
      inputSchema: { type: "object", properties: { ...REF_PROPS }, additionalProperties: false },
      async run(args, session) {
        const r = await resolve(args || {});
        if (r.error) return toolError(r.error);
        if (!(r.snap.data() || {}).archivedAt) return textResult({ restored: false, leadId: r.snap.id, note: "Not archived." });
        await change(session, r.snap, { archivedAt: null, archivedByEmail: "" }, "archive", "Restored from the archive.");
        await audit(session, "restore_lead", { leadId: r.snap.id });
        return textResult({ restored: true, leadId: r.snap.id, company: nameOf(r.snap) });
      },
    },
    {
      name: "delete_lead",
      description: "Permanently delete a lead and its history. Admin only, and it needs confirm: true. This cannot be undone; archive_lead is the recoverable alternative. A linked Prospects (TAM) record is unlinked.",
      scope: "board.write",
      role: "admin",
      destructive: true,
      inputSchema: { type: "object", properties: { ...REF_PROPS, confirm: { type: "boolean", description: "Must be true." } }, required: ["confirm"], additionalProperties: false },
      async run(args, session) {
        const a = args || {};
        if (a.confirm !== true) return toolError("delete_lead is permanent: pass confirm: true to go ahead (archive_lead is the recoverable option).");
        const r = await resolve(a);
        if (r.error) return toolError(r.error);
        const data = r.snap.data() || {};
        if (data.prospectId) {
          const pref = db().collection("prospects").doc(String(data.prospectId));
          const p = await pref.get();
          if (p.exists && (p.data() || {}).leadId === r.snap.id) await pref.update({ leadId: "", updatedAt: FieldValue.serverTimestamp(), updatedByEmail: session.email });
        }
        await r.snap.ref.delete();
        await audit(session, "delete_lead", { leadId: r.snap.id, company: nameOf(r.snap) });
        return textResult({ deleted: true, leadId: r.snap.id, company: nameOf(r.snap), deletedBy: session.email });
      },
    },
  ];
  return tools;
}

function findContact(lead, a) {
  if (a.contactId) {
    const c = lead.contacts.find((x) => x.id === String(a.contactId));
    return c ? { contact: c } : { error: `No contact with id ${a.contactId} on this lead. Call get_lead first.` };
  }
  if (a.contactName) {
    const want = norm(a.contactName);
    const hits = lead.contacts.filter((x) => norm(x.name) === want);
    if (hits.length === 1) return { contact: hits[0] };
    return { error: hits.length ? `More than one contact is called "${a.contactName}": pass contactId.` : `No contact called "${a.contactName}" on this lead.` };
  }
  return { error: "Give a contactId or contactName." };
}

module.exports = { leadsTools, view, fullView, COLLECTION };
