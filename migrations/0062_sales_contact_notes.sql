-- Additive contact metadata only; apply with the reviewed scoped0062 runner.
-- Constant default uses PostgreSQL fast ADD COLUMN; no contact UPDATE/backfill.
ALTER TABLE sales_prospect_contacts ADD COLUMN notes TEXT NOT NULL DEFAULT '';
