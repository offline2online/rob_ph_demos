'use strict';
const { allowedDisplayTypeIds } = require('../scope');

// Options for the page's Display type filter. A retailer sees every display type; an advertiser sees only
// those in its deals' slot assignments plus those its campaigns target.
module.exports = {
  path: '/filter-options',
  advertiserAccess: true,
  handler({ store, principal }) {
    const types = store.catalog.displayTypes || {};
    const ids = principal.principalType === 'advertiser' ? allowedDisplayTypeIds(store, principal.principalId) : Object.keys(types);
    return { displayTypes: ids.map((id) => ({ id, name: types[id].name })).sort((a, b) => String(a.name).localeCompare(String(b.name))) };
  },
};
