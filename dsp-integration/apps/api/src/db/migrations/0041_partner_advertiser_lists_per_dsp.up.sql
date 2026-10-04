-- Advertiser whitelists and blacklists are managed per DSP, from that DSP's
-- own synced seats (ticket 7ZrBqNdkV9UXbRa8o2fo, Rob 4 Oct 2026). A seat or
-- advertiser ID only means something to the DSP that issued it, so the
-- company-wide lists are removed and each partner's allow_list / block_list
-- now holds seat IDs from partners.seats.
--
-- Existing data is carried over, not dropped: a DSP that adopted the company
-- lists (lists_linked = 1) takes them as its own, and every entry that was a
-- seat NAME becomes that seat's ID. An entry that matches no synced seat
-- can't be resolved to an identifier the DSP bids under, so it is dropped.
-- Category lists and lists_linked are untouched (a separate ticket).
UPDATE partners SET
  allow_list = COALESCE((
    SELECT json_group_array(sid) FROM (
      SELECT DISTINCT json_extract(s.value, '$.id') AS sid
      FROM json_each(CASE WHEN partners.lists_linked = 1
        THEN COALESCE((SELECT advertiser_whitelist FROM company_advertiser_settings LIMIT 1), '[]')
        ELSE partners.allow_list END) AS a
      JOIN json_each(partners.seats) AS s
        ON lower(trim(json_extract(s.value, '$.id'))) = lower(trim(a.value))
        OR lower(trim(json_extract(s.value, '$.name'))) = lower(trim(a.value))
    )), '[]'),
  block_list = COALESCE((
    SELECT json_group_array(sid) FROM (
      SELECT DISTINCT json_extract(s.value, '$.id') AS sid
      FROM json_each(CASE WHEN partners.lists_linked = 1
        THEN COALESCE((SELECT advertiser_blacklist FROM company_advertiser_settings LIMIT 1), '[]')
        ELSE partners.block_list END) AS a
      JOIN json_each(partners.seats) AS s
        ON lower(trim(json_extract(s.value, '$.id'))) = lower(trim(a.value))
        OR lower(trim(json_extract(s.value, '$.name'))) = lower(trim(a.value))
    )), '[]');

ALTER TABLE company_advertiser_settings DROP COLUMN advertiser_whitelist;
ALTER TABLE company_advertiser_settings DROP COLUMN advertiser_blacklist;
