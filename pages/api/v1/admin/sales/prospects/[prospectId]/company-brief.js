import { prepareSalesCompanyBrief } from "../../../../../_lib/salesRepository.js";
import { requireSalesAdmin, runSalesAdminMutation, sendSalesApiError } from "../../../../../_lib/salesApi.js";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    const prospectId = String(req.query?.prospectId || "").trim();
    const result = await runSalesAdminMutation(req, context, {
      scope: `sales.company_brief.prepare:${prospectId}`, request: {},
      action: "sales.company_brief.prepared", auditDetails: { prospectId },
    }, async () => ({ status: 200, body: { ok: true,
      companyBrief: await prepareSalesCompanyBrief(context.pool, prospectId) } }));
    return res.status(result.status).json(result.body);
  } catch (error) {
    return sendSalesApiError(res, error, "sales_company_brief_failed");
  }
}
