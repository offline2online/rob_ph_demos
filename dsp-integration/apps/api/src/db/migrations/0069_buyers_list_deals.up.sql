-- One deal ID per invited DSP (ticket fgBVnNItNcu7qMBUtqH7, 10 Oct 2026): a buyers list stays one object, but DV360 and The Trade Desk each accept their own deal, so the list resolves to a { partnerId, dealId } set. A DSP's first named seat mints its deal; removing its last seat sets retired_at and the row (and ID) is kept, never reused, so a campaign or bid still quoting it resolves. Re-inviting the DSP revives the same ID.
CREATE TABLE buyers_list_deals (
  deal_id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retired_at TEXT,
  UNIQUE (list_id, partner_id)
);
CREATE INDEX buyers_list_deals_list ON buyers_list_deals (list_id);
-- Backfill: the list's existing deal ID (what live bids already quote) goes to its first named DSP; any further DSP gets its own.
INSERT INTO buyers_list_deals (deal_id, list_id, partner_id, created_at)
SELECT CASE WHEN p.partner_id = (SELECT MIN(json_extract(b2.value, '$.partnerId')) FROM json_each(l.invited_buyers) AS b2) THEN l.deal_id ELSE 'PH-' || upper(hex(randomblob(5))) END, l.id, p.partner_id, l.created_at
FROM buyers_lists l
JOIN (SELECT l2.id AS list_id, json_extract(b.value, '$.partnerId') AS partner_id FROM buyers_lists l2, json_each(l2.invited_buyers) AS b GROUP BY l2.id, json_extract(b.value, '$.partnerId')) p ON p.list_id = l.id
WHERE p.partner_id IS NOT NULL;
CREATE TRIGGER buyers_list_deals_immutable BEFORE UPDATE OF deal_id, list_id, partner_id ON buyers_list_deals
BEGIN
  SELECT RAISE(ABORT, 'A deal ID cannot be changed.');
END;
