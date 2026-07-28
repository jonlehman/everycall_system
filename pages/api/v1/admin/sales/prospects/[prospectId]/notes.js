import { addSalesProspectNote } from "../../../../../_lib/salesRepository.js";
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
    const request = {
      salesCallId: body.salesCallId || null,
      body: body.body
    };
    const result = await runSalesAdminMutation(req, context, {
      scope: `sales.prospect.note:${prospectId}`,
      request,
      action: "sales.prospect.note_added",
      auditDetails: { prospectId, salesCallId: request.salesCallId }
    }, async () => ({
      status: 201,
      body: {
        ok: true,
        note: await addSalesProspectNote(context.pool, {
          prospectId,
          salesCallId: request.salesCallId,
          body: request.body,
          adminUserId: context.admin.id
        })
      }
    }));
    return res.status(result.status).json(result.body);
  } catch (error) {
    return sendSalesApiError(res, error, "sales_note_create_failed");
  }
}
