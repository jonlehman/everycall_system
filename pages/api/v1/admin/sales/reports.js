import { requireSalesAdmin, sendSalesApiError } from '../../../_lib/salesApi.js';
import { getSalesReport, exportSalesReport, getSalesReportTranscript, getSalesReportDay } from '../../../_lib/salesReporting.js';

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
    if (req.query?.view !== undefined) {
      if (req.query.view !== 'timeline') return res.status(400).json({ ok: false, error: 'invalid_report_view', message: 'Choose a valid report view.' });
      return res.status(200).json({ ok: true, ...await getSalesReportDay(context.pool, req.query) });
    }
    if (req.query?.callId !== undefined) return res.status(200).json({ ok: true, ...await getSalesReportTranscript(context.pool, req.query.callId) });
    if (req.query?.format === 'csv') {
      const csv = await exportSalesReport(context.pool, req.query);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="sales-calls.csv"');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(csv);
    }
    return res.status(200).json({ ok: true, ...await getSalesReport(context.pool, req.query) });
  } catch (error) {
    return sendSalesApiError(res, error, 'sales_report_failed');
  }
}
