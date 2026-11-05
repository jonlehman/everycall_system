import { assertSalesProspectOwner } from "../../../../_lib/salesDialer.js";
import {
  getSalesProspectDetail,
  removeSalesProspect,
  updateSalesProspect
} from "../../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  runSalesOwnedProspectMutation,
  salesRequestBody,
  sendSalesApiError
} from "../../../../_lib/salesApi.js";

export default async function handler(req, res) {
  if (!["GET", "PATCH", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, PATCH, DELETE");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    const prospectId = String(req.query?.prospectId || "").trim();
    if(context.session.role === "sales") await assertSalesProspectOwner(context.pool,prospectId,context.admin.id);
    if (req.method === "GET") {
      const prospect = await getSalesProspectDetail(context.pool, prospectId, {
        operatorUserId: context.session.role === "sales" ? context.admin.id : null
      });
      if (!prospect) {
        return res.status(404).json({ ok: false, error: "prospect_not_found" });
      }
      return res.status(200).json({ ok: true, prospect });
    }
    const body = salesRequestBody(req);
    if (req.method === "DELETE") {
      const result = await runSalesOwnedProspectMutation(req, context, prospectId, {
        scope: `sales.prospects.delete:${prospectId}`,
        request: body,
        action: "sales.prospect.deleted",
        auditDetails: { prospectId }
      }, async (db) => ({
        status: 200,
        body: {
          ok: true,
          prospect: await removeSalesProspect(db, prospectId, {
            expectedRowVersion: body.expectedRowVersion
          })
        }
      }));
      return res.status(result.status).json(result.body);
    }
    const result = await runSalesOwnedProspectMutation(req, context, prospectId, {
      scope: `sales.prospects.update:${prospectId}`,
      request: body,
      action: "sales.prospect.updated",
      auditDetails: { prospectId, fields: Object.keys(body).sort() }
    }, async (db) => ({
      status: 200,
      body: {
        ok: true,
        prospect: await updateSalesProspect(db, prospectId, body)
      }
    }));
    return res.status(result.status).json(result.body);
  } catch (error) {
    return sendSalesApiError(res, error, "sales_prospect_request_failed");
  }
}
