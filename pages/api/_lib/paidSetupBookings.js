import crypto from 'node:crypto';
import { salesAvailability,salesCalendarConfig,salesGraphClient } from './salesCalendar.js';

async function assertPaidOwner(db,tenantKey,ownerId){
 const row=(await db.query(`SELECT u.id,u.email,u.name,p.purchase_id,t.name AS business_name FROM tenant_users u JOIN tenants t USING(tenant_key)
  JOIN tenant_billing_accounts b ON b.tenant_key=u.tenant_key JOIN paid_purchases p ON p.purchase_id=b.paid_purchase_id AND p.tenant_key=u.tenant_key
  WHERE u.id=$1 AND u.tenant_key=$2 AND u.role='owner' AND u.status='active' AND p.payment_status='paid' AND p.paid_at IS NOT NULL
  AND p.livemode=TRUE AND p.recurring_consent_at IS NOT NULL`,[ownerId,tenantKey])).rows[0];
 if(!row)throw Error('setup_payment_required');return row;
}
export async function paidSetupAvailability(pool,{tenantKey,ownerId,...options}){
 await assertPaidOwner(pool,tenantKey,ownerId);
 const existing=(await pool.query('SELECT booking_id,starts_at,ends_at,status FROM paid_setup_bookings WHERE tenant_key=$1',[tenantKey])).rows[0];
 if(existing)return {booking:existing,slots:[]};
 return salesAvailability(pool,options);
}
export async function bookPaidSetup(pool,{tenantKey,ownerId,start,end,env=process.env,graph=null,now=Date.now()}){
 const config=salesCalendarConfig(env),timestamp=Date.parse(start);
 if(!Number.isFinite(timestamp)||timestamp%900000!==0||Date.parse(end)!==timestamp+900000||timestamp<now+config.leadMinutes*60000)throw Error('invalid_booking_slot');
 const request=graph||await salesGraphClient({env});
 const db=await pool.connect();let booking;
 try{
  await db.query('BEGIN');
  // Same shared lock as Sales reservations, without weakening the rep exception.
  await db.query('SELECT id FROM sales_dialer_config WHERE id=TRUE FOR UPDATE');
  await db.query('SELECT tenant_key FROM tenants WHERE tenant_key=$1 FOR UPDATE',[tenantKey]);
  const owner=await assertPaidOwner(db,tenantKey,ownerId);
  booking=(await db.query('SELECT * FROM paid_setup_bookings WHERE tenant_key=$1 FOR UPDATE',[tenantKey])).rows[0];
  if(booking){
   if(Date.parse(booking.starts_at)!==timestamp)throw Error('setup_booking_already_reserved');
   await db.query('COMMIT');return {bookingId:booking.booking_id,status:booking.status,start:booking.starts_at,end:booking.ends_at};
  }
  const available=await salesAvailability(db,{after:start,env,graph:request,now,count:1});
  if(available.slots[0]?.start!==new Date(timestamp).toISOString())throw Error('slot_unavailable');
  const bookingId=`paid_booking_${crypto.randomUUID()}`;
  const payload={subject:`EveryCall setup — ${owner.business_name}`,start:{dateTime:new Date(start).toISOString().replace('Z',''),timeZone:'UTC'},end:{dateTime:new Date(end).toISOString().replace('Z',''),timeZone:'UTC'},
   attendees:[{emailAddress:{address:owner.email,name:owner.name||owner.email},type:'required'}],transactionId:bookingId,body:{contentType:'text',content:'Paid EveryCall customer setup appointment.'}};
  booking=(await db.query(`INSERT INTO paid_setup_bookings(booking_id,tenant_key,purchase_id,owner_user_id,calendar_owner,starts_at,ends_at,attendee_email,provider_payload,status,attempted_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'submitting',$10) RETURNING *`,[bookingId,tenantKey,owner.purchase_id,ownerId,config.owner,start,end,owner.email,payload,new Date(now)])).rows[0];
  await db.query("INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,$2,'setup.booking.submitted',$3)",[tenantKey,`tenant:${ownerId}`,JSON.stringify({bookingId})]);
  await db.query('COMMIT');
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
 try{
  const event=await request(`/users/${encodeURIComponent(config.owner)}/events`,booking.provider_payload);
  if(!event.id)throw Error('calendar_event_unconfirmed');
  await pool.query("UPDATE paid_setup_bookings SET status='booked',provider_event_id=$2 WHERE booking_id=$1",[booking.booking_id,event.id]);
  return {bookingId:booking.booking_id,status:'booked',start:booking.starts_at,end:booking.ends_at};
 }catch(error){
  // No resend after a crash or ambiguous provider response. Keep the slot reserved
  // for operator/provider reconciliation, and show the customer that state.
  await pool.query("UPDATE paid_setup_bookings SET status='uncertain' WHERE booking_id=$1 AND status<>'booked'",[booking.booking_id]);
  return {bookingId:booking.booking_id,status:'uncertain',start:booking.starts_at,end:booking.ends_at};
 }
}
