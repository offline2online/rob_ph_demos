// Promote › Leads ACE table rules: public/js/ace-core.js.   node ace.test.mjs
import assert from "node:assert/strict";
import { summarise, matchLead, mailtoFor, partnerCentralHref, formatMonthly, formatDate, kpis, reviewTone, isPastDate, formValues, changedValues, validateForm, savedMessage, checkDocument, docDisplayName, formatDateTime } from "../public/js/ace-core.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };
const rows = [
  { id: "O1", name: "Menu boards", customer: "Acme Retail Ltd", stage: "Qualified", reviewStatus: "Approved", awsSeller: { name: "Ann Lee", email: "ann@amazon.com" }, partnerCentralUrl: "https://partnercentral.awspartner.com/partnercentral2/s/opportunities/O1" },
  { id: "O2", name: "Signage", customer: "Beta", stage: "Prospect", reviewStatus: "Submitted" },
  { id: "O3", name: "Kiosk", customer: "Beta", stage: "prospect", reviewStatus: "Action Required" },
  { id: "O4", name: "X", customer: "Z", stage: "", reviewStatus: "" },
];

t("the summary counts by ACE stage and review status, in AWS order", () => {
  const s = summarise(rows);
  assert.equal(s.total, 4);
  assert.deepEqual(s.byStage, [{ label: "Prospect", count: 2 }, { label: "Qualified", count: 1 }, { label: "Not set", count: 1 }]);
  assert.deepEqual(s.byReview.map((r) => r.label), ["Submitted", "Approved", "Action Required", "Not set"]);
});
t("an empty list summarises to nothing", () => assert.deepEqual(summarise([]), { total: 0, byStage: [], byReview: [] }));
t("the email icon opens a new email to the AWS manager naming opportunity and customer", () => {
  const m = mailtoFor(rows[0]);
  assert.ok(m.startsWith("mailto:ann@amazon.com?subject="));
  const subject = decodeURIComponent(/subject=([^&]*)/.exec(m)[1]);
  assert.equal(subject, "Menu boards – Acme Retail Ltd");
});
t("no manager, or a malformed address, gives no mailto", () => {
  assert.equal(mailtoFor(rows[1]), "");
  assert.equal(mailtoFor({ awsSeller: { email: "a b@c" } }), "");
  assert.equal(mailtoFor({ awsSeller: { email: "x@y.com>\r\nBcc: z@z.com" } }), "");
});
t("a row links to the lead card whose company matches the customer", () => {
  const leads = [{ id: "L1", company: { name: "ACME Retail" } }, { id: "L2", company: { name: "Beta" } }];
  assert.equal(matchLead(rows[0], leads).id, "L1");
  assert.equal(matchLead(rows[3], leads), null);
  assert.equal(matchLead({ customer: "" }, leads), null);
});
t("only Partner Central addresses are linked", () => {
  assert.ok(partnerCentralHref(rows[0]).startsWith("https://partnercentral.awspartner.com/"));
  assert.equal(partnerCentralHref({ partnerCentralUrl: "https://evil.example/" }), "");
  assert.equal(partnerCentralHref({ partnerCentralUrl: "javascript:alert(1)" }), "");
});
t("money and dates read plainly", () => {
  assert.equal(formatMonthly({ amount: 2200, currency: "USD" }), "US$2,200");
  assert.equal(formatMonthly(null), "");
  assert.equal(formatDate("2026-12-31"), "31 Dec 2026");
  assert.equal(formatDate("nope"), "");
});
t("review tones: approved green, in progress amber, needs a person red", () => {
  assert.equal(reviewTone("Approved"), "ok");
  for (const s of ["Pending Submission", "Submitted", "In review"]) assert.equal(reviewTone(s), "warn");
  for (const s of ["Action Required", "Rejected"]) assert.equal(reviewTone(s), "bad");
  assert.equal(reviewTone(""), "none");
});
t("a close date before today is past; today and later are not", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  assert.equal(isPastDate("2026-11-06", now), true);
  assert.equal(isPastDate("2026-11-07", now), false);
  assert.equal(isPastDate("2026-12-31", now), false);
  assert.equal(isPastDate(null, now), false);
});
t("KPIs: count, revenue per currency, approved, needs action", () => {
  const k = kpis([
    { reviewStatus: "Approved", expectedMonthly: { amount: 100, currency: "USD" } },
    { reviewStatus: "Rejected", expectedMonthly: { amount: 50, currency: "USD" } },
    { reviewStatus: "Action Required", expectedMonthly: { amount: 10, currency: "GBP" } },
    { reviewStatus: "Submitted", expectedMonthly: null },
  ]);
  assert.deepEqual(k, { total: 4, revenue: [{ currency: "USD", amount: 150 }, { currency: "GBP", amount: 10 }], approved: 1, needsAction: 2 });
  assert.deepEqual(kpis([]), { total: 0, revenue: [], approved: 0, needsAction: 0 });
});
t("the dialog edits only what changed, and an empty create asks for title and customer", () => {
  const o = formValues({ name: "A", customer: "B", nextSteps: "x", expectedMonthly: { amount: 5, currency: "GBP" } });
  assert.deepEqual(o.monthlyAmount, "5"); assert.equal(o.currency, "GBP");
  assert.deepEqual(changedValues(o, { ...o, nextSteps: " y " }), { nextSteps: "y" });
  assert.deepEqual(changedValues(o, o), {});
  assert.deepEqual(validateForm(formValues({}), { creating: true }), ["Enter a title and customer."]);
  assert.deepEqual(validateForm({ name: "A", customer: "B", targetCloseDate: "x", monthlyAmount: "-1" }).length, 2);
  assert.equal(savedMessage({ score: 72 }), "Saved to AWS ACE. Score 72.");
  assert.match(savedMessage({ score: null }, "Created in AWS ACE"), /^Created in AWS ACE\. Score not available/);
});
t("documents: PDF, Office, image and zip up to 50 MB only", () => {
  assert.equal(checkDocument({ name: "a.PDF", size: 10 }).contentType, "application/pdf");
  assert.equal(checkDocument({ name: "a.zip", size: 10 }).ok, true);
  assert.equal(checkDocument({ name: "a.exe", size: 10 }).ok, false);
  assert.equal(checkDocument({ name: "a.pdf", size: 51 * 1024 * 1024 }).error, "That file is over 50 MB.");
  assert.equal(checkDocument({ name: "a.pdf", size: 0 }).ok, false);
  assert.equal(docDisplayName("1762500000000-plan.pdf"), "plan.pdf");
  assert.equal(formatDateTime("2026-10-01T09:00:00Z"), "1 Oct 2026");
});

console.log(`ace: ${n} passed`);
