'use strict';

// Standard orderings (REQUIREMENTS.md section 3.2).
const DEAL_TYPES = ['Programmatic guaranteed', 'Preferred deal', 'Private auction', 'Open auction'];
// The old label's casing, accepted on input for one release only; every response uses DEAL_TYPES.
const LEGACY_DEAL_TYPES = { 'Programmatic Guaranteed': 'Programmatic guaranteed' };
const normaliseDealType = (t) => LEGACY_DEAL_TYPES[t] || t;
const DSPS = ['DV360', 'The Trade Desk', 'Amazon DSP'];
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

// Operating-hours windows are whole hours [open, close).
const ALWAYS_OPEN = Object.freeze({ open: 0, close: 24 });

module.exports = { DEAL_TYPES, normaliseDealType, DSPS, ZONES, MATURITY_LEVELS, ALWAYS_OPEN, LOCALISATION_VARIABLES, PERSONALISATION_VARIABLES };
