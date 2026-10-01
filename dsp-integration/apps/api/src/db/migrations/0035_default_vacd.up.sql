-- Default VAC-d per display type (ticket, 1 Oct 2026). The default itself is
-- `phExtensions.defaultVacd` on the display type (assumed views per play
-- window, per display); this column is the display's own score when it has
-- been tuned. NULL means the display inherits its type's default, so editing
-- the default reaches every display that was never overridden.
ALTER TABLE displays ADD COLUMN vacd_override INTEGER;
