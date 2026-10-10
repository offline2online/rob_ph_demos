-- Direct advertisers (ticket weNwveB1YwGs7OP3JsiX, 9 Oct 2026): advertisers with a direct relationship with the retailer, not brought by any DSP. Listed beside the DSP-sourced advertisers (shown as "Name (Direct)") and sellable like them. id is the advertiser slug, the same key a DSP seat of that name would have.
CREATE TABLE direct_advertisers (
  advertiser_id TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
