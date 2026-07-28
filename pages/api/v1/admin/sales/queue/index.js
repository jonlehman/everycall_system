import {
  getSalesMissingTimezonePolicy,
  listSalesProspects,
  SALES_WARM_QUEUE_SIZE
} from "../../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  sendSalesApiError
} from "../../../../_lib/salesApi.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    const queue = await listSalesProspects(context.pool, {
      limit: req.query?.limit || SALES_WARM_QUEUE_SIZE,
      afterQueuePosition: req.query?.afterQueuePosition,
      eligibleOnly: true
    });
    return res.status(200).json({
      ok: true,
      queue: queue.prospects,
      missingTimezonePolicy: getSalesMissingTimezonePolicy()
    });
  } catch (error) {
    return sendSalesApiError(res, error, "sales_queue_load_failed");
  }
}
