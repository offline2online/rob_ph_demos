-- A playlist's own settings (Asset Position/Fill, Campaign Transition,
-- Auto-Rotation, Auto-Play), moved off the display type (26 Sep 2026) so
-- they can be edited whether or not the playlist is currently assigned to
-- one. Maximum Campaigns Played In Rotation and slot assignment stay on
-- display_types.playlist_settings/ph_extensions — they size and sell that
-- specific screen's positions. Additive, nullable: existing rows load
-- unchanged with '{}' (every field inherits the platform default).
ALTER TABLE playlists ADD COLUMN playlist_settings TEXT;
