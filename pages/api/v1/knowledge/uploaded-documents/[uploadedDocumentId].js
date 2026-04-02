import { getPool } from "../../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../../_lib/auth.js";
import { requireTenantBillingAccess, requireTenantRoles } from "../../../_lib/billing.js";
import { archiveUploadedDocument } from "../../../_lib/knowledgeReceptionistConfig.js";

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

    if (req.method !== "DELETE") {
      res.setHeader("Allow", "DELETE");
      return fail(res, 405, "method_not_allowed", "Method not allowed.");
    }

    const manager = await requireTenantRoles(res, session, ["owner", "admin"], {
      message: "Only account admins and owners can remove knowledge documents."
    });
    if (!manager) return;

    const uploadedDocumentId = String(req.query?.uploadedDocumentId || "").trim();
    if (!uploadedDocumentId) {
      return fail(res, 400, "uploaded_document_not_found", "Uploaded document id is required.");
    }

    const document = await archiveUploadedDocument(pool, tenantKey, uploadedDocumentId, session);
    return res.status(200).json({ ok: true, document });
  } catch (err) {
    const message = String(err?.message || "unknown");
    if (message === "knowledge_receptionist_migrations_not_applied") {
      return fail(res, 503, "migrations_required", "Knowledge receptionist migrations have not been applied.");
    }
    if (message === "uploaded_document_not_found") {
      return fail(res, 404, "uploaded_document_not_found", "That uploaded document was not found.");
    }
    return fail(res, 500, "uploaded_document_delete_error", message);
  }
}
