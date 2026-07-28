import { enqueueSalesDemoJob } from "../../../../../_lib/salesRepository.js";
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
    const force = body.force === true;
    const result = await runSalesAdminMutation(req, context, {
      scope: `sales.demo.enqueue:${prospectId}`,
      request: { force },
      action: "sales.demo.enqueued",
      auditDetails: { prospectId, force }
    }, async () => ({
      status: 202,
      body: {
        ok: true,
        result: await enqueueSalesDemoJob(context.pool, {
          prospectId,
          adminUserId: context.admin.id,
          force
        })
      }
    }));
    return res.status(result.status).json(result.body);
  } catch (error) {
    return sendSalesApiError(res, error, "sales_demo_enqueue_failed");
  }
}
