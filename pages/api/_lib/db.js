import pg from "pg";

const { Pool } = pg;

export function getPool() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }

  if (!globalThis.__everycallPool) {
    globalThis.__everycallPool = new Pool({ connectionString: databaseUrl });
  }

  return globalThis.__everycallPool;
}

let tablesReady = false;

export async function ensureTables(pool) {
  if (tablesReady) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      tenant_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      data_region TEXT NOT NULL DEFAULT 'US',
      plan TEXT NOT NULL DEFAULT 'Growth',
      primary_number TEXT,
      industry TEXT,
      telnyx_voice_number TEXT,
      telnyx_voice_number_id TEXT,
      telnyx_voice_order_id TEXT,
      telnyx_voice_status TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS industry TEXT;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telnyx_voice_number TEXT;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telnyx_voice_number_id TEXT;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telnyx_voice_order_id TEXT;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telnyx_voice_status TEXT;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telnyx_voice_monthly_cost_cents INTEGER;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telnyx_voice_upfront_cost_cents INTEGER;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telnyx_voice_purchased_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS forwarding_setup_status TEXT NOT NULL DEFAULT 'not_started';`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS forwarding_acknowledged_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS forwarding_configured_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'trialing';`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_code TEXT;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS post_trial_access_ends_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_grace_ends_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS service_access_status TEXT NOT NULL DEFAULT 'enabled';`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS app_access_status TEXT NOT NULL DEFAULT 'enabled';`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_status_updated_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_lock_reason TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_users (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone_number TEXT,
      sms_opt_in_status TEXT NOT NULL DEFAULT 'not_requested',
      sms_opt_in_requested_at TIMESTAMPTZ,
      sms_opt_in_confirmed_at TIMESTAMPTZ,
      lead_alert_sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      lead_alert_email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'owner',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS phone_number TEXT;`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS sms_opt_in_status TEXT NOT NULL DEFAULT 'not_requested';`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS sms_opt_in_requested_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS sms_opt_in_confirmed_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS lead_alert_sms_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS lead_alert_email_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS calls (
      call_sid TEXT PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      agent_version_id BIGINT,
      from_number TEXT,
      to_number TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      summary TEXT,
      urgency TEXT,
      disposition TEXT,
      ai_model TEXT,
      ai_input_tokens BIGINT,
      ai_output_tokens BIGINT,
      ai_cached_input_tokens BIGINT,
      ai_input_text_tokens BIGINT,
      ai_input_audio_tokens BIGINT,
      ai_output_text_tokens BIGINT,
      ai_output_audio_tokens BIGINT,
      ai_input_rate_micros_usd BIGINT,
      ai_output_rate_micros_usd BIGINT,
      ai_estimated_cost_micros_usd BIGINT,
      ai_response_count INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE calls ALTER COLUMN status SET DEFAULT 'new';`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_model TEXT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_input_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_output_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_cached_input_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_input_text_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_input_audio_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_output_text_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_output_audio_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_input_rate_micros_usd BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_output_rate_micros_usd BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_estimated_cost_micros_usd BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_response_count INTEGER NOT NULL DEFAULT 0;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_details (
      call_sid TEXT PRIMARY KEY,
      transcript TEXT,
      transcript_combined TEXT,
      extracted_json JSONB,
      routing_json JSONB,
      state_json JSONB,
      caller_first_name TEXT,
      caller_last_name TEXT,
      callback_number TEXT,
      service_required TEXT,
      urgency_level TEXT,
      address_line1 TEXT,
      address_line2 TEXT,
      city TEXT,
      state TEXT,
      postal_code TEXT,
      requested_date TEXT,
      requested_time TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS state_json JSONB;`);
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS transcript_combined TEXT;`);
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS caller_first_name TEXT;`);
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS caller_last_name TEXT;`);
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS callback_number TEXT;`);
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS service_required TEXT;`);
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS urgency_level TEXT;`);
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS address_line1 TEXT;`);
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS address_line2 TEXT;`);
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS city TEXT;`);
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS state TEXT;`);
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS postal_code TEXT;`);
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS requested_date TEXT;`);
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS requested_time TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_events (
      id BIGSERIAL PRIMARY KEY,
      call_sid TEXT NOT NULL,
      tenant_key TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT,
      event_type TEXT NOT NULL DEFAULT 'message',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dispatch_queue (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      call_sid TEXT,
      caller_name TEXT,
      summary TEXT,
      due_at TIMESTAMPTZ,
      assigned_to TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE dispatch_queue ADD COLUMN IF NOT EXISTS assigned_to TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS routing_rules (
      tenant_key TEXT PRIMARY KEY,
      primary_queue TEXT NOT NULL,
      emergency_behavior TEXT NOT NULL,
      after_hours_behavior TEXT NOT NULL,
      business_hours TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_settings (
      tenant_key TEXT PRIMARY KEY,
      timezone TEXT DEFAULT 'America/Los_Angeles',
      notes TEXT,
      caller_id_name TEXT,
      lead_alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      lead_alert_sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      lead_alert_email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      lead_alert_email_include_transcript BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS caller_id_name TEXT;`);
  await pool.query(`ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS lead_alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS lead_alert_sms_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS lead_alert_email_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS lead_alert_email_include_transcript BOOLEAN NOT NULL DEFAULT TRUE;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS onboarding_intake (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      website TEXT,
      phone TEXT,
      service_area TEXT,
      address TEXT,
      timezone TEXT,
      business_hours TEXT,
      average_calls_per_day INTEGER,
      emergency_services BOOLEAN,
      services_offered TEXT,
      primary_goal TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE onboarding_intake ADD COLUMN IF NOT EXISTS website TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_bootstrap_profiles (
      tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) ON DELETE CASCADE,
      website_url TEXT,
      company_description TEXT,
      business_category TEXT,
      source_mode TEXT NOT NULL DEFAULT 'website_first',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE IF EXISTS tenant_domain_assignments ALTER COLUMN subdomain_id DROP NOT NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'admin',
      last_active_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      tenant_key TEXT,
      role TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id BIGSERIAL PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      token_type TEXT NOT NULL,
      user_id BIGINT,
      email TEXT,
      tenant_key TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS auth_tokens_token_idx ON auth_tokens (token);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS onboarding_idempotency (
      id BIGSERIAL PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_body JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS onboarding_idempotency_created_idx ON onboarding_idempotency (created_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_config (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      global_emergency_phrase TEXT NOT NULL,
      telnyx_sms_number TEXT,
      telnyx_sms_number_id TEXT,
      telnyx_sms_messaging_profile_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS telnyx_sms_number TEXT;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS telnyx_sms_number_id TEXT;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS telnyx_sms_messaging_profile_id TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS prompt_blueprints (
      prompt_blueprint_id TEXT PRIMARY KEY,
      blueprint_key TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      name TEXT NOT NULL,
      sample_phrase_groups_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      tool_definitions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS prompt_blueprints_key_version_idx ON prompt_blueprints (blueprint_key, version);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS prompt_blueprints_status_idx ON prompt_blueprints (status, updated_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS prompt_blueprint_sections (
      id BIGSERIAL PRIMARY KEY,
      prompt_blueprint_id TEXT NOT NULL,
      section_id TEXT NOT NULL,
      section_order INTEGER NOT NULL,
      default_text TEXT NOT NULL,
      is_template BOOLEAN NOT NULL DEFAULT FALSE,
      allowed_placeholders_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      admin_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (prompt_blueprint_id, section_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS prompt_blueprint_sections_order_idx ON prompt_blueprint_sections (prompt_blueprint_id, section_order ASC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_prompt_profiles (
      tenant_key TEXT PRIMARY KEY,
      assistant_name TEXT,
      business_name TEXT,
      company_description TEXT,
      opening_line TEXT,
      ai_disclosure_line TEXT,
      lead_goal TEXT,
      required_contact_fields_json JSONB,
      closing_phrase TEXT,
      basic_no_tool_allowed_statement TEXT,
      updated_by_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_prompt_section_overrides (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      prompt_blueprint_id TEXT NOT NULL,
      section_id TEXT NOT NULL,
      override_text TEXT NOT NULL,
      updated_by_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_key, prompt_blueprint_id, section_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS tenant_prompt_section_overrides_tenant_idx ON tenant_prompt_section_overrides (tenant_key, updated_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_billing_accounts (
      tenant_key TEXT PRIMARY KEY,
      stripe_customer_id TEXT UNIQUE,
      stripe_subscription_id TEXT UNIQUE,
      stripe_product_id TEXT,
      stripe_price_id TEXT,
      monthly_amount_cents INTEGER,
      monthly_amount_override_cents INTEGER,
      price_override_reason TEXT,
      price_override_cycles_remaining INTEGER,
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
      canceled_at TIMESTAMPTZ,
      trial_end TIMESTAMPTZ,
      last_invoice_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS stripe_product_id TEXT;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS monthly_amount_cents INTEGER;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS monthly_amount_override_cents INTEGER;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS price_override_reason TEXT;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS price_override_cycles_remaining INTEGER;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS last_invoice_id TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_events (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT,
      stripe_event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      payload_json JSONB NOT NULL,
      processed_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'processed',
      error_message TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_lifecycle_events (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      from_billing_status TEXT,
      to_billing_status TEXT,
      from_service_access_status TEXT,
      to_service_access_status TEXT,
      from_app_access_status TEXT,
      to_app_access_status TEXT,
      reason TEXT,
      metadata_json JSONB,
      created_by_type TEXT NOT NULL DEFAULT 'system',
      created_by_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_channel_health (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      channel TEXT NOT NULL,
      destination TEXT,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_attempted_at TIMESTAMPTZ,
      last_succeeded_at TIMESTAMPTZ,
      last_failed_at TIMESTAMPTZ,
      last_error_code TEXT,
      last_error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_notification_deliveries (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      call_sid TEXT NOT NULL,
      channel TEXT NOT NULL,
      destination TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'new_lead',
      status TEXT NOT NULL DEFAULT 'pending',
      attempted_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      last_error_code TEXT,
      last_error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS provisioning_jobs (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      status_detail TEXT,
      provider TEXT,
      provider_reference TEXT,
      error_code TEXT,
      error_message TEXT,
      attempted_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS status_detail TEXT;`);
  await pool.query(`ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS provider TEXT;`);
  await pool.query(`ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS provider_reference TEXT;`);
  await pool.query(`ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS error_code TEXT;`);
  await pool.query(`ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS error_message TEXT;`);
  await pool.query(`ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS attempted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT,
      issue TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'watching',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS industries (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const industryCount = await pool.query(`SELECT COUNT(*)::int AS count FROM industries`);
  if ((industryCount.rows[0]?.count || 0) === 0) {
    await pool.query(
      `INSERT INTO industries (key, name) VALUES
       ('cleaning', 'Cleaning'),
       ('electrical', 'Electrical'),
       ('garage_door', 'Garage Door'),
       ('general_contractor', 'General Contractor'),
       ('hvac', 'HVAC'),
       ('landscaping', 'Landscaping'),
       ('locksmith', 'Locksmith'),
       ('pest_control', 'Pest Control'),
       ('plumbing', 'Plumbing'),
       ('roofing', 'Roofing'),
       ('window_installers', 'Window Installers')`
    );
  }

  await pool.query(`CREATE INDEX IF NOT EXISTS calls_tenant_created_idx ON calls (tenant_key, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS dispatch_queue_tenant_status_idx ON dispatch_queue (tenant_key, status, due_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS audit_log_tenant_created_idx ON audit_log (tenant_key, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS billing_events_tenant_processed_idx ON billing_events (tenant_key, processed_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS billing_lifecycle_events_tenant_created_idx ON billing_lifecycle_events (tenant_key, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS notification_channel_health_tenant_channel_idx ON notification_channel_health (tenant_key, channel, updated_at DESC);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS notification_channel_health_unique_destination_idx ON notification_channel_health (tenant_key, channel, destination);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS lead_notification_deliveries_tenant_call_idx ON lead_notification_deliveries (tenant_key, call_sid, updated_at DESC);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS lead_notification_deliveries_unique_destination_idx ON lead_notification_deliveries (tenant_key, call_sid, channel, destination, event_type);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS provisioning_jobs_tenant_updated_idx ON provisioning_jobs (tenant_key, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS provisioning_jobs_stage_status_idx ON provisioning_jobs (stage, status, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS incidents_tenant_created_idx ON incidents (tenant_key, created_at DESC);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tenant_users_email_unique ON tenant_users (email);`);

  tablesReady = true;
}
