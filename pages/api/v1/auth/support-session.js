import { getPool } from '../../_lib/db.js';
import { getStaffSession,getSupportSessionCookie,clearSupportSessionCookie } from '../../_lib/auth.js';
import { endSupportSession } from '../../_lib/supportSessions.js';
export default async function handler(req,res) {
  if(req.method!=='DELETE'){res.setHeader('Allow','DELETE');return res.status(405).json({error:'method_not_allowed'});}
  const staffSession=await getStaffSession(req);
  if(staffSession)await endSupportSession(getPool(),{supportId:getSupportSessionCookie(req),staffSession});
  clearSupportSessionCookie(res);return res.status(200).json({ok:true});
}
