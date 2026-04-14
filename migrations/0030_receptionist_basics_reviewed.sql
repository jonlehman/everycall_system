ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS receptionist_basics_reviewed_at TIMESTAMPTZ;
