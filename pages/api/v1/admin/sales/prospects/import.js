import {
  parseSalesProspectCsv,
  importSalesProspects
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
    const csv = typeof req.body === "string" ? req.body : body.csv;
    const records = Array.isArray(body.records)
      ? body.records
      : parseSalesProspectCsv(csv);
    const request = {
      records,
      defaultCountryCode: body.defaultCountryCode || "1"
    };
    const result = await runSalesAdminMutation(req, context, {
      scope: "sales.prospects.import",
      request,
      action: "sales.prospects.imported",
      auditDetails: (response) => ({
        receivedCount: response.body?.import?.receivedCount || 0,
        importedCount: response.body?.import?.importedCount || 0,
        rejectedCount: response.body?.import?.rejectedCount || 0
      })
    }, async () => ({
      status: 200,
      body: {
        ok: true,
        import: await importSalesProspects(context.pool, {
          records,
          adminUserId: context.admin.id,
          defaultCountryCode: body.defaultCountryCode || "1"
        })
      }
    }));
    return res.status(result.status).json(result.body);
  } catch (error) {
    return sendSalesApiError(res, error, "sales_prospect_import_failed");
  }
}
