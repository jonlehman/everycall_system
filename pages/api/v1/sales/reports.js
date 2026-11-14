import { requireSalesAdmin, sendSalesApiError } from '../../_lib/salesApi.js';
import { getSalesReport, exportSalesReport, getSalesReportDay, getSalesReportTranscript } from '../../_lib/salesReporting.js';

// The Sales workspace always reports the authenticated actor's own history,
// including when that actor is an administrator. Operations has a separate API.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  try {
    // This read has no prospect target. Do not let arbitrary query identities
    // trigger the shared helper's unrelated prospect-ownership lookup.
    const context = await requireSalesAdmin({ headers: req.headers, method: req.method, url: req.url, query: {} }, res);
    if (!context) return;
    const options = { actorId: Number(context.admin.id) };
    const query = req.query || {};
    if (query.contract !== 'telnyx-v1') return res.status(400).json({ ok: false, error: 'report_contract_changed', message: 'Reload this page to use the Telnyx report.' });
    if (query.callId !== undefined) await getSalesReportTranscript();
    if (query.view !== undefined) {
      if (query.view !== 'timeline') return res.status(400).json({ ok: false, error: 'invalid_report_view', message: 'Choose a valid report view.' });
      return res.status(200).json({ ok: true, ...await getSalesReportDay(context.pool, query, options) });
    }
    if (query.format === 'csv') {
      const csv = await exportSalesReport(context.pool, query, options);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="my-telnyx-sales-records.csv"');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(csv);
    }
    return res.status(200).json({ ok: true, ...await getSalesReport(context.pool, query, options) });
  } catch (error) {
    // Unexpected database/adapter errors may contain account-wide identities.
    if (!Number.isInteger(error?.statusCode)) return res.status(500).json({ ok: false, error: 'sales_report_failed', message: 'Report unavailable. Please retry.' });
    return sendSalesApiError(res, error, 'sales_report_failed');
  }
}
