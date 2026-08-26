import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { ensureTables } from "../pages/api/_lib/db.js";
import { importSalesProspects } from "../pages/api/_lib/salesRepository.js";

const PORT = Number(process.env.SALES_BROWSER_DB_PORT || 55432);
const SESSION_ID = "sales-browser-validation-session";

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

const db = new PGlite();
const pool = createPool(db);

await db.exec(`
  CREATE TABLE knowledge_coverage_events (
    knowledge_coverage_event_id TEXT PRIMARY KEY,
    top_scores_json JSONB NOT NULL DEFAULT '[]'::jsonb
  );
`);
await ensureTables(pool);
await db.exec(await fs.readFile(
  new URL("../migrations/0032_outbound_sales_demo.sql", import.meta.url),
  "utf8"
));

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
         status = 'callback_requested'
     WHERE prospect_id = $1`,
    [activityProspectId]
  );
}

const server = new PGLiteSocketServer({
  db,
  host: "127.0.0.1",
  port: PORT,
  inspect: false
});
await server.start();
console.log(JSON.stringify({
  ready: true,
  port: PORT,
  sessionId: SESSION_ID,
  adminUserId
}));

async function shutdown() {
  await server.stop().catch(() => {});
  await db.close().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
