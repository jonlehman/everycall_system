import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  addSalesProspectNote,
  claimSalesSignupInvitationDelivery,
  completeSalesSignupInvitation,
  createSalesProspect,
  createSalesCallSession,
  createSalesSignupInvitation,
  getSalesProspectDetail,
  getSalesSignupInvitation,
  getSalesProspect,
  importSalesProspects,
  listSalesProspects,
  markExpiredSalesDemoProfiles,
  markSalesSignupInvitationSent,
  openSalesSignupPrefill,
  recordSalesCallOutcome,
  releaseSalesSignupInvitationDelivery,
  removeSalesProspect,
  skipSalesProspect,
  updateSalesProspect,
  validateSalesSignupInvitationForOnboarding
} from "../pages/api/_lib/salesRepository.js";
import { processSalesFollowupJobs } from "../pages/api/_lib/salesFollowupJobs.js";

function withRowCount(result) {
  const returnedRows = Array.isArray(result?.rows) ? result.rows.length : 0;
  return {
    ...result,
    rowCount: returnedRows || (Number.isFinite(result?.affectedRows)
      ? result.affectedRows
      : 0)
  };
}

function createPool(db) {
  const client = {
    async query(text, params = []) {
      return withRowCount(await db.query(text, params));
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

async function main() {
  process.env.SALES_SIGNUP_TOKEN_SECRET = "sales-database-validator-secret-at-least-32";
  process.env.SMARTLEAD_API_KEY = "smartlead-validator-key";
  process.env.SMARTLEAD_SALES_NO_ANSWER_CAMPAIGN_ID = "321";
  process.env.SALES_CALL_WINDOW_START_LOCAL = "00:00";
  process.env.SALES_CALL_WINDOW_END_LOCAL = "00:00";
  process.env.SALES_CALL_MISSING_TIMEZONE_POLICY = "block";

  const db = new PGlite();
  const pool = createPool(db);
  try {
    await db.exec(`
      CREATE TABLE admin_users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin'
      );
      CREATE TABLE tenants (
        tenant_key TEXT PRIMARY KEY,
        status TEXT,
        telnyx_voice_number TEXT,
        telnyx_voice_status TEXT
      );
      CREATE TABLE provisioning_jobs (
        id BIGSERIAL PRIMARY KEY,
        tenant_key TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        status_detail TEXT,
        error_code TEXT,
        error_message TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await db.exec(await fs.readFile(
      new URL("../migrations/0032_outbound_sales_demo.sql", import.meta.url),
      "utf8"
    ));
    const admin = await pool.query(
      `INSERT INTO admin_users (username, email, role)
       VALUES ('sales-validator', 'sales-validator@example.com', 'admin')
       RETURNING id`
    );
    const adminUserId = Number(admin.rows[0].id);

    const imported = await importSalesProspects(pool, {
      adminUserId,
      records: [
        {
          external_ref: "validation-1",
          business_name: "Acme Appliance",
          contact_name: "Mike Owner",
          contact_email: "mike@example.com",
          lead_delivery_email: "leads@example.com",
          phone: "206-555-0101",
          website: "https://example.com",
          business_category: "appliance_repair",
          timezone: "America/Los_Angeles",
          permission: "yes"
        },
        {
          external_ref: "validation-2",
          business_name: "Second Service",
          contact_name: "Sam Owner",
          contact_email: "sam@example.com",
          phone: "206-555-0102",
          website: "https://example.org",
          business_category: "arbitrary unsupported csv category",
          timezone: "UTC",
          permission: "yes"
        },
        {
          external_ref: "validation-blocked",
          business_name: "Blocked Service",
          phone: "206-555-0103",
          website: "https://example.net",
          timezone: "UTC",
          permission: "no",
          do_not_call: "yes"
        },
        {
          external_ref: "validation-skip",
          business_name: "Unusable Demo Service",
          contact_email: "skip@example.com",
          phone: "206-555-0104",
          website: "https://skip.example",
          timezone: "UTC",
          permission: "yes"
        }
      ]
    });
    assert.equal(imported.importedCount, 4);
    assert.equal(imported.rejectedCount, 0);

    const firstId = imported.imported.find((item) => item.rowNumber === 2).prospectId;
    const secondId = imported.imported.find((item) => item.rowNumber === 3).prospectId;
    const blockedId = imported.imported.find((item) => item.rowNumber === 4).prospectId;
    const skipId = imported.imported.find((item) => item.rowNumber === 5).prospectId;
    const blockedProspect = await getSalesProspect(pool, blockedId);
    assert.equal(blockedProspect.suppressed, true);
    assert.equal(blockedProspect.doNotCall, true);
    assert.ok(blockedProspect.emailSuppressedAt);
    assert.equal(blockedProspect.emailSuppressionReason, "do_not_call");
    await pool.query(
      `INSERT INTO sales_demo_profiles (
         demo_profile_id, prospect_id, status, source_website_url,
         failure_code, failure_message, build_completed_at
       )
       VALUES (
         'demo-skip-validation', $1, 'failed', 'https://skip.example',
         'website_fetch_failed', 'Website could not be used.', NOW()
       )`,
      [skipId]
    );
    const skippedProspect = await skipSalesProspect(pool, {
      prospectId: skipId,
      reason: "Website could not be used.",
      adminUserId
    });
    assert.equal(skippedProspect.status, "skipped");
    assert.equal(skippedProspect.skippedReason, "Website could not be used.");
    assert.equal(skippedProspect.suppressed, false);
    assert.equal(skippedProspect.doNotCall, false);
    await pool.query(
      `UPDATE sales_demo_profiles
       SET status = 'ready',
           demo_bundle_json = '{"businessName":"Unusable Demo Service"}'::jsonb,
           build_completed_at = NOW(),
           expires_at = NOW() + INTERVAL '30 days'
       WHERE prospect_id = $1`,
      [skipId]
    );
    await assert.rejects(
      createSalesCallSession(pool, {
        prospectId: skipId,
        adminUserId,
        idempotencyKey: "skipped-prospect-call"
      }),
      (error) => error?.code === "prospect_not_eligible"
    );
    const applianceInvitation = await createSalesSignupInvitation(pool, {
      prospectId: firstId,
      contactEmail: "mike@example.com",
      leadDeliveryEmail: "leads@example.com",
      adminUserId,
      idempotencyKey: "signup-appliance-category-validation",
      appBaseUrl: "https://everycall.example"
    });
    const appliancePrefill = await pool.query(
      `SELECT safe_prefill_json
       FROM sales_signup_invitations
       WHERE invitation_id = $1`,
      [applianceInvitation.invitation.invitationId]
    );
    assert.equal(
      appliancePrefill.rows[0].safe_prefill_json.businessCategory,
      "service_business"
    );
    for (const [prospectId, businessName] of [
      [firstId, "Acme Appliance"],
      [secondId, "Second Service"]
    ]) {
      await pool.query(
        `INSERT INTO sales_demo_profiles (
           demo_profile_id, prospect_id, status, source_website_url,
           business_name, preview_summary, demo_bundle_json,
           build_completed_at, expires_at
         )
         VALUES ($1, $2, 'ready', 'https://example.com', $3, 'Ready demo',
                 $4::jsonb, NOW(), NOW() + INTERVAL '30 days')`,
        [
          `demo-${prospectId}`,
          prospectId,
          businessName,
          JSON.stringify({ businessName, summary: "Repairs home appliances." })
        ]
      );
      await pool.query(
        `UPDATE sales_prospects
         SET status = 'ready_to_call'
         WHERE prospect_id = $1`,
        [prospectId]
      );
    }

    let queue = await listSalesProspects(pool, { eligibleOnly: true, limit: 11 });
    assert.deepEqual(
      queue.prospects.map((prospect) => prospect.prospectId),
      [firstId, secondId]
    );
    assert.equal(queue.prospects[0].emailPermission, true);

    const call = await createSalesCallSession(pool, {
      prospectId: firstId,
      adminUserId,
      idempotencyKey: "call-validation-1",
      metadata: { business_name: "Acme Appliance" }
    });
    assert.equal(call.prospectId, firstId);
    const note = await addSalesProspectNote(pool, {
      prospectId: firstId,
      salesCallId: call.salesCallId,
      body: "Database-backed prospect detail validation.",
      adminUserId
    });
    const prospectDetail = await getSalesProspectDetail(pool, firstId);
    assert.equal(prospectDetail.notes[0].noteId, note.noteId);
    assert.equal(prospectDetail.calls[0].salesCallId, call.salesCallId);
    await pool.query(
      `UPDATE sales_call_sessions
       SET outcome = 'no_answer',
           outcome_recorded_at = NOW()
       WHERE sales_call_id = $1`,
      [call.salesCallId]
    );
    await recordSalesCallOutcome(pool, {
      salesCallId: call.salesCallId,
      outcome: "no_answer"
    });
    queue = await listSalesProspects(pool, { eligibleOnly: true, limit: 11 });
    assert.deepEqual(queue.prospects.map((prospect) => prospect.prospectId), [secondId]);
    const followupCount = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM sales_followup_jobs
       WHERE sales_call_id = $1 AND outcome = 'no_answer'`,
      [call.salesCallId]
    );
    assert.equal(followupCount.rows[0].count, 1);
    const detailWithFollowup = await getSalesProspectDetail(pool, firstId);
    assert.equal(detailWithFollowup.followups.length, 1);
    assert.equal(detailWithFollowup.followups[0].outcome, "no_answer");

    const smartleadRequests = [];
    const followups = await processSalesFollowupJobs(pool, {
      workerId: "sales-db-validator",
      limit: 3,
      fetchImpl: async (url, options) => {
        smartleadRequests.push({ url: String(url), options });
        return new Response(JSON.stringify({ lead_ids: [456] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    });
    assert.equal(followups.claimedCount, 1);
    assert.equal(followups.results[0].ok, true);
    assert.equal(smartleadRequests.length, 1);
    assert.match(smartleadRequests[0].url, /campaigns\/321\/leads/);
    const storedFollowupResult = await pool.query(
      `SELECT provider_result_json
       FROM sales_followup_jobs
       WHERE sales_call_id = $1 AND outcome = 'no_answer'`,
      [call.salesCallId]
    );
    assert.equal(
      Object.hasOwn(storedFollowupResult.rows[0].provider_result_json, "result"),
      false
    );
    const routedProspect = await getSalesProspect(pool, firstId);
    assert.equal(routedProspect.smartleadLeadId, "456");
    assert.equal(routedProspect.smartleadCampaignId, "321");

    await recordSalesCallOutcome(pool, {
      salesCallId: call.salesCallId,
      outcome: "no_answer",
      notes: "Safe replay after the follow-up completed"
    });
    const replayedFollowupCount = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM sales_followup_jobs
       WHERE sales_call_id = $1 AND outcome = 'no_answer'`,
      [call.salesCallId]
    );
    assert.equal(replayedFollowupCount.rows[0].count, 1);
    const replayedFollowups = await processSalesFollowupJobs(pool, {
      workerId: "sales-db-validator-replay",
      limit: 3,
      fetchImpl: async () => {
        throw new Error("A replay must not call Smartlead again.");
      }
    });
    assert.equal(replayedFollowups.claimedCount, 0);

    await recordSalesCallOutcome(pool, {
      salesCallId: call.salesCallId,
      outcome: "do_not_call"
    });
    const suppressedProspect = await getSalesProspect(pool, firstId);
    assert.equal(suppressedProspect.suppressed, true);
    assert.equal(suppressedProspect.doNotCall, true);
    assert.ok(suppressedProspect.emailSuppressedAt);
    assert.equal(suppressedProspect.emailSuppressionReason, "do_not_call");
    const suppressionRequests = [];
    const suppressionFollowups = await processSalesFollowupJobs(pool, {
      workerId: "sales-db-validator-suppression",
      limit: 3,
      fetchImpl: async (url, options) => {
        suppressionRequests.push({ url: String(url), options });
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    });
    assert.equal(suppressionFollowups.claimedCount, 1);
    assert.match(suppressionRequests[0].url, /\/leads\/456\/unsubscribe/);
    await recordSalesCallOutcome(pool, {
      salesCallId: call.salesCallId,
      outcome: "do_not_call"
    });
    const suppressionJobCount = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM sales_followup_jobs
       WHERE sales_call_id = $1 AND outcome = 'do_not_call'`,
      [call.salesCallId]
    );
    assert.equal(suppressionJobCount.rows[0].count, 1);

    const invitation = await createSalesSignupInvitation(pool, {
      prospectId: secondId,
      contactEmail: "sam@example.com",
      leadDeliveryEmail: "dispatch@example.com",
      adminUserId,
      idempotencyKey: "signup-validation-1",
      appBaseUrl: "https://everycall.example"
    });
    assert.equal(invitation.replayed, false);
    assert.match(invitation.signupUrl, /salesInvite=/);
    const unsupportedPrefill = await pool.query(
      `SELECT safe_prefill_json
       FROM sales_signup_invitations
       WHERE invitation_id = $1`,
      [invitation.invitation.invitationId]
    );
    assert.equal(
      unsupportedPrefill.rows[0].safe_prefill_json.businessCategory,
      null
    );
    assert.equal(
      await claimSalesSignupInvitationDelivery(
        pool,
        invitation.invitation.invitationId
      ),
      true
    );
    assert.equal(
      await claimSalesSignupInvitationDelivery(
        pool,
        invitation.invitation.invitationId
      ),
      false
    );
    await pool.query(
      `UPDATE sales_signup_invitations
       SET updated_at = NOW() - INTERVAL '6 minutes'
       WHERE invitation_id = $1`,
      [invitation.invitation.invitationId]
    );
    assert.equal(
      await claimSalesSignupInvitationDelivery(
        pool,
        invitation.invitation.invitationId
      ),
      true
    );
    await releaseSalesSignupInvitationDelivery(
      pool,
      invitation.invitation.invitationId
    );
    await markSalesSignupInvitationSent(pool, invitation.invitation.invitationId);
    const firstOpen = await openSalesSignupPrefill(pool, invitation.token);
    const secondOpen = await openSalesSignupPrefill(pool, invitation.token);
    assert.equal(firstOpen.invitationId, secondOpen.invitationId);
    assert.equal(firstOpen.prefill.businessName, "Second Service");
    assert.equal(firstOpen.prefill.loginEmail, "sam@example.com");

    const validated = await validateSalesSignupInvitationForOnboarding(pool, {
      rawToken: invitation.token,
      forUpdate: false
    });
    assert.equal(validated.prospectId, secondId);
    await completeSalesSignupInvitation(pool, {
      rawToken: invitation.token,
      tenantKey: "second_service"
    });
    await assert.rejects(
      () => validateSalesSignupInvitationForOnboarding(pool, {
        rawToken: invitation.token,
        forUpdate: false
      }),
      (error) => error?.code === "signup_invitation_unavailable"
    );
    const convertedProspect = await getSalesProspect(pool, secondId);
    assert.equal(convertedProspect.status, "signup_completed");
    await pool.query(
      `INSERT INTO tenants (
         tenant_key, status, telnyx_voice_number, telnyx_voice_status
       )
       VALUES ('second_service', 'active', NULL, NULL)`
    );
    const provisioningJob = await pool.query(
      `INSERT INTO provisioning_jobs (
         tenant_key, stage, status, status_detail
       )
       VALUES (
         'second_service', 'number_setup', 'running',
         'Provisioning a voice number during onboarding.'
       )
       RETURNING id`
    );
    let signupProgress = await getSalesSignupInvitation(
      pool,
      invitation.invitation.invitationId
    );
    assert.equal(signupProgress.provisioningStatus, "provisioning");
    assert.equal(signupProgress.accountStatus, "provisioning");
    assert.equal(signupProgress.attentionRequired, false);

    await pool.query(
      `UPDATE provisioning_jobs
       SET status = 'failed',
           status_detail = 'Voice number provisioning failed.',
           error_code = 'provider_unavailable',
           error_message = 'Provider unavailable.',
           updated_at = NOW()
       WHERE id = $1`,
      [provisioningJob.rows[0].id]
    );
    await pool.query(
      `UPDATE tenants
       SET telnyx_voice_status = 'failed'
       WHERE tenant_key = 'second_service'`
    );
    signupProgress = await getSalesSignupInvitation(
      pool,
      invitation.invitation.invitationId
    );
    assert.equal(signupProgress.provisioningStatus, "failed");
    assert.equal(signupProgress.accountStatus, "attention_required");
    assert.equal(signupProgress.attentionRequired, true);
    assert.equal(signupProgress.provisioningErrorCode, "provider_unavailable");

    await pool.query(
      `UPDATE provisioning_jobs
       SET status = 'done',
           status_detail = 'Provisioned +12065550199.',
           error_code = NULL,
           error_message = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [provisioningJob.rows[0].id]
    );
    await pool.query(
      `UPDATE tenants
       SET telnyx_voice_number = '+12065550199',
           telnyx_voice_status = 'provisioning'
       WHERE tenant_key = 'second_service'`
    );
    signupProgress = await getSalesSignupInvitation(
      pool,
      invitation.invitation.invitationId
    );
    assert.equal(signupProgress.provisioningStatus, "completed");
    assert.equal(signupProgress.accountStatus, "account_ready");
    assert.equal(signupProgress.attentionRequired, false);
    assert.equal(signupProgress.provisionedNumber, "+12065550199");
    const signupFollowup = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM sales_followup_jobs
       WHERE prospect_id = $1 AND outcome = 'signup_completed'`,
      [secondId]
    );
    assert.equal(signupFollowup.rows[0].count, 1);

    await pool.query(
      `UPDATE sales_demo_profiles
       SET status = 'ready',
           business_name = 'Expired private demo data',
           preview_summary = 'Must be cleared',
           demo_bundle_json = '{"private":"stale"}'::jsonb,
           scrape_page_count = 1,
           scrape_pages_json = '[{"text":"stale"}]'::jsonb,
           extraction_version = 'expired',
           expires_at = NOW() - INTERVAL '1 minute'
       WHERE prospect_id = $1`,
      [secondId]
    );
    const expiry = await markExpiredSalesDemoProfiles(pool);
    assert.equal(expiry.expiredCount, 1);
    const expiredProfile = await pool.query(
      `SELECT status, business_name, preview_summary, demo_bundle_json,
              scrape_page_count, scrape_pages_json, extraction_version
       FROM sales_demo_profiles
       WHERE prospect_id = $1`,
      [secondId]
    );
    assert.equal(expiredProfile.rows[0].status, "stale");
    assert.equal(expiredProfile.rows[0].business_name, null);
    assert.equal(expiredProfile.rows[0].preview_summary, null);
    assert.deepEqual(expiredProfile.rows[0].demo_bundle_json, {});
    assert.equal(expiredProfile.rows[0].scrape_page_count, 0);
    assert.deepEqual(expiredProfile.rows[0].scrape_pages_json, []);
    assert.equal(expiredProfile.rows[0].extraction_version, null);

    const managedProspect = await createSalesProspect(pool, {
      external_ref: "prospect-management-validation",
      business_name: "Managed Prospect",
      contact_name: "Pat Manager",
      phone: "206-555-0198",
      website: "https://managed.example",
      timezone: "America/Los_Angeles",
      permission: "yes",
      email_permission: "no"
    }, { adminUserId });
    assert.equal(managedProspect.businessName, "Managed Prospect");
    const editedProspect = await updateSalesProspect(pool, managedProspect.prospectId, {
      businessName: "Managed Prospect Updated",
      expectedRowVersion: managedProspect.rowVersion
    });
    assert.equal(editedProspect.businessName, "Managed Prospect Updated");
    await assert.rejects(
      updateSalesProspect(pool, managedProspect.prospectId, {
        businessName: "Stale Update",
        expectedRowVersion: managedProspect.rowVersion
      }),
      (error) => error?.code === "prospect_version_conflict"
    );
    await pool.query(
      `INSERT INTO sales_followup_jobs (
         sales_followup_job_id, prospect_id, outcome, status
       ) VALUES ('management-followup', $1, 'callback_requested', 'queued')`,
      [managedProspect.prospectId]
    );
    const removedProspect = await removeSalesProspect(pool, managedProspect.prospectId, {
      expectedRowVersion: editedProspect.rowVersion
    });
    assert.equal(removedProspect.status, "deleted");
    assert.equal(removedProspect.suppressed, true);
    assert.equal(removedProspect.doNotCall, true);
    const canceledFollowup = await pool.query(
      `SELECT status FROM sales_followup_jobs WHERE sales_followup_job_id = 'management-followup'`
    );
    assert.equal(canceledFollowup.rows[0].status, "canceled");
    const activeManagementList = await listSalesProspects(pool, { limit: 250 });
    assert.equal(activeManagementList.prospects.some((item) => item.prospectId === managedProspect.prospectId), false);
    const listIncludingRemoved = await listSalesProspects(pool, { limit: 250, includeDeleted: true });
    assert.equal(listIncludingRemoved.prospects.some((item) => item.prospectId === managedProspect.prospectId), true);

    const tables = await pool.query(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename LIKE 'sales_%'`
    );
    const tableNames = new Set(tables.rows.map((row) => row.tablename));
    for (const required of [
      "sales_prospects",
      "sales_demo_profiles",
      "sales_demo_jobs",
      "sales_call_sessions",
      "sales_call_events",
      "sales_followup_jobs",
      "sales_email_events",
      "sales_signup_invitations"
    ]) {
      assert.equal(tableNames.has(required), true, `missing ${required}`);
    }

    console.log("sales database validation passed");
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
