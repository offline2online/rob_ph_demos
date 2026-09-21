-- Additive: this project's display type fields (slot ownership, venue) in
-- one separate, nullable column. Existing records load unchanged.
ALTER TABLE display_types ADD COLUMN ph_extensions TEXT;
