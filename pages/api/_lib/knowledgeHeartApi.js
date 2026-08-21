import { requireSession, resolveTenantKey } from "./auth.js";
import { requireTenantBillingAccess, requireTenantRoles } from "./billing.js";
import { ensureTables, getPool } from "./db.js";
import { explainKnowledgeHeartValidation } from "./knowledgeHeartCatalog.js";

export function failKnowledgeHeart(res, status, error, message, extra = {}) {
  return res.status(status).json({ ok: false, error, message, ...extra });
}

export async function prepareKnowledgeHeartRequest(req, res, {
  mutation = false,
  allowedMethods = []
} = {}) {
  if (allowedMethods.length && !allowedMethods.includes(req.method)) {
    res.setHeader("Allow", allowedMethods.join(", "));
    failKnowledgeHeart(res, 405, "method_not_allowed", "Method not allowed.");
    return null;
  }
  const pool = getPool();
  if (!pool) {
    failKnowledgeHeart(res, 500, "database_unavailable", "Database is unavailable.");
    return null;
  }
  await ensureTables(pool);
  const session = await requireSession(req, res);
  if (!session) return null;
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const tenantKey = resolveTenantKey(session, String(req.query?.tenantKey || body?.tenantKey || ""));
  if (session.role === "tenant") {
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return null;
  }
  if (mutation) {
    const manager = await requireTenantRoles(res, session, ["owner", "admin"], {
      message: "Only account admins and owners can change what the receptionist knows by heart."
    });
    if (!manager) return null;
  }
  const actor = session.user_id
    ? `${session.role || "tenant"}:${session.user_id}`
    : `${session.role || "tenant"}:session`;
  const requestId = String(req.headers?.["x-request-id"] || req.headers?.["x-vercel-id"] || "").trim();
  const idempotencyKey = String(req.headers?.["idempotency-key"] || body?.idempotency_key || body?.idempotencyKey || "").trim();
  return { pool, session, tenantKey, actor, requestId, idempotencyKey, body };
}

export function handleKnowledgeHeartError(res, error) {
  const message = String(error?.message || "unknown");
  const status = Number(error?.statusCode || 0)
    || (message.includes("not_found") ? 404 : 0)
    || (message.includes("conflict") || message.includes("stale") ? 409 : 0)
    || (message.includes("invalid") || message.includes("required") || message.includes("forbidden") ? 422 : 0)
    || 500;
  const code = message.split(":")[0] || "knows_by_heart_error";
  const validationReasons = Array.isArray(error?.validationReasons) ? error.validationReasons : [];
  return failKnowledgeHeart(
    res,
    status,
    code,
    error?.reason || (validationReasons.length
      ? validationReasons.map(explainKnowledgeHeartValidation).join(" ")
      : message),
    {
      ...(error?.routeTo ? { routeTo: error.routeTo } : {}),
      ...(error?.currentVersion != null ? { currentSelectionVersion: error.currentVersion } : {}),
      ...(error?.conflicts ? { conflicts: error.conflicts } : {}),
      ...(validationReasons.length ? { validationReasons } : {})
    }
  );
}

export function requirePostIdempotency(context, res) {
  if (context?.idempotencyKey) return true;
  failKnowledgeHeart(res, 400, "idempotency_key_required", "Send an Idempotency-Key header with this request.");
  return false;
}
