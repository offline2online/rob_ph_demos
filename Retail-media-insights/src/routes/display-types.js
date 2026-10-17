'use strict';
const { displayTypeFacts, hoverCard } = require('../display-types');

// Hover card data shared by every chart: one card per display type, in shopper-journey order.
module.exports = {
  path: '/display-types',
  advertiserAccess: true, // filters are pinned to the advertiser's own display types by scopeFilters
  handler({ store, filters }) {
    return { rows: displayTypeFacts(store, filters).map(hoverCard) };
  },
};
