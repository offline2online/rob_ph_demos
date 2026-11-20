"use strict";

// The admin editor's config.js for the AWS deployment (see
// pharmacy-screen/admin/config.js): same-origin API, OIDC sign-in. The stack
// writes it at deploy time, when the sign-in endpoints are known; the editor's
// browser test (test/ui/admin-oidc.test.mjs) serves the same shape.

function adminConfig({ clientId, authorizeUrl, tokenUrl, logoutUrl = null, logoutParam = "post_logout_redirect_uri", scopes = "openid email profile" }) {
  return {
    apiBase: "",
    screenPage: "",
    auth: { mode: "oidc", oidc: { clientId, authorizeUrl, tokenUrl, logoutUrl, logoutParam, scopes } },
  };
}

// toJson: JSON.stringify, or the stack's token-aware toJsonString.
function adminConfigJs(config, toJson = (v) => JSON.stringify(v, null, 2)) {
  return `// Written by the AWS deploy (aws/infra/stack.js; see pharmacy-screen/admin/config.js). Non-secret.\nexport default ${toJson(config)};\n`;
}

module.exports = { adminConfig, adminConfigJs };
