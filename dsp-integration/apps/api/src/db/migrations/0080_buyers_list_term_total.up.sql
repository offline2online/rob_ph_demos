-- Programmatic guaranteed deals cover a whole delivery term (activeFrom to activeTo), priced as a fixed CPM (floor_cpm) or a total for the term (this column, USD). It replaces the per-day rate (rate_per_day, 20 Oct 2026), whose value is carried over as rate x days of the term where the term is closed. committed_plays stays as the stored figure derived from the assigned slots, the term and the guarantee buffer; it is no longer typed in.
ALTER TABLE buyers_lists ADD COLUMN term_total REAL;
UPDATE buyers_lists SET term_total = ROUND(rate_per_day * (CAST(julianday(substr(active_to, 1, 10)) - julianday(substr(active_from, 1, 10)) AS INTEGER) + 1), 2) WHERE rate_per_day IS NOT NULL AND active_from IS NOT NULL AND active_to IS NOT NULL;
-- The platform default for committed plays (0054) is retired: a guaranteed deal's committed plays are derived from its assigned slots, never defaulted or typed in.
ALTER TABLE company_advertiser_settings DROP COLUMN default_committed_plays;
