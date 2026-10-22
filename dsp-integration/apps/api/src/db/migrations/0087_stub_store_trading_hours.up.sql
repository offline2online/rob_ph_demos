-- Stub store trading hours on an existing database (ticket CLQO1IAZ0YupSnubLxAp, E2E 22 Oct 2026). seed/tradingHours.ts gives
-- them to stores as they are seeded, but a database that already exists (the hosted demo) is never re-seeded, so its stores
-- kept the 0-24 default and Operating hours = Store hours still played 24 hours. Same values and the same rule as
-- applyTradingHours: only a store still on the 24-hour default changes; one whose hours were set is left alone. On an empty
-- database (tests, a fresh demo) this matches nothing and the seed applies the hours instead.
UPDATE stores SET open_hour = 7, close_hour = 21 WHERE id = 'st_sydney_cbd' AND open_hour = 0 AND close_hour = 24;
UPDATE stores SET open_hour = 9, close_hour = 20 WHERE id = 'st_parramatta' AND open_hour = 0 AND close_hour = 24;
UPDATE stores SET open_hour = 9, close_hour = 21 WHERE id = 'st_chatswood' AND open_hour = 0 AND close_hour = 24;
UPDATE stores SET open_hour = 8, close_hour = 19 WHERE id = 'st_bondi_junction' AND open_hour = 0 AND close_hour = 24;
UPDATE stores SET open_hour = 8, close_hour = 20 WHERE id = 'st_melbourne_cbd' AND open_hour = 0 AND close_hour = 24;
UPDATE stores SET open_hour = 9, close_hour = 21 WHERE id = 'st_chadstone' AND open_hour = 0 AND close_hour = 24;
UPDATE stores SET open_hour = 7, close_hour = 19 WHERE id = 'st_brisbane_city' AND open_hour = 0 AND close_hour = 24;
UPDATE stores SET open_hour = 9, close_hour = 21 WHERE id = 'st_chermside' AND open_hour = 0 AND close_hour = 24;
UPDATE stores SET open_hour = 8, close_hour = 18 WHERE id = 'st_perth_cbd' AND open_hour = 0 AND close_hour = 24;
UPDATE stores SET open_hour = 9, close_hour = 17 WHERE id = 'st_adelaide_rundle' AND open_hour = 0 AND close_hour = 24;
UPDATE stores SET open_hour = 10, close_hour = 18 WHERE id = 'st_newcastle' AND open_hour = 0 AND close_hour = 24;
UPDATE stores SET open_hour = 9, close_hour = 17 WHERE id = 'st_canberra_centre' AND open_hour = 0 AND close_hour = 24;
UPDATE stores SET open_hour = 7, close_hour = 22 WHERE id = 'st_mock_central' AND open_hour = 0 AND close_hour = 24;
UPDATE stores SET open_hour = 9, close_hour = 19 WHERE id = 'st_mock_harbour' AND open_hour = 0 AND close_hour = 24;
UPDATE stores SET open_hour = 8, close_hour = 20 WHERE id = 'st_mock_riverside' AND open_hour = 0 AND close_hour = 24;
UPDATE stores SET open_hour = 10, close_hour = 21 WHERE id = 'st_mock_northgate' AND open_hour = 0 AND close_hour = 24;
