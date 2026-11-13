import {requireSession,resolveTenantKey} from '../../_lib/auth.js';
import {getPool,ensureTables} from '../../_lib/db.js';
import {requireTenantOwner} from '../../_lib/billing.js';
import {beginPaidReinstatement} from '../../_lib/paidReinstatement.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
 try{
  const pool=getPool();await ensureTables(pool);const session=await requireSession(req,res);if(!session)return;
  const owner=await requireTenantOwner(session);if(!owner)return res.status(403).json({error:'owner_required'});
  const tenantKey=resolveTenantKey(session,String(req.query.tenantKey||'default'));
  return res.json({ok:true,...await beginPaidReinstatement(pool,tenantKey,owner,req.body||{})});
 }catch(e){return res.status(e.status||500).json({error:e.status?e.message:'restart_unavailable'});}
}
