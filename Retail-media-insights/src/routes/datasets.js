'use strict';
const { availableDatasets } = require('../datasets');

// QuickSight catalog: the datasets the caller may read. An advertiser sees only the advertiser view ones.
module.exports = {
  path: '/datasets',
  advertiserAccess: true,
  handler({ routes, principal }) {
    return {
      datasets: availableDatasets(principal, routes).map((d) => ({ name: d.name, description: d.description, grain: d.grain, path: `/dataset?name=${d.name}` })),
    };
  },
};
