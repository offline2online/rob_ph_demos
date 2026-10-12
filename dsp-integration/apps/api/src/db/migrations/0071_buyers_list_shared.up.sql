-- Deal lifecycle (ticket QG40V1vVwqp9NtFmlC9H, 12 Oct 2026): a buyers list is a DRAFT until the retailer finalises it and presses "Share deal". shared_at is when the deal was sent to its invited buyers' DSPs; NULL = still a draft, which no DSP sees and no bid request quotes. Only a shared deal's term changes ask buyers to re-accept (0070). Every deal that exists today was already live to its buyers, so it is backfilled as shared when it was created.
ALTER TABLE buyers_lists ADD COLUMN shared_at TEXT;
UPDATE buyers_lists SET shared_at = created_at;
