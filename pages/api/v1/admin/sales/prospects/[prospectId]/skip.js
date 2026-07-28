import {
  enqueueWarmSalesDemoQueue,
  skipSalesProspect
} from "../../../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  runSalesAdminMutation,
  salesRequestBody,
  sendSalesApiError
} from "../../../../../_lib/salesApi.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    const prospectId = String(req.query?.prospectId || "").trim();
    const body = salesRequestBody(req);
    const request = { reason: body.reason || "" };
    const result = await runSalesAdminMutation(req, context, {
      scope: `sales.prospects.skip:${prospectId}`,
      request,
      action: "sales.prospect.skipped",
      auditDetails: { prospectId, reason: request.reason || null }
    }, async () => {
      const prospect = await skipSalesProspect(context.pool, {
        prospectId,
        reason: request.reason,
        adminUserId: context.admin.id
      });
      const warmQueue = await enqueueWarmSalesDemoQueue(context.pool, {
        currentProspectId: prospectId,
        adminUserId: context.admin.id
      });
      return {
        status: 200,
        body: { ok: true, prospect, warmQueue }
      };
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return sendSalesApiError(res, error, "sales_prospect_skip_failed");
  }
}
