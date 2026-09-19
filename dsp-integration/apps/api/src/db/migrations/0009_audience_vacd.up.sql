-- POC stand-in for audience scoring (spec §4: MOVE / VAC-d, spec only):
-- seeded assumed views per play window for each display type slot, read
-- through AudienceSource. `counted` = sensor-derived (Vision/AI or MIST),
-- otherwise estimated. No scoring framework or UI.
CREATE TABLE audience_vacd (
  display_type_id          TEXT NOT NULL,
  slot                     INTEGER NOT NULL,
  assumed_views_per_window INTEGER NOT NULL,
  counted                  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (display_type_id, slot)
);
