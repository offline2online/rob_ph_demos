-- Reverse of 0029: the layout goes back to the display type that owns the
-- playlist before the playlist column is dropped. Without the copy, a
-- rollback turned every zoned display type into a single canvas (review,
-- 2 Oct 2026, pwGKh6gfIKq8O7A1ymP6). Where one playlist is the default of
-- several display types, each gets the playlist's layout.
ALTER TABLE display_types ADD COLUMN multi_zone TEXT;
UPDATE display_types
   SET multi_zone = (SELECT p.multi_zone FROM playlists p WHERE p.id = display_types.default_playlist_id)
 WHERE default_playlist_id IS NOT NULL;
ALTER TABLE playlists DROP COLUMN multi_zone;
