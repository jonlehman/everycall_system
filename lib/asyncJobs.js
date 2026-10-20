import crypto from "node:crypto";

export const ASYNC_JOB_TYPES = {
  leadNotificationSend: "lead_notification.send",
  integrationWebhookSend: "integration.webhook_send",
  integrationConnectionSend: "integration.connection_send",
  callTranscriptAnalysis: "call_transcript.analysis",
  callBillingSync: "call_billing.sync"
};

function normalizeText(value) {
  return String(value || "").trim();
}

export async function enqueueAsyncJob(pool, {
  jobType,
  tenantKey = null,
  dedupeKey = null,
  payload = {},
  maxAttempts = 5,
  availableAt = null
}) {
  const normalizedJobType = normalizeText(jobType);
  if (!pool || !normalizedJobType) {
    throw new Error("async_job_requires_type");
  }

  const result = await pool.query(
    `INSERT INTO async_jobs (
       job_type,
       tenant_key,
       dedupe_key,
       payload_json,
       max_attempts,
       available_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4::jsonb, $5, COALESCE($6::timestamptz, NOW()), NOW())
     ON CONFLICT (job_type, dedupe_key)
     WHERE dedupe_key IS NOT NULL
     DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [
      normalizedJobType,
      normalizeText(tenantKey) || null,
      normalizeText(dedupeKey) || null,
      JSON.stringify(payload || {}),
      Number.isFinite(Number(maxAttempts)) ? Math.max(1, Math.round(Number(maxAttempts))) : 5,
      availableAt || null
    ]
  );
  return result.rows[0] || null;
}

const DEFAULT_LEASE_SECONDS = 180;
const LEGACY_CLAIM_GRACE_SECONDS = 900;

function leaseSeconds(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(30, Math.min(3600, parsed)) : DEFAULT_LEASE_SECONDS;
}

export async function claimAsyncJobs(pool, { workerId, jobTypes = [], limit = 5, leaseDurationSeconds = DEFAULT_LEASE_SECONDS }) {
  const types = (Array.isArray(jobTypes) ? jobTypes : []).map(normalizeText).filter(Boolean);
  // Expired claims count as attempts, including a process that died on its last
  // attempt. Legacy claims get a longer grace while old workers drain.
  await pool.query(
    `UPDATE async_jobs SET status = 'dead_letter', completed_at = NOW(),
       locked_at = NULL, locked_by = NULL, claim_token = COALESCE('retired:' || claim_token, 'retired:legacy:' || id::text), lease_expires_at = NULL,
       last_error = 'worker_lease_expired', updated_at = NOW()
     WHERE status = 'running' AND attempts >= max_attempts
       AND COALESCE(lease_expires_at, locked_at + ($2::int * interval '1 second'), updated_at + ($2::int * interval '1 second')) <= NOW()
       AND (cardinality($1::text[]) = 0 OR job_type = ANY($1::text[]))`,
    [types, LEGACY_CLAIM_GRACE_SECONDS]
  );
  const result = await pool.query(
    `WITH candidate AS (
       SELECT id FROM async_jobs
       WHERE (cardinality($2::text[]) = 0 OR job_type = ANY($2::text[]))
         AND attempts < max_attempts
         AND ((status = 'pending' AND available_at <= NOW())
           OR (status = 'running' AND COALESCE(lease_expires_at,
             locked_at + ($6::int * interval '1 second'), updated_at + ($6::int * interval '1 second')) <= NOW()))
       ORDER BY available_at, id LIMIT $3 FOR UPDATE SKIP LOCKED
     )
     UPDATE async_jobs jobs SET status = 'running', attempts = jobs.attempts + 1,
       locked_at = NOW(), locked_by = $1, claim_token = $4,
       lease_expires_at = NOW() + ($5::int * interval '1 second'), updated_at = NOW()
     FROM candidate WHERE jobs.id = candidate.id RETURNING jobs.*`,
    [normalizeText(workerId) || "worker", types, Math.max(1, Number(limit) || 1),
      crypto.randomUUID(), leaseSeconds(leaseDurationSeconds), LEGACY_CLAIM_GRACE_SECONDS]
  );
  return result.rows || [];
}

export async function heartbeatAsyncJob(pool, jobId, { claimToken, leaseDurationSeconds = DEFAULT_LEASE_SECONDS } = {}) {
  const result = await pool.query(
    `UPDATE async_jobs SET lease_expires_at = NOW() + ($3::int * interval '1 second'), updated_at = NOW()
     WHERE id = $1 AND status = 'running' AND claim_token = $2 AND lease_expires_at > NOW() RETURNING id`,
    [jobId, normalizeText(claimToken), leaseSeconds(leaseDurationSeconds)]
  );
  return result.rowCount > 0;
}

export async function releaseAsyncJob(pool, jobId, { claimToken } = {}) {
  const result = await pool.query(
    `UPDATE async_jobs SET status = 'pending', available_at = NOW(),
       attempts = GREATEST(attempts - 1, 0), locked_at = NULL, locked_by = NULL,
       claim_token = 'retired:' || claim_token, lease_expires_at = NULL, updated_at = NOW()
     WHERE id = $1 AND status = 'running' AND claim_token = $2 AND lease_expires_at > NOW() RETURNING id`,
    [jobId, normalizeText(claimToken)]
  );
  return result.rowCount > 0;
}

export async function completeAsyncJob(pool, jobId, { claimToken } = {}) {
  const result = await pool.query(
    `UPDATE async_jobs SET status = 'done', completed_at = NOW(), locked_at = NULL,
       locked_by = NULL, claim_token = 'retired:' || claim_token, lease_expires_at = NULL, last_error = NULL, updated_at = NOW()
     WHERE id = $1 AND status = 'running' AND claim_token = $2 AND lease_expires_at > NOW() RETURNING id`,
    [jobId, normalizeText(claimToken)]
  );
  return result.rowCount > 0;
}

export async function failAsyncJob(pool, jobId, { claimToken, errorMessage } = {}) {
  const result = await pool.query(
    `UPDATE async_jobs SET
       status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'pending' END,
       completed_at = CASE WHEN attempts >= max_attempts THEN NOW() ELSE NULL END,
       available_at = NOW() + (LEAST(900, 15 * power(2, LEAST(10, GREATEST(0, attempts - 1)))) * interval '1 second'),
       locked_at = NULL, locked_by = NULL, claim_token = 'retired:' || claim_token, lease_expires_at = NULL,
       last_error = $3, updated_at = NOW()
     WHERE id = $1 AND status = 'running' AND claim_token = $2 AND lease_expires_at > NOW() RETURNING id`,
    [jobId, normalizeText(claimToken), normalizeText(errorMessage) || "unknown"]
  );
  return result.rowCount > 0;
}
