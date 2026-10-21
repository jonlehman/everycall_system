import { requireSalesAdmin,salesRequestBody,runSalesAdminMutation,sendSalesApiError } from '../../../_lib/salesApi.js';
import { getSalesDialerSettings,saveSalesScripts } from '../../../_lib/salesDialer.js';
export default async function handler(req,res) {
  if(!['GET','PATCH'].includes(req.method)){res.setHeader('Allow','GET, PATCH');return res.status(405).json({ok:false,error:'method_not_allowed'});}
  try {const c=await requireSalesAdmin(req,res);if(!c)return;
    if(req.method==='PATCH'){
      if(c.session.role!=='admin')return res.status(403).json({ok:false,error:'admin_required'});
      const {scripts}=salesRequestBody(req);
      await runSalesAdminMutation(req,c,{scope:'sales.scripts.update',request:{scripts},action:'sales.scripts.updated'},async()=>{await saveSalesScripts(c.pool,scripts);return {status:200,body:{ok:true}};});
    }
    res.setHeader('Cache-Control','no-store');return res.status(200).json({ok:true,...await getSalesDialerSettings(c.pool,{...c.admin,role:c.session.role})});
  }catch(e){return sendSalesApiError(res,e);}
}
