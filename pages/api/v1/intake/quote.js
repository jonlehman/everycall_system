import {ensureTables,getPool} from '../../_lib/db.js';
import {createIntakeQuote,requireVerifiedIntake} from '../../_lib/paidIntake.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
 try{const pool=getPool();await ensureTables(pool);const intake=await requireVerifiedIntake(pool,req);
  return res.json({ok:true,...await createIntakeQuote(pool,intake,req.body||{})});
 }catch(e){return res.status(e.status||500).json({error:e.status?e.message:'payment_quote_unavailable'});}
}
