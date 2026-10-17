'use strict';
// The front-end tests run on what the real route handlers return (LocalApi), never on invented fixtures.
const LocalApi = require('../local-api.js');
const ADMIN = { principalType: 'admin', principalId: 'hq', scopes: ['insights:read'] };
const ADVERTISER = { principalType: 'advertiser', principalId: 'adv-blackmores', scopes: ['insights:read'] };
const RANGE = { dateFrom: '2026-09-12', dateTo: '2026-10-11' };
const get = (path, params, principal) => LocalApi.get(path, Object.assign({}, RANGE, params), principal || ADMIN);
module.exports = { get, ADMIN, ADVERTISER, RANGE };
