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
      return res.status(200).json({ ok: true, settings });
    }
    const body = salesRequestBody(req);
    const result = await runSalesAdminMutation(req, context, {
      scope: "sales.operator_settings.update",
      request: body,
      action: "sales.operator_settings.updated",
      auditDetails: {
        adminUserId: Number(context.admin.id),
        active: body.active
      }
    }, async () => ({
      status: 200,
      body: {
        ok: true,
        settings: await upsertSalesOperatorSettings(
          context.pool,
          context.admin.id,
          body
        )
      }
    }));
    return res.status(result.status).json(result.body);
  } catch (error) {
    return sendSalesApiError(res, error, "sales_operator_settings_failed");
  }
}
