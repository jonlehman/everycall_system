import { requireSalesAdmin, runSalesAdminMutation, salesRequestBody, sendSalesApiError, writeSalesAdminAudit } from '../../../_lib/salesApi.js';
import { getSalesPhoneTestMode, setSalesPhoneTestMode } from '../../../_lib/salesPhoneTestMode.js';
export default async function handler(req, res) {
  if (!['GET','PATCH'].includes(req.method)) { res.setHeader('Allow','GET, PATCH'); return res.status(405).json({ok:false,error:'method_not_allowed'}); }
  try {
    const context = await requireSalesAdmin(req,res); if (!context) return;
    if (context.session.role !== 'admin') return res.status(403).json({ok:false,error:'admin_required'});
    res.setHeader('Cache-Control','no-store');
    if (req.method === 'GET') return res.status(200).json({ok:true,phoneTestMode:await getSalesPhoneTestMode(context.pool)});
    const {enabled} = salesRequestBody(req);
    const result = await runSalesAdminMutation(req,context,{
      scope:'sales.phone_test_mode.update', request:{enabled}
    },async()=>({status:200,body:{ok:true,phoneTestMode:await setSalesPhoneTestMode(context.pool,enabled,{audit:(db,status)=>writeSalesAdminAudit({...context,pool:db},'sales.phone_test_mode.updated',{enabled:status.enabled,backedUpCount:status.backedUpCount})})}}));
    return res.status(result.status).json(result.body);
  } catch(error) { return sendSalesApiError(res,error); }
}
