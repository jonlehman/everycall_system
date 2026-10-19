import { requireSalesAdmin, sendSalesApiError } from '../../../_lib/salesApi.js';
import { getSalesReport } from '../../../_lib/salesReporting.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    if (context.session.role !== 'admin') return res.status(403).json({ ok: false, error: 'forbidden' });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ ok: true, ...await getSalesReport(context.pool, req.query) });
  } catch (error) {
    return sendSalesApiError(res, error, 'sales_report_failed');
  }
}
