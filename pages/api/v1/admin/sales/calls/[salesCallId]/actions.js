import {
  getSalesCallSession
} from "../../../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  runSalesAdminMutation,
  salesRequestBody,
  sendSalesApiError
} from "../../../../../_lib/salesApi.js";
import { sendSalesCallAction } from "../../../../../_lib/salesGatewayClient.js";
import {
  assertSalesCallAdmin,
  buildSalesCallView
} from "../../../../../_lib/salesCallView.js";
import { salesError } from "../../../../../_lib/salesRepository.js";

const ALLOWED_ACTIONS = new Set([
  "start_demo",
  "pause_ai",
  "end_demo",
  "end_call"
]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    const salesCallId = String(req.query?.salesCallId || "").trim();
    const body = salesRequestBody(req);
    const action = String(body.action || "").trim().toLowerCase();
    if (!ALLOWED_ACTIONS.has(action)) {
      throw salesError("invalid_sales_call_action", "Sales call action is not supported.", 400);
    }
    const call = assertSalesCallAdmin(
      await getSalesCallSession(context.pool, salesCallId),
      context.admin.id
    );
    const request = { action, payload: body.payload || {} };
    const result = await runSalesAdminMutation(req, context, {
      scope: `sales.call.action:${salesCallId}`,
      request,
      action: "sales.call.action_requested",
      auditDetails: { salesCallId, action }
    }, async () => {
      await sendSalesCallAction(call.salesCallId, action, {
        payload: request.payload
      });
      const updated = assertSalesCallAdmin(
        await getSalesCallSession(context.pool, call.salesCallId),
        context.admin.id
      );
      return {
        status: 200,
        body: {
          ok: true,
          call: await buildSalesCallView(context.pool, updated)
        }
      };
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return sendSalesApiError(res, error, "sales_call_action_failed");
  }
}
