'use strict';
// Read-only HTTP server. Routes are auto-discovered from src/routes/*.js and mounted under
// /insights/v1/retail-media. Only GET is served.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseFilters, scopeFilters, FilterError, ForbiddenError } = require('./filters');
const { createTokenAuthenticator, PRINCIPAL_TYPES } = require('./auth');

const BASE = '/insights/v1/retail-media';

function loadRoutes(dir = path.join(__dirname, 'routes')) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => require(path.join(dir, f))).filter((r) => r.path); // helper modules (params.js) export no path
}

/**
 * `authenticate(req)` is required and resolves the caller to {principalType: 'admin'|'advertiser',
 * principalId, scopes}, or null; anything else (null, a malformed principal, a throw) is a 401. There is
 * no default: an unauthenticated caller is never a retailer user (DSP Integration section 9.5).
 *
 * Each route declares who may call it. Only `public: true` skips authentication (/health). A route
 * without `advertiserAccess: true` is retailer (admin) only and an advertiser gets 403. A route that
 * sets `advertiserAccess: true` must read its data through the already-scoped `filters`, never through
 * `params`. `routes` overrides the auto-discovered list (tests).
 */
function createServer({ store, authenticate, today, routes: routeList } = {}) {
  if (typeof authenticate !== 'function') throw new TypeError('createServer requires an authenticate(req) function');
  const routes = new Map((routeList || loadRoutes()).map((r) => [`${BASE}${r.path}`, r]));
  return http.createServer((req, res) => {
    const send = (code, body, headers = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, 'http://localhost');
    const route = routes.get(url.pathname);
    if (!route) return send(404, { error: 'not found' });
    let principal = null;
    if (!route.public) {
      try { principal = normalisePrincipal(authenticate(req)); } catch { principal = null; }
      if (!principal) return send(401, { error: 'authentication required' }, { 'www-authenticate': 'Bearer' });
    }
    if (req.method !== 'GET') return send(405, { error: 'read-only service' }, { allow: 'GET' });
    try {
      if (principal && principal.principalType === 'advertiser' && !route.advertiserAccess) throw new ForbiddenError('not available to advertiser logins');
      const filters = principal ? scopeFilters(parseFilters(url.searchParams, { today }), principal, store) : null;
      return send(200, route.handler({ store, filters, params: url.searchParams, principal }));
    } catch (e) {
      if (e instanceof FilterError) return send(400, { error: e.message });
      if (e instanceof ForbiddenError) return send(403, { error: e.message });
      return send(500, { error: 'internal error' });
    }
  });
}

function normalisePrincipal(p) {
  if (!p || !PRINCIPAL_TYPES.includes(p.principalType) || typeof p.principalId !== 'string' || !p.principalId) return null;
  return { principalType: p.principalType, principalId: p.principalId, scopes: Array.isArray(p.scopes) ? p.scopes : [] };
}

if (require.main === module) {
  const { generateTestRetailer } = require('./testdata');
  const { buildAggregates } = require('./aggregate');
  const { AggregateStore } = require('./store');
  const data = generateTestRetailer();
  const store = new AggregateStore(buildAggregates(data.raw, data.ctx));
  const port = Number(process.env.PORT) || 8080;
  // Fail closed: no secret, no server. Mint tokens with `node src/mint-token.js`.
  const authenticate = createTokenAuthenticator({ secret: process.env.RMI_AUTH_SECRET });
  createServer({ store, authenticate }).listen(port, () => console.log(`Retail Media Insights on :${port}${BASE}/health (test retailer)`));
}

module.exports = { createServer, BASE };
