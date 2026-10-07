-- Play config default (Rob, 7 Oct 2026): the committed-plays figure a new
-- buyers list is pre-filled with. NULL means no default (per play).
ALTER TABLE company_advertiser_settings ADD COLUMN default_committed_plays INTEGER;
