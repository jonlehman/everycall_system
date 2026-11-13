import { getPool } from '../../../../_lib/db.js';
import { getStaffSession, setSupportSessionCookie } from '../../../../_lib/auth.js';
import { createSupportSession } from '../../../../_lib/supportSessions.js';
export default async function handler(req,res) {
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'method_not_allowed'});}
  const staffSession=await getStaffSession(req);
  if(!staffSession)return res.status(403).json({error:'forbidden'});
  try {
    const support=await createSupportSession(getPool(),{staffSession,tenantKey:String(req.query.tenantKey||'')});
    setSupportSessionCookie(res,support.id);
    return res.status(200).json({url:`/client/dashboard?tenantKey=${encodeURIComponent(support.tenantKey)}`,supportSession:{tenantKey:support.tenantKey,actorEmail:support.actorEmail,expiresAt:support.expiresAt,readOnly:true}});
  }catch(error){return res.status(error.message==='support_tenant_not_found'?404:403).json({error:error.message});}
}
