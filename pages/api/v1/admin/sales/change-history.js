import { requireSalesAdmin, sendSalesApiError } from '../../../_lib/salesApi.js';
import { getSalesChangeHistory } from '../../../_lib/salesChangeHistory.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET') { res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'}); }
  try {
    // Never let prospectId or any other query parameter influence auth or widen it.
    const context=await requireSalesAdmin({headers:req.headers,method:req.method,url:req.url,query:{}},res);
    if(!context)return;
    if(context.session.role!=='admin')return res.status(403).json({ok:false,error:'forbidden'});
    return res.status(200).json({ok:true,...await getSalesChangeHistory(context.pool,req.query)});
  }catch(error){return sendSalesApiError(res,error,'sales_history_failed');}
}
