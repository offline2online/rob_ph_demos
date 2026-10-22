-- No buyer is named on a slot (ticket QdMaGvVhMZgcdcmIAalT, 22 Oct 2026): 0082 removed the direct advertisers, this removes every advertiser still named in a slot's Assigned to, DSP advertisers included (Nestlé via Google DSP). A slot gets a buyer only through a deal. A slot left with no named advertiser becomes real time (rtb) again. A slot with a live booking (a won or reserved, non-test window starting in the last 60 days, a safe over-estimate of "not finished playing") keeps its advertisers and is locked against new sales instead, the existing sold-slot rule; the lock releases when its bookings have played and the sweep then removes the names (domain/slotLock.ts). Nothing is converted into a draft deal: a deal needs flight dates and a price the old assignment never held, so the removed names are kept only in the SSP change history (one agent entry per field, 'migration-0086'). The demo seed re-expresses Nestlé's hold as a Programmatic guaranteed deal.
CREATE TABLE _m0086_fix (dt_id TEXT NOT NULL, dt_name TEXT NOT NULL, idx INTEGER NOT NULL, old_adv TEXT NOT NULL, old_mode TEXT, live INTEGER NOT NULL, locked INTEGER NOT NULL);

INSERT INTO _m0086_fix (dt_id, dt_name, idx, old_adv, old_mode, live, locked)
SELECT dt.id, dt.name, CAST(s.key AS INTEGER), json_extract(s.value, '$.advertisers'), json_extract(s.value, '$.listMode'),
  EXISTS (SELECT 1 FROM reservations r WHERE r.position_id = dt.id || '.s' || (CAST(s.key AS INTEGER) + 1) AND r.status IN ('won', 'reserved') AND r.test_mode = 0 AND r.window_start > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 days')),
  COALESCE(json_extract(s.value, '$.salesLocked'), 0)
FROM display_types dt, json_each(dt.ph_extensions, '$.slots') s
WHERE json_array_length(s.value, '$.advertisers') > 0;

-- The change history. Every old_value/new_value is JSON text, because SspAuditRepo reads it back with JSON.parse: json_extract returns an array as JSON text already, but a string (listMode) needs json_quote.
INSERT INTO ssp_audit_log (id, at, change_id, actor_type, actor_id, actor_name, session_user_id, request, reason, object_type, object_id, object_label, change_type, field, old_value, new_value)
SELECT 'aud_' || lower(hex(randomblob(6))), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'chg_m0086' || lower(hex(randomblob(3))), 'agent', 'migration-0086', 'Migration 0086', 'migration-0086',
  'MIGRATION 0086_clear_named_slot_assignments', 'Buyers are assigned through a deal, not named on a slot.',
  'display_type', dt_id, dt_name, 'updated', 'slots[' || (idx + 1) || '].advertisers', old_adv, '[]'
FROM _m0086_fix WHERE NOT live;

INSERT INTO ssp_audit_log (id, at, change_id, actor_type, actor_id, actor_name, session_user_id, request, reason, object_type, object_id, object_label, change_type, field, old_value, new_value)
SELECT 'aud_' || lower(hex(randomblob(6))), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'chg_m0086' || lower(hex(randomblob(3))), 'agent', 'migration-0086', 'Migration 0086', 'migration-0086',
  'MIGRATION 0086_clear_named_slot_assignments', 'No named advertiser left: the slot is real time again.',
  'display_type', dt_id, dt_name, 'updated', 'slots[' || (idx + 1) || '].listMode', json_quote(old_mode), json_quote('rtb')
FROM _m0086_fix WHERE NOT live;

INSERT INTO ssp_audit_log (id, at, change_id, actor_type, actor_id, actor_name, session_user_id, request, reason, object_type, object_id, object_label, change_type, field, old_value, new_value)
SELECT 'aud_' || lower(hex(randomblob(6))), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'chg_m0086' || lower(hex(randomblob(3))), 'agent', 'migration-0086', 'Migration 0086', 'migration-0086',
  'MIGRATION 0086_clear_named_slot_assignments', 'The slot is sold: locked against new sales instead; the named advertisers are removed once its bookings have played.',
  'display_type', dt_id, dt_name, 'updated', 'slots[' || (idx + 1) || '].salesLocked', NULL, 'true'
FROM _m0086_fix WHERE live AND NOT locked;

-- The slots themselves, one rewrite of each affected display type's slot list.
UPDATE display_types SET ph_extensions = json_set(ph_extensions, '$.slots', (
  SELECT json_group_array(json(CASE
    WHEN f.idx IS NULL THEN s.value
    WHEN f.live THEN json_set(s.value, '$.salesLocked', json('true'))
    ELSE json_set(s.value, '$.advertisers', json('[]'), '$.listMode', 'rtb', '$.buyersListId', NULL, '$.buyersListIds', json('[]'), '$.openAuction', json('false'))
  END))
  FROM (SELECT key, value FROM json_each(display_types.ph_extensions, '$.slots') ORDER BY CAST(key AS INTEGER)) s
  LEFT JOIN _m0086_fix f ON f.dt_id = display_types.id AND f.idx = CAST(s.key AS INTEGER)
)), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (SELECT dt_id FROM _m0086_fix);

DROP TABLE _m0086_fix;
