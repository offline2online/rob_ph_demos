/* Real-time bid lookahead (Rob, 7 Oct 2026): a real-time slot's auction opens
   `bidLookaheadSeconds` (Advertiser settings, company-wide, default 35 as
   Broadsign Reach) before the slot plays, so the winner has time to be
   downloaded and rendered. It is per slot, off the slot's own start time,
   never a scheduled clock. */
export const DEFAULT_BID_LOOKAHEAD_SECONDS = 35

export const bidLookaheadOk = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1

/* When the auction for a slot that plays at `slotStart` opens. */
export const rtbAuctionOpensAt = (company: { bidLookaheadSeconds: number }, slotStart: Date) => new Date(slotStart.getTime() - company.bidLookaheadSeconds * 1000)
