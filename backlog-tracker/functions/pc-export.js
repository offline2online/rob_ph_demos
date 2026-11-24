"use strict";
// ── AWS Partner Central S3 data export → the Conversion Funnel ────────────
// Partner Central's single-step data export writes its performance data (co-sell
// pipeline, Marketplace revenue, funding utilisation, AWS Revenue Measurement
// attributed revenue) as files into a PH-owned S3 bucket. funnel-ingest.js reads
// the newest export from that bucket on its usual due run and turns it into
// `pc-export` rows of funnelDaily, which the Conversion Funnel's Revenue stage
// reads (public/js/funnel-core.js).
//
// No AWS key anywhere: S3 is read with the same short-lived credentials the
// Partner Central connection already gets (Google OIDC → STS
// AssumeRoleWithWebIdentity, partner-central.js), so the role in
// deploy/aws/partner-central-role.yaml carries s3:ListBucket / s3:GetObject on
// the export bucket only. Requests are signed here with the module's own SigV4
// (partner-central.js signRequest), so the function gains no dependency.
//
// The export's column names are not published, so every field is read by a
// list of header aliases (HEADER_ALIASES). Unrecognised headers and the rows
// read / joined are recorded on consoleConfig/funnelIngest (sources.pc-export),
// so the first real file shows at once if a guess was wrong. CSV and JSON files
// are both read; anything else under the prefix is ignored.
//
// Configuration (consoleConfig/funnelIngest, server-written):
//   pcExportBucket   the bucket name (unset: the source is "not set up yet",
//                    a neutral state, never a red failure)
//   pcExportPrefix   the folder the export writes under (default: the root)
//   pcExportRegion   the bucket's region (default us-east-1)

const crypto = require("crypto");
const { signRequest } = require("./partner-central");

const DEFAULT_REGION = "us-east-1";
const MAX_FILES = 25;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const LOOSE_RUN_MS = 6 * 3600e3; // files straight under the prefix: one run = written within 6 h of the newest
const DATA_FILE = /\.(csv|json|jsonl)$/i;

const s = (v) => String(v == null ? "" : v).trim();
const sha256hex = (x) => crypto.createHash("sha256").update(x).digest("hex");

// ── Parsing ───────────────────────────────────────────────────────────────
/** RFC 4180 CSV → array of string arrays (quoted fields, "" escapes, CRLF). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  const src = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/** "Attributed Revenue (USD)" → "attributedrevenueusd". */
const headerKey = (h) => s(h).toLowerCase().replace(/[^a-z0-9]+/g, "");

// Canonical field → the header spellings it is read from (first match wins).
const HEADER_ALIASES = {
  opportunityId: ["opportunityid", "aceopportunityid", "opportunityidentifier", "id", "acoppid", "opportunityreferenceid", "partneropportunityidentifier"],
  customer: ["customercompanyname", "customername", "companyname", "customer", "accountname", "endcustomer", "endcustomername"],
  stage: ["stage", "opportunitystage", "lifecyclestage", "salesstage", "status"],
  createdDate: ["createddate", "opportunitycreateddate", "datecreated", "creationdate"],
  closeDate: ["launchdate", "closeddate", "closedate", "actualclosedate", "wondate"],
  period: ["revenuemonth", "revenueperiod", "billingmonth", "billingperiod", "month", "period", "reportingmonth", "date", "revenuedate"],
  campaign: ["demandcentercampaign", "demandcentercampaignname", "campaignname", "campaign", "marketingcampaign", "campaignid", "demandcentercampaignid"],
  leadId: ["leadid", "demandcenterleadid", "leadidentifier", "sourceleadid"],
  attributedRevenue: ["attributedrevenue", "attributedrevenueusd", "revenuemeasurementattributedrevenue", "awsattributedrevenue", "influencedrevenue"],
  marketplaceRevenue: ["marketplacerevenue", "marketplacerevenueusd", "billedrevenue", "grossrevenue", "netrevenue", "awsmarketplacerevenue", "revenue"],
  fundingUsed: ["fundingutilised", "fundingutilized", "fundingused", "fundingutilisation", "fundingutilization", "fundingspent", "benefitamountused", "fundsclaimed"],
  currency: ["currency", "currencycode", "revenuecurrency"],
};
const ALIAS_INDEX = new Map();
for (const [field, names] of Object.entries(HEADER_ALIASES)) for (const n of names) if (!ALIAS_INDEX.has(n)) ALIAS_INDEX.set(n, field);
const MONEY = ["attributedRevenue", "marketplaceRevenue", "fundingUsed"];

/** "$1,234.50" / "1234.5" / "(12)" → number (0 when unreadable). */
function money(v) {
  const t = s(v);
  if (!t) return 0;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  const x = Number(t.replace(/[^0-9.]/g, ""));
  return Number.isFinite(x) ? (neg ? -x : x) : 0;
}

/** A date-ish value → "YYYY-MM-DD", or "". "2026-10" → the 1st of that month. */
function dayOf(v) {
  const t = s(v);
  if (!t) return "";
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})[-/](\d{1,2})$/.exec(t) || /^(\d{4})(\d{2})$/.exec(t);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-01`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t); // US export style M/D/YYYY
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "";
}

/** Objects with arbitrary keys → canonical records, plus the keys nobody recognised. */
function canonicalise(objects) {
  const unknown = new Set();
  const out = [];
  for (const o of objects || []) {
    if (!o || typeof o !== "object") continue;
    const r = {};
    for (const [k, v] of Object.entries(o)) {
      const field = ALIAS_INDEX.get(headerKey(k));
      if (!field) { if (v !== "" && v != null && typeof v !== "object") unknown.add(s(k)); continue; }
      if (r[field] === undefined || r[field] === "") r[field] = v;
    }
    out.push(r);
  }
  return { records: out, unknown: [...unknown] };
}

/** One export file's text → canonical records. JSON may be an array, {rows|data|opportunities:[…]} or JSON lines. */
function parseExportFile(name, text) {
  if (/\.csv$/i.test(name)) {
    const rows = parseCsv(text);
    if (!rows.length) return { records: [], unknown: [] };
    const head = rows[0];
    return canonicalise(rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? "" : r[i]]))));
  }
  let items = [];
  const t = String(text || "").trim();
  try {
    const j = JSON.parse(t);
    items = Array.isArray(j) ? j : (j && (j.rows || j.data || j.opportunities || j.records)) || (j && typeof j === "object" ? [j] : []);
  } catch {
    items = t.split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
  // A nested opportunity (CRM-style JSON) carries the company under customer.account.companyName.
  const flat = items.map((o) => (o && typeof o === "object" ? flatten(o) : o));
  return canonicalise(flat);
}
function flatten(o, out = {}) {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === "object") { if (!Array.isArray(v)) flatten(v, out); continue; }
    if (out[k] === undefined || out[k] === "" || out[k] === null) out[k] = v;
  }
  return out;
}

const WON = /launched|closed\s*won|won|deployed/i;
const LOST = /closed\s*lost|lost/i;

/**
 * Canonical records (from every file of one export) → one entry per ACE
 * opportunity and per day, with revenue summed across that day's rows.
 * Records with no opportunity id still count if they name a customer (a
 * Marketplace revenue row for a company); they are keyed by the company.
 */
function exportEntries(records) {
  const opps = new Map(); // id → merged descriptive fields
  const amountsBy = new Map(); // id|day → amounts
  const keyOf = (r) => s(r.opportunityId) || (s(r.customer) ? `company:${s(r.customer).toLowerCase()}` : "");
  for (const r of records || []) {
    const id = keyOf(r);
    if (!id) continue;
    const o = opps.get(id) || { id, opportunityId: s(r.opportunityId), customer: "", stage: "", createdDate: "", closeDate: "", campaign: "", leadId: "", currency: "" };
    for (const k of ["customer", "stage", "campaign", "leadId", "currency"]) if (!o[k] && s(r[k])) o[k] = s(r[k]);
    for (const k of ["createdDate", "closeDate"]) if (!o[k] && dayOf(r[k])) o[k] = dayOf(r[k]);
    opps.set(id, o);
    const amounts = Object.fromEntries(MONEY.map((k) => [k, money(r[k])]));
    if (!MONEY.some((k) => amounts[k])) continue;
    const day = dayOf(r.period) || "";
    const mk = `${id}|${day}`;
    const have = amountsBy.get(mk) || { id, day, attributedRevenue: 0, marketplaceRevenue: 0, fundingUsed: 0 };
    for (const k of MONEY) have[k] += amounts[k];
    amountsBy.set(mk, have);
  }
  const entries = [];
  for (const m of amountsBy.values()) {
    const o = opps.get(m.id);
    const day = m.day || o.closeDate || o.createdDate;
    if (!day) continue;
    entries.push({ ...o, day, attributedRevenue: round(m.attributedRevenue), marketplaceRevenue: round(m.marketplaceRevenue), fundingUsed: round(m.fundingUsed) });
  }
  return { opportunities: [...opps.values()], entries };
}
const round = (x) => Math.round(x * 100) / 100;

// ── The join to the console's own records ────────────────────────────────
const normName = (x) => String(x || "").toLowerCase().replace(/\b(ltd|limited|plc|inc|llc|gmbh|corp|corporation|co|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
function channelOfLeadSource(source) {
  const t = s(source).toLowerCase();
  if (!t) return "";
  if (/marketplace|aws/.test(t)) return "AWS Marketplace";
  if (/google|paid|ad(s|words)?\b/.test(t)) return "Google Ads";
  if (/organic|seo|search/.test(t)) return "Organic";
  if (/referr|partner/.test(t)) return "Referral";
  if (/direct|manual|website|form/.test(t)) return "Direct";
  return "";
}

/**
 * Export entries → funnelDaily `pc-export` rows {id, row}. Joined on the ACE
 * opportunity id first (the live ACE list gives the company), then on company
 * name to Prospects (TAM) (industry, country) and Leads (channel, content); a
 * Demand Center campaign on the export wins over the prospect's first campaign.
 * Pure.
 */
function exportRows(entries, { opportunities = [], leads = [], prospects = [] } = {}) {
  const aceById = new Map((opportunities || []).map((o) => [s(o.id), o]));
  const prospectByName = new Map();
  for (const p of prospects || []) { const k = normName(p.name); if (k && !prospectByName.has(k)) prospectByName.set(k, p); }
  const leadByName = new Map(); const leadById = new Map();
  for (const l of leads || []) {
    if (!l || l.test === true || l.archivedAt) continue;
    const k = normName(l.company && l.company.name);
    if (k && !leadByName.has(k)) leadByName.set(k, l);
    if (l.id) leadById.set(s(l.id), l);
  }
  let joined = 0;
  const rows = entries.map((e) => {
    const ace = aceById.get(s(e.opportunityId)) || null;
    const company = s((ace && ace.customer) || e.customer);
    const k = normName(company);
    const p = prospectByName.get(k) || null;
    const l = (e.leadId && leadById.get(s(e.leadId))) || leadByName.get(k) || null;
    if (ace || p || l) joined++;
    const c = (l && l.company) || {};
    const row = {
      date: e.day, source: "pc-export",
      channel: channelOfLeadSource(l && l.source), campaign: s(e.campaign || (p && Array.isArray(p.campaigns) && p.campaigns[0]) || ""),
      adGroup: "", creative: "",
      industry: s((ace && ace.industry) || (p && p.industry) || c.industry || ""),
      country: s((p && (p.country || p.hqCountry)) || (Array.isArray(c.countries) && c.countries[0]) || ""),
      content: s(l && (l.sourceLabel || l.sourcePage)), company,
      aceId: s(e.opportunityId), stage: s((ace && ace.stage) || e.stage), currency: s(e.currency).toUpperCase().slice(0, 3) || "USD",
      attributedRevenue: e.attributedRevenue, marketplaceRevenue: e.marketplaceRevenue, fundingUsed: e.fundingUsed,
    };
    const key = (s(e.opportunityId) || `co-${normName(company).replace(/ /g, "-")}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "row";
    return { id: `${e.day}_pc-export_${key}`, row };
  });
  return { rows, joined };
}

// ── S3 (ListObjectsV2 + GetObject), SigV4-signed ─────────────────────────
const enc = (x) => encodeURIComponent(x).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const xmlAll = (xml, tag) => [...String(xml).matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
const xmlOne = (xml, tag) => { const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml); return m ? m[1] : ""; };
const unxml = (x) => String(x).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function createS3Reader({ credentials, fetch: fetchImpl = globalThis.fetch, now = () => new Date() }) {
  async function get({ bucket, region, key = "", query = {} }) {
    const host = region === "us-east-1" ? `${bucket}.s3.amazonaws.com` : `${bucket}.s3.${region}.amazonaws.com`;
    const path = `/${key.split("/").map(enc).join("/")}`;
    const qs = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(String(query[k]))}`).join("&");
    const creds = await credentials();
    const headers = signRequest({ method: "GET", host, path, query: qs, body: "", service: "s3", region, creds, date: now(), headers: { "x-amz-content-sha256": sha256hex("") } });
    const r = await fetchImpl(`https://${host}${path}${qs ? `?${qs}` : ""}`, { method: "GET", headers });
    const body = await r.text();
    if (!r.ok) {
      const code = xmlOne(body, "Code") || `HTTP ${r.status}`;
      throw Object.assign(new Error(`S3 answered ${code}${xmlOne(body, "Message") ? `: ${xmlOne(body, "Message").slice(0, 200)}` : ""}`), { status: r.status, code });
    }
    return body;
  }
  async function list({ bucket, region, prefix }) {
    const objects = [];
    let token = "";
    for (let page = 0; page < 20; page++) {
      const xml = await get({ bucket, region, query: { "list-type": "2", prefix: prefix || "", ...(token ? { "continuation-token": token } : {}) } });
      for (const c of xmlAll(xml, "Contents")) objects.push({ key: unxml(xmlOne(c, "Key")), lastModified: xmlOne(c, "LastModified"), etag: unxml(xmlOne(c, "ETag")).replace(/"/g, ""), size: Number(xmlOne(c, "Size")) || 0 });
      token = unxml(xmlOne(xml, "NextContinuationToken"));
      if (xmlOne(xml, "IsTruncated") !== "true" || !token) break;
    }
    return objects;
  }
  const read = ({ bucket, region, key }) => get({ bucket, region, key });
  return { list, read };
}

/** The files of the newest export run: the newest data file's folder, or (files loose under the prefix) those written within 6 h of it. */
function latestRun(objects, prefix = "") {
  const data = (objects || []).filter((o) => DATA_FILE.test(o.key) && o.size <= MAX_FILE_BYTES).map((o) => ({ ...o, ms: Date.parse(o.lastModified) || 0 }));
  if (!data.length) return [];
  data.sort((a, b) => b.ms - a.ms);
  const newest = data[0];
  const folderOf = (k) => (k.includes("/") ? k.slice(0, k.lastIndexOf("/") + 1) : "");
  const base = String(prefix || "").replace(/^\/+/, "");
  const root = base && !base.endsWith("/") ? folderOf(base) : base; // "exports/pc-" lists under "exports/"
  const folder = folderOf(newest.key);
  const run = folder === root
    ? data.filter((o) => folderOf(o.key) === folder && newest.ms - o.ms <= LOOSE_RUN_MS) // loose files: one run = written within 6 h
    : data.filter((o) => folderOf(o.key) === folder); // a run folder: every data file in it
  return run.slice(0, MAX_FILES);
}

/** consoleConfig/funnelIngest → the export's settings, or null when not set up. */
function exportConfig(raw) {
  const d = raw || {};
  const bucket = s(d.pcExportBucket);
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return null;
  return { bucket, prefix: s(d.pcExportPrefix).replace(/^\/+/, ""), region: /^[a-z]{2}(-[a-z]+)+-\d$/.test(s(d.pcExportRegion)) ? s(d.pcExportRegion) : DEFAULT_REGION };
}

/**
 * Read the newest export: {skipped} when its files are the ones imported last
 * time (same keys and ETags), else the parsed entries and what was read.
 */
async function readLatestExport(s3, cfg, { lastSignature = "" } = {}) {
  const objects = await s3.list(cfg);
  const run = latestRun(objects, cfg.prefix);
  if (!run.length) throw new Error(`No export files (.csv or .json) under s3://${cfg.bucket}/${cfg.prefix}`);
  const signature = sha256hex(run.map((o) => `${o.key}@${o.etag}`).sort().join("\n")).slice(0, 32);
  if (signature === lastSignature) return { skipped: true, signature, files: run.map((o) => o.key) };
  const records = []; const unknown = new Set();
  for (const o of run) {
    const text = await s3.read({ ...cfg, key: o.key });
    const parsed = parseExportFile(o.key, text);
    records.push(...parsed.records);
    parsed.unknown.forEach((h) => unknown.add(h));
  }
  return { skipped: false, signature, files: run.map((o) => o.key), exportedAt: run[0].lastModified, records, unknownHeaders: [...unknown].slice(0, 40), ...exportEntries(records) };
}

module.exports = {
  parseCsv, parseExportFile, canonicalise, exportEntries, exportRows, createS3Reader, latestRun, exportConfig, readLatestExport,
  money, dayOf, headerKey, HEADER_ALIASES, DEFAULT_REGION, MAX_FILES,
};
