"use strict";

// The Content-Security-Policy for the screen page and the admin editor, in one place. Both deployments send it:
// aws/infra/stack.js (CloudFront response headers) builds it from here, and firebase.json (Firebase Hosting, which
// cannot read code) carries the same strings, which test/deploy-config.test.mjs checks against this file.
//
// It is sent as Content-Security-Policy-Report-Only first: nothing is blocked, and each violation is POSTed to
// /api/csp-report (the config API logs one line per report, "[csp] …"). Once a week of real players and editor
// use reports nothing, the same value is sent as Content-Security-Policy instead (CSP_HEADER below; docs/
// DEPLOYMENT.md → "Content-Security-Policy").
//
// The screen gets the policy as specified. The editor needs more: Google Fonts, and on Firebase the Firebase
// Auth SDK (loaded from www.gstatic.com; Google sign-in opens the project's authDomain), Identity Toolkit and
// Secure Token; on AWS the OIDC token endpoint the editor calls after sign-in.

const CSP_HEADER = "Content-Security-Policy-Report-Only";
const REPORT_URI = "/api/csp-report";

const join = (directives) =>
  Object.entries(directives)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => (v.length ? `${k} ${v.join(" ")}` : k))
    .join("; ");

// connect: the screen's API servers beyond its own origin (the page's pharmacy-screen-api setting, if it names
// other servers). Empty (the default): this origin only.
function screenCsp({ connect = [] } = {}) {
  return join({
    "script-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "img-src": ["'self'", "https:", "data:"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...connect],
    "report-uri": [REPORT_URI],
  });
}

// script / connect / frame: what the editor's sign-in needs on top (firebaseEditorExtras, or the OIDC token
// endpoint's origin on AWS).
function editorCsp({ script = [], connect = [], frame = [] } = {}) {
  return join({
    "script-src": ["'self'", ...script],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    // blob: the logo and background upload previews (URL.createObjectURL).
    "img-src": ["'self'", "https:", "data:", "blob:"],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    "connect-src": ["'self'", ...connect],
    "frame-src": frame.length ? frame : null,
    "report-uri": [REPORT_URI],
  });
}

// Firebase sign-in (admin/js/auth.js): the SDK from www.gstatic.com (and apis.google.com for the Google popup),
// Identity Toolkit and Secure Token, and the project's authDomain, which the popup frames.
function firebaseEditorExtras(authDomain) {
  return {
    script: ["https://www.gstatic.com", "https://apis.google.com"],
    connect: ["https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com", "https://www.googleapis.com"],
    frame: [`https://${authDomain}`],
  };
}

module.exports = { CSP_HEADER, REPORT_URI, screenCsp, editorCsp, firebaseEditorExtras };
