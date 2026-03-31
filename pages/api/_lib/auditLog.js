function normalizeText(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function buildAuditActor({ session = null, admin = null, tenantUser = null, fallback = "system" } = {}) {
  if (admin?.id) {
    return `admin:${admin.id}`;
  }
  if (tenantUser?.isPlatformAdmin && tenantUser?.id) {
    return `admin:${tenantUser.id}`;
  }
  if (tenantUser?.id) {
    return `tenant:${tenantUser.id}`;
  }
  if (session?.role === "admin" && session?.user_id) {
    return `admin:${session.user_id}`;
  }
  if (session?.role === "tenant" && session?.user_id) {
    return `tenant:${session.user_id}`;
  }
  return normalizeText(fallback) || "system";
}

export async function writeAuditLog(pool, {
  tenantKey = null,
  actor = "system",
  action,
  details = null
}) {
  const normalizedAction = normalizeText(action);
  if (!pool || !normalizedAction) return;
  await pool.query(
    `INSERT INTO audit_log (tenant_key, actor, action, details)
     VALUES ($1, $2, $3, $4)`,
    [
      normalizeText(tenantKey) || null,
      normalizeText(actor) || "system",
      normalizedAction,
      details ? JSON.stringify(asObject(details)) : null
    ]
  );
}
