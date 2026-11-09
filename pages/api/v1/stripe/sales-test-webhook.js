import { applySalesPaidCheckout, getSalesTestStripe } from '../../_lib/salesCheckout.js';
import { salesTransaction } from '../../_lib/salesDialer.js';
import { readRawBody } from '../../_lib/telnyx.js';
import { ensureTables, getPool } from '../../_lib/db.js';

export const config = { api: { bodyParser: false } };
export default async function handler(req,res) {
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'method_not_allowed'});}
 let event;
 try {
  const secret=String(process.env.SALES_STRIPE_TEST_WEBHOOK_SECRET||'').trim();
  if(!secret) return res.status(503).json({ok:false,error:'sales_test_webhook_not_configured'});
  event=getSalesTestStripe().webhooks.constructEvent(await readRawBody(req),req.headers['stripe-signature'],secret);
 }catch(error){return res.status(error.statusCode||400).json({ok:false,error:error.code==='sales_test_checkout_not_configured'?error.code:'invalid_test_webhook_signature'});}
 if(event.livemode!==false)return res.status(400).json({ok:false,error:'sales_test_webhook_mode_mismatch'});
 // This endpoint has no access to the general subscription/payment activation
 // handler. Unrelated sandbox events are acknowledged without side effects.
 if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)||!event.data?.object?.metadata?.sales_checkout_id)return res.status(200).json({ok:true,ignored:true});
 try {
  const pool=getPool();if(!pool)return res.status(503).json({ok:false,error:'database_unavailable'});
  await ensureTables(pool);
  await salesTransaction(pool,db=>applySalesPaidCheckout(db,event,{testWebhook:true}));
  return res.status(200).json({ok:true,test:true});
 }catch(error){return res.status(error.statusCode||500).json({ok:false,error:error.code||'sales_test_webhook_failed'});}
}
