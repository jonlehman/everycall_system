import { ensureTables,getPool } from '../../_lib/db.js';
import { getSession } from '../../_lib/auth.js';
import { verifyIntakeOwner,setIntakeCookie,getIntakeStatus } from '../../_lib/paidIntake.js';
export default async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
 try {
  const pool=getPool();await ensureTables(pool);
  const {row,secret}=await verifyIntakeOwner(pool,req.body?.token,{session:await getSession(req)});
  setIntakeCookie(res,secret);return res.json(await getIntakeStatus(pool,row));
 }catch(e){return res.status(e.status||500).json({ok:false,error:e.status?e.message:'verification_unavailable'});}
}
