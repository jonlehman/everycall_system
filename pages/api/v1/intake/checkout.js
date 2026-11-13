import { ensureTables,getPool } from '../../_lib/db.js';
import { beginPaidCheckout,requireVerifiedIntake } from '../../_lib/paidIntake.js';
export const config={maxDuration:60};
export default async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
 try {const pool=getPool();await ensureTables(pool);const intake=await requireVerifiedIntake(pool,req);
  return res.json({ok:true,...await beginPaidCheckout(pool,intake,req.body||{})});
 }catch(e){return res.status(e.status||500).json({ok:false,error:e.status?e.message:'checkout_unavailable',...(['historical_purchase_term_review_required','purchase_term_reconciliation_required'].includes(e.message)?{message:'Your original paid period needs a manual review before setup can continue. Contact customerservice@everycall.io. Do not submit another setup payment; we will review your original payment and dates.'}:{})});}
}
