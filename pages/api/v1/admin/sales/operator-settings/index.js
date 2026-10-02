import {
  getSalesOperatorSettings,
  upsertSalesOperatorSettings
} from "../../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  runSalesAdminMutation,
  salesRequestBody,
  sendSalesApiError
} from "../../../../_lib/salesApi.js";

export default async function handler(req, res) {
  if (!["GET", "PUT"].includes(req.method)) {
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    if (req.method === "GET") {
      const settings = await getSalesOperatorSettings(context.pool, context.admin.id);
      const visibleSettings = context.session.role === "sales" && settings
        ? { displayName: settings.displayName, active: settings.active }
        : settings;
      return res.status(200).json({ ok: true, settings: visibleSettings });
    }
    if (context.session.role !== "admin") {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }
    const body = salesRequestBody(req);
    const targetUserId = body.adminUserId === undefined
      ? Number(context.admin.id)
      : Number(body.adminUserId);
    if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ ok: false, error: "invalid_operator_user_id" });
    }
    const target = await context.pool.query(
      `SELECT id FROM admin_users WHERE id = $1 AND role IN ('admin', 'super_admin', 'sales')`,
      [targetUserId]
    );
    if (!target.rowCount) {
      return res.status(404).json({ ok: false, error: "operator_user_not_found" });
    }
    const result = await runSalesAdminMutation(req, context, {
      scope: "sales.operator_settings.update",
      request: body,
      action: "sales.operator_settings.updated",
      auditDetails: {
        adminUserId: targetUserId,
        active: body.active
      }
    }, async () => ({
      status: 200,
      body: {
        ok: true,
        settings: await upsertSalesOperatorSettings(
          context.pool,
          targetUserId,
          body
        )
      }
    }));
    return res.status(result.status).json(result.body);
  } catch (error) {
    return sendSalesApiError(res, error, "sales_operator_settings_failed");
  }
}
