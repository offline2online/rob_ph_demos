DROP TABLE buyers_list_acceptances;
DROP TRIGGER buyers_list_term_versions_append_only;
DROP TABLE buyers_list_term_versions;
ALTER TABLE buyers_lists DROP COLUMN reaccept_version;
ALTER TABLE buyers_lists DROP COLUMN term_version;
