import {
  getSalesCallSession
} from "../../../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  sendSalesApiError
} from "../../../../../_lib/salesApi.js";
import {
  assertSalesCallAdmin,
  buildSalesCallView
} from "../../../../../_lib/salesCallView.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    const call = assertSalesCallAdmin(
      await getSalesCallSession(context.pool, req.query?.salesCallId),
      context.admin.id
    );
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      call: await buildSalesCallView(context.pool, call)
    });
  } catch (error) {
    return sendSalesApiError(res, error, "sales_call_load_failed");
  }
}
