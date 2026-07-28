import {
  getSalesProspect,
  normalizeSalesText,
  updateSalesProspectEmailState
} from "./salesRepository.js";
import { routeSalesOutcomeToSmartlead } from "./salesSmartlead.js";

function serializeJob(row) {
  if (!row) return null;
  return {
    jobId: row.sales_followup_job_id,
    prospectId: row.prospect_id,
    salesCallId: row.sales_call_id || null,
    outcome: row.outcome,
    status: row.status,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0)
  };
}

function summarizeProviderResult(result = {}) {
  return {
    ok: result?.ok === true,
    routed: result?.routed === true,
    paused: result?.paused === true,
    suppressed: result?.suppressed === true,
    reason: normalizeSalesText(result?.reason, 120) || null,
    method: normalizeSalesText(result?.method, 80) || null,
    campaignId: result?.campaignId || null,
    leadId: result?.leadId || null
  };
}

async function claimJobs(pool, {
  workerId,
  limit = 3,
  leaseMinutes = 10
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE sales_followup_jobs
       SET status = 'queued',
           locked_at = NULL,
           locked_by = NULL,
           available_at = NOW(),
           updated_at = NOW()
       WHERE status = 'leased'
         AND locked_at < NOW() - ($1::text || ' minutes')::interval`,
      [String(Math.max(1, Number(leaseMinutes) || 10))]
    );
    const result = await client.query(
      `WITH claimable AS (
         SELECT sales_followup_job_id
         FROM sales_followup_jobs
         WHERE status = 'queued'
           AND available_at <= NOW()
           AND attempts < max_attempts
         ORDER BY available_at ASC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE sales_followup_jobs jobs
       SET status = 'leased',
           attempts = jobs.attempts + 1,
           locked_at = NOW(),
           locked_by = $2,
           updated_at = NOW()
       FROM claimable
       WHERE jobs.sales_followup_job_id = claimable.sales_followup_job_id
       RETURNING jobs.*`,
      [
        Math.min(10, Math.max(1, Number(limit) || 3)),
        normalizeSalesText(workerId, 200)
      ]
    );
    await client.query("COMMIT");
    return result.rows.map(serializeJob);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function completeJob(pool, job, providerResult) {
  await pool.query(
    `UPDATE sales_followup_jobs
     SET status = 'completed',
         completed_at = NOW(),
         locked_at = NULL,
         locked_by = NULL,
         provider_result_json = $2::jsonb,
         last_error_code = NULL,
         last_error_message = NULL,
         updated_at = NOW()
     WHERE sales_followup_job_id = $1`,
    [job.jobId, JSON.stringify(providerResult || {})]
  );
}

async function failJob(pool, job, error) {
  const exhausted = job.attempts >= job.maxAttempts;
  const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, job.attempts - 1)));
  await pool.query(
    `UPDATE sales_followup_jobs
     SET status = $2,
         available_at = CASE
           WHEN $2 = 'queued' THEN NOW() + ($3::text || ' seconds')::interval
           ELSE available_at
         END,
         completed_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE NULL END,
         locked_at = NULL,
         locked_by = NULL,
         last_error_code = $4,
         last_error_message = $5,
         updated_at = NOW()
     WHERE sales_followup_job_id = $1`,
    [
      job.jobId,
      exhausted ? "failed" : "queued",
      String(delaySeconds),
      normalizeSalesText(error?.code, 120) || "smartlead_followup_failed",
      normalizeSalesText(error?.message, 1000) || "Smartlead follow-up failed."
    ]
  );
}

async function persistProviderState(pool, prospect, outcome, providerResult) {
  if (!prospect?.contactEmail) return;
  const changes = {
    smartleadStatus: providerResult?.routed
      ? "active"
      : providerResult?.paused
        ? "paused"
        : providerResult?.suppressed
          ? "unsubscribed"
          : providerResult?.reason || outcome,
    lastEmailEventAt: new Date().toISOString()
  };
  if (providerResult?.leadId) changes.smartleadLeadId = providerResult.leadId;
  if (providerResult?.campaignId) changes.smartleadCampaignId = providerResult.campaignId;
  if (outcome === "do_not_call") {
    changes.emailSuppressed = true;
    changes.emailSuppressionReason = "do_not_call";
  }
  await updateSalesProspectEmailState(pool, prospect.contactEmail, changes);
}

export async function processSalesFollowupJobs(pool, {
  workerId,
  limit = 3,
  fetchImpl
}) {
  const jobs = await claimJobs(pool, { workerId, limit });
  const results = [];
  for (const job of jobs) {
    try {
      const prospect = await getSalesProspect(pool, job.prospectId);
      if (!prospect) {
        const error = new Error("Prospect not found for follow-up.");
        error.code = "prospect_not_found";
        throw error;
      }
      const providerResult = await routeSalesOutcomeToSmartlead({
        prospect,
        outcome: job.outcome,
        fetchImpl
      });
      const providerSummary = summarizeProviderResult(providerResult);
      await persistProviderState(pool, prospect, job.outcome, providerSummary);
      await completeJob(pool, job, providerSummary);
      results.push({ jobId: job.jobId, ok: true, providerResult: providerSummary });
    } catch (error) {
      await failJob(pool, job, error);
      results.push({
        jobId: job.jobId,
        ok: false,
        error: normalizeSalesText(error?.message, 500) || "Follow-up failed."
      });
    }
  }
  return { claimedCount: jobs.length, results };
}
