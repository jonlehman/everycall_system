import { listSalesProspects } from "../../../../_lib/salesRepository.js";
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
    const result = await listSalesProspects(context.pool, {
      limit: req.query?.limit,
      afterQueuePosition: req.query?.afterQueuePosition,
      status: req.query?.status,
      eligibleOnly: String(req.query?.eligibleOnly || "").toLowerCase() === "true",
      search: req.query?.search
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return sendSalesApiError(res, error, "sales_prospects_list_failed");
  }
}
