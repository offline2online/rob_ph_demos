-- Platform users (ticket H6BcvdNZUvdP8Ebh5Tve, 10 Oct 2026): Company Settings -> Users. Internal users (Admin, Marketing, Help Desk) and Advertiser users scoped to one advertiser. email is stored lower-cased and is the key. advertiser_id is the advertiser slug (a DSP seat or a direct advertiser), set only for role Advertiser.
CREATE TABLE platform_users (
  email         TEXT PRIMARY KEY,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL,
  advertiser_id TEXT,
  invited       INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at    TEXT NOT NULL
);
