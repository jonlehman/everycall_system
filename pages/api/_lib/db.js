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

function normalizeGatewayToolDefinitions(value) {
  if (!Array.isArray(value)) return value;
  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const next = item.name === "faq_lookup"
      ? {
          ...item,
          name: "knowledge_lookup",
          description: "Retrieve tenant knowledge relevant to the caller's question."
        }
      : item;
    const name = String(next?.name || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    normalized.push(next);
  }
  return normalized;
}

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      tenant_key TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      company_name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      tenant_prompt_override TEXT,
      greeting_text TEXT,
      voice_type TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS tenant_prompt_override TEXT;`);
  await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS greeting_text TEXT;`);
  await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS voice_type TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_versions (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      company_name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      tenant_prompt_override TEXT,
      greeting_text TEXT,
      voice_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS tenant_prompt_override TEXT;`);
  await pool.query(`ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS greeting_text TEXT;`);
  await pool.query(`ALTER TABLE agent_versions ADD COLUMN IF NOT EXISTS voice_type TEXT;`);

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
      assistant_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS assistant_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);

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
      personality_prompt TEXT,
      datetime_prompt TEXT,
      numbers_symbols_prompt TEXT,
      confirmation_prompt TEXT,
      knowledge_usage_prompt TEXT,
      gateway_field_schema JSONB,
      gateway_tool_definitions JSONB,
      gateway_session_config JSONB,
      telnyx_sms_number TEXT,
      telnyx_sms_number_id TEXT,
      telnyx_sms_messaging_profile_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS personality_prompt TEXT;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS datetime_prompt TEXT;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS numbers_symbols_prompt TEXT;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS confirmation_prompt TEXT;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS knowledge_usage_prompt TEXT;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS gateway_field_schema JSONB;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS gateway_tool_definitions JSONB;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS gateway_session_config JSONB;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS telnyx_sms_number TEXT;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS telnyx_sms_number_id TEXT;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS telnyx_sms_messaging_profile_id TEXT;`);

  const hasLegacyFaqPromptColumn = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_name = 'system_config'
       AND column_name = 'faq_usage_prompt'
     LIMIT 1`
  );
  if (hasLegacyFaqPromptColumn.rowCount) {
    const legacySystemConfig = await pool.query(
      `SELECT knowledge_usage_prompt, faq_usage_prompt, gateway_tool_definitions
       FROM system_config
       WHERE id = 1`
    );
    const legacyRow = legacySystemConfig.rows[0] || null;
    const currentKnowledgeUsage = String(legacyRow?.knowledge_usage_prompt || "").trim();
    const legacyKnowledgeUsage = String(legacyRow?.faq_usage_prompt || "").trim();
    if (!currentKnowledgeUsage && legacyKnowledgeUsage) {
      await pool.query(
        `UPDATE system_config
         SET knowledge_usage_prompt = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [1, legacyKnowledgeUsage]
      );
    }

    const normalizedGatewayTools = normalizeGatewayToolDefinitions(legacyRow?.gateway_tool_definitions);
    if (JSON.stringify(normalizedGatewayTools ?? null) !== JSON.stringify(legacyRow?.gateway_tool_definitions ?? null)) {
      await pool.query(
        `UPDATE system_config
         SET gateway_tool_definitions = $2::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [1, normalizedGatewayTools ? JSON.stringify(normalizedGatewayTools) : null]
      );
    }
  }

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS industry_prompts (
      industry_key TEXT PRIMARY KEY REFERENCES industries(key) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS industry_knowledge_entries (
      id BIGSERIAL PRIMARY KEY,
      industry_key TEXT NOT NULL REFERENCES industries(key) ON DELETE CASCADE,
      section_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content_text TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'industry_seed',
      source_url TEXT,
      source_confidence DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS industry_knowledge_entries_unique_idx ON industry_knowledge_entries (industry_key, section_type);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS industry_knowledge_entries_industry_idx ON industry_knowledge_entries (industry_key, updated_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS industry_guardrail_question_templates (
      id BIGSERIAL PRIMARY KEY,
      industry_key TEXT NOT NULL REFERENCES industries(key) ON DELETE CASCADE,
      topic TEXT,
      question_text TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'high',
      answer TEXT NOT NULL,
      service_tags TEXT[] NOT NULL DEFAULT '{}',
      source_type TEXT NOT NULL DEFAULT 'industry_seed',
      source_url TEXT,
      source_confidence DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS industry_guardrail_templates_unique_idx ON industry_guardrail_question_templates (industry_key, question_text);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS industry_guardrail_templates_industry_idx ON industry_guardrail_question_templates (industry_key, updated_at DESC);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_crawls (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      root_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      crawl_mode TEXT NOT NULL DEFAULT 'website',
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      pages_discovered_count INTEGER NOT NULL DEFAULT 0,
      pages_fetched_count INTEGER NOT NULL DEFAULT 0,
      pages_failed_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      metadata_json JSONB,
      created_by_type TEXT NOT NULL DEFAULT 'system',
      created_by_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_pages (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      crawl_id BIGINT REFERENCES site_crawls(id) ON DELETE SET NULL,
      source_url TEXT NOT NULL,
      canonical_url TEXT,
      page_title TEXT,
      content_hash TEXT,
      fetch_status TEXT NOT NULL DEFAULT 'pending',
      http_status INTEGER,
      content_type TEXT,
      last_seen_at TIMESTAMPTZ,
      fetched_at TIMESTAMPTZ,
      metadata_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_sections (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      crawl_id BIGINT REFERENCES site_crawls(id) ON DELETE SET NULL,
      page_id BIGINT REFERENCES site_pages(id) ON DELETE CASCADE,
      section_key TEXT,
      heading_path TEXT,
      section_order INTEGER NOT NULL DEFAULT 0,
      content_text TEXT NOT NULL,
      content_hash TEXT,
      metadata_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_topics (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      crawl_id BIGINT REFERENCES site_crawls(id) ON DELETE SET NULL,
      page_id BIGINT REFERENCES site_pages(id) ON DELETE SET NULL,
      topic_key TEXT NOT NULL,
      parent_topic_key TEXT,
      topic_path TEXT NOT NULL,
      parent_topic_path TEXT,
      display_title TEXT NOT NULL,
      topic_type TEXT NOT NULL DEFAULT 'page',
      summary_objective TEXT,
      source_url TEXT,
      source_confidence DOUBLE PRECISION,
      risk_level TEXT NOT NULL DEFAULT 'normal',
      metadata_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_coverage_checks (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      check_key TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'missing',
      coverage_confidence DOUBLE PRECISION,
      matched_topic_paths_json JSONB,
      notes TEXT,
      metadata_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      entry_type TEXT NOT NULL DEFAULT 'manual_note',
      section_type TEXT NOT NULL DEFAULT 'general',
      title TEXT,
      content_text TEXT NOT NULL,
      source_url TEXT,
      compilation_status TEXT NOT NULL DEFAULT 'pending',
      last_compiled_at TIMESTAMPTZ,
      metadata_json JSONB,
      created_by_type TEXT NOT NULL DEFAULT 'tenant',
      created_by_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_facts (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      page_id BIGINT REFERENCES site_pages(id) ON DELETE SET NULL,
      section_id BIGINT REFERENCES site_sections(id) ON DELETE SET NULL,
      knowledge_entry_id BIGINT REFERENCES knowledge_entries(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active',
      review_status TEXT NOT NULL DEFAULT 'unreviewed',
      source_type TEXT NOT NULL DEFAULT 'website_extracted',
      topic TEXT,
      trade TEXT,
      service_tags TEXT[] NOT NULL DEFAULT '{}',
      claim TEXT NOT NULL,
      evidence_text TEXT,
      source_url TEXT,
      confidence DOUBLE PRECISION,
      risk_level TEXT NOT NULL DEFAULT 'normal',
      explicit BOOLEAN NOT NULL DEFAULT TRUE,
      metadata_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_cards (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      card_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      topic TEXT,
      trade TEXT,
      service_tags TEXT[] NOT NULL DEFAULT '{}',
      audience TEXT NOT NULL DEFAULT 'general',
      title TEXT NOT NULL,
      summary TEXT,
      usage_notes TEXT,
      metadata_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_card_facts (
      card_id BIGINT NOT NULL REFERENCES knowledge_cards(id) ON DELETE CASCADE,
      fact_id BIGINT NOT NULL REFERENCES knowledge_facts(id) ON DELETE CASCADE,
      fact_rank INTEGER NOT NULL DEFAULT 0,
      required BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (card_id, fact_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_overrides (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      topic TEXT,
      trade TEXT,
      service_tags TEXT[] NOT NULL DEFAULT '{}',
      audience TEXT NOT NULL DEFAULT 'general',
      trigger_text TEXT,
      preferred_answer TEXT NOT NULL,
      applies_when_json JSONB,
      source_feedback_event_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_guardrails (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      rule_type TEXT NOT NULL,
      topic TEXT,
      trade TEXT,
      service_tags TEXT[] NOT NULL DEFAULT '{}',
      severity TEXT NOT NULL DEFAULT 'high',
      instruction_text TEXT NOT NULL,
      applies_when_json JSONB,
      source_feedback_event_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_feedback_events (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      source_kind TEXT NOT NULL DEFAULT 'knowledge_review',
      question_text TEXT,
      draft_answer TEXT,
      user_feedback_text TEXT,
      edited_answer TEXT,
      route_decision TEXT,
      route_confidence DOUBLE PRECISION,
      route_reason TEXT,
      target_artifact_type TEXT,
      target_artifact_id BIGINT,
      status TEXT NOT NULL DEFAULT 'pending',
      metadata_json JSONB,
      created_by_type TEXT NOT NULL DEFAULT 'tenant',
      created_by_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guardrail_question_tests (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      topic TEXT,
      trade TEXT,
      service_tags TEXT[] NOT NULL DEFAULT '{}',
      question_text TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'high',
      draft_answer TEXT,
      approved_answer TEXT,
      review_status TEXT NOT NULL DEFAULT 'pending',
      last_run_at TIMESTAMPTZ,
      last_run_confidence DOUBLE PRECISION,
      supporting_artifacts_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  await pool.query(`CREATE INDEX IF NOT EXISTS provisioning_jobs_tenant_updated_idx ON provisioning_jobs (tenant_key, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS provisioning_jobs_stage_status_idx ON provisioning_jobs (stage, status, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS incidents_tenant_created_idx ON incidents (tenant_key, created_at DESC);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tenant_users_email_unique ON tenant_users (email);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS site_crawls_tenant_created_idx ON site_crawls (tenant_key, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS site_crawls_status_updated_idx ON site_crawls (status, updated_at DESC);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS site_pages_tenant_source_url_idx ON site_pages (tenant_key, source_url);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS site_pages_tenant_status_updated_idx ON site_pages (tenant_key, fetch_status, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS site_sections_tenant_page_order_idx ON site_sections (tenant_key, page_id, section_order);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS site_topics_tenant_topic_path_idx ON site_topics (tenant_key, topic_path);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS site_topics_tenant_parent_idx ON site_topics (tenant_key, parent_topic_path, topic_type, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS site_topics_tenant_risk_idx ON site_topics (tenant_key, risk_level, updated_at DESC);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_coverage_checks_tenant_check_idx ON knowledge_coverage_checks (tenant_key, check_key);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS knowledge_coverage_checks_tenant_status_idx ON knowledge_coverage_checks (tenant_key, status, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS knowledge_entries_tenant_section_updated_idx ON knowledge_entries (tenant_key, section_type, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS knowledge_entries_compilation_status_idx ON knowledge_entries (tenant_key, compilation_status, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS knowledge_facts_tenant_topic_idx ON knowledge_facts (tenant_key, topic, trade, status, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS knowledge_facts_tenant_risk_idx ON knowledge_facts (tenant_key, risk_level, review_status, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS knowledge_facts_service_tags_idx ON knowledge_facts USING GIN (service_tags);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_cards_tenant_card_key_idx ON knowledge_cards (tenant_key, card_key);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS knowledge_cards_tenant_topic_idx ON knowledge_cards (tenant_key, topic, trade, status, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS knowledge_cards_service_tags_idx ON knowledge_cards USING GIN (service_tags);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS knowledge_overrides_tenant_topic_idx ON knowledge_overrides (tenant_key, topic, trade, status, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS knowledge_overrides_service_tags_idx ON knowledge_overrides USING GIN (service_tags);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS knowledge_guardrails_tenant_topic_idx ON knowledge_guardrails (tenant_key, topic, trade, status, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS knowledge_guardrails_service_tags_idx ON knowledge_guardrails USING GIN (service_tags);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS knowledge_feedback_events_tenant_status_idx ON knowledge_feedback_events (tenant_key, status, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS guardrail_question_tests_tenant_review_idx ON guardrail_question_tests (tenant_key, review_status, risk_level, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS guardrail_question_tests_service_tags_idx ON guardrail_question_tests USING GIN (service_tags);`);

  tablesReady = true;
}
