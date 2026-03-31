import { getPool } from "../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess } from "../../_lib/billing.js";
import { listUploadedDocuments, saveUploadedDocument } from "../../_lib/knowledgeReceptionistConfig.js";

function fail(res, status, error, message) {
  return res.status(status).json({ ok: false, error, message });
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return fail(res, 500, "database_unavailable", "Database is unavailable.");
    }

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, String(req.query?.tenantKey || req.body?.tenantKey || ""));
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return;

    if (req.method === "GET") {
      const documents = await listUploadedDocuments(pool, tenantKey);
      return res.status(200).json({ ok: true, documents });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const document = await saveUploadedDocument(pool, tenantKey, body.document || body, session);
      return res.status(200).json({ ok: true, document });
    }

    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method_not_allowed", "Method not allowed.");
  } catch (err) {
    const message = String(err?.message || "unknown");
    if (message === "knowledge_receptionist_migrations_not_applied") {
      return fail(res, 503, "migrations_required", "Knowledge receptionist migrations have not been applied.");
    }
    if (message === "uploaded_document_title_and_body_required") {
      return fail(res, 400, "uploaded_document_title_and_body_required", "Uploaded documents require both a title and body text.");
    }
    if (message === "uploaded_document_file_type_not_supported") {
      return fail(res, 400, "uploaded_document_file_type_not_supported", "Only .pdf and .txt files are supported for file upload right now.");
    }
    if (message === "uploaded_document_file_too_large") {
      return fail(res, 413, "uploaded_document_file_too_large", "Uploaded files must be 5 MB or smaller.");
    }
    if (message === "uploaded_document_body_too_large") {
      return fail(res, 413, "uploaded_document_body_too_large", "Uploaded document text is too large to process.");
    }
    return fail(res, 500, "uploaded_document_error", message);
  }
}
