-- Puts back the 24-hour default on stores that still hold exactly the hours 0087 gave them.
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_sydney_cbd' AND open_hour = 7 AND close_hour = 21;
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_parramatta' AND open_hour = 9 AND close_hour = 20;
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_chatswood' AND open_hour = 9 AND close_hour = 21;
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_bondi_junction' AND open_hour = 8 AND close_hour = 19;
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_melbourne_cbd' AND open_hour = 8 AND close_hour = 20;
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_chadstone' AND open_hour = 9 AND close_hour = 21;
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_brisbane_city' AND open_hour = 7 AND close_hour = 19;
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_chermside' AND open_hour = 9 AND close_hour = 21;
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_perth_cbd' AND open_hour = 8 AND close_hour = 18;
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_adelaide_rundle' AND open_hour = 9 AND close_hour = 17;
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_newcastle' AND open_hour = 10 AND close_hour = 18;
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_canberra_centre' AND open_hour = 9 AND close_hour = 17;
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_mock_central' AND open_hour = 7 AND close_hour = 22;
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_mock_harbour' AND open_hour = 9 AND close_hour = 19;
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_mock_riverside' AND open_hour = 8 AND close_hour = 20;
UPDATE stores SET open_hour = 0, close_hour = 24 WHERE id = 'st_mock_northgate' AND open_hour = 10 AND close_hour = 21;
