'use strict';
// In-memory, date-indexed aggregate store. Rows are sorted by date once; a query binary-searches
// the date range and then applies the remaining page filters with Set lookups.

function lowerBound(rows, date) {
  let lo = 0; let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].date < date) lo = mid + 1; else hi = mid;
  }
  return lo;
}

const asSet = (list) => (list ? new Set(list) : null);

class AggregateStore {
  constructor({ delivery, inventory, campaigns = [], advertisers = {}, catalog = { displayTypes: {}, displays: [] } }) {
    this.catalog = catalog;
    this.campaigns = campaigns;
    this.advertisers = advertisers;
    this.delivery = [...delivery].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    this.inventory = [...inventory].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  static #scan(rows, f, fn, useAdvertiser) {
    const stores = asSet(f.storeIds);
    const types = asSet(f.displayTypeIds);
    const advs = useAdvertiser ? asSet(f.advertiserIds) : null;
    const end = lowerBound(rows, `${f.dateTo}￿`);
    for (let i = lowerBound(rows, f.dateFrom); i < end; i += 1) {
      const r = rows[i];
      if (stores && !stores.has(r.storeId)) continue;
      if (types && !types.has(r.displayTypeId)) continue;
      if (advs && !advs.has(r.advertiserId)) continue;
      fn(r);
    }
  }

  scanDelivery(filters, fn) { AggregateStore.#scan(this.delivery, filters, fn, true); }

  /**
   * Campaigns live in the date range (start/end overlap it) for the advertiser and display type
   * filters. A campaign with no display types targets all of them; stores are not a campaign property.
   */
  scanCampaigns(f, fn) {
    const advs = asSet(f.advertiserIds);
    const types = asSet(f.displayTypeIds);
    for (const c of this.campaigns) {
      if (c.start > f.dateTo || (c.end && c.end < f.dateFrom)) continue;
      if (advs && !advs.has(c.advertiserId)) continue;
      if (types && c.displayTypeIds && !c.displayTypeIds.some((t) => types.has(t))) continue;
      fn(c);
    }
  }

  /** Unsold inventory ignores the advertiser filter: slot records belong to no advertiser (README open question 1 default). */
  scanInventory(filters, fn) { AggregateStore.#scan(this.inventory, filters, fn, false); }
}

module.exports = { AggregateStore };
