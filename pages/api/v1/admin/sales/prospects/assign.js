import { requireSalesAdmin, runSalesAdminMutation, salesRequestBody, sendSalesApiError } from '../../../../_lib/salesApi.js';
import { salesTransaction } from '../../../../_lib/salesDialer.js';
import { reassignSalesProspects } from '../../../../_lib/salesAssignments.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    if (context.session.role !== 'admin') return res.status(403).json({ ok: false, error: 'forbidden' });
    const body = salesRequestBody(req);
    const result = await salesTransaction(context.pool, db => runSalesAdminMutation(req, { ...context, pool: db }, {
      scope: 'sales.prospects.assign', request: body, action: 'sales.prospects.assigned',
      auditDetails: response => ({ targetRepUserId: response.body.targetRepUserId, assignments: response.body.assignments })
    }, async () => ({ status: 200, body: { ok: true, ...await reassignSalesProspects(db, body) } })));
    return res.status(result.status).json(result.body);
  } catch (error) {
    return sendSalesApiError(res, error, 'sales_prospect_assignment_failed');
  }
}
