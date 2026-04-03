ALTER TABLE tenant_users
  ADD COLUMN IF NOT EXISTS lead_alert_sms_categories_json JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE tenant_users
  ADD COLUMN IF NOT EXISTS lead_alert_email_categories_json JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE tenant_users
SET lead_alert_sms_categories_json = '["project_inquiry","general_inquiry","existing_customer_support","vendor_or_sales","spam","wrong_number","hangup_or_incomplete","other_non_billable"]'::jsonb
WHERE lead_alert_sms_enabled = TRUE
  AND (
    lead_alert_sms_categories_json IS NULL
    OR jsonb_typeof(lead_alert_sms_categories_json) <> 'array'
    OR jsonb_array_length(lead_alert_sms_categories_json) = 0
  );

UPDATE tenant_users
SET lead_alert_email_categories_json = '["project_inquiry","general_inquiry","existing_customer_support","vendor_or_sales","spam","wrong_number","hangup_or_incomplete","other_non_billable"]'::jsonb
WHERE lead_alert_email_enabled = TRUE
  AND (
    lead_alert_email_categories_json IS NULL
    OR jsonb_typeof(lead_alert_email_categories_json) <> 'array'
    OR jsonb_array_length(lead_alert_email_categories_json) = 0
  );
