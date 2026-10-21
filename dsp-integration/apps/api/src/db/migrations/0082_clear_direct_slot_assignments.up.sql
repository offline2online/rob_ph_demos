-- Direct advertisers leave slots (ticket mpbRDjAPS4uIagi2IVsz, 22 Oct 2026): a direct advertiser gets a slot only through a Direct advertiser deal (0081), never by being named in the slot's Assigned to. This removes every direct advertiser still named on a slot (a name in direct_advertisers that no DSP seat carries, the same test validateAssigned applies). A slot left with no named advertiser becomes real time (rtb) again. A slot with a live booking (a won or reserved, non-test window starting in the last 60 days, a safe over-estimate of "not finished playing") keeps its advertiser and is locked against new sales instead, the existing sold-slot rule; the lock releases when its bookings have played and the sweep then removes the direct advertiser (domain/slotLock.ts). Nothing is converted into a draft deal: a deal needs flight dates and a price the old assignment never held, so the removed names are kept only in the SSP change history (one agent entry per field, 'migration-0082').
CREATE TABLE _m0082_fix (dt_id TEXT NOT NULL, dt_name TEXT NOT NULL, idx INTEGER NOT NULL, old_adv TEXT NOT NULL, kept_adv TEXT NOT NULL, old_mode TEXT, live INTEGER NOT NULL);

INSERT INTO _m0082_fix (dt_id, dt_name, idx, old_adv, kept_adv, old_mode, live)
SELECT dt.id, dt.name, CAST(s.key AS INTEGER), json_extract(s.value, '$.advertisers'),
  (SELECT json_group_array(a.value) FROM json_each(s.value, '$.advertisers') a
    WHERE NOT (a.value IN (SELECT d.name FROM direct_advertisers d WHERE NOT EXISTS (SELECT 1 FROM partners p, json_each(p.seats) st WHERE json_extract(st.value, '$.name') = d.name)))),
  json_extract(s.value, '$.listMode'),
  EXISTS (SELECT 1 FROM reservations r WHERE r.position_id = dt.id || '.s' || (CAST(s.key AS INTEGER) + 1) AND r.status IN ('won', 'reserved') AND r.test_mode = 0 AND r.window_start > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 days'))
FROM display_types dt, json_each(dt.ph_extensions, '$.slots') s
WHERE EXISTS (SELECT 1 FROM json_each(s.value, '$.advertisers') a
  WHERE a.value IN (SELECT d.name FROM direct_advertisers d WHERE NOT EXISTS (SELECT 1 FROM partners p, json_each(p.seats) st WHERE json_extract(st.value, '$.name') = d.name)));

-- The change history: advertisers (and, where the slot goes back to real time, its list mode; where it is locked, the lock).
INSERT INTO ssp_audit_log (id, at, change_id, actor_type, actor_id, actor_name, session_user_id, request, reason, object_type, object_id, object_label, change_type, field, old_value, new_value)
SELECT 'aud_' || lower(hex(randomblob(6))), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'chg_m0082' || lower(hex(randomblob(3))), 'agent', 'migration-0082', 'Migration 0082', 'migration-0082',
  'MIGRATION 0082_clear_direct_slot_assignments', 'Direct advertisers are assigned through a Direct advertiser deal, not named on a slot.',
  'display_type', dt_id, dt_name, 'updated', 'slots[' || (idx + 1) || '].advertisers', old_adv, CASE WHEN live THEN old_adv ELSE kept_adv END
FROM _m0082_fix WHERE NOT live;

INSERT INTO ssp_audit_log (id, at, change_id, actor_type, actor_id, actor_name, session_user_id, request, reason, object_type, object_id, object_label, change_type, field, old_value, new_value)
SELECT 'aud_' || lower(hex(randomblob(6))), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'chg_m0082' || lower(hex(randomblob(3))), 'agent', 'migration-0082', 'Migration 0082', 'migration-0082',
  'MIGRATION 0082_clear_direct_slot_assignments', 'No named advertiser left: the slot is real time again.',
  'display_type', dt_id, dt_name, 'updated', 'slots[' || (idx + 1) || '].listMode', old_mode, 'rtb'
FROM _m0082_fix WHERE NOT live AND kept_adv = '[]';

INSERT INTO ssp_audit_log (id, at, change_id, actor_type, actor_id, actor_name, session_user_id, request, reason, object_type, object_id, object_label, change_type, field, old_value, new_value)
SELECT 'aud_' || lower(hex(randomblob(6))), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'chg_m0082' || lower(hex(randomblob(3))), 'agent', 'migration-0082', 'Migration 0082', 'migration-0082',
  'MIGRATION 0082_clear_direct_slot_assignments', 'The slot is sold: locked against new sales instead; the direct advertiser is removed once its bookings have played.',
  'display_type', dt_id, dt_name, 'updated', 'slots[' || (idx + 1) || '].salesLocked', NULL, 'true'
FROM _m0082_fix WHERE live;

-- The slots themselves, one rewrite of each affected display type's slot list.
UPDATE display_types SET ph_extensions = json_set(ph_extensions, '$.slots', (
  SELECT json_group_array(json(CASE
    WHEN f.idx IS NULL THEN s.value
    WHEN f.live THEN json_set(s.value, '$.salesLocked', json('true'))
    WHEN f.kept_adv = '[]' THEN json_set(s.value, '$.advertisers', json('[]'), '$.listMode', 'rtb', '$.buyersListId', NULL, '$.buyersListIds', json('[]'), '$.openAuction', json('false'))
    ELSE json_set(s.value, '$.advertisers', json(f.kept_adv))
  END))
  FROM (SELECT key, value FROM json_each(display_types.ph_extensions, '$.slots') ORDER BY CAST(key AS INTEGER)) s
  LEFT JOIN _m0082_fix f ON f.dt_id = display_types.id AND f.idx = CAST(s.key AS INTEGER)
)), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (SELECT dt_id FROM _m0082_fix);

DROP TABLE _m0082_fix;
