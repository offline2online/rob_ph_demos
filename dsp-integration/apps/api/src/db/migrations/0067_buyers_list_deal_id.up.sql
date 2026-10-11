-- Deal ID on the buyers list (ticket 5CCgGEYSkVoDTH9yNSYu, 10 Oct 2026): the platform mints a unique, immutable deal ID when a list is created — the identifier a DSP bids under (pmp.deals[].id) and the key a campaign's dealId points at. Existing lists are backfilled with PH-<list id>, exactly what the bid request carried until now, so live bids keep matching.
ALTER TABLE buyers_lists ADD COLUMN deal_id TEXT;
UPDATE buyers_lists SET deal_id = 'PH-' || id WHERE deal_id IS NULL;
CREATE UNIQUE INDEX buyers_lists_deal_id ON buyers_lists (deal_id);
-- Fixed once saved, like a DV360 deal. (The deal type is held fixed by the admin route, which mints a new list on a type change.)
CREATE TRIGGER buyers_lists_deal_id_immutable BEFORE UPDATE OF deal_id ON buyers_lists WHEN NEW.deal_id IS NOT OLD.deal_id
BEGIN
  SELECT RAISE(ABORT, 'A deal ID cannot be changed.');
END;
