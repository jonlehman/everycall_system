import { requireSalesAdmin,sendSalesApiError } from '../../../../../_lib/salesApi.js';
export default async function handler(req,res) {
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
 try{const context=await requireSalesAdmin(req,res);if(!context)return;return res.status(410).json({ok:false,error:'sales_checkout_required',message:'Use checkout and setup booking on the call. Legacy Sales signup invitations are retired.'});}catch(error){return sendSalesApiError(res,error);}
}
