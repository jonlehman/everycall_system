import { ensureTables,getPool } from '../../_lib/db.js';
import { createIntakeDraft,resolveIntakeSalesReference } from '../../_lib/paidIntake.js';
export default async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 try {
  const pool=getPool(); await ensureTables(pool);
  if(req.method==='GET'&&req.query.salesRef){
   const row=await resolveIntakeSalesReference(pool,String(req.query.salesRef));
   return res.json({ok:true,prefill:{businessName:row.business_name,website:row.website_url,businessCategory:row.business_category,
    loginEmail:row.contact_snapshot?.email||'',leadPhone:row.contact_snapshot?.phoneE164||''}});
  }
  if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
  return res.json(await createIntakeDraft(pool,req.body||{}));
 }catch(e){return res.status(e.status||500).json({ok:false,error:e.status?e.message:'intake_unavailable',...(e.status===410?{recoveryUrl:'/intake'}:{})});}
}
