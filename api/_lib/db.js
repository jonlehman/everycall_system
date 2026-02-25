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
let seedReady = false;

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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_users (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      tenant_key TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      company_name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_versions (
      id BIGSERIAL PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      company_name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS calls (
      call_sid TEXT PRIMARY KEY,
      tenant_key TEXT NOT NULL,
      agent_version_id BIGINT,
      from_number TEXT,
      to_number TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      summary TEXT,
      urgency TEXT,
      disposition TEXT,
      latency_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_details (
      call_sid TEXT PRIMARY KEY,
      transcript TEXT,
      extracted_json JSONB,
      routing_json JSONB,
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
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      last_active_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_config (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      global_emergency_phrase TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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

  await pool.query(`CREATE INDEX IF NOT EXISTS calls_tenant_created_idx ON calls (tenant_key, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS dispatch_queue_tenant_status_idx ON dispatch_queue (tenant_key, status, due_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS faqs_tenant_category_idx ON faqs (tenant_key, category);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS audit_log_tenant_created_idx ON audit_log (tenant_key, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS provisioning_jobs_tenant_updated_idx ON provisioning_jobs (tenant_key, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS incidents_tenant_created_idx ON incidents (tenant_key, created_at DESC);`);

  tablesReady = true;
}

export async function seedDemoData(pool) {
  if (seedReady) {
    return;
  }

  const tenantKey = "bobs_plumbing";
  const now = new Date();

  const tenants = await pool.query(`SELECT COUNT(*)::int AS count FROM tenants`);
  if (tenants.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO tenants (tenant_key, name, status, data_region, plan, primary_number)
       VALUES ($1, $2, 'active', 'US', 'Growth', '+1 425 484 3086')`,
      [tenantKey, "Bob's Plumbing"]
    );
  }

  const users = await pool.query(`SELECT COUNT(*)::int AS count FROM tenant_users WHERE tenant_key = $1`, [tenantKey]);
  if (users.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO tenant_users (tenant_key, name, email, role, status)
       VALUES
       ($1, 'Bob', 'bob@bobsplumbing.com', 'owner', 'active'),
       ($1, 'Leah', 'dispatch@bobsplumbing.com', 'dispatcher', 'active'),
       ($1, 'Marco', 'ops@bobsplumbing.com', 'manager', 'pending')`,
      [tenantKey]
    );
  }

  const adminUsers = await pool.query(`SELECT COUNT(*)::int AS count FROM admin_users`);
  if (adminUsers.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO admin_users (username, email, role, last_active_at)
       VALUES ('jonlehman', 'jon@everycall.io', 'super_admin', NOW()),
              ('ops-bot', 'ops-bot@everycall.io', 'automation', NOW() - INTERVAL '5 minutes')`
    );
  }

  const systemConfig = await pool.query(`SELECT COUNT(*)::int AS count FROM system_config`);
  if (systemConfig.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO system_config (id, global_emergency_phrase)
       VALUES (1, 'That sounds urgent — let\'s get you taken care of right away.')`
    );
  }

  const routing = await pool.query(`SELECT COUNT(*)::int AS count FROM routing_rules WHERE tenant_key = $1`, [tenantKey]);
  if (routing.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO routing_rules (tenant_key, primary_queue, emergency_behavior, after_hours_behavior, business_hours)
       VALUES ($1, 'Dispatch Team', 'Priority Queue', 'Collect details and dispatch callback', 'Mon-Fri 7:00 AM - 8:00 PM\nEmergency service 24/7')`,
      [tenantKey]
    );
  }

  const settings = await pool.query(`SELECT COUNT(*)::int AS count FROM tenant_settings WHERE tenant_key = $1`, [tenantKey]);
  if (settings.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO tenant_settings (tenant_key, timezone, notes)
       VALUES ($1, 'America/Los_Angeles', 'Audit logs enabled')`,
      [tenantKey]
    );
  }

  const faqs = await pool.query(`SELECT COUNT(*)::int AS count FROM faqs WHERE tenant_key = $1`, [tenantKey]);
  if (faqs.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO faqs (tenant_key, question, answer, category, deletable, is_default)
       VALUES
       ($1, 'What areas do you serve?', 'We serve the greater metro area and nearby suburbs. Share your address and we will confirm coverage.', 'Service Area', false, true),
       ($1, 'What are your hours and availability?', 'We are available weekdays 7 AM to 8 PM, with emergency support 24/7.', 'Availability', false, true),
       ($1, 'Where are you located?', 'We are locally based in your area. We can confirm the nearest team and dispatch point during your call.', 'Location', false, true),
       ($1, 'Do you offer free estimates?', 'Yes. We provide no-obligation estimates once we review the details of your request.', 'Pricing', false, true),
       ($1, 'What payment methods do you accept?', 'We accept credit cards, checks, and cash. Financing may be available for larger jobs.', 'Billing', false, true)`,
      [tenantKey]
    );
  }

  const agents = await pool.query(`SELECT COUNT(*)::int AS count FROM agents WHERE tenant_key = $1`, [tenantKey]);
  if (agents.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO agents (tenant_key, agent_name, company_name, system_prompt)
       VALUES ($1, 'Sarah', 'Bob\\'s Plumbing', 'Default prompt loaded for tenant.')`,
      [tenantKey]
    );
  }

  const incidents = await pool.query(`SELECT COUNT(*)::int AS count FROM incidents`);
  if (incidents.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO incidents (tenant_key, issue, status)
       VALUES
       ($1, 'Twilio webhook 404', 'resolved'),
       ('blue_sky_hvac', 'Prompt config restore', 'resolved'),
       ('rooter_pro', 'TTS fallback spike', 'watching')`,
      [tenantKey]
    );
  }

  const jobs = await pool.query(`SELECT COUNT(*)::int AS count FROM provisioning_jobs`);
  if (jobs.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO provisioning_jobs (tenant_key, stage, status, updated_at)
       VALUES
       ($1, 'number_setup', 'done', NOW()),
       ('ace_electric', 'workflow_seed', 'running', NOW())`,
      [tenantKey]
    );
  }

  const audit = await pool.query(`SELECT COUNT(*)::int AS count FROM audit_log`);
  if (audit.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details, created_at)
       VALUES
       ($1, 'admin', 'config.update', 'tenant=default', NOW() - INTERVAL '2 minutes'),
       ($1, 'admin', 'webhook.update', 'number=+14254843086', NOW() - INTERVAL '90 seconds'),
       ($1, 'admin', 'prompt.restore', 'tenant=default version=12', NOW() - INTERVAL '60 seconds')`,
      [tenantKey]
    );
  }

  const calls = await pool.query(`SELECT COUNT(*)::int AS count FROM calls WHERE tenant_key = $1`, [tenantKey]);
  if (calls.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO calls (call_sid, tenant_key, from_number, to_number, status, summary, urgency, disposition, latency_ms, created_at)
       VALUES
       ('CA20...681e', $1, '+1 425 615 4640', '+1 425 484 3086', 'completed', 'Burst pipe in basement', 'high', 'callback_pending', 210, $2 - INTERVAL '12 minutes'),
       ('CA13...24cd', $1, '+1 425 615 4640', '+1 425 484 3086', 'completed', 'Water heater no hot water', 'normal', 'handled', 180, $2 - INTERVAL '25 minutes'),
       ('CAea...ce45', $1, '+1 206 998 1101', '+1 425 484 3086', 'error', 'Drain cleaning request', 'normal', 'error', 420, $2 - INTERVAL '38 minutes')`,
      [tenantKey, now]
    );

    await pool.query(
      `INSERT INTO call_details (call_sid, transcript, extracted_json, routing_json)
       VALUES
       ('CA20...681e', 'Caller reports burst pipe in basement.', '{"intent":"emergency_repair","urgency":"high","address":"15506 SE 49th St, Bellevue, WA 98006","callback":"+14256154640"}', '{"disposition":"callback_pending"}')`
    );
  }

  const queue = await pool.query(`SELECT COUNT(*)::int AS count FROM dispatch_queue WHERE tenant_key = $1`, [tenantKey]);
  if (queue.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO dispatch_queue (tenant_key, caller_name, summary, due_at, status)
       VALUES
       ($1, 'John R.', 'Burst pipe · callback due in 7 min', NOW() + INTERVAL '7 minutes', 'new'),
       ($1, 'Maria S.', 'No hot water · quoted range requested', NOW() + INTERVAL '20 minutes', 'new'),
       ($1, 'Elena P.', 'Gas smell safety instruction delivered', NOW() + INTERVAL '40 minutes', 'new')`,
      [tenantKey]
    );
  }

  seedReady = true;
}
