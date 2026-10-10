-- Shared Targeting Variables: the matchable values for a shared variable are
-- defined once, centrally (ticket t5CXokTIz7TCnIkj5pci, 10 Oct 2026). value_list
-- is a JSON array of strings; free_text leaves the variable open to any value
-- entered at selection time. Both are only kept for a variable shared with a DSP.
ALTER TABLE variable_access ADD COLUMN value_list TEXT NOT NULL DEFAULT '[]';
ALTER TABLE variable_access ADD COLUMN free_text INTEGER NOT NULL DEFAULT 0;
