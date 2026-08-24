import { recurrenceOverallState, describeRecurrence } from '../lib/recurrence.js';

// Brief §6.2: full-width banner stating the saving and end date. Shared
// between Product Details and Pricing.
//
// getOfferState is exported so anything that needs to know whether an
// offer is live/scheduled/ended right now — the Pricing tab pre-filling
// Offer description is the reason this got pulled out — uses the exact
// same rule this banner does, rather than a second copy that could drift.
// `recurrence` is optional — omitting it (or passing `{freq:'none'}`)
// collapses to the original single-window behaviour exactly; when set,
// state comes from recurrenceOverallState (lib/recurrence.js), which adds
// a fifth possible value, 'recurring': the series has started and hasn't
// ended, but right now falls outside today's day-part window.
export function getOfferState(rrp, offerPrice, offerFrom, offerUntil, recurrence) {
  const offerNum = parseFloat(offerPrice);
  if (!(offerNum > 0)) return 'none';
  const now = new Date();

  if (recurrence && recurrence.freq !== 'none') {
    return recurrenceOverallState(offerFrom, offerUntil, recurrence, now);
  }
  const from = offerFrom ? new Date(offerFrom) : null;
  const until = offerUntil ? new Date(offerUntil) : null;
  if (until && until < now) return 'ended';
  if (from && from > now) return 'scheduled';
  return 'live';
}

// The grid, its price-column filters, and the Product Details banner all
// still read a single flat offerPrice/offerFrom/offerUntil/offerDescription
// off the product — none of them know about the offers[] array multi-offer
// support introduced on the Pricing tab. Rather than rewriting every one of
// those call sites to understand a list, PricingTab derives "the one offer
// that currently matters" at save time and writes it back into those same
// flat fields. Live beats scheduled (a customer standing at the till cares
// what price rings up right now); among several scheduled offers, the one
// starting soonest is shown next.
export function pickEffectiveOffer(offers) {
  if (!offers || offers.length === 0) return null;
  const enabled = offers.filter((o) => o.enabled !== false);
  const withState = enabled.map((o) => ({ o, state: getOfferState(null, o.offerPrice, o.offerFrom, o.offerUntil, o.recurrence) }));
  const live = withState.find((x) => x.state === 'live');
  if (live) return live.o;
  // A day-parted offer that's merely off right now (e.g. checked at 9pm
  // for a lunch window) is a better "what to show" answer than an offer
  // that hasn't started its series at all yet.
  const recurring = withState
    .filter((x) => x.state === 'recurring')
    .sort((a, b) => new Date(a.o.offerFrom) - new Date(b.o.offerFrom));
  if (recurring[0]) return recurring[0].o;
  const scheduled = withState
    .filter((x) => x.state === 'scheduled')
    .sort((a, b) => new Date(a.o.offerFrom) - new Date(b.o.offerFrom));
  return scheduled[0]?.o || null;
}

// Same precedence as pickEffectiveOffer(), but never considers a
// store-targeted offer — used for the flat legacy fields
// (offerPrice/offerFrom/offerUntil/offerDescription) that HQ Admin's
// grid and Product Details' banner read as if they applied everywhere.
// A targeted offer's price is only ever correct at the stores it
// targets, so it must never be written into a field every one of those
// aggregate/all-stores surfaces treats as universal — pickEffectiveOffer()
// above is still used where the admin UI itself needs to reason about a
// targeted offer specifically (e.g. which offer's note is currently
// overriding the default at its target stores).
export function pickDefaultOffer(offers) {
  return pickEffectiveOffer((offers || []).filter((o) => !o.targeting || !o.targeting.length));
}

export default function OfferBanner({ rrp, offerPrice, offerFrom, offerUntil, recurrence, currency = '$' }) {
  const rrpNum = parseFloat(rrp);
  const offerNum = parseFloat(offerPrice);
  const from = offerFrom ? new Date(offerFrom) : null;
  const until = offerUntil ? new Date(offerUntil) : null;
  const state = getOfferState(rrp, offerPrice, offerFrom, offerUntil, recurrence);

  const fmt = (d) => d && d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const fmtTime = (d) => d && d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const styles = {
    live: { background: '#f6ffed', border: '1px solid #b7eb8f', color: '#237804' },
    recurring: { background: '#e6f7ff', border: '1px solid #91caff', color: '#0958a5' },
    scheduled: { background: '#fffbe6', border: '1px solid #ffe58f', color: '#874d00' },
    ended: { background: '#fff2f0', border: '1px solid #ffccc7', color: '#a8071a' },
    none: { background: '#fafafa', border: '1px solid #f0f0f0', color: 'rgba(0,0,0,.65)' },
  };

  let text = 'No offer price set.';
  if (state === 'live') {
    text = `Offer live — ${currency}${offerNum.toFixed(2)} instead of ${currency}${rrpNum.toFixed(2)}, saving ${currency}${(rrpNum - offerNum).toFixed(2)}` +
      (until ? ` until ${fmt(until)}.` : '.');
  } else if (state === 'recurring') {
    text = `Recurring offer — off right now, ${currency}${offerNum.toFixed(2)} instead of ${currency}${rrpNum.toFixed(2)} during its next window: ` +
      `${describeRecurrence(recurrence, offerFrom)}, ${fmtTime(from)}–${until ? fmtTime(until) : 'end of day'}.`;
  } else if (state === 'scheduled') {
    text = `Offer scheduled from ${fmt(from)}${until ? ` until ${fmt(until)}` : ''}.`;
  } else if (state === 'ended') {
    text = `Offer ended ${fmt(until)}.`;
  }

  return (
    <div style={{ borderRadius: 6, padding: '10px 12px', fontSize: 13, marginBottom: 4, lineHeight: 1.6, ...styles[state] }}>
      {text}
    </div>
  );
}
