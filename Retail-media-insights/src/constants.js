'use strict';

// Standard orderings (REQUIREMENTS.md section 3.2).
const DEAL_TYPES = ['Programmatic Guaranteed', 'Preferred deal', 'Private auction', 'Open auction'];
const DSPS = ['DV360', 'The Trade Desk', 'Amazon DSP'];
// The five IAB / IAB Europe In-Store Retail Media Standards zones, in shopper-journey order.
const ZONES = ['Exterior', 'Entrance & out of category', 'In aisles', 'Checkout', 'Other & connected store'];
const MATURITY_LEVELS = ['Default only', 'Localised', 'Personalised'];

// Operating-hours windows are whole hours [open, close).
const ALWAYS_OPEN = Object.freeze({ open: 0, close: 24 });

module.exports = { DEAL_TYPES, DSPS, ZONES, MATURITY_LEVELS, ALWAYS_OPEN };
