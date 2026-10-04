-- Back to the identifier-typed shape: each synced seat becomes a dspSeatId entry.
UPDATE buyers_lists SET invited_buyers = COALESCE((
  SELECT json_group_array(json_object('identifierType', 'dspSeatId', 'value', json_extract(b.value, '$.seatId')))
  FROM json_each(buyers_lists.invited_buyers) AS b), '[]');
