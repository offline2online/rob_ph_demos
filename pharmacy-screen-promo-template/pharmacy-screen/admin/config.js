// Admin editor deployment settings. Non-secret: this file is served to the browser.
//
//   apiBase     where /api/** is served. '' = this site (Hosting rewrites /api/admin/**, /api/settings/** and
//               /api/device/** to the config API and the PH API proxy).
//   screenPage  the screen page URL that "Copy experience URL" builds on. '' = ../pharmacy-screen.html beside
//               this editor.
//   auth.mode   'firebase': sign in with Firebase Auth; admins carry the `admin` custom claim
//               (config-api/scripts/set-admin-claim.js). auth.firebase is the web app config
//               ({apiKey, authDomain, projectId}) from the Firebase console.
//               'oidc': OpenID Connect sign-in (the AWS deployment: Cognito or the retailer's identity provider).
//               auth.oidc is {clientId, authorizeUrl, tokenUrl, logoutUrl, logoutParam, scopes}; the AWS deploy
//               writes it (aws/infra/stack.js). Admins carry the admin claim the stack names (aws/README.md).
//               'token': paste an access token. Local development only (admin/tools/dev-server.mjs serves its
//               own copy of this file with mode 'token'); never deploy it.
export default {
  apiBase: '',
  screenPage: '',
  auth: { mode: 'firebase', firebase: null },
};
