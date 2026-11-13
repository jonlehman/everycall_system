import { getPool } from '../../_lib/db.js';
import { requireSession } from '../../_lib/auth.js';
import { requireTenantOwner } from '../../_lib/billing.js';
import { paidSetupAvailability,bookPaidSetup } from '../../_lib/paidSetupBookings.js';
export default async function handler(req,res) {
 res.setHeader('Cache-Control','private, no-store');
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'method_not_allowed'});}
 const session=await requireSession(req,res,{role:'tenant'});if(!session)return;
 const owner=await requireTenantOwner(session);if(!owner)return res.status(403).json({error:'owner_required'});
 try{
  const options={tenantKey:session.tenant_key,ownerId:owner.id};
  if(req.method==='POST')return res.status(200).json(await bookPaidSetup(getPool(),{...options,start:req.body?.start,end:req.body?.end}));
  return res.status(200).json({url:'/client/setup-appointment',...await paidSetupAvailability(getPool(),{...options,after:req.query?.after||null})});
 }catch(error){const code=error.code||error.message;return res.status(code==='setup_payment_required'?402:code==='invalid_booking_slot'?400:409).json({error:code});}
}
