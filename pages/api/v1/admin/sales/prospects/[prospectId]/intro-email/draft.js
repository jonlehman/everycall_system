import { requireSalesAdmin, salesRequestBody, sendSalesApiError } from '../../../../../../_lib/salesApi.js';
import { createSalesIntroEmailDraft } from '../../../../../../_lib/salesIntroEmail.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow','POST');
    return res.status(405).json({ok:false,error:'method_not_allowed'});
  }
  try {
    const context = await requireSalesAdmin(req,res);
    if (!context) return;
    const body = salesRequestBody(req);
    if (Object.keys(body).some(key => !['contactId','salesCallId'].includes(key))
      || typeof body.contactId !== 'string' || (body.salesCallId != null && typeof body.salesCallId !== 'string')) {
      return res.status(400).json({ok:false,error:'invalid_intro_email_draft',message:'Select a contact from this company.'});
    }
    const draft = await createSalesIntroEmailDraft(context.pool,{
      prospectId:String(req.query.prospectId),repId:context.admin.id,isAdmin:context.session.role==='admin',
      authenticatedSession:{id:context.session.id,role:context.session.role},
      contactId:body.contactId,salesCallId:body.salesCallId||null
    });
    return res.status(200).json({ok:true,draft});
  } catch (error) { return sendSalesApiError(res,error,'intro_email_failed'); }
}
