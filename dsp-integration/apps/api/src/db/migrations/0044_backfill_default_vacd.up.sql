-- Back-fill the default VAC-d for display types created before the field
-- existed (ticket qfpWmGnALUCzHgIpdUwl, 4 Oct 2026). The default is
-- `phExtensions.defaultVacd` on the TYPE and is pre-filled with 300
-- (DEFAULT_VACD_BASELINE, admin model.ts) only on a new type; older types read
-- "None — unscored", so every advertiser slot on them was left out of
-- inventory, forecast and the auction.
--
-- Zones carry no VAC-d of their own: a slot's score is resolved from its
-- display type (audienceOf / defaultVacdOf), so setting the type's default
-- scores every advertiser slot on every zone of a multi-zone type too.
--
-- Only Digital Signage and Kiosk types are touched (Website / Mobile App are
-- HQ-only, no advertiser slots). A type that already has a default of its own
-- is left as is, and so are audience_vacd and displays.vacd_override, so
-- precedence is unchanged. Re-running changes nothing: once set, the type no
-- longer matches.
UPDATE display_types
   SET ph_extensions = json_set(COALESCE(ph_extensions, '{"slots":[]}'), '$.defaultVacd', 300, '$.defaultVacdSource', 'manual')
 WHERE touch_point IN ('Digital Signage', 'Kiosk')
   AND json_type(COALESCE(ph_extensions, '{}'), '$.defaultVacd') IS NOT 'integer'
   AND json_type(COALESCE(ph_extensions, '{}'), '$.defaultVacd') IS NOT 'real';
