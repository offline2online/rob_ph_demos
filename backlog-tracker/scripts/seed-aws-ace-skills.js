// Insert-only seed for the four AWS ACE funding skills, from ../skill-sources/.
// Safe to re-run: skips a slug that already exists. Needs a human with
// GOOGLE_APPLICATION_CREDENTIALS for backlog-tracker-e4ed2 (see README -> Skills).
const fs = require("fs");
const path = require("path");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const SKILLS = [
  ["aws-pricing-calculator", "AWS Pricing Calculator (shared)", "Builds the online AWS Pricing Calculator estimate for a POC or sandbox; called by both funding skills."],
  ["aws-ace-poc-funding-request", "AWS ACE POC funding request", "Generates the AWS POC funding document from the CP Group example; calls the pricing calculator skill."],
  ["aws-ace-sandbox-credit-request", "AWS ACE sandbox credit request", "Generates the sandbox credit request from the Avolta Hudson example; calls the pricing calculator skill."],
  ["aws-ace-poc-claim", "AWS ACE POC claim", "Prepares and submits the claim for approved, delivered POC funding."],
];

async function main() {
  for (const [slug, name, summary] of SKILLS) {
    const existing = await db.collection("skills").where("slug", "==", slug).limit(1).get();
    if (!existing.empty) { console.log(`"${slug}" already exists (${existing.docs[0].id}) - skipped.`); continue; }
    const content = fs.readFileSync(path.join(__dirname, "..", "skill-sources", slug + ".md"), "utf8");
    const now = Timestamp.now();
    const ref = await db.collection("skills").add({
      name, slug, summary, version: "1.0.0",
      files: [{ path: "SKILL.md", content }],
      misses: [],
      createdVia: "console", createdByEmail: null, updatedByEmail: null,
      createdAt: now, updatedAt: now,
    });
    console.log(`Created "${slug}" (${ref.id}).`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
