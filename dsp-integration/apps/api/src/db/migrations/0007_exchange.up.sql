-- Exchange settings: the client as seller of record (one row). Seller type,
-- confidentiality, SupplyChain and OpenRTB options are platform defaults.
CREATE TABLE exchange (
  id            TEXT PRIMARY KEY,
  organisation  TEXT NOT NULL DEFAULT '',
  domain        TEXT NOT NULL DEFAULT '',
  seller_id     TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL
);
