import crypto from 'node:crypto';
import { salesTransaction,SALES_TERMINAL_SQL,enrichSalesProspect } from './salesDialer.js';
import { salesError,getSalesCallSession,getSalesOperatorSettings,getReadySalesDemoProfile,enqueueSalesDemoJob } from './salesRepository.js';
import { buildSalesWebrtcCallOptions } from './salesWebrtc.js';
import { buildSalesCallView } from './salesCallView.js';
import { buildOutboundSalesDemoRealtimeInstructions } from './demoRealtimeSession.js';
import { requestSalesCallGateway } from './salesGatewayClient.js';

export async function salesIncomingAction(pool,{incomingId,repId,action,prospectId,websiteUrl,businessName,interruptedProspectId,env=process.env}) {
 const mode=await pool.query('SELECT phone_test_mode FROM sales_dialer_config WHERE id=TRUE');
 if(mode.rows[0]?.phone_test_mode)throw salesError('sales_test_inbound_paused','Sales inbound calls are paused during phone test mode.',409);
 const incoming=await pool.query('SELECT * FROM sales_incoming_calls WHERE incoming_id=$1 AND rep_user_id=$2',[incomingId,repId]);
 if(!incoming.rowCount)throw salesError('incoming_not_found','Incoming call not found for this rep.',404);
 if(action==='receptionist'){await requestSalesCallGateway(`/internal/incoming/${encodeURIComponent(incomingId)}/receptionist`,{method:'POST',body:{repId}});return {routed:true};}
 if(['match','create'].includes(action)){
  let selected=prospectId;
  if(action==='create'){
   let website;try{website=new URL(/^https?:\/\//i.test(websiteUrl)?websiteUrl:`https://${websiteUrl}`);if(!websiteUrl||!['https:','http:'].includes(website.protocol))throw Error();}catch{throw salesError('website_required','Enter a valid business website.');}
   // Known callers keep their record; unknown calls get one record per inbound identity.
   selected=incoming.rows[0].prospect_id||`sales_prospect_${crypto.randomUUID()}`;
   await pool.query(`INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,website_url,permission_granted,status,assigned_rep_user_id,timezone) VALUES($1,$2,$3,$4,$5,TRUE,'queued',$6,$7) ON CONFLICT(prospect_id) DO UPDATE SET business_name=EXCLUDED.business_name,website_url=EXCLUDED.website_url,status=CASE WHEN sales_prospects.do_not_call THEN sales_prospects.status ELSE 'queued' END`,[selected,`incoming:${incomingId}`,String(businessName||'Incoming caller').slice(0,300),incoming.rows[0].phone_e164,website.toString(),repId,env.SETUP_CALL_TIMEZONE||'America/Los_Angeles']);
  }
  const claimed=await pool.query('UPDATE sales_prospects SET assigned_rep_user_id=$2 WHERE prospect_id=$1 AND (assigned_rep_user_id=$2 OR assigned_rep_user_id IS NULL) RETURNING prospect_id',[selected,repId]);
  if(!claimed.rowCount)throw salesError('prospect_forbidden','Choose a prospect assigned to you.',403);
  await pool.query('UPDATE sales_incoming_calls SET prospect_id=$2,updated_at=NOW() WHERE incoming_id=$1 AND rep_user_id=$3',[incomingId,selected,repId]);
  if(incoming.rows[0].sales_call_id) await pool.query('UPDATE sales_call_sessions SET prospect_id=$2 WHERE sales_call_id=$1 AND admin_user_id=$3',[incoming.rows[0].sales_call_id,selected,repId]);
  if(action==='create')await enqueueSalesDemoJob(pool,{prospectId:selected,adminUserId:repId});
  return {prospect:await enrichSalesProspect(pool,selected,repId)};
 }
 if(action!=='take')throw salesError('invalid_incoming_action','Unsupported incoming action.');
 const settings=await getSalesOperatorSettings(pool,repId);
 if(settings && !settings.active)throw salesError('sales_operator_inactive','Browser calling is disabled.',403);
 const id=`sales_call_${crypto.randomUUID()}`;
 const callOptions=buildSalesWebrtcCallOptions({salesCallId:id,prospectPhone:incoming.rows[0].phone_e164,callerIdNumber:settings?.callerIdNumber||env.SALES_TELNYX_CALLER_ID,callerName:settings?.displayName||'EveryCall'});
 const selected=await salesTransaction(pool,async db=>{
  await db.query('SELECT id FROM admin_users WHERE id=$1 FOR UPDATE',[repId]);
  const active=await db.query(`SELECT 1 FROM sales_call_sessions WHERE admin_user_id=$1 AND state NOT IN (${SALES_TERMINAL_SQL})`,[repId]);
  if(active.rowCount)throw salesError('rep_call_active','Finish your current call first.',409);
  const result=await db.query("UPDATE sales_incoming_calls SET state='claimed',claimed_at=NOW(),updated_at=NOW() WHERE incoming_id=$1 AND rep_user_id=$2 AND state='ringing' AND ring_expires_at>NOW() RETURNING *",[incomingId,repId]);
  if(!result.rowCount)throw salesError('incoming_already_claimed','This call was already answered or routed.',409);
  const row=result.rows[0];let selectedId=row.prospect_id;
  if(!selectedId){selectedId=`sales_prospect_${crypto.randomUUID()}`;await db.query(`INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,permission_granted,status,assigned_rep_user_id,timezone) VALUES($1,$2,'Incoming caller',$3,TRUE,'queued',$4,$5)`,[selectedId,`incoming:${incomingId}`,row.phone_e164,repId,env.SETUP_CALL_TIMEZONE||'America/Los_Angeles']);}
  const owner=await db.query('UPDATE sales_prospects SET assigned_rep_user_id=$2 WHERE prospect_id=$1 AND (assigned_rep_user_id IS NULL OR assigned_rep_user_id=$2) RETURNING prospect_id',[selectedId,repId]);if(!owner.rowCount)throw salesError('prospect_forbidden','This prospect is assigned to another rep.',403);
  const demo=await getReadySalesDemoProfile(db,selectedId);
  const metadata={direction:'inbound',incoming_id:incomingId,prospect_number:row.phone_e164,correlation_id:id,...(demo?{business_name:demo.businessName,realtime_instructions:buildOutboundSalesDemoRealtimeInstructions(demo.demoBundle)}:{})};
  await db.query("INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state,ai_state,prospect_call_control_id,started_at,metadata_json) VALUES($1,$2,$3,'connecting_browser','not_started',$4,NOW(),$5::jsonb)",[id,selectedId,repId,row.provider_call_control_id,JSON.stringify(metadata)]);
  await db.query('UPDATE sales_incoming_calls SET prospect_id=$2,sales_call_id=$3 WHERE incoming_id=$1',[incomingId,selectedId,id]);
  if(interruptedProspectId&&interruptedProspectId!==selectedId) await db.query("UPDATE sales_prospects SET inbound_return=TRUE,callback_at=NULL WHERE prospect_id=$1 AND assigned_rep_user_id=$2 AND status IN ('queued','ready_to_call')",[interruptedProspectId,repId]);
  return selectedId;
 });
 return {call:await buildSalesCallView(pool,await getSalesCallSession(pool,id),{operatorUserId:repId,webrtc:{callOptions}}),prospect:await enrichSalesProspect(pool,selected,repId)};
}
