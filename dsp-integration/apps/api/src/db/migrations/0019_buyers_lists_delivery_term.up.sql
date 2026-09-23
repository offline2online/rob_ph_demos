-- Private auctions: the two-period model (spec "Private auctions (buyers
-- lists)" — auction window vs delivery term) and the locked rate that
-- follows from it (spec "dynamic VAC-d billing over the delivery term").
--
-- auction_closes: the deal's own one-time bidding deadline — the auction
-- window. A deal with no auction_closes behaves exactly as before this
-- migration: a real auction, cleared fresh every play window, for as long
-- as active_from/active_to (the delivery term) covers it.
--
-- locked_win: null until a deal with auction_closes set has its first
-- clearing bid; from then on it holds the winning identity and CPM
-- (JSON: {cpm, partnerId, advertiserId, campaignId, pricingType, channel,
-- lockedAt}) that every later play window in the delivery term is booked
-- at directly, without a fresh auction (exchange/auction.ts). Set once,
-- never overwritten — see BuyersListRepo.lockWin.
ALTER TABLE buyers_lists ADD COLUMN auction_closes TEXT;
ALTER TABLE buyers_lists ADD COLUMN locked_win TEXT;
