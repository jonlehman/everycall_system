import { saveSalesLiveNotes } from "../../../../../_lib/salesDialer.js";
import {
  getSalesCallSession
} from "../../../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  sendSalesApiError
} from "../../../../../_lib/salesApi.js";
import {
  assertSalesCallAdmin,
  assertSalesCallRead,
  buildSalesCallView
} from "../../../../../_lib/salesCallView.js";

export default async function handler(req, res) {
  if (!["GET","PATCH"].includes(req.method)) {
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    let call = await getSalesCallSession(context.pool, req.query?.salesCallId);
    if(req.method === "GET") call = assertSalesCallRead(call,context);
    else call = assertSalesCallAdmin(call,context.admin.id);
    if(req.method === "PATCH") call = await saveSalesLiveNotes(context.pool,call.salesCallId,context.admin.id,req.body?.liveNotes);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      call: await buildSalesCallView(context.pool, call, {
        operatorUserId: context.session.role === "sales" ? context.admin.id : null
      })
    });
  } catch (error) {
    return sendSalesApiError(res, error, "sales_call_load_failed");
  }
}
