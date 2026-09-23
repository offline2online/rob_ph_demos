-- Buyers lists (spec "Support private auctions"): a reusable private-auction
-- deal object — an invited-buyer list plus an active time window — created
-- once and attached to any number of slots (assignedTo.buyersListId). Floor
-- and the auction resolution rule are never stored here: floor is inherited
-- from the slot, and first- vs second-price is a platform-wide setting.
CREATE TABLE buyers_lists (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  invited_buyers TEXT NOT NULL DEFAULT '[]',
  active_from    TEXT,
  active_to      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
