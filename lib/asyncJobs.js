export const ASYNC_JOB_TYPES = {
  leadNotificationSend: "lead_notification.send"
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

export async function claimAsyncJobs(pool, {
  workerId,
  jobTypes = [],
  limit = 5
}) {
  const normalizedWorkerId = normalizeText(workerId) || "worker";
  const normalizedTypes = (Array.isArray(jobTypes) ? jobTypes : [])
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const query = normalizedTypes.length
    ? `WITH candidate AS (
         SELECT id
         FROM async_jobs
         WHERE status = 'pending'
           AND available_at <= NOW()
           AND job_type = ANY($2::text[])
         ORDER BY available_at ASC, id ASC
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       )
       UPDATE async_jobs jobs
       SET status = 'running',
           attempts = jobs.attempts + 1,
           locked_at = NOW(),
           locked_by = $1,
           updated_at = NOW()
       FROM candidate
       WHERE jobs.id = candidate.id
       RETURNING jobs.*`
    : `WITH candidate AS (
         SELECT id
         FROM async_jobs
         WHERE status = 'pending'
           AND available_at <= NOW()
         ORDER BY available_at ASC, id ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE async_jobs jobs
       SET status = 'running',
           attempts = jobs.attempts + 1,
           locked_at = NOW(),
           locked_by = $1,
           updated_at = NOW()
       FROM candidate
       WHERE jobs.id = candidate.id
       RETURNING jobs.*`;
  const params = normalizedTypes.length
    ? [normalizedWorkerId, normalizedTypes, Math.max(1, Number(limit || 1))]
    : [normalizedWorkerId, Math.max(1, Number(limit || 1))];
  const result = await pool.query(query, params);
  return result.rows || [];
}

export async function completeAsyncJob(pool, jobId) {
  await pool.query(
    `UPDATE async_jobs
     SET status = 'done',
         completed_at = NOW(),
         locked_at = NULL,
         locked_by = NULL,
         last_error = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [jobId]
  );
}

function backoffSeconds(attempts) {
  return Math.min(900, Math.max(15, 15 * (2 ** Math.max(0, attempts - 1))));
}

export async function failAsyncJob(pool, jobId, {
  attempts,
  maxAttempts,
  errorMessage
}) {
  const normalizedError = normalizeText(errorMessage) || "unknown";
  const exhausted = Number(attempts || 0) >= Number(maxAttempts || 0);
  if (exhausted) {
    await pool.query(
      `UPDATE async_jobs
       SET status = 'dead_letter',
           completed_at = NOW(),
           locked_at = NULL,
           locked_by = NULL,
           last_error = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [jobId, normalizedError]
    );
    return;
  }

  await pool.query(
    `UPDATE async_jobs
     SET status = 'pending',
         available_at = NOW() + ($2::text || ' seconds')::interval,
         locked_at = NULL,
         locked_by = NULL,
         last_error = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [jobId, String(backoffSeconds(Number(attempts || 1))), normalizedError]
  );
}
