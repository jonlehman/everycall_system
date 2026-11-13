-- Prepared concurrent index repair; execute only through the separately reviewed
-- source-tenant-index-ops.mjs guard/journal. Not a transactional migration.
-- No row, constraint, publication, capture, or frozen 0063/0064/0065 change.
CREATE INDEX CONCURRENTLY source_segments_tenant_key_idx ON public.source_segments USING btree (tenant_key);
CREATE INDEX CONCURRENTLY source_chunks_tenant_key_idx ON public.source_chunks USING btree (tenant_key);
