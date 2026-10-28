-- Cancel and End deal (ticket q2t6YgDdW9XCsbORxCq2, 27 Oct 2026). end_kind is 'cancelled' (a shared deal whose flight had not started; archived at once) or 'ended_early' (a live deal given an earlier end date; active_to becomes that date and the deal archives itself after it, as any ended deal does). end_reason is the required free-text reason; end_requested_at is when the person asked, original_active_to the flight end before an early end (null for an open-ended deal), ended_by the person's name.
ALTER TABLE buyers_lists ADD COLUMN end_kind TEXT;
ALTER TABLE buyers_lists ADD COLUMN end_reason TEXT;
ALTER TABLE buyers_lists ADD COLUMN end_requested_at TEXT;
ALTER TABLE buyers_lists ADD COLUMN original_active_to TEXT;
ALTER TABLE buyers_lists ADD COLUMN ended_by TEXT;
