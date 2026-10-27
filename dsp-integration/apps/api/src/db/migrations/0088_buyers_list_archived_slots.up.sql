-- An archived deal keeps the slots it was assigned to (ticket VHuSQiHQoGCPPvreusgK, 27 Oct 2026). The slots are released as the deal is archived (end of flight, domain/dealEnd.ts), so the list is saved on the deal as JSON, in the same shape as assignedSlots. Deals archived before this migration have none recorded: '[]'.
ALTER TABLE buyers_lists ADD COLUMN archived_slots TEXT;
