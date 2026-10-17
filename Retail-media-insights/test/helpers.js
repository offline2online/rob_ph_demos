'use strict';
// Test principals: a stub authenticate(req) per principal type.
const admin = () => ({ principalType: 'admin', principalId: 'retailer', scopes: ['insights:read'] });
const advertiser = (id) => () => ({ principalType: 'advertiser', principalId: id, scopes: ['insights:read'] });
// Routes with advertiserAccess switched on, to exercise a route's own scoping before the ticket that opens it.
const optIn = (...names) => names.map((n) => ({ ...require(`../src/routes/${n}`), advertiserAccess: true }));
module.exports = { admin, advertiser, optIn };
