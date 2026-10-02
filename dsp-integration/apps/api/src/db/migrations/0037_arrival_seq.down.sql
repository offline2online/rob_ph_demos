-- Reverts 0037: the triggers, the indexes, then the columns.

DROP TRIGGER IF EXISTS reservations_seq_fill;
DROP INDEX IF EXISTS reservations_seq;
ALTER TABLE reservations DROP COLUMN seq;

DROP TRIGGER IF EXISTS buyers_lists_seq_fill;
DROP INDEX IF EXISTS buyers_lists_seq;
ALTER TABLE buyers_lists DROP COLUMN seq;

DROP TRIGGER IF EXISTS partners_seq_fill;
DROP INDEX IF EXISTS partners_seq;
ALTER TABLE partners DROP COLUMN seq;

DROP TRIGGER IF EXISTS displays_seq_fill;
DROP INDEX IF EXISTS displays_seq;
ALTER TABLE displays DROP COLUMN seq;

DROP TRIGGER IF EXISTS playlists_seq_fill;
DROP INDEX IF EXISTS playlists_seq;
ALTER TABLE playlists DROP COLUMN seq;

DROP TRIGGER IF EXISTS display_types_seq_fill;
DROP INDEX IF EXISTS display_types_seq;
ALTER TABLE display_types DROP COLUMN seq;
