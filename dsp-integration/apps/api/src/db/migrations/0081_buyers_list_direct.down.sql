DELETE FROM buyers_lists WHERE direct = 1;
ALTER TABLE buyers_lists DROP COLUMN direct;
