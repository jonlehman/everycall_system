CREATE TABLE IF NOT EXISTS billing_call_types (
  billing_call_type_id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  short_description TEXT,
  long_description TEXT,
  counts_toward_usage BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INTEGER NOT NULL DEFAULT 100,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS billing_call_type_id BIGINT REFERENCES billing_call_types(billing_call_type_id);

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS billing_evaluated_at TIMESTAMPTZ;

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS billing_notes_json JSONB;

ALTER TABLE tenant_billing_accounts
  ADD COLUMN IF NOT EXISTS call_overage_rate_cents INTEGER;

ALTER TABLE tenant_billing_accounts
  ADD COLUMN IF NOT EXISTS included_call_count INTEGER;

ALTER TABLE tenant_billing_accounts
  ADD COLUMN IF NOT EXISTS call_overage_rate_override_cents INTEGER;

CREATE TABLE IF NOT EXISTS billing_periods (
  billing_period_id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  source TEXT NOT NULL DEFAULT 'internal',
  billing_rule_version TEXT NOT NULL DEFAULT 'call_billing_v1',
  plan_code TEXT,
  monthly_amount_cents INTEGER NOT NULL DEFAULT 0,
  included_call_count INTEGER NOT NULL DEFAULT 0,
  call_overage_rate_cents INTEGER NOT NULL DEFAULT 0,
  eligible_call_count INTEGER NOT NULL DEFAULT 0,
  included_call_count_used INTEGER NOT NULL DEFAULT 0,
  overage_call_count INTEGER NOT NULL DEFAULT 0,
  overage_amount_cents INTEGER NOT NULL DEFAULT 0,
  stripe_subscription_id TEXT,
  stripe_invoice_id TEXT,
  stripe_invoice_item_id TEXT,
  finalized_at TIMESTAMPTZ,
  invoiced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_key, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS billing_period_call_assignments (
  billing_period_call_assignment_id BIGSERIAL PRIMARY KEY,
  billing_period_id BIGINT NOT NULL REFERENCES billing_periods(billing_period_id) ON DELETE CASCADE,
  call_sid TEXT NOT NULL REFERENCES calls(call_sid) ON DELETE CASCADE,
  billing_call_type_id BIGINT REFERENCES billing_call_types(billing_call_type_id),
  charge_bucket TEXT NOT NULL,
  sequence_number INTEGER,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (billing_period_id, call_sid)
);

CREATE TABLE IF NOT EXISTS billing_period_adjustments (
  billing_period_adjustment_id BIGSERIAL PRIMARY KEY,
  billing_period_id BIGINT NOT NULL REFERENCES billing_periods(billing_period_id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL,
  reason_code TEXT,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_type TEXT,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS billing_call_types_active_idx
  ON billing_call_types (active, display_order ASC);

CREATE INDEX IF NOT EXISTS billing_periods_tenant_status_idx
  ON billing_periods (tenant_key, status, period_start DESC);

CREATE INDEX IF NOT EXISTS billing_period_call_assignments_period_idx
  ON billing_period_call_assignments (billing_period_id, charge_bucket, sequence_number);

CREATE INDEX IF NOT EXISTS billing_period_adjustments_period_idx
  ON billing_period_adjustments (billing_period_id, created_at DESC);

INSERT INTO billing_call_types (
  code,
  label,
  short_description,
  long_description,
  counts_toward_usage,
  display_order,
  is_system,
  active
)
VALUES
  (
    'answered_handled',
    'Answered & Handled',
    'Receptionist answered and handled the call.',
    'The receptionist answered the call and handled the interaction long enough to count toward included or overage usage.',
    TRUE,
    10,
    TRUE,
    TRUE
  ),
  (
    'short_abandon',
    'Short Abandon',
    'Very short answered call.',
    'The call connected briefly but ended too quickly to count toward usage.',
    FALSE,
    20,
    TRUE,
    TRUE
  ),
  (
    'never_answered',
    'Never Answered',
    'Call never reached a handled state.',
    'The call ended before the receptionist answered and handled it.',
    FALSE,
    30,
    TRUE,
    TRUE
  ),
  (
    'technical_failure',
    'Technical Failure',
    'Platform or telephony failure.',
    'The call failed because of a platform, prompt, or telephony problem and should not count toward usage.',
    FALSE,
    40,
    TRUE,
    TRUE
  ),
  (
    'test_call',
    'Test / Internal',
    'Internal or test call.',
    'The call was an internal or test interaction and should not count toward customer usage.',
    FALSE,
    50,
    TRUE,
    TRUE
  ),
  (
    'manual_exclusion',
    'Manual Exclusion',
    'Manually excluded from usage.',
    'Operations manually excluded this call from usage billing.',
    FALSE,
    60,
    TRUE,
    TRUE
  )
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  short_description = EXCLUDED.short_description,
  long_description = EXCLUDED.long_description,
  counts_toward_usage = EXCLUDED.counts_toward_usage,
  display_order = EXCLUDED.display_order,
  is_system = EXCLUDED.is_system,
  active = EXCLUDED.active,
  updated_at = NOW();
