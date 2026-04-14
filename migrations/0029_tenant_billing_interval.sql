ALTER TABLE tenant_billing_accounts
ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'month';

UPDATE tenant_billing_accounts
SET billing_interval = 'month'
WHERE billing_interval IS NULL
   OR TRIM(billing_interval) = '';
