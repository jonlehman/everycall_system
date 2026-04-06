ALTER TABLE billing_period_adjustments
  ADD COLUMN IF NOT EXISTS stripe_invoice_item_id TEXT;

ALTER TABLE billing_period_adjustments
  ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMPTZ;
