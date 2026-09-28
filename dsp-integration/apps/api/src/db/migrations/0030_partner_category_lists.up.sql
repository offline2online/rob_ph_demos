-- A DSP's own category whitelist/blacklist, alongside its existing
-- advertiser allow_list/block_list (ticket, 28 Sep 2026): unlinking a DSP's
-- list management already copies the company's advertiser lists down for
-- separate editing; category lists never got the same treatment, so an
-- unlinked DSP had no way to hold its own category lists at all. Additive,
-- same default as allow_list/block_list: existing rows load unchanged with
-- '[]' (a linked DSP ignores these columns and reads the company lists
-- instead — see domain/lists.ts effectiveCategoryLists).
ALTER TABLE partners ADD COLUMN category_allow_list TEXT NOT NULL DEFAULT '[]';
ALTER TABLE partners ADD COLUMN category_block_list TEXT NOT NULL DEFAULT '[]';
