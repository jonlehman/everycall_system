import { requireSalesAdmin,runSalesAdminMutation,sendSalesApiError } from '../../../../../_lib/salesApi.js';
import { removeSalesQueueProspect } from '../../../../../_lib/salesDialer.js';
export default async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
 try {const c=await requireSalesAdmin(req,res);if(!c)return;const id=String(req.query.prospectId||'');const result=await runSalesAdminMutation(req,c,{scope:`sales.remove:${id}`,request:{id},action:'sales.prospect.removed'},async()=>({status:200,body:{ok:true,prospect:await removeSalesQueueProspect(c.pool,id,c.admin.id)}}));return res.status(result.status).json(result.body);}catch(e){return sendSalesApiError(res,e);}
}
