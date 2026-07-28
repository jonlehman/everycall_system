import crypto from "node:crypto";
import { getAdminActor, requireSession } from "./auth.js";
import { buildAuditActor, writeAuditLog } from "./auditLog.js";
import { ensureTables, getPool } from "./db.js";
import {
  normalizeSalesText,
  runSalesIdempotentMutation,
  salesError
} from "./salesRepository.js";

export function salesRequestBody(req) {
  return req?.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body
    : {};
}

export function salesIdempotencyKey(req) {
  return normalizeSalesText(req?.headers?.["idempotency-key"], 240);
}

export async function requireSalesAdmin(req, res) {
  const pool = getPool();
  if (!pool) {
    res.status(500).json({ ok: false, error: "database_unavailable" });
    return null;
  }
  await ensureTables(pool);
  const session = await requireSession(req, res, { role: "admin" });
  if (!session) return null;
  const admin = await getAdminActor(session);
  if (!admin) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return null;
  }
  return { pool, session, admin };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length
    && leftBuffer.length > 0
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireSalesInternalSecret(req, res) {
  const configuredSecrets = [
    process.env.INTERNAL_SERVICE_SECRET,
    process.env.CRON_SECRET
  ].map((value) => normalizeSalesText(value, 1000)).filter(Boolean);
  if (!configuredSecrets.length) {
    res.status(503).json({ ok: false, error: "internal_auth_not_configured" });
    return false;
  }
  const authorization = normalizeSalesText(req?.headers?.authorization, 1200);
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const headerSecret = normalizeSalesText(req?.headers?.["x-internal-service-secret"], 1000);
  const supplied = bearer || headerSecret;
  if (!configuredSecrets.some((secret) => safeEqual(secret, supplied))) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

export function salesAppBaseUrl() {
  const configured = normalizeSalesText(
    process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL,
    1000
  );
  if (!configured) {
    throw salesError(
      "sales_app_base_url_not_configured",
      "APP_BASE_URL is required to create signup links.",
      503
    );
  }
  try {
    const parsed = new URL(configured);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid_protocol");
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    throw salesError(
      "sales_app_base_url_invalid",
      "APP_BASE_URL must be a valid HTTP or HTTPS URL.",
      503
    );
  }
}

export async function runSalesAdminMutation(req, context, {
  scope,
  request,
  action,
  auditDetails = null
}, callback) {
  const result = await runSalesIdempotentMutation(context.pool, {
    adminUserId: context.admin.id,
    scope,
    idempotencyKey: salesIdempotencyKey(req),
    request
  }, async () => {
    const response = await callback();
    if (action) {
      await writeAuditLog(context.pool, {
        actor: buildAuditActor({
          session: context.session,
          admin: context.admin
        }),
        action,
        details: typeof auditDetails === "function"
          ? auditDetails(response)
          : auditDetails
      });
    }
    return response;
  });
  return result;
}

export async function writeSalesAdminAudit(context, action, details = null) {
  await writeAuditLog(context.pool, {
    actor: buildAuditActor({
      session: context.session,
      admin: context.admin
    }),
    action,
    details
  });
}

export function sendSalesApiError(res, error, fallback = "sales_request_failed") {
  const status = Number(error?.statusCode || 500) || 500;
  return res.status(status).json({
    ok: false,
    error: normalizeSalesText(error?.code, 160) || fallback,
    message: normalizeSalesText(error?.message, 1000) || "Request failed.",
    ...(error?.details ? { details: error.details } : {})
  });
}
