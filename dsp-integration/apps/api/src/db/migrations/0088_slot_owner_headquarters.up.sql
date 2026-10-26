-- Slot owners are Headquarters and Advertiser only (Duy and Thuc, 26 Oct 2026): `internal` did not match the Headquarters label
-- it showed under, and `retail` collided with the DSP term "retailer" (which means Headquarters). Every `internal` slot becomes
-- `headquarters`. Stores is not a slot owner in this release (it will be added later as its own value), so a slot still saved
-- as `retail` becomes `headquarters` too and loses its store scope. Only display types holding one of the old values change.
UPDATE display_types SET ph_extensions = json_set(ph_extensions, '$.slots', (
  SELECT json_group_array(json(CASE
    WHEN json_extract(s.value, '$.owner') = 'internal' THEN json_set(s.value, '$.owner', 'headquarters')
    WHEN json_extract(s.value, '$.owner') = 'retail' THEN json_set(s.value, '$.owner', 'headquarters', '$.storeScope', NULL)
    ELSE s.value
  END))
  FROM (SELECT key, value FROM json_each(display_types.ph_extensions, '$.slots') ORDER BY CAST(key AS INTEGER)) s
)), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (SELECT 1 FROM json_each(display_types.ph_extensions, '$.slots') s WHERE json_extract(s.value, '$.owner') IN ('internal', 'retail'));
