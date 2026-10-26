'use strict';

// Standard orderings (REQUIREMENTS.md section 3.2).
// 'Direct advertiser' (an owned slot sold by the retailer through PH, no DSP, no bidding) ranks first: it takes its slots before any deal.
const DIRECT_DEAL_TYPE = 'Direct advertiser';
const DEAL_TYPES = [DIRECT_DEAL_TYPE, 'Programmatic guaranteed', 'Preferred deal', 'Private auction', 'Open auction'];
// The old label's casing, accepted on input for one release only; every response uses DEAL_TYPES.
const LEGACY_DEAL_TYPES = { 'Programmatic Guaranteed': 'Programmatic guaranteed' };
const normaliseDealType = (t) => LEGACY_DEAL_TYPES[t] || t;
const DSPS = ['DV360', 'The Trade Desk', 'Amazon DSP'];
// Where a billing line came from: a connected DSP, or 'Direct' (the retailer's own direct advertisers, no DSP seat). The DSP columns,
// filters and breakdowns list every source, in this order, with Direct after the DSPs.
const DIRECT = 'Direct';
const SOURCES = [...DSPS, DIRECT];
// How each DSP is named on DSP Integration's Deals & buyers lists (README "Deals are named, not coded").
const DSP_LABELS = { DV360: 'Google DSP (DV360)', 'The Trade Desk': 'The Trade Desk', 'Amazon DSP': 'Amazon Ads DSP', [DIRECT]: 'Direct (no DSP)' };
// The five IAB / IAB Europe In-Store Retail Media Standards zones, in shopper-journey order.
const ZONES = ['Exterior', 'Entrance & out of category', 'In aisles', 'Checkout', 'Other & connected store'];
const MATURITY_LEVELS = ['Default only', 'Localised', 'Personalised'];

// DSP Integration's Shared Targeting Variables (default set, exact labels), by group. Daypart is
// scheduling, never a variable, so it is deliberately absent. Personalisation variables carry the
// sub-type shown as detail only (never a level): Computer Vision, Aggregate or Identified visitor.
const LOCALISATION_VARIABLES = [
  'Store Open / Closed', 'Fixed Store Segments', 'Variable Store Segments', 'Display Tag(s)',
  'Suburb', 'Postcode', 'State', 'Country',
];
const PERSONALISATION_VARIABLES = {
  'Gender (Computer Vision)': 'Computer Vision',
  'Estimated Age (Computer Vision)': 'Computer Vision',
  'Reason for Visit (Aggregate)': 'Aggregate',
  'Device Type (Aggregate)': 'Aggregate',
  'Purchase Intent': 'Identified visitor',
  'Purchase History': 'Identified visitor',
  SKUs: 'Identified visitor',
  Events: 'Identified visitor',
  Age: 'Identified visitor',
  Gender: 'Identified visitor',
  'Visitor Segments': 'Identified visitor',
  'Reason for Visit': 'Identified visitor',
  'Device Type': 'Identified visitor',
  'Product Holdings': 'Identified visitor',
  'Product Type': 'Identified visitor',
  'Plan Type': 'Identified visitor',
  'Plan Value': 'Identified visitor',
};

// Advertiser view (ticket ekKWkuP6z9scE5UfjeE8, README open question 4, decided 17 Oct 2026): the Winning CPM
// row (average and highest across winning buyers) is shown on a private or open auction day block only when
// at least this many OTHER buyers won plays on it that day; otherwise the row is omitted.
const MIN_OTHER_BUYERS_FOR_WINNING_CPM = 2;

// Operating-hours windows are whole hours [open, close).
const ALWAYS_OPEN = Object.freeze({ open: 0, close: 24 });
// No opening hours on record for an in-store type: nothing is inventory (fail closed, never ALWAYS_OPEN).
const NEVER_OPEN = Object.freeze({ open: 0, close: 0 });
// The scope every non-public route needs (DSP Integration section 9.5).
const READ_SCOPE = 'insights:read';

module.exports = { DEAL_TYPES, DIRECT_DEAL_TYPE, normaliseDealType, DSPS, DIRECT, SOURCES, DSP_LABELS, ZONES, MATURITY_LEVELS, ALWAYS_OPEN, NEVER_OPEN, READ_SCOPE, MIN_OTHER_BUYERS_FOR_WINNING_CPM, LOCALISATION_VARIABLES, PERSONALISATION_VARIABLES };
