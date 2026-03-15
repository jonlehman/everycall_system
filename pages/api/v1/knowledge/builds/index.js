import { getPool } from "../../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../../_lib/auth.js";
import { requireTenantBillingAccess } from "../../../_lib/billing.js";
import {
  createKnowledgeBuild,
  listKnowledgeReceptionistBuilds
} from "../../../_lib/knowledgeReceptionistBuilds.js";

function normalizeAssignments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      domainId: String(item?.domainId || item?.domain_id || "").trim(),
      subdomainId: String(item?.subdomainId || item?.subdomain_id || "").trim()
    }))
    .filter((item) => item.domainId && item.subdomainId);
}

function getTenantKey(req) {
  return String(req.query?.tenantKey || req.body?.tenantKey || "");
}

function normalizeIdArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function fail(res, status, error, message, extra = {}) {
  return res.status(status).json({ ok: false, error, message, ...extra });
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return fail(res, 500, "database_unavailable", "Database is unavailable.");
    }

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, getTenantKey(req));
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return;

    if (req.method === "GET") {
      const data = await listKnowledgeReceptionistBuilds(pool, tenantKey);
      return res.status(200).json({ ok: true, ...data });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const buildResult = await createKnowledgeBuild(pool, tenantKey, {
        websiteUrl: body.websiteUrl || body.website_url,
        assignments: normalizeAssignments(body.assignments),
        uploadedDocumentIds: normalizeIdArray(body.uploadedDocumentIds || body.uploaded_document_ids),
        setupInterviewSessionIds: normalizeIdArray(body.setupInterviewSessionIds || body.setup_interview_session_ids)
      });
      return res.status(200).json({ ok: true, ...buildResult });
    }

    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method_not_allowed", "Method not allowed.");
  } catch (err) {
    const message = String(err?.message || "unknown");
    if (message === "knowledge_receptionist_migrations_not_applied") {
      return fail(res, 503, "migrations_required", "Knowledge receptionist migrations have not been applied.");
    }
    if (message === "website_url_required") {
      return fail(res, 400, "website_url_required", "A website URL is required for a website build.");
    }
    if (message === "approved_source_required") {
      return fail(res, 400, "approved_source_required", "At least one approved source channel is required for a build.");
    }
    if (message === "domain_assignment_required") {
      return fail(res, 400, "domain_assignment_required", "At least one canonical domain/subdomain assignment is required.");
    }
    if (message === "uploaded_document_not_found") {
      return fail(res, 404, "uploaded_document_not_found", "One or more uploaded documents were not found for this tenant.");
    }
    if (message === "setup_interview_session_not_found") {
      return fail(res, 404, "setup_interview_session_not_found", "One or more setup interview sessions were not found for this tenant.");
    }
    if (message === "build_rate_limited") {
      return fail(res, 429, "build_rate_limited", "Build initiation is limited to once per 24-hour window.");
    }
    if (message === "website_fetch_failed") {
      return fail(res, 502, "website_fetch_failed", "Unable to fetch the approved website for this build.");
    }
    return fail(res, 500, "knowledge_build_error", message);
  }
}
