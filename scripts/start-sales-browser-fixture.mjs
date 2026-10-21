import fs from "node:fs/promises";
import crypto from "node:crypto";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { bootstrapFixtureSchema } from "./lib/schema-migrations.mjs";
import { importSalesProspects } from "../pages/api/_lib/salesRepository.js";

const PORT = Number(process.env.SALES_BROWSER_DB_PORT || 55432);
const SESSION_ID = "sales-browser-validation-session";
const SALES_SESSION_ID = "sales-browser-operator-session";

function adaptResult(result) {
  const returnedRows = Array.isArray(result?.rows) ? result.rows.length : 0;
  return {
    ...result,
    rowCount: returnedRows || (Number(result?.affectedRows) || 0)
  };
}

function createPool(db) {
  const client = {
    async query(text, params = []) {
      return adaptResult(await db.query(text, params));
    },
    release() {}
  };
  return {
    query: client.query,
    async connect() {
      return client;
    }
  };
}

const externalDatabaseUrl = process.env.SALES_BROWSER_DATABASE_URL;
let nativeAdmin;
let nativeSchema;
let pool;
let db;
let databaseUrl;
if (externalDatabaseUrl) {
  const target = new URL(externalDatabaseUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) throw new Error("browser_fixture_requires_loopback_database");
  nativeAdmin = new pg.Pool({ connectionString: externalDatabaseUrl });
  nativeSchema = `sales_browser_${crypto.randomBytes(6).toString("hex")}`;
  await nativeAdmin.query(`CREATE SCHEMA ${nativeSchema}`);
  target.searchParams.set("options", `-csearch_path=${nativeSchema},public`);
  databaseUrl = target.toString();
  pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  db = { exec: sql => pool.query(sql), close: () => pool.end() };
} else {
  db = new PGlite();
  pool = createPool(db);
}

await bootstrapFixtureSchema(pool, { executeSql: sql => db.exec(sql) });


const admin = await pool.query(
  `INSERT INTO admin_users (username, email, role)
   VALUES ('sales-browser', 'sales-browser@example.com', 'admin')
   RETURNING id`
);
const adminUserId = Number(admin.rows[0].id);
await pool.query(
  `INSERT INTO sessions (id, user_id, role, expires_at)
   VALUES ($1, $2, 'admin', NOW() + INTERVAL '1 day')`,
  [SESSION_ID, adminUserId]
);
const salesOperator = await pool.query(
  `INSERT INTO admin_users (username, email, role)
   VALUES ('sales-browser-operator', 'sales-browser-operator@example.com', 'sales')
   RETURNING id`
);
const salesOperatorId = Number(salesOperator.rows[0].id);
await pool.query(
  `INSERT INTO sales_operator_settings (admin_user_id, active)
   VALUES ($1, TRUE)`,
  [salesOperatorId]
);
await pool.query(
  `INSERT INTO sessions (id, user_id, role, expires_at)
   VALUES ($1, $2, 'sales', NOW() + INTERVAL '1 day')`,
  [SALES_SESSION_ID, salesOperatorId]
);

const imported = await importSalesProspects(pool, {
  adminUserId,
  records: [
    {
      external_ref: "browser-1",
      business_name: "Acme Appliance Repair",
      contact_name: "Mike Owner",
      contact_email: "mike@example.com",
      lead_delivery_email: "dispatch@example.com",
      phone: "206-555-0101",
      website: "https://example.com",
      business_category: "appliance_repair",
      competitor_name: "Best Appliance",
      timezone: "America/Los_Angeles",
      permission: "yes"
    },
    {
      external_ref: "browser-2",
      business_name: "Cascade Refrigerator Service",
      contact_name: "Sam Technician",
      contact_email: "sam@example.com",
      phone: "206-555-0102",
      website: "https://example.org",
      timezone: "America/Los_Angeles",
      permission: "yes"
    },
    {
      external_ref: "browser-3",
      business_name: "Suppressed Service",
      phone: "206-555-0103",
      website: "https://example.net",
      timezone: "America/Los_Angeles",
      permission: "no"
    }
  ]
});

for (const item of imported.imported.slice(0, 2)) {
  const businessName = item.rowNumber === 2
    ? "Acme Appliance Repair"
    : "Cascade Refrigerator Service";
  await pool.query(
    `INSERT INTO sales_demo_profiles (
       demo_profile_id, prospect_id, status, source_website_url,
       business_name, preview_summary, demo_bundle_json,
       build_completed_at, expires_at
     )
     VALUES ($1, $2, 'ready', 'https://example.com', $3, $4, $5::jsonb,
             NOW(), NOW() + INTERVAL '30 days')`,
    [
      `browser-demo-${item.prospectId}`,
      item.prospectId,
      businessName,
      `${businessName} provides appliance repair and callback service.`,
      JSON.stringify({
        businessName,
        summary: `${businessName} provides appliance repair and callback service.`,
        topServices: ["Refrigerator repair", "Appliance diagnostics"],
        core_facts: [{category:"services",label:"Services",sentence:"We repair refrigerators and diagnose appliances."},{category:"service_area",label:"Service area",sentence:"We serve the Seattle area."}],
        serviceArea: "Seattle area"
      })
    ]
  );
  await pool.query(
    `UPDATE sales_prospects
     SET status = 'ready_to_call'
     WHERE prospect_id = $1`,
    [item.prospectId]
  );
}

const activityProspectId = imported.imported[0]?.prospectId;
if (activityProspectId) {
  await pool.query(
    `INSERT INTO sales_call_sessions (
       sales_call_id, prospect_id, admin_user_id, state, outcome,
       outcome_notes, outcome_recorded_at, started_at, connected_at,
       ended_at
     ) VALUES (
       'sales-browser-call-1', $1, $2, 'closed', 'callback_requested',
       'Owner asked for a call tomorrow afternoon.', NOW(),
       NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '4 minutes', NOW()
     )`,
    [activityProspectId, adminUserId]
  );
  await pool.query(
    `INSERT INTO sales_followup_jobs (
       sales_followup_job_id, prospect_id, sales_call_id, outcome,
       status, attempts, max_attempts, completed_at
     ) VALUES (
       'sales-browser-followup-1', $1, 'sales-browser-call-1',
       'callback_requested', 'completed', 1, 5, NOW()
     )`,
    [activityProspectId]
  );
  await pool.query(
    `UPDATE sales_prospects
     SET last_outcome = 'callback_requested',
         last_outcome_at = NOW(),
         status = 'ready_to_call',
         callback_at = NOW() - INTERVAL '1 minute'
     WHERE prospect_id = $1`,
    [activityProspectId]
  );
}

// Reporting fixtures are database records only; they never create provider calls.
const secondRep = (await pool.query(
  `INSERT INTO admin_users (username, email, role) VALUES ('Jordan Rep', 'jordan-rep@example.com', 'sales') RETURNING id`
)).rows[0];
await pool.query(`INSERT INTO sales_operator_settings (admin_user_id, display_name, active) VALUES ($1, 'Jordan Rep', TRUE)`, [secondRep.id]);
await pool.query(`INSERT INTO sales_call_sessions (sales_call_id, prospect_id, admin_user_id, state,
    created_at, connected_at, demo_started_at, ended_at, outcome, outcome_recorded_at) VALUES
  ('fixture-report-demo', $1, $2, 'ended', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', 'demo_completed', NOW() - INTERVAL '2 days'),
  ('fixture-report-no-answer', $1, $2, 'ended', NOW() - INTERVAL '1 day', NULL, NULL, NOW() - INTERVAL '1 day', 'no_answer', NOW() - INTERVAL '1 day'),
  ('fixture-report-connected', $1, $3, 'ended', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', NULL, NOW() - INTERVAL '1 day', 'callback_requested', NOW() - INTERVAL '1 day'),
  ('fixture-report-old', $1, $3, 'failed', NOW() - INTERVAL '60 days', NULL, NULL, NOW() - INTERVAL '60 days', NULL, NULL)`,
  [imported.imported[0].prospectId, salesOperatorId, secondRep.id]);

// Each rep receives a separate ready record. The suppressed third record stays excluded.
await pool.query("UPDATE sales_prospects SET assigned_rep_user_id=$1 WHERE prospect_id=$2", [salesOperatorId, imported.imported[0]?.prospectId]);
await pool.query("UPDATE sales_prospects SET assigned_rep_user_id=$1 WHERE prospect_id=$2", [adminUserId, imported.imported[1]?.prospectId]);

const server = externalDatabaseUrl ? null : new PGLiteSocketServer({
  db,
  host: "127.0.0.1",
  port: externalDatabaseUrl ? Number(new URL(externalDatabaseUrl).port) : PORT,
  databaseUrl,
  schema: nativeSchema,
  inspect: false
});
if (server) await server.start();
console.log(JSON.stringify({
  ready: true,
  port: externalDatabaseUrl ? Number(new URL(externalDatabaseUrl).port) : PORT,
  databaseUrl,
  schema: nativeSchema,
  sessionId: SESSION_ID,
  adminUserId,
  salesSessionId: SALES_SESSION_ID,
  salesOperatorId
}));

async function shutdown() {
  if (server) await server.stop().catch(() => {});
  await db.close().catch(() => {});
  if (nativeAdmin) {
    await nativeAdmin.query(`DROP SCHEMA ${nativeSchema} CASCADE`).catch(() => {});
    await nativeAdmin.end().catch(() => {});
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
