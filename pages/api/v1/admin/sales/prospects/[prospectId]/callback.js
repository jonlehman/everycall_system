import { requireSalesAdmin,runSalesAdminMutation,salesRequestBody,sendSalesApiError } from '../../../../../_lib/salesApi.js';
import { mutateSalesContact } from '../../../../../_lib/salesContacts.js';
export default async function handler(req,res) {
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  try {
    const context=await requireSalesAdmin(req,res); if(!context)return;
    const prospectId=String(req.query?.prospectId||'');
    const body=salesRequestBody(req);
    const result=await runSalesAdminMutation(req,context,{
      scope:`sales.contacts.callback:${prospectId}`,request:body,action:'sales.prospect.callback',auditDetails:{prospectId}
    },async()=>({status:200,body:{ok:true,prospect:await mutateSalesContact(context.pool,{prospectId,repId:context.admin.id,action:'callback',callbackAt:body.callbackAt,expectedRowVersion:body.expectedRowVersion})}}));
    return res.status(result.status).json(result.body);
  } catch(error) {return sendSalesApiError(res,error);}
}
