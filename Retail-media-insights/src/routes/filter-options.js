'use strict';
const { allowedDisplayTypeIds } = require('../scope');

// Options for the page filters. A retailer sees every store, display type and advertiser; an advertiser sees the stores, only
// those display types in its deals' slot assignments plus those its campaigns target, and just itself as the advertiser
// (fixed server-side). `lastDataDay` is the last played day (never a reservation date), which "Last n days" ends on; `firstDataDay` is the first.
module.exports = {
  path: '/filter-options',
  advertiserAccess: true,
  handler({ store, principal }) {
    const types = store.catalog.displayTypes || {};
    const isAdvertiser = principal.principalType === 'advertiser';
    const ids = isAdvertiser ? allowedDisplayTypeIds(store, principal.principalId) : Object.keys(types);
    const byName = (a, b) => String(a.name).localeCompare(String(b.name));
    const out = {
      firstDataDay: store.firstPlayedDay,
      lastDataDay: store.lastPlayedDay,
      displayTypes: ids.map((id) => ({ id, name: types[id].name })).sort(byName),
    };
    const stores = store.catalog.stores || {};
    out.stores = Object.keys(stores).map((id) => ({ id, name: stores[id].name || id })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'en', { numeric: true }));
    if (isAdvertiser) {
      const me = (store.advertisers || {})[principal.principalId] || {};
      out.advertiser = { id: principal.principalId, name: me.name || principal.principalId, dsp: me.dsp || null }; // its own, for the locked chip
      return out;
    }
    out.advertisers = Object.entries(store.advertisers || {}).map(([id, a]) => ({ id, name: a.name, dsp: a.dsp || null })).sort(byName);
    return out;
  },
};
