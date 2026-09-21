-- POC stand-in for the platform's store records (Rob, Q10): stores are
-- managed by the primary Personalisation Hub platform, like display types.
-- This build only reads them through StoreSource: unique store IDs, names
-- and regions, for store counts, the inventory's store and region filters,
-- and the display type delete check. Existing displays are linked to a store
-- record made from their store name.
CREATE TABLE stores (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  region TEXT
);
INSERT INTO stores (id, name, region)
  SELECT DISTINCT 'st_' || lower(replace(store, ' ', '_')), store, NULL FROM displays;
ALTER TABLE displays ADD COLUMN store_id TEXT;
UPDATE displays SET store_id = 'st_' || lower(replace(store, ' ', '_'));
