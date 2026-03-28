function normalizeText(value) {
  return String(value || "").trim();
}

export async function updateNotificationChannelHealth(pool, {
  tenantKey,
  channel,
  destination,
  status,
  errorCode = null,
  errorMessage = null
}) {
  const attemptedAt = new Date().toISOString();
  await pool.query(
    `INSERT INTO notification_channel_health (
       tenant_key,
       channel,
       destination,
       status,
       last_attempted_at,
       last_succeeded_at,
       last_failed_at,
       last_error_code,
       last_error_message,
       updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5::timestamptz,
       CASE WHEN $4 = 'functioning' THEN $5::timestamptz ELSE NULL END,
       CASE WHEN $4 = 'non_functioning' THEN $5::timestamptz ELSE NULL END,
       $6, $7, NOW()
     )
     ON CONFLICT (tenant_key, channel, destination)
     DO UPDATE SET
       status = EXCLUDED.status,
       last_attempted_at = EXCLUDED.last_attempted_at,
       last_succeeded_at = CASE
         WHEN EXCLUDED.status = 'functioning' THEN EXCLUDED.last_attempted_at
         ELSE notification_channel_health.last_succeeded_at
       END,
       last_failed_at = CASE
         WHEN EXCLUDED.status = 'non_functioning' THEN EXCLUDED.last_attempted_at
         ELSE notification_channel_health.last_failed_at
       END,
       last_error_code = EXCLUDED.last_error_code,
       last_error_message = EXCLUDED.last_error_message,
       updated_at = NOW()`,
    [
      normalizeText(tenantKey),
      normalizeText(channel),
      normalizeText(destination),
      normalizeText(status) || "unknown",
      attemptedAt,
      normalizeText(errorCode) || null,
      normalizeText(errorMessage) || null
    ]
  );
}
