-- Hour-of-week VAC-d profile per display (ticket L0lA4mMgRdA7YTcQpGxg, 16 Oct
-- 2026): a JSON array of 168 assumed views per hour, Monday 00:00 UTC first.
-- NULL means the display follows its display type's defaultVacd, spread flat
-- over the week, so a display nobody tuned scores exactly as it did before.
ALTER TABLE displays ADD COLUMN vacd_profile TEXT;
