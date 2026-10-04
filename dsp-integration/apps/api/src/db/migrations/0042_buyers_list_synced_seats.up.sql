-- Invited buyers become seats the DSPs synced (ticket W8wjh2wtFTnHZUO0Exuu,
-- Rob 4 Oct 2026): [{ identifierType, value }] -> [{ partnerId, seatId }].
-- A brandEntity entry (an advertiser name) or a dspSeatId entry that matches
-- a synced seat becomes that seat, on every DSP that has it; an "other"
-- entry, or one that matches no synced seat, has no identifier a DSP bids
-- under and is dropped.
UPDATE buyers_lists SET invited_buyers = COALESCE((
  SELECT json_group_array(json(entry)) FROM (
    SELECT DISTINCT json_object('partnerId', p.id, 'seatId', json_extract(s.value, '$.id')) AS entry
    FROM json_each(buyers_lists.invited_buyers) AS b
    JOIN partners p
    JOIN json_each(p.seats) AS s
      ON (json_extract(b.value, '$.identifierType') = 'dspSeatId' AND json_extract(b.value, '$.value') = json_extract(s.value, '$.id'))
      OR (json_extract(b.value, '$.identifierType') = 'brandEntity' AND lower(trim(json_extract(b.value, '$.value'))) = lower(trim(json_extract(s.value, '$.name'))))
  )), '[]');
