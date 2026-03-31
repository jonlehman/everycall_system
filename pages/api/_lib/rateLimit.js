function normalizeText(value) {
  return String(value || "").trim();
}

function clampInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

export function getClientIp(req) {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "")
    .split(",")
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
  if (forwarded.length) {
    return forwarded[0];
  }
  return normalizeText(
    req?.headers?.["x-real-ip"]
    || req?.socket?.remoteAddress
    || req?.connection?.remoteAddress
  ) || "unknown";
}

export async function consumeRateLimit(pool, {
  scope,
  key,
  maxHits,
  windowMs,
  blockDurationMs = null
}) {
  const normalizedScope = normalizeText(scope).slice(0, 120);
  const normalizedKey = normalizeText(key).slice(0, 240);
  if (!pool || !normalizedScope || !normalizedKey) {
    return {
      allowed: true,
      limited: false,
      remaining: null,
      retryAfterSeconds: null
    };
  }

  const safeMaxHits = clampInteger(maxHits, 5, 1, 1000);
  const safeWindowMs = clampInteger(windowMs, 60_000, 1_000, 24 * 60 * 60 * 1000);
  const safeBlockDurationMs = clampInteger(blockDurationMs ?? safeWindowMs, safeWindowMs, 1_000, 7 * 24 * 60 * 60 * 1000);
  const windowInterval = `${safeWindowMs} milliseconds`;
  const blockInterval = `${safeBlockDurationMs} milliseconds`;

  const result = await pool.query(
    `INSERT INTO request_rate_limits (
       scope,
       rate_limit_key,
       window_started_at,
       hits,
       blocked_until,
       updated_at
     )
     VALUES ($1, $2, NOW(), 1, NULL, NOW())
     ON CONFLICT (scope, rate_limit_key)
     DO UPDATE SET
       window_started_at = CASE
         WHEN request_rate_limits.blocked_until IS NOT NULL
              AND request_rate_limits.blocked_until > NOW()
           THEN request_rate_limits.window_started_at
         WHEN request_rate_limits.window_started_at <= NOW() - $3::interval
           THEN NOW()
         ELSE request_rate_limits.window_started_at
       END,
       hits = CASE
         WHEN request_rate_limits.blocked_until IS NOT NULL
              AND request_rate_limits.blocked_until > NOW()
           THEN request_rate_limits.hits
         WHEN request_rate_limits.window_started_at <= NOW() - $3::interval
           THEN 1
         ELSE request_rate_limits.hits + 1
       END,
       blocked_until = CASE
         WHEN request_rate_limits.blocked_until IS NOT NULL
              AND request_rate_limits.blocked_until > NOW()
           THEN request_rate_limits.blocked_until
         WHEN request_rate_limits.window_started_at <= NOW() - $3::interval
           THEN NULL
         WHEN request_rate_limits.hits + 1 > $4
           THEN NOW() + $5::interval
         ELSE NULL
       END,
       updated_at = NOW()
     RETURNING window_started_at, hits, blocked_until`,
    [normalizedScope, normalizedKey, windowInterval, safeMaxHits, blockInterval]
  );

  const row = result.rows[0] || {};
  const blockedUntil = row.blocked_until ? new Date(row.blocked_until).getTime() : 0;
  const now = Date.now();
  const limited = Number.isFinite(blockedUntil) && blockedUntil > now;
  const retryAfterSeconds = limited
    ? Math.max(1, Math.ceil((blockedUntil - now) / 1000))
    : null;
  const remaining = limited
    ? 0
    : Math.max(0, safeMaxHits - Number(row.hits || 0));

  return {
    allowed: !limited,
    limited,
    remaining,
    retryAfterSeconds,
    maxHits: safeMaxHits,
    windowMs: safeWindowMs
  };
}

export async function enforceRateLimit(res, pool, config = {}) {
  const result = await consumeRateLimit(pool, config);
  if (!result.limited) {
    return result;
  }
  if (result.retryAfterSeconds) {
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
  }
  res.status(429).json({
    error: "rate_limited",
    message: normalizeText(config?.message) || "Too many requests. Please try again soon."
  });
  return result;
}
