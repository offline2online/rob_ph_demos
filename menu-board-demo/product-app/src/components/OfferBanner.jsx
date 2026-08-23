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
