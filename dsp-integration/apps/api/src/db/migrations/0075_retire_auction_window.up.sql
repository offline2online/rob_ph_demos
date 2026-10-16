-- Private auctions aligned to the industry standard (Rob, 16 Oct 2026): the
-- two-period model (a one-time auction_closes deadline, then a rate locked to
-- its winner) is retired. Invited buyers bid per slot throughout the flight,
-- first price, against the deal's CPM floor. A deal that never locked simply
-- clears every window from now on, so its deadline is cleared. A deal that
-- already locked keeps auction_closes and locked_win: it honours its terms
-- until its flight ends. Nothing writes a new lock.
UPDATE buyers_lists SET auction_closes = NULL WHERE locked_win IS NULL AND auction_closes IS NOT NULL;
