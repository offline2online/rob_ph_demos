'use strict';
// The principal types a caller can be. Kept apart from auth.js (token signing, Node crypto) so the browser bundle can use it.
module.exports = { PRINCIPAL_TYPES: ['admin', 'advertiser'] };
