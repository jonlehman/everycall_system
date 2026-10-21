import { expireUnstartedSalesCalls } from '../../../../_lib/salesRepository.js';
import { requireSalesAdmin,sendSalesApiError } from '../../../../_lib/salesApi.js';
import { getSalesRepQueue } from '../../../../_lib/salesDialer.js';
export default async function handler(req,res) {
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  try {const context=await requireSalesAdmin(req,res);if(!context)return;await expireUnstartedSalesCalls(context.pool);res.setHeader('Cache-Control','no-store');return res.status(200).json({ok:true,...await getSalesRepQueue(context.pool,context.admin.id,{timezone:req.query.timezone||'UTC',actor:{...context.admin,role:context.session.role}})});}catch(error){return sendSalesApiError(res,error,'sales_queue_load_failed');}
}
