-- Reverts 0102.
DROP TRIGGER IF EXISTS campaign_approval_audit_seq_fill;
DROP INDEX IF EXISTS campaign_approval_audit_seq;
ALTER TABLE campaign_approval_audit DROP COLUMN seq;

DROP TRIGGER IF EXISTS campaign_approvals_seq_fill;
DROP INDEX IF EXISTS campaign_approvals_seq;
ALTER TABLE campaign_approvals DROP COLUMN seq;
