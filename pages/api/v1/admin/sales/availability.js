import { requireSalesAdmin,sendSalesApiError } from '../../../_lib/salesApi.js';
import { salesAvailability } from '../../../_lib/salesCalendar.js';
export default async function handler(req,res){if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'method_not_allowed'});}try{const c=await requireSalesAdmin(req,res);if(!c)return;res.setHeader('Cache-Control','no-store');return res.status(200).json({ok:true,...await salesAvailability(c.pool,{after:req.query.after})});}catch(e){return sendSalesApiError(res,e);}}
