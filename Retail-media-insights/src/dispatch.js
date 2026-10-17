'use strict';
// Request dispatch as one pure function, shared by the HTTP server and the browser bundle (frontend/local-api.js),
// so the 401/403/400 rules, the insights:read scope and server-side advertiser scoping apply identically in both.
// Nothing here touches http, fs or tokens: the caller resolves who is asking and hands in the result.

const { FilterError, ForbiddenError } = require('./filters');
const { runRoute } = require('./query');
const { PRINCIPAL_TYPES } = require('./auth-types');

const BASE = '/insights/v1/retail-media';

function normalisePrincipal(p) {
  if (!p || !PRINCIPAL_TYPES.includes(p.principalType) || typeof p.principalId !== 'string' || !p.principalId) return null;
  return { principalType: p.principalType, principalId: p.principalId, scopes: Array.isArray(p.scopes) ? p.scopes : [] };
}

/**
 * dispatch({store, routes, url, principal, today, method}) -> {status, body, headers}
 *  - routes: the route objects ({path, handler, public?, advertiserAccess?}); url: BASE + route path + query string.
 *  - principal: the resolved principal, or a function returning it (called only for a non-public route, and a
 *    throw is a 401). Anything null or malformed is a 401: there is no default caller.
 */
function dispatch({ store, routes, url, principal, today, method = 'GET' }) {
  const list = Array.isArray(routes) ? routes : [...routes.values()];
  const u = new URL(url, 'http://localhost');
  const route = list.find((r) => `${BASE}${r.path}` === u.pathname);
  let who = null;
  // Authenticate before the route lookup: an unauthenticated caller gets 401 for every path but a public one, so
  // 404 versus 401 cannot be used to enumerate routes.
  if (!route || !route.public) {
    try { who = normalisePrincipal(typeof principal === 'function' ? principal() : principal); } catch { who = null; }
    if (!who) return { status: 401, body: { error: 'authentication required' }, headers: { 'www-authenticate': 'Bearer' } };
  }
  if (!route) return { status: 404, body: { error: 'not found' } };
  if (method !== 'GET') return { status: 405, body: { error: 'read-only service' }, headers: { allow: 'GET' } };
  const byPath = new Map(list.map((r) => [r.path, r]));
  try {
    const body = route.public
      ? route.handler({ store, filters: null, params: u.searchParams, principal: who })
      : runRoute(route, { store, principal: who, params: u.searchParams, today, routes: byPath });
    return { status: 200, body };
  } catch (e) {
    if (e instanceof FilterError) return { status: 400, body: { error: e.message } };
    if (e instanceof ForbiddenError) return { status: 403, body: { error: e.message } };
    return { status: 500, body: { error: 'internal error' } };
  }
}

module.exports = { dispatch, normalisePrincipal, BASE };
