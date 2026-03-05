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
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS forwarding_setup_status TEXT NOT NULL DEFAULT 'not_started';`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS forwarding_acknowledged_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS forwarding_configured_at TIMESTAMPTZ;`);

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
    CREATE TABLE IF NOT EXISTS faqs (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      deletable BOOLEAN NOT NULL DEFAULT TRUE,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      is_industry_default BOOLEAN NOT NULL DEFAULT FALSE,
      industry TEXT,
      source_type TEXT,
      source_url TEXT,
      source_retrieved_at TIMESTAMPTZ,
      source_confidence DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE faqs ADD COLUMN IF NOT EXISTS source_type TEXT;`);
  await pool.query(`ALTER TABLE faqs ADD COLUMN IF NOT EXISTS source_url TEXT;`);
  await pool.query(`ALTER TABLE faqs ADD COLUMN IF NOT EXISTS source_retrieved_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE faqs ADD COLUMN IF NOT EXISTS source_confidence DOUBLE PRECISION;`);

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
      latency_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE calls ALTER COLUMN status SET DEFAULT 'new';`);

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
      faq_usage_prompt TEXT,
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
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS faq_usage_prompt TEXT;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS gateway_field_schema JSONB;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS gateway_tool_definitions JSONB;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS gateway_session_config JSONB;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS telnyx_sms_number TEXT;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS telnyx_sms_number_id TEXT;`);
  await pool.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS telnyx_sms_messaging_profile_id TEXT;`);

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
    CREATE TABLE IF NOT EXISTS provisioning_jobs (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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
    CREATE TABLE IF NOT EXISTS industry_faqs (
      id BIGSERIAL PRIMARY KEY,
      industry_key TEXT NOT NULL REFERENCES industries(key) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
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

  await pool.query(`CREATE INDEX IF NOT EXISTS industry_faqs_industry_idx ON industry_faqs (industry_key);`);

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
  await pool.query(`CREATE INDEX IF NOT EXISTS faqs_tenant_category_idx ON faqs (tenant_key, category);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS audit_log_tenant_created_idx ON audit_log (tenant_key, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS provisioning_jobs_tenant_updated_idx ON provisioning_jobs (tenant_key, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS incidents_tenant_created_idx ON incidents (tenant_key, created_at DESC);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tenant_users_email_unique ON tenant_users (email);`);

  tablesReady = true;
}
