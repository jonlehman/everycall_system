import {
  getSalesCallSession,
  recordSalesCallOutcome
} from "../../../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  runSalesAdminMutation,
  salesRequestBody,
  sendSalesApiError
} from "../../../../../_lib/salesApi.js";
import { assertSalesCallAdmin } from "../../../../../_lib/salesCallView.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    const salesCallId = String(req.query?.salesCallId || "").trim();
    assertSalesCallAdmin(
      await getSalesCallSession(context.pool, salesCallId),
      context.admin.id
    );
    const body = salesRequestBody(req);
    const request = { outcome: body.outcome, notes: body.notes || "" };
    const result = await runSalesAdminMutation(req, context, {
      scope: `sales.call.outcome:${salesCallId}`,
      request,
      action: "sales.call.outcome_recorded",
      auditDetails: { salesCallId, outcome: request.outcome }
    }, async () => ({
      status: 200,
      body: {
        ok: true,
        call: await recordSalesCallOutcome(context.pool, {
          salesCallId,
          ...request
        })
      }
    }));
    return res.status(result.status).json(result.body);
  } catch (error) {
    return sendSalesApiError(res, error, "sales_call_outcome_failed");
  }
}
