"use strict";
// ── AWS Marketplace agreements → Promote › License Manager ─────────────────
// Reads PH's Marketplace agreements (the licences) and each one's buyer
// contacts, and keeps them in `licences/{id}` for the console's License
// Manager page (public/js/licences-page.js; matching to Prospects (TAM) and
// Leads is done on the page, in public/js/licences-core.js).
//
// Same keyless access as Partner Central (partner-central.js builds this
// module and hands it the short-lived credentials, the SigV4 signer and the
// audit log), but its own closed list of operations, all read-only:
//   SearchAgreements      the agreements PH is the proposer (seller) on
//   GetAgreementContacts  the buyer's contacts on one agreement (name, email,
//                         company, country)
// Nothing here can accept, cancel or change an agreement.
//
// UNTESTED LIVE: the Agreements service details below (host, signing name,
// target prefix) follow the published Agreements API; GetAgreementContacts'
// request is assumed to be { agreementId } like DescribeAgreement's, and its
// answer is stored raw (contactsRaw) and read defensively on the page, so a
// different shape needs a change in licences-core.js only, not a re-sync.
// Verify on the first real sync, as the Partner Central link was.
//
// Routes (through the partnerCentral function, /partnerCentral/v1/licences/…), editors and admins:
//   POST /v1/licences/sync                         pull agreements + contacts now
//   POST /v1/licences/link {agreementId, prospectId}  link a licence to a TAM record by hand ("" clears it)

const AGREEMENTS = {
  host: "agreement-marketplace.us-east-1.amazonaws.com",
  signingName: "aws-marketplace",
  target: "AWSMPCommerceService_v20200301",
  region: "us-east-1",
};
const LICENCE_OPERATIONS = { SearchAgreements: { readOnly: true }, GetAgreementContacts: { readOnly: true } };
const COLLECTION = "licences";
const STATUS_DOC = ["consoleConfig", "licenceSync"];
const MAX_PAGES = 10; // 50 a page
const MAX_RAW = 20000;

const text = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
// A Firestore document id from an agreement id (agmt-xxxx): letters, digits, - and _ only.
const licenceDocId = (agreementId) => text(agreementId, 120).replace(/[^A-Za-z0-9_-]/g, "_");
const isoOf = (v) => {
  if (!v) return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

// One SearchAgreements summary → the licence fields the sync writes.
function licenceFromSummary(s) {
  const x = s || {};
  const proposal = x.proposalSummary || x.ProposalSummary || {};
  const resources = proposal.resources || proposal.Resources || [];
  const acceptor = x.acceptor || x.Acceptor || {};
  return {
    agreementId: text(x.agreementId || x.AgreementId, 120),
    awsAccountId: text(acceptor.accountId || acceptor.AccountId, 12).replace(/\D/g, ""),
    status: text(x.status || x.Status, 40),
    agreementType: text(x.agreementType || x.AgreementType, 60),
    offerId: text(proposal.offerId || proposal.OfferId, 120),
    productIds: (Array.isArray(resources) ? resources : []).map((r) => text(r && (r.id || r.Id), 120)).filter(Boolean).slice(0, 10),
    startTime: isoOf(x.startTime || x.StartTime),
    endTime: isoOf(x.endTime || x.EndTime),
  };
}

function createLicenceSync({ db, credentials, sign, audit = async () => {}, fetch: fetchImpl = globalThis.fetch, now = () => new Date(), logger = console }) {
  async function call(operation, payload, by) {
    if (!LICENCE_OPERATIONS[operation]) throw Object.assign(new Error(`operation not allowed: ${operation}`), { status: 400 });
    const started = now();
    let error = null, httpStatus = null, awsType = null, result = null;
    try {
      const creds = await credentials();
      const body = JSON.stringify(payload);
      const headers = sign({
        host: AGREEMENTS.host, service: AGREEMENTS.signingName, region: AGREEMENTS.region, creds, body, date: now(),
        headers: { "content-type": "application/x-amz-json-1.0", "x-amz-target": `${AGREEMENTS.target}.${operation}` },
      });
      const r = await fetchImpl(`https://${AGREEMENTS.host}/`, { method: "POST", headers, body });
      httpStatus = r.status;
      const raw = await r.text();
      let parsed = {};
      try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw: raw.slice(0, 200) }; }
      if (!r.ok) {
        awsType = String(parsed.__type || `HTTP ${r.status}`).split("#").pop();
        error = `${awsType}: ${String(parsed.message || parsed.Message || "").slice(0, 200)}`;
      } else result = parsed;
    } catch (err) {
      error = String((err && err.message) || err).slice(0, 300);
    }
    await audit({ operation, service: "marketplace-agreements", by: by || null, ok: !error, httpStatus, awsType, error, ms: now().getTime() - started.getTime(), target: payload && (payload.agreementId || null) });
    if (error) throw Object.assign(new Error(error), { status: 502, awsType });
    return result;
  }

  const searchAgreements = (nextToken, by) => call("SearchAgreements", {
    catalog: "AWSMarketplace",
    filters: [{ name: "PartyType", values: ["Proposer"] }, { name: "AgreementType", values: ["PurchaseAgreement"] }],
    maxResults: 50, ...(nextToken ? { nextToken } : {}),
  }, by);
  const getAgreementContacts = (agreementId, by) => call("GetAgreementContacts", { agreementId }, by);

  // Every agreement, then each one's contacts, a few at a time. A contacts
  // call that fails leaves that licence with its error; the rest still sync.
  async function sync(by) {
    const ref = db.collection(STATUS_DOC[0]).doc(STATUS_DOC[1]);
    try {
      const summaries = [];
      let next = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const out = (await searchAgreements(next, by)) || {};
        summaries.push(...(out.agreementViewSummaries || out.AgreementViewSummaries || []));
        next = out.nextToken || out.NextToken || null;
        if (!next) break;
      }
      const licences = summaries.map(licenceFromSummary).filter((l) => l.agreementId);
      let contactErrors = 0, cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, licences.length) }, async () => {
        while (cursor < licences.length) {
          const lic = licences[cursor++];
          let contactsRaw = "", contactsError = null;
          try { contactsRaw = JSON.stringify((await getAgreementContacts(lic.agreementId, by)) || {}).slice(0, MAX_RAW); } catch (err) { contactsError = String(err.message || err).slice(0, 300); contactErrors++; }
          const fields = { ...lic, contactsError, syncedAt: now(), syncedBy: by || null };
          // A failed contacts read keeps the contacts from the last good sync.
          if (!contactsError) fields.contactsRaw = contactsRaw;
          await db.collection(COLLECTION).doc(licenceDocId(lic.agreementId)).set(fields, { merge: true });
        }
      }));
      const status = { lastSyncAt: now(), lastSyncBy: by || null, count: licences.length, contactErrors, truncated: !!next };
      await ref.set(status, { merge: true });
      return { ok: true, count: licences.length, contactErrors, truncated: !!next };
    } catch (err) {
      const msg = String(err.message || err).slice(0, 300);
      try { await ref.set({ lastErrorAt: now(), lastError: msg, lastErrorBy: by || null }, { merge: true }); } catch (e) { logger.warn("licenceSync status write failed", { error: String(e) }); }
      throw Object.assign(new Error(msg), { status: err.status || 502 });
    }
  }

  // A person's link from the review queue. prospectId "" clears it.
  async function link({ agreementId, prospectId } = {}, by) {
    const id = licenceDocId(agreementId);
    if (!id) throw Object.assign(new Error("agreementId is required"), { status: 400 });
    const pid = text(prospectId, 200);
    if (pid && !/^[A-Za-z0-9_-]+$/.test(pid)) throw Object.assign(new Error("prospectId is not a TAM record id"), { status: 400 });
    const ref = db.collection(COLLECTION).doc(id);
    if (!(await ref.get()).exists) throw Object.assign(new Error("no licence with that agreement id"), { status: 404 });
    if (pid && !(await db.collection("prospects").doc(pid).get()).exists) throw Object.assign(new Error("no TAM record with that id"), { status: 404 });
    await ref.set({ manualLink: pid ? { prospectId: pid, by: by || null, at: now() } : null }, { merge: true });
    return { ok: true, agreementId: id, prospectId: pid };
  }

  async function handle(path, req, ctx) {
    if (path === "/v1/licences/sync" && req.method === "POST") return sync(ctx.by);
    if (path === "/v1/licences/link" && req.method === "POST") return link(req.body || {}, ctx.by);
    return null;
  }

  return { handle, sync, link, searchAgreements, getAgreementContacts };
}

module.exports = { createLicenceSync, licenceFromSummary, licenceDocId, AGREEMENTS, LICENCE_OPERATIONS, COLLECTION, STATUS_DOC };
