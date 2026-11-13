import {
  getSalesProspect,
  normalizeSalesText,
  updateSalesProspectEmailState
} from "./salesRepository.js";
import { routeSalesOutcomeToSmartlead } from "./salesSmartlead.js";

// These operations stop provider outreach; conversion must not discard an
// outstanding opt-out or the pause of an already-running sales campaign.
const TERMINAL_PROVIDER_OUTCOMES = ['do_not_call','signup_completed','not_interested','wrong_number'];

function serializeJob(row) {
  if (!row) return null;
  return {
    jobId: row.sales_followup_job_id,
    prospectId: row.prospect_id,
    salesCallId: row.sales_call_id || null,
    outcome: row.outcome,
    status: row.status,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    lockedBy:row.locked_by,lockedAt:row.locked_at
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
       SET status='reconciliation_required',last_error_code='provider_outcome_unknown',updated_at=NOW()
       WHERE status='leased' AND locked_at<NOW()-($1::text||' minutes')::interval`,
      [String(Math.max(1, Number(leaseMinutes) || 10))]
    );
    const result = await client.query(
      `WITH claimable AS (
         SELECT sales_followup_job_id
         FROM sales_followup_jobs
         WHERE status = 'queued'
           AND (outcome=ANY($3::text[]) OR NOT EXISTS(SELECT 1 FROM sales_prospects p WHERE p.prospect_id=sales_followup_jobs.prospect_id AND p.status='paid'))
           AND available_at <= NOW()
           AND attempts=0 AND attempts < max_attempts
           AND locked_at IS NULL AND locked_by IS NULL AND provider_result_json='{}'::jsonb
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
        normalizeSalesText(workerId, 200),
        TERMINAL_PROVIDER_OUTCOMES
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
     WHERE sales_followup_job_id=$1 AND status='leased' AND locked_by=$3 AND attempts=$4`,
    [job.jobId, JSON.stringify(providerResult || {}),job.lockedBy,job.attempts]
  );
}

async function failJob(pool,job,error){
 // Provider acceptance is unknowable after a timeout. Preserve the lease and
 // attempt identity for reconciliation; never auto-replay or cancel as unsent.
 await pool.query(`UPDATE sales_followup_jobs SET status='reconciliation_required',last_error_code='provider_outcome_unknown',
  last_error_message=$2,updated_at=NOW() WHERE sales_followup_job_id=$1 AND status='leased' AND locked_by=$3 AND attempts=$4`,
 [job.jobId,normalizeSalesText(error?.message,1000)||'Provider outcome requires reconciliation',job.lockedBy,job.attempts]);
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

export async function processSalesFollowupJobs(pool,{workerId,limit=3,fetchImpl,route=routeSalesOutcomeToSmartlead}){
 const jobs=await claimJobs(pool,{workerId,limit});const results=[];
 for(const job of jobs){
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const current=(await client.query('SELECT * FROM sales_followup_jobs WHERE sales_followup_job_id=$1 FOR UPDATE',[job.jobId])).rows[0];
   if(current?.status!=='leased'||current.locked_by!==job.lockedBy||Number(current.attempts)!==job.attempts||new Date(current.locked_at).getTime()!==new Date(job.lockedAt).getTime()){
    await client.query('COMMIT');results.push({jobId:job.jobId,ok:false,error:'lease_changed'});continue;
   }
   // Conversion must acquire this same prospect lock. A provider attempt either
   // finishes before conversion or observes paid state and makes no new effect.
   const state=(await client.query('SELECT status FROM sales_prospects WHERE prospect_id=$1 FOR UPDATE',[job.prospectId])).rows[0];
   if(state?.status==='paid'&&!TERMINAL_PROVIDER_OUTCOMES.includes(job.outcome)){
    await failJob(client,job,Error('Paid conversion requires review of the preexisting attempt.'));
    await client.query('COMMIT');results.push({jobId:job.jobId,ok:false,error:'paid_conversion_reconciliation_required'});continue;
   }
   const prospect=await getSalesProspect(client,job.prospectId);
   if(!prospect)throw Error('Prospect not found for follow-up.');
   const providerResult=await route({prospect,outcome:job.outcome,fetchImpl});
   const summary=summarizeProviderResult(providerResult);
   await persistProviderState(client,prospect,job.outcome,summary);await completeJob(client,job,summary);
   await client.query('COMMIT');results.push({jobId:job.jobId,ok:true,providerResult:summary});
  }catch(error){await client.query('ROLLBACK');await failJob(client,job,error);results.push({jobId:job.jobId,ok:false,error:normalizeSalesText(error?.message,500)||'Follow-up failed.'});}
  finally{client.release();}
 }
 return {claimedCount:jobs.length,results};
}
