import { requireSalesAdmin, salesRequestBody, sendSalesApiError, runSalesAdminMutation } from '../../../../../_lib/salesApi.js';
import { sendSalesCheckout, validateSalesCheckoutRequest } from '../../../../../_lib/salesCheckout.js';
export default async function handler(req,res) {
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
 try {
  const context=await requireSalesAdmin(req,res);if(!context)return;
  const prospectId=String(req.query.prospectId),body=salesRequestBody(req);
  const details={prospectId,repId:context.admin.id,channel:body.channel,email:body.email,confirmedWithoutCall:body.confirmedWithoutCall,expectedIsTest:body.expectedIsTest,confirmedRecipient:body.confirmedRecipient};
  const isTest=await validateSalesCheckoutRequest(context.pool,details);
  const result=await runSalesAdminMutation(req,context,{scope:`sales.prospect.checkout:${prospectId}:${isTest?"test":"live"}`,request:body,action:'sales.checkout.sent',auditDetails:{prospectId}},async()=>({status:200,body:{ok:true,checkout:await sendSalesCheckout(context.pool,details)}}));
  return res.status(result.status).json(result.body);
 }catch(error){return sendSalesApiError(res,error);}
}
