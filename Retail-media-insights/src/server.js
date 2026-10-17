'use strict';
// Read-only HTTP server. Routes are auto-discovered from src/routes/*.js and mounted under
// /insights/v1/retail-media. Only GET is served.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseFilters, scopeFilters, FilterError, ForbiddenError } = require('./filters');

const BASE = '/insights/v1/retail-media';

function loadRoutes(dir = path.join(__dirname, 'routes')) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => require(path.join(dir, f)));
}

/**
 * `authenticate(req)` resolves the caller to a principal: {} for a retailer user, or
 * {advertiserId} for an advertiser login. The real identity provider is a follow-up; the default
 * treats every caller as a retailer user, so this must not be exposed beyond the VPC as is.
 */
function createServer({ store, authenticate = () => ({}), today } = {}) {
  const routes = new Map(loadRoutes().map((r) => [`${BASE}${r.path}`, r]));
  return http.createServer((req, res) => {
    const send = (code, body, headers = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, 'http://localhost');
    const route = routes.get(url.pathname);
    if (!route) return send(404, { error: 'not found' });
    if (req.method !== 'GET') return send(405, { error: 'read-only service' }, { allow: 'GET' });
    try {
      const principal = authenticate(req);
      const filters = scopeFilters(parseFilters(url.searchParams, { today }), principal);
      return send(200, route.handler({ store, filters, params: url.searchParams, principal }));
    } catch (e) {
      if (e instanceof FilterError) return send(400, { error: e.message });
      if (e instanceof ForbiddenError) return send(403, { error: e.message });
      return send(500, { error: 'internal error' });
    }
  });
}

if (require.main === module) {
  const { generateTestRetailer } = require('./testdata');
  const { buildAggregates } = require('./aggregate');
  const { AggregateStore } = require('./store');
  const data = generateTestRetailer();
  const store = new AggregateStore(buildAggregates(data.raw, data.ctx));
  const port = Number(process.env.PORT) || 8080;
  createServer({ store }).listen(port, () => console.log(`Retail Media Insights on :${port}${BASE}/health (test retailer)`));
}

module.exports = { createServer, BASE };
