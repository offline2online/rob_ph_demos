-- Coded rejection reasons (Campaign Approval summary, 19 Oct 2026): free text
-- alone can't be counted, so a rejection also carries a code from a fixed
-- pick-list. Rows rejected before this stay NULL and count as 'other'.
ALTER TABLE campaign_approvals ADD COLUMN reason_code TEXT;
ALTER TABLE campaign_approval_audit ADD COLUMN reason_code TEXT;
-- The summary reads decisions by date.
CREATE INDEX campaign_approval_audit_at ON campaign_approval_audit (at);
