// Merges fields into the single systemStatus/pipeline doc that backs the
// board's pipeline health strip (YeCj7sNpHXFUZQhmAmEb — see
// public/js/app.js's renderHealthStrip). Called by
// .github/workflows/deploy-backlog-tracker.yml as its own last step, so the
// strip can show whether the last deploy actually succeeded and which
// APP_VERSION it shipped — without ever handing a GitHub token to the
// browser. (backlog-automation.yml's own half of this doc — the
// backlogAutomation segment — is written directly from
// run-backlog-automation.js, which already has this exact token-exchange
// logic for its Firestore reads/writes; this script exists standalone
// because the deploy workflow doesn't otherwise run that script at all, and
// duplicating ~30 lines of auth here is cheaper and lower-risk than wiring
// an unrelated workflow's step into that larger, already-in-production file.)
//
//   GOOGLE_APPLICATION_CREDENTIALS=<path to the deploy service account key> \
//     node write-system-status.js '<JSON object of fields to merge>'
const fs = require("fs");

const PROJECT_ID = "backlog-tracker-e4ed2";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function tv(value) {
  // Encode a plain JS value into a Firestore REST "Value" object — same
  // shape as run-backlog-automation.js's own tv(), kept in sync by hand
  // since duplicating it here avoids introducing a shared module between a
  // long-running, carefully-hardened production script and a one-shot
  // status writer that runs from a completely different workflow.
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(tv) } };
  if (typeof value === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, tv(v)])) } };
  return { stringValue: String(value) };
}

// Same service-account JWT exchange as run-backlog-automation.js's own
// getAccessToken() — the "datastore" OAuth scope authenticates this as a GCP
// IAM principal, which is what lets it write systemStatus without needing a
// firestore.rules allow-write clause for the browser to ever share.
async function getAccessToken() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not set — write-system-status needs the Firebase service account to write Firestore");
  const key = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email, scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`;
  const signature = require("crypto").createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${signature}`,
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function main() {
  const fields = JSON.parse(process.argv[2] || "{}");
  fields.updatedAt = new Date().toISOString();
  const fieldPaths = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const token = await getAccessToken();
  const res = await fetch(`${FIRESTORE_BASE}/systemStatus/pipeline?${fieldPaths}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, tv(v)])) }),
  });
  if (!res.ok) throw new Error(`write-system-status PATCH failed: ${res.status} ${await res.text()}`);
  console.log(`write-system-status: wrote ${Object.keys(fields).join(", ")}`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
