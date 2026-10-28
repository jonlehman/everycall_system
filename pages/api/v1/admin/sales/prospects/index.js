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
import { createSalesContact, listSalesContacts } from '../../../../_lib/salesContacts.js';

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    if (req.method === "GET") {
      if (req.query?.contactsView === 'true') {
        const result = await listSalesContacts(context.pool, { ...req.query, repId: context.admin.id });
        return res.status(200).json({ ok: true, ...result });
      }
      const result = await listSalesProspects(context.pool, {
        limit: req.query?.limit,
        afterQueuePosition: req.query?.afterQueuePosition,
        status: req.query?.status,
        eligibleOnly: String(req.query?.eligibleOnly || "").toLowerCase() === "true",
        includeDeleted: String(req.query?.includeDeleted || "").toLowerCase() === "true",
        includeUnprepared: true,
        search: req.query?.search,
        operatorUserId: context.session.role === "sales" ? context.admin.id : null
      });
      return res.status(200).json({ ok: true, ...result });
    }
    const body = salesRequestBody(req);
    if (body.contactsView === true || context.session.role === 'sales') {
      const result = await runSalesAdminMutation(req, context, {
        scope: 'sales.contacts.create', request: body, action: 'sales.prospect.created',
        auditDetails: response => ({ prospectId: response.body?.prospect?.prospectId })
      }, async () => ({ status: 201, body: { ok: true, ...await createSalesContact(context.pool, body, { repId: context.admin.id }) } }));
      return res.status(result.status).json(result.body);
    }
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
