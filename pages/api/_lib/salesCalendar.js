import { resolveSalesContactTarget, loadSalesCompanyContacts } from './salesCompanyContacts.js';
import { assertSalesNotTestCall } from './salesPhoneTestMode.js';
import crypto from 'node:crypto';
import { salesError, getSalesCallSession, getSalesProspect } from './salesRepository.js';
import { assertSalesCallAdmin } from './salesCallView.js';
import { salesTransaction } from './salesDialer.js';

export function salesCalendarConfig(env=process.env) {
 const leadMinutes=Number(env.FULL_BUILD_LEAD_MINUTES);
 const owner=String(env.SETUP_CALL_OWNER||'').trim();
 if(!owner || !Number.isFinite(leadMinutes)||leadMinutes<=0) throw salesError('sales_calendar_not_configured','Set SETUP_CALL_OWNER and the measured FULL_BUILD_LEAD_MINUTES before booking.',503);
 if(!env.SALES_GRAPH_TENANT_ID||!env.SALES_GRAPH_CLIENT_ID||!env.SALES_GRAPH_CLIENT_SECRET) throw salesError('sales_calendar_not_configured','Microsoft Outlook calendar credentials are not configured.',503);
 return {owner,leadMinutes,timezone:env.SETUP_CALL_TIMEZONE||'America/Los_Angeles',startHour:Number(env.SETUP_CALL_START_HOUR||9),endHour:Number(env.SETUP_CALL_END_HOUR||17)};
}
export async function salesGraphClient({env=process.env,fetchImpl=fetch}={}) {
 salesCalendarConfig(env);
 const auth=await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(env.SALES_GRAPH_TENANT_ID)}/oauth2/v2.0/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.SALES_GRAPH_CLIENT_ID,client_secret:env.SALES_GRAPH_CLIENT_SECRET,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'}),signal:AbortSignal.timeout(10000)});
 const token=await auth.json();if(!auth.ok||!token.access_token)throw salesError('sales_calendar_auth_failed','Outlook calendar authorization failed.',503);
 return async(path,body)=>{const response=await fetchImpl(`https://graph.microsoft.com/v1.0${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json',Prefer:'outlook.timezone="UTC"'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});const result=await response.json();if(!response.ok)throw salesError('sales_calendar_provider_failed','Outlook calendar request failed.',502);return result;};
}
function graphDate(date) {return {dateTime:new Date(date).toISOString().replace('Z',''),timeZone:'UTC'};}
export async function salesAvailability(pool,{after=null,env=process.env,graph=null,now=Date.now(),count=4}={}) {
 const config=salesCalendarConfig(env);const request=graph||await salesGraphClient({env});
 const earliest=now+config.leadMinutes*60000;
 const requested=after?Date.parse(after):earliest;
 if(!Number.isFinite(requested))throw salesError('invalid_slot_time','Invalid availability start.');
 const start=Math.ceil(Math.max(earliest,requested)/900000)*900000;const end=start+7*86400000;
 const result=await request(`/users/${encodeURIComponent(config.owner)}/calendar/getSchedule`,{schedules:[config.owner],startTime:graphDate(start),endTime:graphDate(end),availabilityViewInterval:15});
 const schedule=result.value?.[0];if(!schedule||schedule.error||typeof schedule.availabilityView!=='string')throw salesError('sales_calendar_unavailable','Outlook did not return availability.',502);
 const reservations=await pool.query("SELECT starts_at,ends_at FROM sales_setup_bookings WHERE calendar_owner=$1 AND status IN ('reserving','booked') AND starts_at<$3 AND ends_at>$2",[config.owner,new Date(start).toISOString(),new Date(end).toISOString()]);
 // During the additive release, old fixtures/deployments may not have the paid
 // ledger yet. Once installed, both booking paths reserve the same calendar.
 if((await pool.query("SELECT to_regclass('paid_setup_bookings') IS NOT NULL AS ready")).rows[0]?.ready){
  const paid=await pool.query('SELECT starts_at,ends_at FROM paid_setup_bookings WHERE calendar_owner=$1 AND starts_at<$3 AND ends_at>$2',[config.owner,new Date(start).toISOString(),new Date(end).toISOString()]);
  reservations.rows.push(...paid.rows);
 }
 const slots=[];
 for(let index=0;index<schedule.availabilityView.length;index++) {
  if(schedule.availabilityView[index]!=='0')continue;
  const timestamp=start+index*900000; const parts=new Intl.DateTimeFormat('en-US',{timeZone:config.timezone,weekday:'short',hour:'numeric',hourCycle:'h23'}).formatToParts(timestamp);
  const weekday=parts.find(p=>p.type==='weekday')?.value;const hour=Number(parts.find(p=>p.type==='hour')?.value);
  if(['Sat','Sun'].includes(weekday)||hour<config.startHour||hour>=config.endHour)continue;
  if(reservations.rows.some(r=>Date.parse(r.starts_at)<timestamp+900000&&Date.parse(r.ends_at)>timestamp))continue;
  slots.push({start:new Date(timestamp).toISOString(),end:new Date(timestamp+900000).toISOString(),label:new Intl.DateTimeFormat('en-US',{timeZone:config.timezone,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(timestamp)});
  if(slots.length>=count)break;
 }
 return {slots,nextAfter:slots.length?slots.at(-1).end:new Date(end).toISOString(),owner:config.owner,leadMinutes:config.leadMinutes,timezone:config.timezone};
}
export async function bookSalesSetup(pool,{salesCallId,repId,start,end,email,contactId,expectedRowVersion,env=process.env,graph=null,now=Date.now()}) {
 const config=salesCalendarConfig(env);const timestamp=Date.parse(start);
 if(!Number.isFinite(timestamp)||timestamp%900000!==0||Date.parse(end)!==timestamp+900000||timestamp<now+config.leadMinutes*60000)throw salesError('invalid_booking_slot','Choose an offered 15-minute slot after the build lead time.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email||''))throw salesError('invalid_email','Enter the owner email.');
 const call=assertSalesCallAdmin(await getSalesCallSession(pool,salesCallId),repId);const prospect=await getSalesProspect(pool,call.prospectId);
 assertSalesNotTestCall(call,prospect);
 const alreadyPaid=Boolean(call.paidAt)||prospect.status==='paid'||Boolean((await pool.query('SELECT 1 FROM sales_checkout_sessions WHERE prospect_id=$1 AND paid_at IS NOT NULL LIMIT 1',[call.prospectId])).rowCount);
 const request=graph||await salesGraphClient({env});
 const booking=await salesTransaction(pool,async db=>{
  const mode=await db.query('SELECT phone_test_mode FROM sales_dialer_config WHERE id=TRUE FOR UPDATE');
  assertSalesNotTestCall(call,{phoneTestMode:mode.rows[0]?.phone_test_mode});
  const owner = await db.query('SELECT assigned_rep_user_id FROM sales_prospects WHERE prospect_id=$1 FOR UPDATE', [call.prospectId]);
  if (Number(owner.rows[0]?.assigned_rep_user_id) !== Number(repId)) throw salesError('prospect_forbidden', 'This prospect has been reassigned. Refresh your workspace.', 403);
  const previous=await db.query("SELECT * FROM sales_setup_bookings WHERE sales_call_id=$1 AND status IN ('reserving','booked') FOR UPDATE",[salesCallId]);
  if(previous.rowCount){const prior=previous.rows[0];if(Date.parse(prior.starts_at)!==timestamp||prior.attendee_email!==email||(contactId&&prior.attendee_snapshot?.contactId!==contactId))throw salesError('sales_booking_exists','This call already has a booking. Contact the calendar owner to change it.',409);return prior;}
  const target=await resolveSalesContactTarget(db,call.prospectId,{contactId:contactId||call.metadata?.contact_id,expectedRowVersion,allowNoNumber:true});
  if(call.metadata?.contact_id&&target.contactId!==call.metadata.contact_id)throw salesError('booking_contact_changed','Use the contact recorded on this call.',409);
  const company=await loadSalesCompanyContacts(db,call.prospectId);
  const currentProspect=await getSalesProspect(db,call.prospectId);
  const attendee={...target.contactSnapshot,email,numbers:[...(company.contacts.find(c=>c.id===target.contactId)?.numbers||[]),...company.sharedNumbers],businessName:currentProspect.businessName};
  const bookingId=`sales_booking_${crypto.randomUUID()}`;
  const providerPayload={subject:`EveryCall setup — ${attendee.businessName}`,start:graphDate(start),end:graphDate(end),attendees:[{emailAddress:{address:email,name:attendee.displayName||email},type:'required'}],transactionId:bookingId,body:{contentType:'text',content:[`Business: ${attendee.businessName}`,`Contact: ${attendee.displayName||''}`,`Numbers: ${attendee.numbers.map(n=>`${n.label}: ${n.phoneE164}`).join(', ')}`,`Payment at booking: ${alreadyPaid?'PAID':'UNPAID'}`,`Call: ${String(env.APP_BASE_URL||'').replace(/\/$/,'')}/sales/calls/${encodeURIComponent(salesCallId)}`].join('\n')}};
  const collision=await db.query("SELECT 1 FROM sales_setup_bookings WHERE calendar_owner=$1 AND status IN ('reserving','booked') AND starts_at<$3 AND ends_at>$2",[config.owner,start,end]);
  if(collision.rowCount)throw salesError('slot_unavailable','That slot was just booked. Choose another.',409);
  const available=await salesAvailability(db,{after:start,env,graph:request,now,count:1});
  if(available.slots[0]?.start!==new Date(timestamp).toISOString())throw salesError('slot_unavailable','That slot is no longer available.',409);
  const row=await db.query(`INSERT INTO sales_setup_bookings(booking_id,sales_call_id,rep_user_id,calendar_owner,starts_at,ends_at,attendee_email,paid_at_booking,attendee_snapshot,provider_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) RETURNING *`,[bookingId,salesCallId,repId,config.owner,start,end,email,alreadyPaid,JSON.stringify(attendee),JSON.stringify(providerPayload)]);return row.rows[0];
 });
 if(booking.status==='booked')return booking;
 // Keep uncertain provider writes reserved. transactionId makes a retry the same event.
 if(!booking.provider_payload)throw salesError('booking_snapshot_missing','This legacy reservation needs calendar-owner review before retrying.',409);
 const event=await request(`/users/${encodeURIComponent(booking.calendar_owner)}/events`,booking.provider_payload);
 if(!event.id)throw salesError('sales_calendar_provider_failed','Outlook did not confirm the calendar event.',502);
 await salesTransaction(pool,async db=>{await db.query("UPDATE sales_setup_bookings SET status='booked',provider_event_id=$2,updated_at=NOW() WHERE booking_id=$1",[booking.booking_id,event.id]);await db.query('UPDATE sales_call_sessions SET booked_at=COALESCE(booked_at,NOW()),updated_at=NOW() WHERE sales_call_id=$1',[salesCallId]);});
 return {...booking,status:'booked',provider_event_id:event.id};
}
