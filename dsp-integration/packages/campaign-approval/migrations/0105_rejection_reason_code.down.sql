DROP INDEX campaign_approval_audit_at;
ALTER TABLE campaign_approval_audit DROP COLUMN reason_code;
ALTER TABLE campaign_approvals DROP COLUMN reason_code;
