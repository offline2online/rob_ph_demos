// Brief §6.2: full-width banner stating the saving and end date. Shared
// between Product Details and Pricing.
//
// getOfferState is exported so anything that needs to know whether an
// offer is live/scheduled/ended right now — the Pricing tab pre-filling
// Offer description is the reason this got pulled out — uses the exact
// same rule this banner does, rather than a second copy that could drift.
export function getOfferState(rrp, offerPrice, offerFrom, offerUntil) {
  const offerNum = parseFloat(offerPrice);
  const now = new Date();
  const from = offerFrom ? new Date(offerFrom) : null;
  const until = offerUntil ? new Date(offerUntil) : null;

  let state = 'none';
  if (offerNum > 0) {
    if (until && until < now) state = 'ended';
    else if (from && from > now) state = 'scheduled';
    else state = 'live';
  }
  return state;
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
  const live = enabled.find((o) => getOfferState(null, o.offerPrice, o.offerFrom, o.offerUntil) === 'live');
  if (live) return live;
  const scheduled = enabled
    .filter((o) => getOfferState(null, o.offerPrice, o.offerFrom, o.offerUntil) === 'scheduled')
    .sort((a, b) => new Date(a.offerFrom) - new Date(b.offerFrom));
  return scheduled[0] || null;
}

export default function OfferBanner({ rrp, offerPrice, offerFrom, offerUntil }) {
  const rrpNum = parseFloat(rrp);
  const offerNum = parseFloat(offerPrice);
  const from = offerFrom ? new Date(offerFrom) : null;
  const until = offerUntil ? new Date(offerUntil) : null;
  const state = getOfferState(rrp, offerPrice, offerFrom, offerUntil);

  const fmt = (d) => d && d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const styles = {
    live: { background: '#f6ffed', border: '1px solid #b7eb8f', color: '#237804' },
    scheduled: { background: '#fffbe6', border: '1px solid #ffe58f', color: '#874d00' },
    ended: { background: '#fff2f0', border: '1px solid #ffccc7', color: '#a8071a' },
    none: { background: '#fafafa', border: '1px solid #f0f0f0', color: 'rgba(0,0,0,.65)' },
  };

  let text = 'No offer price set.';
  if (state === 'live') {
    text = `Offer live — $${offerNum.toFixed(2)} instead of $${rrpNum.toFixed(2)}, saving $${(rrpNum - offerNum).toFixed(2)}` +
      (until ? ` until ${fmt(until)}.` : '.');
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
