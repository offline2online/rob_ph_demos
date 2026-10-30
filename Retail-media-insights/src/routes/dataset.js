'use strict';
const { FilterError } = require('../filters');
const { buildDataset, toCsv } = require('../datasets');
const catalog = require('./datasets');
const { RAW } = require('../query');

// One Amazon Quick dataset: `name=` picks it (omit it for the catalog), `format=json|csv` (default json), and every parameter of the
// underlying endpoint (page filters, granularity, ...) is passed through. It answers with exactly what the
// endpoint answers for the same caller: an advertiser is pinned to itself and a retailer-only dataset is 403.
module.exports = {
  path: '/dataset',
  advertiserAccess: true,
  handler({ store, routes, params, principal, today }) {
    const format = params.get('format') || 'json';
    if (!['json', 'csv'].includes(format)) throw new FilterError('format must be json or csv');
    if (!params.get('name')) return catalog.handler({ routes, principal }); // no name: the list of datasets
    const ds = buildDataset(params.get('name') || '', { routes, store, principal, params, today });
    return format === 'csv' ? { [RAW]: { contentType: 'text/csv; charset=utf-8', body: toCsv(ds), filename: `${ds.name}.csv` } } : ds;
  },
};
