-- Puts back `internal` on every `headquarters` slot. A slot that was `retail` before 0088 also comes back as `internal`: which
-- slots were Stores (and their store scope) is not kept.
UPDATE display_types SET ph_extensions = json_set(ph_extensions, '$.slots', (
  SELECT json_group_array(json(CASE
    WHEN json_extract(s.value, '$.owner') = 'headquarters' THEN json_set(s.value, '$.owner', 'internal')
    ELSE s.value
  END))
  FROM (SELECT key, value FROM json_each(display_types.ph_extensions, '$.slots') ORDER BY CAST(key AS INTEGER)) s
)), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (SELECT 1 FROM json_each(display_types.ph_extensions, '$.slots') s WHERE json_extract(s.value, '$.owner') = 'headquarters');
