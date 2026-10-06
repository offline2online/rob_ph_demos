/* The exchange transacts in one currency, whatever the instance's own.
   The supported DSPs bid in USD only, so rather
   than convert, bid floors, reserve prices and bids are all expressed and
   compared in USD. `company.currency` stays the display/reporting currency
   and is not read anywhere in the bid path. */
export const TRANSACTING_CURRENCY = 'USD'
