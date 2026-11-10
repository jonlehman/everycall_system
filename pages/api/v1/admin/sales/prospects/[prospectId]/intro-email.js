import { requireSalesAdmin, salesRequestBody, sendSalesApiError } from '../../../../../_lib/salesApi.js';
import { sendSalesIntroEmail } from '../../../../../_lib/salesIntroEmail.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow','POST');
    return res.status(405).json({ok:false,error:'method_not_allowed'});
  }
  try {
    const context = await requireSalesAdmin(req,res);
    if (!context) return;
    const options = {prospectId:String(req.query.prospectId),repId:context.admin.id,isAdmin:context.session.role==='admin',authenticatedSession:{id:context.session.id,role:context.session.role}};
    const body = salesRequestBody(req);
    const allowed = new Set(['draftToken','subject','text','confirmedEmailPermission']);
    if (Object.keys(body).some(key => !allowed.has(key))) return res.status(400).json({ok:false,error:'intro_email_field_not_allowed',message:'Recipient, sender and reply address are selected by the server. Open a new draft to change contacts.'});
    const delivery = await sendSalesIntroEmail(context.pool,{...options,...body,idempotencyKey:req.headers?.['idempotency-key']});
    return res.status(200).json({ok:true,delivery});
  } catch (error) { return sendSalesApiError(res,error,'intro_email_failed'); }
}
