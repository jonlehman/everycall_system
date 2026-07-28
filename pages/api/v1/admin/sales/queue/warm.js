import {
  enqueueWarmSalesDemoQueue,
  SALES_WARM_QUEUE_SIZE
} from "../../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  runSalesAdminMutation,
  salesRequestBody,
  sendSalesApiError
} from "../../../../_lib/salesApi.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    const body = salesRequestBody(req);
    const request = {
      currentProspectId: body.currentProspectId || "",
      size: body.size || SALES_WARM_QUEUE_SIZE
    };
    const result = await runSalesAdminMutation(req, context, {
      scope: "sales.queue.warm",
      request,
      action: "sales.demo_queue.warmed",
      auditDetails: (response) => ({
        currentProspectId: request.currentProspectId || null,
        enqueuedCount: response.body?.result?.enqueuedCount || 0
      })
    }, async () => ({
      status: 202,
      body: {
        ok: true,
        result: await enqueueWarmSalesDemoQueue(context.pool, {
          ...request,
          adminUserId: context.admin.id
        })
      }
    }));
    return res.status(result.status).json(result.body);
  } catch (error) {
    return sendSalesApiError(res, error, "sales_queue_warm_failed");
  }
}
