import { requireSalesAdmin,runSalesOwnedProspectMutation,salesRequestBody,sendSalesApiError } from '../../../../../_lib/salesApi.js';
import { mutateSalesContact } from '../../../../../_lib/salesContacts.js';
export default async function handler(req,res) {
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  try {
    const context=await requireSalesAdmin(req,res); if(!context)return;
    const prospectId=String(req.query?.prospectId||'');
    const body=salesRequestBody(req);
    const result=await runSalesOwnedProspectMutation(req,context,prospectId,{
      scope:`sales.contacts.callback:${prospectId}`,request:body,action:'sales.prospect.callback',auditDetails:{prospectId}
    },async(db)=>({status:200,body:{ok:true,prospect:await mutateSalesContact(db,{inTransaction:true,prospectId,repId:context.admin.id,action:'callback',callbackAt:body.callbackAt,expectedRowVersion:body.expectedRowVersion,contactId:body.contactId,numberId:body.numberId})}}));
    return res.status(result.status).json(result.body);
  } catch(error) {return sendSalesApiError(res,error);}
}
