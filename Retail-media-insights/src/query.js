'use strict';
// The one place a request becomes an answer: HTTP routes, QuickSight datasets and MCP tools all go through
// runRoute, so they share the same role check, the same server-side advertiser scoping and the same filters.

const { parseFilters, scopeFilters, ForbiddenError } = require('./filters');
const { READ_SCOPE } = require('./constants');

/**
 * `cache` (optional, the HTTP server's ResponseCache) is consulted after the scope and role checks and the server-side scoping, so a
 * hit can never skip a check or cross principals. With one, a successful JSON result comes back as {[SERIALISED]: json}, the
 * response text itself, whether it was cached or just computed.
 */
function runRoute(route, { store, principal, params, today, routes, cache }) {
  // An authenticated caller lacking the scope is 403 (DSP Integration section 9.5).
  if (principal && !(principal.scopes || []).includes(READ_SCOPE)) throw new ForbiddenError(`the ${READ_SCOPE} scope is required`);
  if (principal && principal.principalType === 'advertiser' && !route.advertiserAccess) throw new ForbiddenError('not available to advertiser logins');
  const filters = principal ? scopeFilters(parseFilters(params, { today }), principal, store) : null;
  const key = cache && principal ? cache.keyFor({ route, principal, filters, params }) : null;
  if (key !== null) {
    const hit = cache.get(key);
    if (hit !== undefined) return { [SERIALISED]: hit };
  }
  const body = route.handler({ store, filters, params, principal, routes, today });
  if (key === null || (body && body[RAW])) return body;
  let json;
  try { json = JSON.stringify(body); } catch { return body; } // the caller reports what cannot be serialised
  cache.set(key, json);
  return { [SERIALISED]: json };
}

// A handler returns {[RAW]: {contentType, body}} to send something other than JSON (the CSV form of a dataset).
const RAW = Symbol('raw');
// A result that is already JSON text (see runRoute's cache).
const SERIALISED = Symbol('serialised');

module.exports = { runRoute, RAW, SERIALISED };
