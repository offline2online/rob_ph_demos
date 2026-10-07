-- Play-volume commitments live on the deal, not the open auction (Rob, 7 Oct 2026; open question 45): the number of plays a buyers list (deal) commits to over its delivery term. NULL = no volume commitment, the deal is per play like the open auction. Delivery is metered in plays from billing line items, not stored here.
ALTER TABLE buyers_lists ADD COLUMN committed_plays INTEGER;
