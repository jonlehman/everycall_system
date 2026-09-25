import crypto from "node:crypto";
import { performance } from "node:perf_hooks";

const DEFAULT_LEASE_SECONDS = 180;
const DEFAULT_HEARTBEAT_SECONDS = 30;
const HEARTBEAT_MAX_ATTEMPTS = 3;

async function beforeLeaseDeadline(operation, deadline) {
  const remainingMs = deadline - performance.now();
  if (!(remainingMs > 0)) throw new Error("knowledge_build_execution_lease_lost");
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => {
        if (performance.now() >= deadline) throw new Error("knowledge_build_execution_lease_lost");
        return operation();
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("knowledge_build_execution_lease_lost")), remainingMs);
      })
    ]);
    if (performance.now() >= deadline) throw new Error("knowledge_build_execution_lease_lost");
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function isTransientLeaseError(error) {
  const codes = new Set([
    "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN",
    "08000", "08003", "08006", "57P01", "57P02", "57P03"
  ]);
  const seen = new Set();
  for (let current = error; current && !seen.has(current); current = current.cause) {
    seen.add(current);
    if (codes.has(current.code)) return true;
  }
  return false;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function returnedRowCount(result) {
  return Array.isArray(result?.rows) ? result.rows.length : 0;
}

function affectedRowCount(result) {
  if (Number.isFinite(Number(result?.rowCount))) return Number(result.rowCount);
  if (Number.isFinite(Number(result?.affectedRows))) return Number(result.affectedRows);
  return returnedRowCount(result);
}

function boundedSeconds(value, fallback, { min, max }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function knowledgeBuildLeaseTiming() {
  const leaseSeconds = boundedSeconds(
    process.env.KNOWLEDGE_BUILD_EXECUTION_LEASE_SECONDS,
    DEFAULT_LEASE_SECONDS,
    { min: 60, max: 900 }
  );
  const heartbeatSeconds = boundedSeconds(
    process.env.KNOWLEDGE_BUILD_EXECUTION_HEARTBEAT_SECONDS,
    DEFAULT_HEARTBEAT_SECONDS,
    { min: 10, max: Math.max(10, Math.floor(leaseSeconds / 2)) }
  );
  return { leaseSeconds, heartbeatSeconds };
}

export function createKnowledgeBuildLeaseToken() {
  return `klease_${Date.now()}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function claimKnowledgeBuildExecutionLease(db, {
  tenantKey,
  buildId,
  owner,
  token = createKnowledgeBuildLeaseToken(),
  leaseSeconds = knowledgeBuildLeaseTiming().leaseSeconds
} = {}) {
  const normalizedTenantKey = normalizeText(tenantKey);
  const normalizedBuildId = normalizeText(buildId);
  const normalizedOwner = normalizeText(owner) || "knowledge-build-worker";
  const normalizedToken = normalizeText(token);
  if (!normalizedTenantKey || !normalizedBuildId || !normalizedToken) {
    throw new Error("knowledge_build_lease_target_required");
  }

  const result = await db.query(
    `UPDATE knowledge_builds
     SET execution_lease_token = $3,
         execution_lease_owner = $4,
         execution_lease_acquired_at = NOW(),
         execution_lease_heartbeat_at = NOW(),
         execution_lease_expires_at = NOW() + ($5::double precision * INTERVAL '1 second'),
         execution_attempt_count = execution_attempt_count + 1,
         updated_at = NOW()
     WHERE tenant_key = $1
       AND build_id = $2
       AND status IN ('queued', 'running', 'ready_to_publish')
       AND (
         execution_lease_token IS NULL
         OR execution_lease_expires_at IS NULL
         OR execution_lease_expires_at <= NOW()
       )
     RETURNING build_id, tenant_key, status, execution_lease_token, execution_lease_owner,
               execution_lease_acquired_at, execution_lease_heartbeat_at,
               execution_lease_expires_at, execution_attempt_count`,
    [normalizedTenantKey, normalizedBuildId, normalizedToken, normalizedOwner, Number(leaseSeconds)]
  );

  return {
    acquired: returnedRowCount(result) === 1,
    token: returnedRowCount(result) === 1 ? normalizedToken : "",
    lease: result.rows?.[0] || null
  };
}

export async function heartbeatKnowledgeBuildExecutionLease(db, {
  tenantKey,
  buildId,
  token,
  leaseSeconds = knowledgeBuildLeaseTiming().leaseSeconds
} = {}) {
  const result = await db.query(
    `UPDATE knowledge_builds
     SET execution_lease_heartbeat_at = NOW(),
         execution_lease_expires_at = NOW() + ($4::double precision * INTERVAL '1 second'),
         updated_at = NOW()
     WHERE tenant_key = $1
       AND build_id = $2
       AND execution_lease_token = $3
       AND execution_lease_expires_at > NOW()
     RETURNING status, execution_lease_expires_at`,
    [normalizeText(tenantKey), normalizeText(buildId), normalizeText(token), Number(leaseSeconds)]
  );
  return { owned: returnedRowCount(result) === 1, row: result.rows?.[0] || null };
}

export async function assertKnowledgeBuildExecutionLease(db, { tenantKey, buildId, token } = {}) {
  const result = await db.query(
    `SELECT status
     FROM knowledge_builds
     WHERE tenant_key = $1
       AND build_id = $2
       AND execution_lease_token = $3
       AND execution_lease_expires_at > NOW()
     LIMIT 1`,
    [normalizeText(tenantKey), normalizeText(buildId), normalizeText(token)]
  );
  if (returnedRowCount(result) !== 1) throw new Error("knowledge_build_execution_lease_lost");
  return result.rows[0];
}

export async function releaseKnowledgeBuildExecutionLease(db, { tenantKey, buildId, token } = {}) {
  const result = await db.query(
    `UPDATE knowledge_builds
     SET execution_lease_token = NULL,
         execution_lease_owner = NULL,
         execution_lease_acquired_at = NULL,
         execution_lease_heartbeat_at = NULL,
         execution_lease_expires_at = NULL
     WHERE tenant_key = $1
       AND build_id = $2
       AND execution_lease_token = $3`,
    [normalizeText(tenantKey), normalizeText(buildId), normalizeText(token)]
  );
  return affectedRowCount(result) === 1;
}

export async function markKnowledgeBuildFailedIfLeaseOwned(db, {
  tenantKey,
  buildId,
  token,
  failureMessages = [],
  allowUnleasedForValidation = false
} = {}) {
  const normalizedToken = normalizeText(token);
  if (!normalizedToken && allowUnleasedForValidation !== true) {
    throw new Error("knowledge_build_execution_lease_required");
  }
  const result = await db.query(
    `UPDATE knowledge_builds
     SET status = 'failed',
         warnings_json = $4::jsonb,
         updated_at = NOW()
     WHERE tenant_key = $1
       AND build_id = $2
       AND status IN ('queued', 'running', 'ready_to_publish')
       AND (
         ($3 <> '' AND execution_lease_token = $3 AND execution_lease_expires_at > NOW())
         OR ($3 = '' AND execution_lease_token IS NULL)
       )
     RETURNING build_id`,
    [
      normalizeText(tenantKey),
      normalizeText(buildId),
      normalizedToken,
      JSON.stringify(Array.isArray(failureMessages) ? failureMessages : [])
    ]
  );
  return returnedRowCount(result) === 1;
}

export async function withKnowledgeBuildExecutionLease(db, {
  tenantKey,
  buildId,
  owner,
  leaseSeconds = knowledgeBuildLeaseTiming().leaseSeconds,
  heartbeatSeconds = knowledgeBuildLeaseTiming().heartbeatSeconds
} = {}, work) {
  const claimStartedAt = performance.now();
  const claim = await claimKnowledgeBuildExecutionLease(db, {
    tenantKey,
    buildId,
    owner,
    leaseSeconds
  });
  if (!claim.acquired) return { acquired: false, result: null };

  let heartbeatInFlight = null;
  let heartbeatQueryInFlight = null;
  let heartbeatError = null;
  let stopped = false;
  // Query-start time is conservative even with clock skew or a slow DB response.
  // Only an acknowledged renewal advances this deadline; an ambiguous write does not.
  let confirmedUntil = claimStartedAt + Number(leaseSeconds) * 1000;
  const leaseLost = () => new Error("knowledge_build_execution_lease_lost");
  const renew = async () => {
    for (let attempt = 0; attempt < HEARTBEAT_MAX_ATTEMPTS; attempt += 1) {
      if (stopped) return { owned: false, row: null };
      if (performance.now() >= confirmedUntil) throw leaseLost();
      const startedAt = performance.now();
      try {
        const result = await beforeLeaseDeadline(() => {
          heartbeatQueryInFlight = heartbeatKnowledgeBuildExecutionLease(db, {
            tenantKey,
            buildId,
            token: claim.token,
            leaseSeconds
          }).finally(() => { heartbeatQueryInFlight = null; });
          return heartbeatQueryInFlight;
        }, confirmedUntil);
        if (!result.owned) throw leaseLost();
        confirmedUntil = startedAt + Number(leaseSeconds) * 1000;
        if (performance.now() >= confirmedUntil) throw leaseLost();
        return result;
      } catch (error) {
        const delayMs = 250 * (2 ** attempt);
        if (stopped || !isTransientLeaseError(error)
          || attempt + 1 >= HEARTBEAT_MAX_ATTEMPTS
          || performance.now() + delayMs >= confirmedUntil) throw error;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  };
  const heartbeat = async () => {
    if (heartbeatInFlight) return heartbeatInFlight;
    if (stopped || heartbeatError) return { owned: false, row: null };
    heartbeatInFlight = renew().catch((error) => {
      heartbeatError = error;
      return { owned: false, row: null };
    }).finally(() => {
      heartbeatInFlight = null;
    });
    return heartbeatInFlight;
  };
  const checkHeartbeat = async () => {
    if (performance.now() >= confirmedUntil) heartbeatError ||= leaseLost();
    if (heartbeatInFlight) await heartbeatInFlight;
    if (heartbeatError) throw heartbeatError;
    if (stopped || performance.now() >= confirmedUntil) throw leaseLost();
  };
  const assertOwned = async () => {
    await checkHeartbeat();
    const result = await beforeLeaseDeadline(() => assertKnowledgeBuildExecutionLease(db, {
      tenantKey,
      buildId,
      token: claim.token
    }), confirmedUntil).catch((error) => {
      heartbeatError ||= error;
      throw error;
    });
    await checkHeartbeat();
    return result;
  };
  const timer = setInterval(() => {
    void heartbeat();
  }, Math.max(1, Number(heartbeatSeconds)) * 1000);
  if (typeof timer.unref === "function") timer.unref();

  try {
    const result = await work({ token: claim.token, lease: claim.lease, assertOwned, heartbeat });
    clearInterval(timer);
    await checkHeartbeat();
    return { acquired: true, result };
  } finally {
    stopped = true;
    clearInterval(timer);
    if (heartbeatInFlight) await heartbeatInFlight;
    // A deadline bounds our wait, not the SQL itself. Never release alongside an
    // unresolved renewal or interpret its late acknowledgement as recovered work.
    // Let that fenced lease expire instead; the stale query cannot touch a new token.
    if (!heartbeatQueryInFlight) {
      await beforeLeaseDeadline(() => releaseKnowledgeBuildExecutionLease(db, {
        tenantKey,
        buildId,
        token: claim.token
      }), Math.min(confirmedUntil, performance.now() + 5000)).catch(() => {});
    }
  }
}
