import { ensureTables,getPool } from '../../_lib/db.js';
import { createSession,setSessionCookie } from '../../_lib/auth.js';
import { getIntakeStatus,requireVerifiedIntake } from '../../_lib/paidIntake.js';
export default async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 try {const pool=getPool();await ensureTables(pool);const intake=await requireVerifiedIntake(pool,req);
  const result=await getIntakeStatus(pool,intake);
  if(result.purchase?.paymentStatus==='paid'&&result.purchase.tenantKey){
   const owner=(await pool.query("SELECT id,email,password_hash,status,role FROM tenant_users WHERE tenant_key=$1 AND lower(email)=$2 AND role='owner' AND status='active'",[result.purchase.tenantKey,intake.owner_email])).rows[0];
   if(owner)result.redirectUrl='/client/account/billing';
   if(owner&&!owner.password_hash){const id=await createSession({userId:owner.id,tenantKey:result.purchase.tenantKey,role:'tenant',expectedUser:owner});
    if(id){setSessionCookie(res,id);result.redirectUrl='/client/account/billing';}}
  }
  return res.json(result);
 }catch(e){return res.status(e.status||500).json({ok:false,error:e.status?e.message:'intake_status_unavailable'});}
}
