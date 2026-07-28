import pg from "pg";

const { Pool } = pg;

export function getPool() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }

  if (!globalThis.__everycallPool) {
    const configuredPoolMax = Number.parseInt(
      String(process.env.DATABASE_POOL_MAX || ""),
      10
    );
    globalThis.__everycallPool = new Pool({
      connectionString: databaseUrl,
      ...(Number.isFinite(configuredPoolMax) && configuredPoolMax > 0
        ? { max: configuredPoolMax }
        : {})
    });
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
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS receptionist_basics_reviewed_at TIMESTAMPTZ;`);
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
      transfer_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      transfer_extension TEXT,
      forward_to_number TEXT,
      sms_opt_in_status TEXT NOT NULL DEFAULT 'not_requested',
      sms_opt_in_requested_at TIMESTAMPTZ,
      sms_opt_in_confirmed_at TIMESTAMPTZ,
      lead_alert_sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      lead_alert_email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      lead_alert_sms_categories_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      lead_alert_email_categories_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'owner',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS phone_number TEXT;`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS transfer_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS transfer_extension TEXT;`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS forward_to_number TEXT;`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS sms_opt_in_status TEXT NOT NULL DEFAULT 'not_requested';`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS sms_opt_in_requested_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS sms_opt_in_confirmed_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS lead_alert_sms_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS lead_alert_email_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS lead_alert_sms_categories_json JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS lead_alert_email_categories_json JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`
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
  `);
  await pool.query(`ALTER TABLE billing_call_types ADD COLUMN IF NOT EXISTS short_description TEXT;`);
  await pool.query(`ALTER TABLE billing_call_types ADD COLUMN IF NOT EXISTS long_description TEXT;`);
  await pool.query(`ALTER TABLE billing_call_types ADD COLUMN IF NOT EXISTS counts_toward_usage BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE billing_call_types ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 100;`);
  await pool.query(`ALTER TABLE billing_call_types ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT TRUE;`);
  await pool.query(`ALTER TABLE billing_call_types ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;`);
  await pool.query(`ALTER TABLE billing_call_types ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE billing_call_types ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`CREATE INDEX IF NOT EXISTS billing_call_types_active_idx ON billing_call_types (active, display_order ASC);`);
  const duplicateUserPhones = await pool.query(
    `SELECT phone_number
     FROM tenant_users
     WHERE phone_number IS NOT NULL
       AND TRIM(phone_number) <> ''
     GROUP BY phone_number
     HAVING COUNT(*) > 1
     LIMIT 1`
  );

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
      lead_outcome_type TEXT,
      lead_is_valid BOOLEAN NOT NULL DEFAULT FALSE,
      lead_is_billable BOOLEAN NOT NULL DEFAULT FALSE,
      lead_decision_reason TEXT,
      lead_duplicate_of_call_sid TEXT,
      billing_call_type_id BIGINT REFERENCES billing_call_types(billing_call_type_id),
      billing_evaluated_at TIMESTAMPTZ,
      billing_notes_json JSONB,
      ai_model TEXT,
      ai_input_tokens BIGINT,
      ai_output_tokens BIGINT,
      ai_cached_input_tokens BIGINT,
      ai_cached_input_text_tokens BIGINT,
      ai_cached_input_audio_tokens BIGINT,
      ai_input_text_tokens BIGINT,
      ai_input_audio_tokens BIGINT,
      ai_output_text_tokens BIGINT,
      ai_output_audio_tokens BIGINT,
      ai_input_rate_micros_usd BIGINT,
      ai_output_rate_micros_usd BIGINT,
      ai_estimated_cost_micros_usd BIGINT,
      ai_response_count INTEGER NOT NULL DEFAULT 0,
      answered_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      duration_seconds INTEGER,
      telephony_billable_minutes INTEGER,
      telephony_rate_micros_usd BIGINT,
      telephony_estimated_cost_micros_usd BIGINT,
      notification_estimated_cost_micros_usd BIGINT,
      total_estimated_cost_micros_usd BIGINT,
      latency_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE calls ALTER COLUMN status SET DEFAULT 'new';`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_model TEXT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS lead_outcome_type TEXT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS lead_is_valid BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS lead_is_billable BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS lead_decision_reason TEXT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS lead_duplicate_of_call_sid TEXT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS billing_call_type_id BIGINT REFERENCES billing_call_types(billing_call_type_id);`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS billing_evaluated_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS billing_notes_json JSONB;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_input_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_output_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_cached_input_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_cached_input_text_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_cached_input_audio_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_input_text_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_input_audio_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_output_text_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_output_audio_tokens BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_input_rate_micros_usd BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_output_rate_micros_usd BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_estimated_cost_micros_usd BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_response_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS telephony_billable_minutes INTEGER;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS telephony_rate_micros_usd BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS telephony_estimated_cost_micros_usd BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS notification_estimated_cost_micros_usd BIGINT;`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS total_estimated_cost_micros_usd BIGINT;`);

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
      caller_email TEXT,
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
  await pool.query(`ALTER TABLE call_details ADD COLUMN IF NOT EXISTS caller_email TEXT;`);
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
    CREATE TABLE IF NOT EXISTS call_transcript_analyses (
      call_sid TEXT PRIMARY KEY REFERENCES calls(call_sid) ON DELETE CASCADE,
      tenant_key TEXT NOT NULL,
      transcript_sha256 TEXT,
      analysis_version TEXT NOT NULL DEFAULT 'unanswered_questions_v1',
      model TEXT,
      response_id TEXT,
      total_business_questions INTEGER NOT NULL DEFAULT 0,
      answered_question_count INTEGER NOT NULL DEFAULT 0,
      unanswered_question_count INTEGER NOT NULL DEFAULT 0,
      analysis_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE call_transcript_analyses ADD COLUMN IF NOT EXISTS tenant_key TEXT;`);
  await pool.query(`ALTER TABLE call_transcript_analyses ADD COLUMN IF NOT EXISTS transcript_sha256 TEXT;`);
  await pool.query(`ALTER TABLE call_transcript_analyses ADD COLUMN IF NOT EXISTS analysis_version TEXT NOT NULL DEFAULT 'unanswered_questions_v1';`);
  await pool.query(`ALTER TABLE call_transcript_analyses ADD COLUMN IF NOT EXISTS model TEXT;`);
  await pool.query(`ALTER TABLE call_transcript_analyses ADD COLUMN IF NOT EXISTS response_id TEXT;`);
  await pool.query(`ALTER TABLE call_transcript_analyses ADD COLUMN IF NOT EXISTS total_business_questions INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE call_transcript_analyses ADD COLUMN IF NOT EXISTS answered_question_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE call_transcript_analyses ADD COLUMN IF NOT EXISTS unanswered_question_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE call_transcript_analyses ADD COLUMN IF NOT EXISTS analysis_json JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE call_transcript_analyses ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE call_transcript_analyses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_answered_questions (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      call_sid TEXT NOT NULL REFERENCES calls(call_sid) ON DELETE CASCADE,
      analysis_version TEXT NOT NULL DEFAULT 'question_inventory_v2',
      ordinal INTEGER NOT NULL DEFAULT 0,
      question_text TEXT NOT NULL,
      assistant_response_text TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE call_answered_questions ADD COLUMN IF NOT EXISTS tenant_key TEXT;`);
  await pool.query(`ALTER TABLE call_answered_questions ADD COLUMN IF NOT EXISTS analysis_version TEXT NOT NULL DEFAULT 'question_inventory_v2';`);
  await pool.query(`ALTER TABLE call_answered_questions ADD COLUMN IF NOT EXISTS ordinal INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE call_answered_questions ADD COLUMN IF NOT EXISTS question_text TEXT;`);
  await pool.query(`ALTER TABLE call_answered_questions ADD COLUMN IF NOT EXISTS assistant_response_text TEXT;`);
  await pool.query(`ALTER TABLE call_answered_questions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE call_answered_questions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_unanswered_questions (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      call_sid TEXT NOT NULL REFERENCES calls(call_sid) ON DELETE CASCADE,
      analysis_version TEXT NOT NULL DEFAULT 'unanswered_questions_v1',
      ordinal INTEGER NOT NULL DEFAULT 0,
      question_text TEXT NOT NULL,
      assistant_response_text TEXT,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE call_unanswered_questions ADD COLUMN IF NOT EXISTS tenant_key TEXT;`);
  await pool.query(`ALTER TABLE call_unanswered_questions ADD COLUMN IF NOT EXISTS analysis_version TEXT NOT NULL DEFAULT 'unanswered_questions_v1';`);
  await pool.query(`ALTER TABLE call_unanswered_questions ADD COLUMN IF NOT EXISTS ordinal INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE call_unanswered_questions ADD COLUMN IF NOT EXISTS question_text TEXT;`);
  await pool.query(`ALTER TABLE call_unanswered_questions ADD COLUMN IF NOT EXISTS assistant_response_text TEXT;`);
  await pool.query(`ALTER TABLE call_unanswered_questions ADD COLUMN IF NOT EXISTS reason TEXT;`);
  await pool.query(`ALTER TABLE call_unanswered_questions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE call_unanswered_questions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

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
    CREATE TABLE IF NOT EXISTS support_conversations (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      created_by_tenant_user_id BIGINT,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting_on_support',
      priority TEXT NOT NULL DEFAULT 'normal',
      assigned_admin_user_id BIGINT,
      client_last_read_at TIMESTAMPTZ,
      admin_last_read_at TIMESTAMPTZ,
      client_unread_count INTEGER NOT NULL DEFAULT 0,
      admin_unread_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_message_preview TEXT,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS created_by_tenant_user_id BIGINT;`);
  await pool.query(`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS subject TEXT;`);
  await pool.query(`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'waiting_on_support';`);
  await pool.query(`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';`);
  await pool.query(`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS assigned_admin_user_id BIGINT;`);
  await pool.query(`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS client_last_read_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS admin_last_read_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS client_unread_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS admin_unread_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS last_message_preview TEXT;`);
  await pool.query(`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT NOT NULL,
      tenant_key TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      sender_id TEXT,
      sender_name TEXT,
      body TEXT NOT NULL,
      body_format TEXT NOT NULL DEFAULT 'plain_text',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS sender_id TEXT;`);
  await pool.query(`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS sender_name TEXT;`);
  await pool.query(`ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS body_format TEXT NOT NULL DEFAULT 'plain_text';`);

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
    CREATE TABLE IF NOT EXISTS tenant_business_hours (
      tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) ON DELETE CASCADE,
      timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
      source TEXT NOT NULL DEFAULT 'manual',
      open_status TEXT NOT NULL DEFAULT 'OPEN',
      regular_hours_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      special_hours_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      more_hours_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      display_text TEXT,
      external_source_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE tenant_business_hours ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles';`);
  await pool.query(`ALTER TABLE tenant_business_hours ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';`);
  await pool.query(`ALTER TABLE tenant_business_hours ADD COLUMN IF NOT EXISTS open_status TEXT NOT NULL DEFAULT 'OPEN';`);
  await pool.query(`ALTER TABLE tenant_business_hours ADD COLUMN IF NOT EXISTS regular_hours_json JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE tenant_business_hours ADD COLUMN IF NOT EXISTS special_hours_json JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE tenant_business_hours ADD COLUMN IF NOT EXISTS more_hours_json JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE tenant_business_hours ADD COLUMN IF NOT EXISTS display_text TEXT;`);
  await pool.query(`ALTER TABLE tenant_business_hours ADD COLUMN IF NOT EXISTS external_source_json JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE tenant_business_hours ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_business_hours ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_settings (
      tenant_key TEXT PRIMARY KEY,
      timezone TEXT DEFAULT 'America/Los_Angeles',
      notes TEXT,
      caller_id_name TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS caller_id_name TEXT;`);

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
      marketing_attribution_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE tenant_bootstrap_profiles ADD COLUMN IF NOT EXISTS marketing_attribution_json JSONB NOT NULL DEFAULT '{}'::jsonb;`);

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
      token_hash TEXT,
      token_type TEXT NOT NULL,
      user_id BIGINT,
      email TEXT,
      tenant_key TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS auth_tokens_token_idx ON auth_tokens (token);`);
  await pool.query(`ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS token_hash TEXT;`);
  await pool.query(`ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS auth_tokens_token_hash_idx ON auth_tokens (token_hash) WHERE token_hash IS NOT NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS request_rate_limits (
      scope TEXT NOT NULL,
      rate_limit_key TEXT NOT NULL,
      window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      hits INTEGER NOT NULL DEFAULT 0,
      blocked_until TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (scope, rate_limit_key)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS demo_sessions (
      demo_session_id TEXT PRIMARY KEY,
      normalized_website_url TEXT NOT NULL,
      website_origin TEXT NOT NULL,
      website_hostname TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      contact_name TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      source_page TEXT,
      source_label TEXT,
      source_url TEXT,
      reused_from_demo_session_id TEXT REFERENCES demo_sessions(demo_session_id) ON DELETE SET NULL,
      business_name TEXT,
      preview_summary TEXT,
      demo_bundle_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      scrape_page_count INTEGER NOT NULL DEFAULT 0,
      scrape_pages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      transcript_items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      failure_code TEXT,
      failure_message TEXT,
      request_ip_hash TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
    );
  `);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS contact_name TEXT;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS contact_phone TEXT;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS contact_email TEXT;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS source_page TEXT;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS source_label TEXT;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS source_url TEXT;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS reused_from_demo_session_id TEXT REFERENCES demo_sessions(demo_session_id) ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS website_hostname TEXT;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS business_name TEXT;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS preview_summary TEXT;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS demo_bundle_json JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS scrape_page_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS scrape_pages_json JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS transcript_items_json JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS failure_code TEXT;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS failure_message TEXT;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS request_ip_hash TEXT;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE demo_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days');`);
  await pool.query(`ALTER TABLE demo_sessions ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '30 days');`);
  await pool.query(`
    UPDATE demo_sessions
    SET expires_at = created_at + INTERVAL '30 days'
    WHERE status <> 'expired'
      AND expires_at < created_at + INTERVAL '30 days'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS demo_session_events (
      demo_session_event_id BIGSERIAL PRIMARY KEY,
      demo_session_id TEXT NOT NULL REFERENCES demo_sessions(demo_session_id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE demo_session_events ADD COLUMN IF NOT EXISTS payload_json JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE demo_session_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inbound_webhook_events (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT,
      payload_hash TEXT,
      first_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE (provider, event_id)
    );
  `);

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
      default_trial_days INTEGER NOT NULL DEFAULT 30,
      billing_plans_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      telnyx_sms_number TEXT,
      telnyx_sms_number_id TEXT,
      telnyx_sms_messaging_profile_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS default_trial_days INTEGER NOT NULL DEFAULT 30;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS billing_plans_json JSONB NOT NULL DEFAULT '[]'::jsonb;`);
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
      billing_interval TEXT NOT NULL DEFAULT 'month',
      monthly_amount_cents INTEGER,
      lead_rate_cents INTEGER,
      included_lead_count INTEGER,
      call_overage_rate_cents INTEGER,
      included_call_count INTEGER,
      monthly_amount_override_cents INTEGER,
      lead_rate_override_cents INTEGER,
      call_overage_rate_override_cents INTEGER,
      price_override_reason TEXT,
      price_override_cycles_remaining INTEGER,
      pending_plan_code TEXT,
      pending_billing_interval TEXT,
      pending_plan_effective_at TIMESTAMPTZ,
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
      canceled_at TIMESTAMPTZ,
      trial_end TIMESTAMPTZ,
      active_coupon_redemption_id BIGINT,
      coupon_trial_ends_at TIMESTAMPTZ,
      coupon_discount_starts_at TIMESTAMPTZ,
      coupon_discount_ends_at TIMESTAMPTZ,
      last_invoice_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS stripe_product_id TEXT;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'month';`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS monthly_amount_cents INTEGER;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS lead_rate_cents INTEGER;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS included_lead_count INTEGER;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS call_overage_rate_cents INTEGER;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS included_call_count INTEGER;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS monthly_amount_override_cents INTEGER;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS lead_rate_override_cents INTEGER;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS call_overage_rate_override_cents INTEGER;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS price_override_reason TEXT;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS price_override_cycles_remaining INTEGER;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS pending_plan_code TEXT;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS pending_billing_interval TEXT;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS pending_plan_effective_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS active_coupon_redemption_id BIGINT;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS coupon_trial_ends_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS coupon_discount_starts_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS coupon_discount_ends_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenant_billing_accounts ADD COLUMN IF NOT EXISTS last_invoice_id TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tenant_billing_accounts_active_coupon_idx ON tenant_billing_accounts (active_coupon_redemption_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_coupons (
      billing_coupon_id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      monthly_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      overage_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      discount_duration_days INTEGER NOT NULL DEFAULT 0,
      free_trial_days INTEGER NOT NULL DEFAULT 0,
      single_use_global BOOLEAN NOT NULL DEFAULT TRUE,
      max_redemptions INTEGER NOT NULL DEFAULT 1,
      redeem_by TIMESTAMPTZ,
      notes TEXT,
      created_by_admin_user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE billing_coupons ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`);
  await pool.query(`ALTER TABLE billing_coupons ADD COLUMN IF NOT EXISTS monthly_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_coupons ADD COLUMN IF NOT EXISTS overage_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_coupons ADD COLUMN IF NOT EXISTS discount_duration_days INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_coupons ADD COLUMN IF NOT EXISTS free_trial_days INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_coupons ADD COLUMN IF NOT EXISTS single_use_global BOOLEAN NOT NULL DEFAULT TRUE;`);
  await pool.query(`ALTER TABLE billing_coupons ADD COLUMN IF NOT EXISTS max_redemptions INTEGER NOT NULL DEFAULT 1;`);
  await pool.query(`ALTER TABLE billing_coupons ADD COLUMN IF NOT EXISTS redeem_by TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE billing_coupons ADD COLUMN IF NOT EXISTS notes TEXT;`);
  await pool.query(`ALTER TABLE billing_coupons ADD COLUMN IF NOT EXISTS created_by_admin_user_id TEXT;`);
  await pool.query(`ALTER TABLE billing_coupons ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE billing_coupons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`CREATE INDEX IF NOT EXISTS billing_coupons_status_idx ON billing_coupons (status, created_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_coupon_plan_scopes (
      billing_coupon_plan_scope_id BIGSERIAL PRIMARY KEY,
      billing_coupon_id BIGINT NOT NULL REFERENCES billing_coupons(billing_coupon_id) ON DELETE CASCADE,
      plan_code TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (billing_coupon_id, plan_code)
    );
  `);
  await pool.query(`ALTER TABLE billing_coupon_plan_scopes ADD COLUMN IF NOT EXISTS plan_code TEXT;`);
  await pool.query(`ALTER TABLE billing_coupon_plan_scopes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`CREATE INDEX IF NOT EXISTS billing_coupon_plan_scopes_coupon_idx ON billing_coupon_plan_scopes (billing_coupon_id, plan_code);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_coupon_redemptions (
      billing_coupon_redemption_id BIGSERIAL PRIMARY KEY,
      billing_coupon_id BIGINT NOT NULL REFERENCES billing_coupons(billing_coupon_id) ON DELETE RESTRICT,
      tenant_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      trial_starts_at TIMESTAMPTZ,
      trial_ends_at TIMESTAMPTZ,
      discount_starts_at TIMESTAMPTZ,
      discount_ends_at TIMESTAMPTZ,
      snapshot_plan_code TEXT,
      snapshot_monthly_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      snapshot_overage_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      snapshot_discount_duration_days INTEGER NOT NULL DEFAULT 0,
      snapshot_free_trial_days INTEGER NOT NULL DEFAULT 0,
      stripe_discount_id TEXT,
      stripe_coupon_id TEXT,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by_type TEXT,
      created_by_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (billing_coupon_id)
    );
  `);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS trial_starts_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS discount_starts_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS discount_ends_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS snapshot_plan_code TEXT;`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS snapshot_monthly_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS snapshot_overage_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS snapshot_discount_duration_days INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS snapshot_free_trial_days INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS stripe_discount_id TEXT;`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS stripe_coupon_id TEXT;`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS created_by_type TEXT;`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS created_by_id TEXT;`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE billing_coupon_redemptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`CREATE INDEX IF NOT EXISTS billing_coupon_redemptions_tenant_idx ON billing_coupon_redemptions (tenant_key, status, redeemed_at DESC);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS billing_coupon_redemptions_active_tenant_idx ON billing_coupon_redemptions (tenant_key) WHERE status = 'active';`);

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
      billing_coupon_redemption_id BIGINT REFERENCES billing_coupon_redemptions(billing_coupon_redemption_id),
      billing_coupon_id BIGINT REFERENCES billing_coupons(billing_coupon_id),
      coupon_code TEXT,
      monthly_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      overage_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
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
  `);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'internal';`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS billing_rule_version TEXT NOT NULL DEFAULT 'call_billing_v1';`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS plan_code TEXT;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS monthly_amount_cents INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS included_call_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS call_overage_rate_cents INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS billing_coupon_redemption_id BIGINT REFERENCES billing_coupon_redemptions(billing_coupon_redemption_id);`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS billing_coupon_id BIGINT REFERENCES billing_coupons(billing_coupon_id);`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS coupon_code TEXT;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS monthly_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS overage_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS eligible_call_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS included_call_count_used INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS overage_call_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS overage_amount_cents INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS stripe_invoice_item_id TEXT;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`CREATE INDEX IF NOT EXISTS billing_periods_tenant_status_idx ON billing_periods (tenant_key, status, period_start DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS billing_periods_coupon_idx ON billing_periods (billing_coupon_redemption_id, period_start DESC);`);

  await pool.query(`
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
  `);
  await pool.query(`ALTER TABLE billing_period_call_assignments ADD COLUMN IF NOT EXISTS billing_call_type_id BIGINT REFERENCES billing_call_types(billing_call_type_id);`);
  await pool.query(`ALTER TABLE billing_period_call_assignments ADD COLUMN IF NOT EXISTS charge_bucket TEXT NOT NULL DEFAULT 'excluded';`);
  await pool.query(`ALTER TABLE billing_period_call_assignments ADD COLUMN IF NOT EXISTS sequence_number INTEGER;`);
  await pool.query(`ALTER TABLE billing_period_call_assignments ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`CREATE INDEX IF NOT EXISTS billing_period_call_assignments_period_idx ON billing_period_call_assignments (billing_period_id, charge_bucket, sequence_number);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_period_adjustments (
      billing_period_adjustment_id BIGSERIAL PRIMARY KEY,
      billing_period_id BIGINT NOT NULL REFERENCES billing_periods(billing_period_id) ON DELETE CASCADE,
      adjustment_type TEXT NOT NULL,
      reason_code TEXT,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      stripe_invoice_item_id TEXT,
      invoiced_at TIMESTAMPTZ,
      created_by_type TEXT,
      created_by_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE billing_period_adjustments ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE billing_period_adjustments ADD COLUMN IF NOT EXISTS stripe_invoice_item_id TEXT;`);
  await pool.query(`ALTER TABLE billing_period_adjustments ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE billing_period_adjustments ADD COLUMN IF NOT EXISTS created_by_type TEXT;`);
  await pool.query(`ALTER TABLE billing_period_adjustments ADD COLUMN IF NOT EXISTS created_by_id TEXT;`);
  await pool.query(`ALTER TABLE billing_period_adjustments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`CREATE INDEX IF NOT EXISTS billing_period_adjustments_period_idx ON billing_period_adjustments (billing_period_id, created_at DESC);`);

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
      provider_reference TEXT,
      attempted_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      last_error_code TEXT,
      last_error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE lead_notification_deliveries ADD COLUMN IF NOT EXISTS provider_reference TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_alert_links (
      token TEXT PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      call_sid TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_connections (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      connector_type TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'enabled',
      endpoint_url TEXT,
      signing_secret_ciphertext TEXT,
      credentials_ciphertext TEXT,
      config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      reconnect_required BOOLEAN NOT NULL DEFAULT FALSE,
      last_test_status TEXT,
      last_tested_at TIMESTAMPTZ,
      last_test_error TEXT,
      last_delivery_succeeded_at TIMESTAMPTZ,
      last_delivery_failed_at TIMESTAMPTZ,
      last_delivery_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS endpoint_url TEXT;`);
  await pool.query(`ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS signing_secret_ciphertext TEXT;`);
  await pool.query(`ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS credentials_ciphertext TEXT;`);
  await pool.query(`ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS config_json JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS reconnect_required BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS last_test_status TEXT;`);
  await pool.query(`ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS last_test_error TEXT;`);
  await pool.query(`ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS last_delivery_succeeded_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS last_delivery_failed_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS last_delivery_error TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_deliveries (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      connection_id BIGINT NOT NULL,
      call_sid TEXT,
      event_type TEXT NOT NULL,
      event_version INTEGER NOT NULL DEFAULT 1,
      event_id TEXT NOT NULL,
      delivery_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      request_url TEXT,
      response_status INTEGER,
      response_body_excerpt TEXT,
      error_message TEXT,
      delivered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE integration_deliveries ADD COLUMN IF NOT EXISTS tenant_key TEXT;`);
  await pool.query(`ALTER TABLE integration_deliveries ADD COLUMN IF NOT EXISTS connection_id BIGINT;`);
  await pool.query(`ALTER TABLE integration_deliveries ADD COLUMN IF NOT EXISTS call_sid TEXT;`);
  await pool.query(`ALTER TABLE integration_deliveries ADD COLUMN IF NOT EXISTS event_type TEXT;`);
  await pool.query(`ALTER TABLE integration_deliveries ADD COLUMN IF NOT EXISTS event_version INTEGER NOT NULL DEFAULT 1;`);
  await pool.query(`ALTER TABLE integration_deliveries ADD COLUMN IF NOT EXISTS event_id TEXT;`);
  await pool.query(`ALTER TABLE integration_deliveries ADD COLUMN IF NOT EXISTS delivery_id TEXT;`);
  await pool.query(`ALTER TABLE integration_deliveries ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 1;`);
  await pool.query(`ALTER TABLE integration_deliveries ADD COLUMN IF NOT EXISTS status TEXT;`);
  await pool.query(`ALTER TABLE integration_deliveries ADD COLUMN IF NOT EXISTS request_url TEXT;`);
  await pool.query(`ALTER TABLE integration_deliveries ADD COLUMN IF NOT EXISTS response_status INTEGER;`);
  await pool.query(`ALTER TABLE integration_deliveries ADD COLUMN IF NOT EXISTS response_body_excerpt TEXT;`);
  await pool.query(`ALTER TABLE integration_deliveries ADD COLUMN IF NOT EXISTS error_message TEXT;`);
  await pool.query(`ALTER TABLE integration_deliveries ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;`);

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
    CREATE TABLE IF NOT EXISTS async_jobs (
      id BIGSERIAL PRIMARY KEY,
      job_type TEXT NOT NULL,
      tenant_key TEXT,
      dedupe_key TEXT,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_at TIMESTAMPTZ,
      locked_by TEXT,
      completed_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE async_jobs ADD COLUMN IF NOT EXISTS dedupe_key TEXT;`);
  await pool.query(`ALTER TABLE async_jobs ADD COLUMN IF NOT EXISTS payload_json JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE async_jobs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';`);
  await pool.query(`ALTER TABLE async_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE async_jobs ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5;`);
  await pool.query(`ALTER TABLE async_jobs ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE async_jobs ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE async_jobs ADD COLUMN IF NOT EXISTS locked_by TEXT;`);
  await pool.query(`ALTER TABLE async_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE async_jobs ADD COLUMN IF NOT EXISTS last_error TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sms_failover_events (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT,
      destination TEXT,
      provider_event_id TEXT,
      provider_message_id TEXT,
      reason TEXT,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE sms_failover_events ADD COLUMN IF NOT EXISTS destination TEXT;`);
  await pool.query(`ALTER TABLE sms_failover_events ADD COLUMN IF NOT EXISTS provider_event_id TEXT;`);
  await pool.query(`ALTER TABLE sms_failover_events ADD COLUMN IF NOT EXISTS provider_message_id TEXT;`);
  await pool.query(`ALTER TABLE sms_failover_events ADD COLUMN IF NOT EXISTS reason TEXT;`);
  await pool.query(`ALTER TABLE sms_failover_events ADD COLUMN IF NOT EXISTS payload_json JSONB NOT NULL DEFAULT '{}'::jsonb;`);

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
  await pool.query(`CREATE INDEX IF NOT EXISTS support_conversations_tenant_updated_idx ON support_conversations (tenant_key, last_message_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS support_conversations_status_updated_idx ON support_conversations (status, last_message_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS support_conversations_assigned_status_idx ON support_conversations (assigned_admin_user_id, status, last_message_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS support_messages_conversation_created_idx ON support_messages (conversation_id, created_at ASC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS support_messages_tenant_created_idx ON support_messages (tenant_key, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS dispatch_queue_tenant_status_idx ON dispatch_queue (tenant_key, status, due_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS audit_log_tenant_created_idx ON audit_log (tenant_key, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS call_transcript_analyses_tenant_updated_idx ON call_transcript_analyses (tenant_key, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS call_answered_questions_tenant_created_idx ON call_answered_questions (tenant_key, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS call_answered_questions_call_created_idx ON call_answered_questions (call_sid, created_at DESC);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS call_answered_questions_call_ordinal_idx ON call_answered_questions (call_sid, analysis_version, ordinal);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS call_unanswered_questions_tenant_created_idx ON call_unanswered_questions (tenant_key, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS call_unanswered_questions_call_created_idx ON call_unanswered_questions (call_sid, created_at DESC);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS call_unanswered_questions_call_ordinal_idx ON call_unanswered_questions (call_sid, analysis_version, ordinal);`);
  await pool.query(`ALTER TABLE IF EXISTS knowledge_coverage_events ADD COLUMN IF NOT EXISTS observed_support_strength TEXT;`);
  await pool.query(`ALTER TABLE IF EXISTS knowledge_coverage_events ADD COLUMN IF NOT EXISTS kb_answerability TEXT;`);
  await pool.query(`ALTER TABLE IF EXISTS knowledge_coverage_events ADD COLUMN IF NOT EXISTS answered_from_kb BOOLEAN;`);
  await pool.query(`ALTER TABLE IF EXISTS knowledge_coverage_events ADD COLUMN IF NOT EXISTS unanswered_from_kb BOOLEAN;`);
  await pool.query(`ALTER TABLE IF EXISTS knowledge_coverage_events ADD COLUMN IF NOT EXISTS max_card_similarity DOUBLE PRECISION;`);
  await pool.query(`ALTER TABLE IF EXISTS knowledge_coverage_events ADD COLUMN IF NOT EXISTS max_fact_similarity DOUBLE PRECISION;`);
  await pool.query(`ALTER TABLE IF EXISTS knowledge_coverage_events ADD COLUMN IF NOT EXISTS selected_card_count INTEGER;`);
  await pool.query(`ALTER TABLE IF EXISTS knowledge_coverage_events ADD COLUMN IF NOT EXISTS selected_fact_count INTEGER;`);
  await pool.query(`ALTER TABLE IF EXISTS knowledge_coverage_events ADD COLUMN IF NOT EXISTS direct_answer_point_count INTEGER;`);
  await pool.query(`
    WITH computed AS (
      SELECT
        k.knowledge_coverage_event_id,
        COALESCE((
          SELECT MAX((entry->>'similarity')::double precision)
          FROM jsonb_array_elements(COALESCE(k.top_scores_json, '[]'::jsonb)) AS entry
          WHERE entry->>'kind' = 'card'
        ), 0) AS max_card_similarity,
        COALESCE((
          SELECT MAX((entry->>'similarity')::double precision)
          FROM jsonb_array_elements(COALESCE(k.top_scores_json, '[]'::jsonb)) AS entry
          WHERE entry->>'kind' = 'fact'
        ), 0) AS max_fact_similarity,
        COALESCE((
          SELECT COUNT(*)
          FROM jsonb_array_elements(COALESCE(k.top_scores_json, '[]'::jsonb)) AS entry
          WHERE
            (entry->>'kind' = 'card' AND (entry->>'similarity')::double precision >= 0.38)
            OR (entry->>'kind' = 'fact' AND (entry->>'similarity')::double precision >= 0.42)
        ), 0) AS corroborating_count
      FROM knowledge_coverage_events k
      WHERE
        k.max_card_similarity IS NULL
        OR k.max_fact_similarity IS NULL
        OR k.observed_support_strength IS NULL
        OR k.kb_answerability IS NULL
        OR k.answered_from_kb IS NULL
        OR k.unanswered_from_kb IS NULL
        OR k.selected_card_count IS NULL
        OR k.selected_fact_count IS NULL
        OR k.direct_answer_point_count IS NULL
    )
    UPDATE knowledge_coverage_events AS target
    SET
      max_card_similarity = computed.max_card_similarity,
      max_fact_similarity = computed.max_fact_similarity,
      observed_support_strength = CASE
        WHEN (computed.max_card_similarity >= 0.62 OR computed.max_fact_similarity >= 0.65) AND computed.corroborating_count >= 2 THEN 'strong'
        WHEN computed.max_card_similarity >= 0.38 OR computed.max_fact_similarity >= 0.42 THEN 'partial'
        ELSE 'none'
      END,
      kb_answerability = CASE
        WHEN (computed.max_card_similarity >= 0.62 OR computed.max_fact_similarity >= 0.65) AND computed.corroborating_count >= 2 THEN 'answered'
        WHEN computed.max_card_similarity >= 0.38 OR computed.max_fact_similarity >= 0.42 THEN 'partial'
        ELSE 'unanswered'
      END,
      answered_from_kb = CASE
        WHEN (computed.max_card_similarity >= 0.62 OR computed.max_fact_similarity >= 0.65) AND computed.corroborating_count >= 2 THEN TRUE
        WHEN computed.max_card_similarity >= 0.38 OR computed.max_fact_similarity >= 0.42 THEN TRUE
        ELSE FALSE
      END,
      unanswered_from_kb = CASE
        WHEN computed.max_card_similarity >= 0.38 OR computed.max_fact_similarity >= 0.42 THEN FALSE
        ELSE TRUE
      END,
      selected_card_count = COALESCE(target.selected_card_count, 0),
      selected_fact_count = COALESCE(target.selected_fact_count, 0),
      direct_answer_point_count = COALESCE(target.direct_answer_point_count, 0)
    FROM computed
    WHERE target.knowledge_coverage_event_id = computed.knowledge_coverage_event_id;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS billing_events_tenant_processed_idx ON billing_events (tenant_key, processed_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS billing_lifecycle_events_tenant_created_idx ON billing_lifecycle_events (tenant_key, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS notification_channel_health_tenant_channel_idx ON notification_channel_health (tenant_key, channel, updated_at DESC);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS notification_channel_health_unique_destination_idx ON notification_channel_health (tenant_key, channel, destination);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS lead_notification_deliveries_tenant_call_idx ON lead_notification_deliveries (tenant_key, call_sid, updated_at DESC);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS lead_notification_deliveries_unique_destination_idx ON lead_notification_deliveries (tenant_key, call_sid, channel, destination, event_type);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS lead_notification_deliveries_provider_reference_idx ON lead_notification_deliveries (provider_reference);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS call_alert_links_tenant_call_created_idx ON call_alert_links (tenant_key, call_sid, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS call_alert_links_expires_idx ON call_alert_links (expires_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS integration_connections_tenant_idx ON integration_connections (tenant_key, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS integration_connections_tenant_status_idx ON integration_connections (tenant_key, status, connector_type);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS integration_deliveries_tenant_created_idx ON integration_deliveries (tenant_key, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS integration_deliveries_connection_created_idx ON integration_deliveries (connection_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS integration_deliveries_call_created_idx ON integration_deliveries (call_sid, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS integration_deliveries_event_idx ON integration_deliveries (event_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS provisioning_jobs_tenant_updated_idx ON provisioning_jobs (tenant_key, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS provisioning_jobs_stage_status_idx ON provisioning_jobs (stage, status, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS async_jobs_status_available_idx ON async_jobs (status, available_at ASC, id ASC);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS async_jobs_job_type_dedupe_idx ON async_jobs (job_type, dedupe_key) WHERE dedupe_key IS NOT NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sms_failover_events_tenant_created_idx ON sms_failover_events (tenant_key, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sms_failover_events_destination_created_idx ON sms_failover_events (destination, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS request_rate_limits_updated_idx ON request_rate_limits (updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS demo_sessions_status_updated_idx ON demo_sessions (status, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS demo_sessions_source_created_idx ON demo_sessions (source_label, source_page, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS demo_sessions_website_url_updated_idx ON demo_sessions (normalized_website_url, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS demo_sessions_origin_updated_idx ON demo_sessions (website_origin, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS demo_sessions_created_idx ON demo_sessions (created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS demo_sessions_contact_email_created_idx ON demo_sessions (contact_email, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS demo_sessions_expires_idx ON demo_sessions (expires_at ASC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS demo_session_events_session_created_idx ON demo_session_events (demo_session_id, created_at ASC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS inbound_webhook_events_provider_seen_idx ON inbound_webhook_events (provider, last_seen_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS incidents_tenant_created_idx ON incidents (tenant_key, created_at DESC);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tenant_users_email_unique ON tenant_users (email);`);
  if (!duplicateUserPhones.rowCount) {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tenant_users_phone_number_unique ON tenant_users (phone_number) WHERE phone_number IS NOT NULL AND TRIM(phone_number) <> '';`);
  }
  await pool.query(`CREATE INDEX IF NOT EXISTS tenant_users_transfer_lookup_idx ON tenant_users (tenant_key, status, transfer_enabled);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tenant_users_transfer_extension_unique ON tenant_users (tenant_key, transfer_extension) WHERE transfer_extension IS NOT NULL AND TRIM(transfer_extension) <> '';`);

  tablesReady = true;
}
