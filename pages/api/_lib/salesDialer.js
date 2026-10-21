import { getSalesProspectDetail, getSalesProspect, enqueueSalesDemoJob, salesError, serializeSalesCallSession } from './salesRepository.js';

export const SALES_PHASE_SCRIPTS = Object.freeze({
  opener: "Hi {first_name}, this is {rep_name} with EveryCall. Do you have a minute?",
  if_interested: "I built a quick example for {business_name}. You can hear how it handles a customer call.",
  if_voicemail: "Hi {first_name}, this is {rep_name} with EveryCall. I have a receptionist demo for {business_name}. You can reach me at {rep_phone}.",
  talk_discovery: "What happens when a customer calls while your team is busy? Who answers after hours?",
  handoff: "I can show you in about two minutes. I'll put our AI receptionist on — she already knows everything from the main pages of your website. Ask her anything a customer would ask your receptionist.",
  objections: [{ title: 'We already have someone', text: 'This can cover the calls your team cannot get to.' }, { title: 'Will it sound like a robot?', text: 'Try it yourself and hear how it answers.' }],
  no_time: "When would be a better time for me to call?",
  gatekeeper: "Who handles your phone coverage, and when is the best time to reach them?",
  while_you_listen: 'Listen for the questions customers ask your business.',
  exit_line: "Let me come back on. How did that sound?",
  close: 'The setup is $100 and includes your first month. I can send the secure checkout link and book 15 minutes with Jon.',
  close_decline: 'Jon can take it at the start of your setup call.'
});
export const SALES_TERMINAL_SQL = "'closed','ended','completed','failed','no_answer','voicemail','wrong_number','not_interested','do_not_call','canceled','cancelled'";
export const SALES_UNSUPPRESSED_SQL = `NOT EXISTS (SELECT 1 FROM sales_dnc_registry r WHERE (r.identity_type='phone' AND (r.identity_value=p.phone_e164 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.numbers_json) n WHERE n->>'phoneE164'=r.identity_value))) OR (r.identity_type='domain' AND r.identity_value=sales_website_domain(p.website_url)))`;

export async function salesTransaction(pool, operation) {
  const db = typeof pool.connect === 'function' ? await pool.connect() : pool;
  try { await db.query('BEGIN'); const value=await operation(db); await db.query('COMMIT'); return value; }
  catch(error) { await db.query('ROLLBACK').catch(()=>{}); throw error; }
  finally { if(db!==pool) db.release(); }
}
export async function assertSalesProspectOwner(pool, prospectId, repId, {allowUnassigned=false}={}) {
  const result=await pool.query('SELECT assigned_rep_user_id FROM sales_prospects WHERE prospect_id=$1',[prospectId]);
  if (!result.rowCount) throw salesError('prospect_not_found','Prospect not found.',404);
  if (Number(result.rows[0].assigned_rep_user_id)!==Number(repId) && !(allowUnassigned && result.rows[0].assigned_rep_user_id===null)) throw salesError('prospect_forbidden','This prospect belongs to another rep.',403);
}
export async function getSalesDialerSettings(pool, actor, env=process.env) {
  const stored=await pool.query('SELECT scripts_json FROM sales_dialer_config WHERE id=TRUE');
  const lead=Number(env.FULL_BUILD_LEAD_MINUTES);
  return {scripts:{...SALES_PHASE_SCRIPTS,...stored.rows[0]?.scripts_json},config:{removePromptAt:Math.max(1,Number(env.REMOVE_PROMPT_AT)||4),fullBuildLeadMinutes:Number.isFinite(lead)&&lead>0?lead:null,setupCallOwner:env.SETUP_CALL_OWNER||null,scriptsEditUrl:'/sales/scripts',inboundConfigured:Boolean(env.SALES_INBOUND_RECEPTIONIST_NUMBER || (env.SALES_CALL_GATEWAY_BASE_URL && env.SALES_OPENAI_API_KEY))},operator:{id:Number(actor.id),name:actor.name||actor.display_name||actor.username||actor.email||'Rep',role:actor.role,canEditScripts:['admin','super_admin'].includes(actor.role)}};
}
export async function saveSalesScripts(pool,scripts) {
  if(!scripts||typeof scripts!=='object'||Array.isArray(scripts)) throw salesError('invalid_scripts','Scripts must be an object.');
  const clean={};
  for(const [key,value] of Object.entries(scripts)) {
    if(!(key in SALES_PHASE_SCRIPTS)) throw salesError('invalid_script_phase',`Unsupported phase: ${key}`);
    if(key==='objections') {
      if(!Array.isArray(value)||value.length>10||value.some(v=>typeof v?.title!=='string'||typeof v?.text!=='string')) throw salesError('invalid_objections','Objections require title and text.');
      clean[key]=value.map(v=>({title:v.title.slice(0,120),text:v.text.slice(0,4000)}));
    } else { if(typeof value!=='string') throw salesError('invalid_script','Script must be text.'); clean[key]=value.slice(0,8000); }
  }
  await pool.query("UPDATE sales_dialer_config SET scripts_json=scripts_json || $1::jsonb,updated_at=NOW() WHERE id=TRUE",[JSON.stringify(clean)]);
}
export async function enrichSalesProspect(pool,prospectId,repId) {
  const prospect=await getSalesProspectDetail(pool,prospectId,{operatorUserId:repId});
  if(!prospect) return null;
  const counts=await pool.query(`SELECT COUNT(*) FILTER (WHERE metadata_json->>'direction' IS DISTINCT FROM 'inbound') AS attempts,COUNT(*) FILTER (WHERE connected_at IS NOT NULL) AS conversations FROM sales_call_sessions WHERE prospect_id=$1`,[prospectId]);
  prospect.attemptCount=Number(counts.rows[0]?.attempts||0); prospect.conversationCount=Number(counts.rows[0]?.conversations||0);
  prospect.history=prospect.calls;
  prospect.numbers=prospect.numbers.map(number=>{const history=prospect.calls.filter(c=>c.dialedNumber===number.phoneE164);return {...number,lastConnectedAt:history.find(c=>c.connectedAt)?.connectedAt||null,lastNote:history.find(c=>c.outcomeNotes||c.liveNotes)?.outcomeNotes||history.find(c=>c.liveNotes)?.liveNotes||null};}).sort((a,b)=>Number(Boolean(b.lastConnectedAt))-Number(Boolean(a.lastConnectedAt))||(a.type==='cell'?-1:b.type==='cell'?1:0));
  return prospect;
}
export async function listSalesIncoming(pool,repId) {
  const result=await pool.query(`SELECT i.*,p.business_name,p.contact_name,p.last_outcome,p.last_outcome_at,
    NOT EXISTS(SELECT 1 FROM sales_call_sessions c WHERE c.admin_user_id=$1 AND c.state NOT IN (${SALES_TERMINAL_SQL})) AS can_take
    FROM sales_incoming_calls i LEFT JOIN sales_prospects p ON p.prospect_id=i.prospect_id WHERE i.rep_user_id=$1 AND i.state IN ('ringing','receptionist') AND i.ring_expires_at>NOW() ORDER BY i.created_at LIMIT 5`,[repId]);
  return result.rows.map(r=>({incomingId:r.incoming_id,phoneE164:r.phone_e164,prospectId:r.prospect_id,businessName:r.business_name,contactName:r.contact_name,state:r.state,canTake:r.can_take && r.state==='ringing',ringExpiresAt:r.ring_expires_at,context:r.last_outcome?`Returning your call — last outcome: ${r.last_outcome.replaceAll('_',' ')}`:'Returned your call'}));
}
export async function listSalesReturnItems(pool,repId) {
  const result=await pool.query(`SELECT i.*,p.business_name,p.contact_name,p.website_url,d.status AS demo_status FROM sales_incoming_calls i JOIN sales_prospects p USING(prospect_id) LEFT JOIN sales_demo_profiles d USING(prospect_id) WHERE i.rep_user_id=$1 AND i.state='receptionist' AND p.inbound_return=TRUE AND NOT p.do_not_call AND NOT p.suppressed AND COALESCE(d.status,'not_prepared')<>'ready' ORDER BY i.created_at DESC LIMIT 20`,[repId]);
  return result.rows.map(r=>({incomingId:r.incoming_id,prospectId:r.prospect_id,phoneE164:r.phone_e164,businessName:r.business_name,contactName:r.contact_name,message:r.message||'',needsWebsite:!r.website_url,state:'return_pending',demoStatus:r.demo_status||'not_prepared',canTake:false}));
}
export async function getSalesRepQueue(pool,repId,{timezone='UTC',actor={id:repId},env=process.env}={}) {
  try { new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format(); } catch {throw salesError('invalid_timezone','Provide an IANA timezone.');}
  // Claims are durable, and SKIP LOCKED prevents two reps acquiring the same prospect.
  await salesTransaction(pool,async db=>{
    await db.query('SELECT id FROM admin_users WHERE id=$1 FOR UPDATE',[repId]);
    const count=await db.query(`SELECT count(*) AS n FROM sales_prospects p LEFT JOIN sales_demo_profiles d USING(prospect_id) WHERE p.assigned_rep_user_id=$1 AND p.status IN ('queued','ready_to_call') AND p.permission_granted AND NOT p.do_not_call AND NOT p.suppressed AND p.website_url IS NOT NULL AND (p.callback_at IS NULL OR p.callback_at<=NOW()) AND COALESCE(d.status,'not_prepared')<>'failed' AND NOT EXISTS(SELECT 1 FROM sales_call_sessions c WHERE c.prospect_id=p.prospect_id AND c.state NOT IN (${SALES_TERMINAL_SQL})) AND ${SALES_UNSUPPRESSED_SQL}`,[repId]);
    const needed=Math.max(0,10-Number(count.rows[0]?.n||0));
    if(needed) await db.query(`WITH candidates AS (SELECT p.prospect_id FROM sales_prospects p WHERE p.assigned_rep_user_id IS NULL AND p.permission_granted AND NOT p.suppressed AND NOT p.do_not_call AND p.status IN ('queued','ready_to_call') AND p.website_url IS NOT NULL AND (p.callback_at IS NULL OR p.callback_at<=NOW()) AND NOT EXISTS(SELECT 1 FROM sales_demo_profiles failed WHERE failed.prospect_id=p.prospect_id AND failed.status='failed') AND ${SALES_UNSUPPRESSED_SQL} ORDER BY p.queue_position FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE sales_prospects p SET assigned_rep_user_id=$1 FROM candidates c WHERE p.prospect_id=c.prospect_id`,[repId,needed]);
  });
  const candidates=await pool.query(`SELECT p.prospect_id,d.status AS demo_status FROM sales_prospects p LEFT JOIN sales_demo_profiles d USING(prospect_id) WHERE p.assigned_rep_user_id=$1 AND p.permission_granted AND NOT p.suppressed AND NOT p.do_not_call AND p.status IN ('queued','ready_to_call') AND p.website_url IS NOT NULL AND (p.callback_at IS NULL OR p.callback_at<=NOW()) AND NOT EXISTS(SELECT 1 FROM sales_call_sessions c WHERE c.prospect_id=p.prospect_id AND c.state NOT IN (${SALES_TERMINAL_SQL})) AND ${SALES_UNSUPPRESSED_SQL} ORDER BY CASE WHEN p.callback_at<=NOW() THEN 0 WHEN p.inbound_return THEN 1 ELSE 2 END,p.callback_at ASC NULLS LAST,p.queue_position`,[repId]);
  const ready=candidates.rows.filter(r=>r.demo_status==='ready');
  if(ready.length<=9) for(const row of candidates.rows.filter(r=>!['ready','failed','preparing'].includes(r.demo_status)).slice(0,10-ready.length)) await enqueueSalesDemoJob(pool,{prospectId:row.prospect_id,adminUserId:repId});
  const queue=(await Promise.all(ready.map(r=>enrichSalesProspect(pool,r.prospect_id,repId)))).filter(p=>p && !p.activeSalesCallId && (!p.callbackAt||Date.parse(p.callbackAt)<=Date.now()));
  const counters=await pool.query(`SELECT COUNT(*) FILTER(WHERE (COALESCE(started_at,created_at) AT TIME ZONE $2)::date=(NOW() AT TIME ZONE $2)::date AND metadata_json->>'direction' IS DISTINCT FROM 'inbound') AS dials,COUNT(*) FILTER(WHERE (connected_at AT TIME ZONE $2)::date=(NOW() AT TIME ZONE $2)::date) AS conversations,COUNT(*) FILTER(WHERE (demo_started_at AT TIME ZONE $2)::date=(NOW() AT TIME ZONE $2)::date) AS demos,COUNT(*) FILTER(WHERE (paid_at AT TIME ZONE $2)::date=(NOW() AT TIME ZONE $2)::date) AS paid FROM sales_call_sessions WHERE admin_user_id=$1`,[repId,timezone]);
  return {queue,readyCount:queue.length,counters:Object.fromEntries(Object.entries(counters.rows[0]).map(([k,v])=>[k,Number(v)])),...await getSalesDialerSettings(pool,actor,env),incoming:await listSalesIncoming(pool,repId),returnItems:await listSalesReturnItems(pool,repId)};
}
export async function saveSalesLiveNotes(pool,id,repId,notes) {
  const result=await pool.query('UPDATE sales_call_sessions SET live_notes=$3,updated_at=NOW() WHERE sales_call_id=$1 AND admin_user_id=$2 RETURNING *',[id,repId,String(notes||'').slice(0,5000)]);
  if(!result.rowCount) throw salesError('sales_call_forbidden','Call not found for this rep.',403);
  return serializeSalesCallSession(result.rows[0]);
}
export async function removeSalesQueueProspect(pool,id,repId) {
  await assertSalesProspectOwner(pool,id,repId);
  const active=await pool.query(`SELECT 1 FROM sales_call_sessions WHERE prospect_id=$1 AND state NOT IN (${SALES_TERMINAL_SQL})`,[id]);
  if(active.rowCount) throw salesError('sales_call_end_required','End the call before removing this prospect.',409);
  await pool.query("UPDATE sales_prospects SET status='removed',removed_reason='attempts_exhausted',callback_at=NULL,assigned_rep_user_id=NULL,updated_at=NOW() WHERE prospect_id=$1",[id]);
  return getSalesProspect(pool,id);
}
