import {
  createSalesProspect,
  listSalesProspects
} from "../../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  runSalesAdminMutation,
  salesRequestBody,
  sendSalesApiError
} from "../../../../_lib/salesApi.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    if (req.method === "GET") {
      const result = await listSalesProspects(context.pool, {
        limit: req.query?.limit,
        afterQueuePosition: req.query?.afterQueuePosition,
        status: req.query?.status,
        eligibleOnly: String(req.query?.eligibleOnly || "").toLowerCase() === "true",
        includeDeleted: String(req.query?.includeDeleted || "").toLowerCase() === "true",
        search: req.query?.search
      });
      return res.status(200).json({ ok: true, ...result });
    }
    const body = salesRequestBody(req);
    const result = await runSalesAdminMutation(req, context, {
      scope: "sales.prospects.create",
      request: body,
      action: "sales.prospect.created",
      auditDetails: (response) => ({
        prospectId: response.body?.prospect?.prospectId || null
      })
    }, async () => ({
      status: 201,
      body: {
        ok: true,
        prospect: await createSalesProspect(context.pool, body, {
          adminUserId: context.admin.id,
          defaultCountryCode: body.defaultCountryCode || "1"
        })
      }
    }));
    return res.status(result.status).json(result.body);
  } catch (error) {
    return sendSalesApiError(res, error, "sales_prospect_request_failed");
  }
}
