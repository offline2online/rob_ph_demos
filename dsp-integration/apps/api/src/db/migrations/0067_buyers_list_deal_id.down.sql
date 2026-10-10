DROP TRIGGER buyers_lists_deal_id_immutable;
DROP INDEX buyers_lists_deal_id;
ALTER TABLE buyers_lists DROP COLUMN deal_id;
