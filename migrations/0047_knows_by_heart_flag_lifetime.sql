-- Review flags are audit records. Removing a selected slot resolves its flags;
-- it must not erase them. Tenant deletion still cascades through tenant_key.
ALTER TABLE kb_selection_flags
  DROP CONSTRAINT IF EXISTS kb_selection_flags_tenant_key_slot_index_fkey;

ALTER TABLE kb_selection_flags
  DROP CONSTRAINT IF EXISTS kb_selection_flags_tenant_key_fkey;

ALTER TABLE kb_selection_flags
  ADD CONSTRAINT kb_selection_flags_tenant_key_fkey
  FOREIGN KEY (tenant_key) REFERENCES tenants(tenant_key) ON DELETE CASCADE;
