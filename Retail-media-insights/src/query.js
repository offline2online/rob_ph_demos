'use strict';
// The one place a request becomes an answer: HTTP routes, QuickSight datasets and MCP tools all go through
// runRoute, so they share the same role check, the same server-side advertiser scoping and the same filters.

const { parseFilters, scopeFilters, ForbiddenError } = require('./filters');
const { READ_SCOPE } = require('./constants');

function runRoute(route, { store, principal, params, today, routes }) {
  // An authenticated caller lacking the scope is 403 (DSP Integration section 9.5).
  if (principal && !(principal.scopes || []).includes(READ_SCOPE)) throw new ForbiddenError(`the ${READ_SCOPE} scope is required`);
  if (principal && principal.principalType === 'advertiser' && !route.advertiserAccess) throw new ForbiddenError('not available to advertiser logins');
  const filters = principal ? scopeFilters(parseFilters(params, { today }), principal, store) : null;
  return route.handler({ store, filters, params, principal, routes, today });
}

// A handler returns {[RAW]: {contentType, body}} to send something other than JSON (the CSV form of a dataset).
const RAW = Symbol('raw');

module.exports = { runRoute, RAW };
