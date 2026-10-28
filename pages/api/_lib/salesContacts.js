import crypto from 'node:crypto';
import { normalizeSalesPhone, parseSalesPermission, normalizeSalesImportRecord, createSalesProspect, enqueueSalesDemoJob, getSalesProspect, normalizeSalesText, salesError, serializeProspect, PROSPECT_WITH_DEMO_SELECT } from './salesRepository.js';
import { salesTransaction, SALES_TERMINAL_SQL, SALES_UNSUPPRESSED_SQL } from './salesDialer.js';

export const CONTACT_STATUSES = ['all','in_queue','callback','demo_done','link_sent','paid','not_interested','do_not_call','removed','not_prepped'];
const contactStatusSql = `CASE
 WHEN p.status='paid' OR p.last_outcome='paid' THEN 'paid'
 WHEN p.dnc_reason='not_interested' OR p.status='not_interested' OR p.last_outcome='not_interested' THEN 'not_interested'
 WHEN p.do_not_call OR p.suppressed OR NOT (${SALES_UNSUPPRESSED_SQL}) THEN 'do_not_call'
 WHEN p.status='removed' THEN 'removed'
 WHEN p.callback_at IS NOT NULL THEN 'callback'
 WHEN p.last_outcome='signup_link_sent' THEN 'link_sent'
 WHEN p.last_outcome='demo_completed' THEN 'demo_done'
 WHEN COALESCE(d.status,'not_prepared')<>'ready' THEN 'not_prepped'
 WHEN p.status IN ('queued','ready_to_call') THEN 'in_queue'
 ELSE 'not_prepped' END`;

// Use literal text search, or digits-only partial matching across every phone.
export function salesContactSearchSql(search, values) {
  const text = normalizeSalesText(search, 200);
  if (!text) return null;
  values.push(`%${text.replace(/[\\%_]/g,'\\$&')}%`);
  const literal = `$${values.length}`;
  const phoneDigits = /^[+\d\s().-]+$/.test(text) ? text.replace(/\D/g,'') : '';
  values.push(phoneDigits ? `%${phoneDigits}%` : null);
  const digits = `$${values.length}`;
  return `(p.business_name ILIKE ${literal} OR p.contact_name ILIKE ${literal} OR p.website_url ILIKE ${literal}
    OR (${digits}::text IS NOT NULL AND (regexp_replace(p.phone_e164,'[^0-9]','','g') LIKE ${digits}
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p.numbers_json) n WHERE regexp_replace(n->>'phoneE164','[^0-9]','','g') LIKE ${digits}))))`;
}

export async function listSalesContacts(pool, { repId, search='', contactStatus='all', metro='', cursor='', limit=25 }={}) {
  if (!CONTACT_STATUSES.includes(contactStatus)) throw salesError('invalid_contact_status','Choose a valid contact status.');
  const safeLimit = Math.min(100,Math.max(1,Math.floor(Number(limit)||25)));
  const values = [Number(repId)];
  const where = ['p.assigned_rep_user_id=$1',"p.status<>'deleted'"];
  const searchSql = salesContactSearchSql(search,values);
  if (searchSql) where.push(searchSql);
  if (metro) { values.push(normalizeSalesText(metro,120)); where.push(`p.metadata_json->>'metro'=$${values.length}`); }
  const scope = crypto.createHash('sha256').update(JSON.stringify([Number(repId),search,contactStatus,metro])).digest('hex');
  let after = null;
  if (cursor) {
    try {
      after = JSON.parse(Buffer.from(cursor,'base64url').toString());
      if (after.scope!==scope || typeof after.id!=='string' || typeof after.at!=='string' || !Number.isFinite(Date.parse(after.at))) throw Error();
    } catch { throw salesError('invalid_contacts_cursor','Reload the contact list.'); }
  }
  const base = `WITH contacts AS (SELECT p.prospect_id, ${contactStatusSql} AS contact_status,
    GREATEST(p.updated_at,p.last_outcome_at,d.updated_at,activity.at) AS activity_at,
    COALESCE(activity.attempts,0)::integer AS attempts
    FROM sales_prospects p LEFT JOIN sales_demo_profiles d USING(prospect_id)
    LEFT JOIN LATERAL (SELECT MAX(updated_at) AS at,COUNT(*) FILTER(WHERE metadata_json->>'direction' IS DISTINCT FROM 'inbound') AS attempts
      FROM sales_call_sessions WHERE prospect_id=p.prospect_id AND metadata_json->>'phone_test_mode' IS DISTINCT FROM 'true') activity ON TRUE
    WHERE ${where.join(' AND ')})`;
  // A single statement provides consistent counts and page membership. Timestamp text
  // preserves Postgres microseconds for keyset pagination; JS Date would truncate them.
  values.push(contactStatus);
  const statusParam = `$${values.length}`;
  values.push(after?.at||null,after?.id||null,safeLimit+1);
  const countResult = await pool.query(`${base}, selected AS (SELECT * FROM contacts WHERE ${statusParam}='all' OR contact_status=${statusParam}),
    page AS (SELECT * FROM selected WHERE $${values.length-2}::timestamptz IS NULL OR (activity_at,prospect_id)<($${values.length-2}::timestamptz,$${values.length-1}::text) ORDER BY activity_at DESC,prospect_id DESC LIMIT $${values.length})
    SELECT (SELECT COUNT(*) FROM selected) AS total,
      (SELECT jsonb_object_agg(contact_status,n) FROM (SELECT contact_status,COUNT(*) AS n FROM contacts GROUP BY contact_status) counts) AS counts,
      (SELECT COUNT(*) FROM contacts) AS all_count,
      (SELECT jsonb_agg(jsonb_build_object('id',prospect_id,'at',activity_at::text,'status',contact_status,'attempts',attempts) ORDER BY activity_at DESC,prospect_id DESC) FROM page) AS page,
      (SELECT jsonb_agg(metro ORDER BY metro) FROM (SELECT DISTINCT NULLIF(metadata_json->>'metro','') AS metro FROM sales_prospects WHERE assigned_rep_user_id=$1 AND status<>'deleted') m WHERE metro IS NOT NULL) AS metros`,values);
  const result = countResult.rows[0];
  const page = result.page||[];
  const hasMore = page.length>safeLimit;
  page.splice(safeLimit);
  const rows = page.length ? await pool.query(`${PROSPECT_WITH_DEMO_SELECT} WHERE p.assigned_rep_user_id=$1 AND p.prospect_id=ANY($2::text[])`,[repId,page.map(p=>p.id)]) : {rows:[]};
  const byId = new Map(rows.rows.map(row=>[row.prospect_id,serializeProspect(row)]));
  const last = page.at(-1);
  return { prospects:page.filter(p=>byId.has(p.id)).map(p=>({...byId.get(p.id),contactStatus:p.status,attemptCount:p.attempts,lastActivityAt:p.at})),
    total:Number(result.total),counts:Object.fromEntries(CONTACT_STATUSES.map(key=>[key,key==='all'?Number(result.all_count):Number(result.counts?.[key]||0)])),metros:result.metros||[],
    nextCursor:hasMore&&last?Buffer.from(JSON.stringify({scope,id:last.id,at:last.at})).toString('base64url'):null };
}

export async function lockSalesContactMode(db) {
  const mode = await db.query('SELECT phone_test_mode FROM sales_dialer_config WHERE id=TRUE FOR SHARE');
  if (!mode.rowCount || mode.rows[0].phone_test_mode) throw salesError('sales_phone_test_mode_active','Restore original Sales phones before changing contacts.',409);
}

export async function createSalesContact(pool, record, {repId,env=process.env,existingProspectId=null,expectedRowVersion,allowedSalesCallId=null,inTransaction=false}={}) {
  const transact=inTransaction ? operation=>operation(pool) : operation=>salesTransaction(pool,operation);
  return transact(async db=>{
    await lockSalesContactMode(db);
    // Contact entry is allowed before consent/timezone are known. Keep both unknown;
    // existing preparation and calling gates decide what may happen next.
    if(record.numbers!==undefined&&(!Array.isArray(record.numbers)||record.numbers.length>20)) throw salesError('invalid_numbers','Provide at most 20 phone numbers.');
    let input={...record,permission:record.permission??record.permission_granted??false,email_permission:false};
    let prospect;
    if(existingProspectId) {
      const locked=await db.query(`SELECT p.*,${SALES_UNSUPPRESSED_SQL} AS unsuppressed FROM sales_prospects p WHERE prospect_id=$1 FOR UPDATE`,[existingProspectId]);
      const existing=locked.rows[0];
      if(Number(existing?.assigned_rep_user_id)!==Number(repId)) throw salesError('prospect_forbidden','This prospect belongs to another rep.',403);
      if(!existing.unsuppressed) throw salesError('contact_identity_suppressed','This contact is permanently suppressed and its identity cannot be changed here.',409);
      const stub=existing.source_key.startsWith('incoming:')&&existing.business_name==='Incoming caller'&&Number(existing.row_version)===1;
      if(!Number.isInteger(expectedRowVersion)||expectedRowVersion!==Number(existing.row_version)) throw salesError('prospect_version_conflict','This contact changed. Refresh and try again.',409);
      const active=await db.query(`SELECT 1 FROM sales_call_sessions WHERE prospect_id=$1 AND state NOT IN (${SALES_TERMINAL_SQL}) AND sales_call_id IS DISTINCT FROM $2 LIMIT 1`,[existingProspectId,allowedSalesCallId]);
      if(active.rowCount) throw salesError('sales_call_end_required','End the other call before changing this contact.',409);
      const combinedNumbers=[...(existing.numbers_json||[]),...(record.numbers||[])];
      if(!combinedNumbers.some(number=>normalizeSalesPhone(number.phoneE164||number.phone)===normalizeSalesPhone(record.phone))) combinedNumbers.push({phoneE164:record.phone,type:'other',label:'Incoming'});
      input={...input,business_name:record.business_name??existing.business_name,contact_name:record.contact_name??existing.contact_name,
        phone:existing.phone_e164,numbers:combinedNumbers,
        website:record.website??existing.website_url,permission:record.permission??(stub?false:existing.permission_granted),timezone:record.timezone??(stub?null:existing.timezone)};
      const normalized=normalizeSalesImportRecord(input,{env:parseSalesPermission(input.permission)?env:{...env,SALES_CALL_MISSING_TIMEZONE_POLICY:'allow'}});
      if(existing.website_url && normalized.websiteUrl!==existing.website_url) throw salesError('contact_website_change_requires_edit','This contact already has a website. Change it in prospect administration before preparing a new demo.',409);
      await db.query(`UPDATE sales_prospects SET business_name=$2,contact_name=$3,phone_e164=$4,numbers_json=$5::jsonb,website_url=$6,permission_granted=$7,permission_recorded_at=NOW(),timezone=$8,row_version=row_version+1,updated_at=NOW() WHERE prospect_id=$1`,[existingProspectId,normalized.businessName,normalized.contactName,normalized.phoneE164,JSON.stringify(normalized.numbers),normalized.websiteUrl,normalized.permissionGranted,normalized.timezone]);
      prospect=await getSalesProspect(db,existingProspectId);
    } else prospect=await createSalesProspect(db,input,{adminUserId:repId,env:parseSalesPermission(input.permission)?env:{...env,SALES_CALL_MISSING_TIMEZONE_POLICY:'allow'}});
    await db.query('UPDATE sales_prospects SET assigned_rep_user_id=$2 WHERE prospect_id=$1',[prospect.prospectId,repId]);
    let preparation = {status:'not_requested'};
    if (prospect.websiteUrl) {
      if (prospect.preparationEligible) { await enqueueSalesDemoJob(db,{prospectId:prospect.prospectId,adminUserId:repId}); preparation={status:'queued'}; }
      else preparation={status:'blocked',reason:prospect.callBlockedReason};
    }
    return {prospect:await getSalesProspect(db,prospect.prospectId),preparation};
  });
}

export async function mutateSalesContact(pool, {prospectId,repId,action,callbackAt,expectedRowVersion,requireVersion=true}) {
  if (requireVersion && (!Number.isInteger(expectedRowVersion)||expectedRowVersion<1)) throw salesError('invalid_row_version','Reload the contact before changing it.');
  if (action==='callback' && callbackAt!==null && (typeof callbackAt!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(callbackAt)||!Number.isFinite(Date.parse(callbackAt))||Date.parse(callbackAt)<=Date.now())) throw salesError('invalid_callback_at','Choose a future callback date and time with a timezone.');
  return salesTransaction(pool,async db=>{
    await lockSalesContactMode(db);
    // Call reservation takes the same rep lock before its active-call check.
    await db.query('SELECT id FROM admin_users WHERE id=$1 FOR UPDATE',[repId]);
    const locked=await db.query(`SELECT p.*,${SALES_UNSUPPRESSED_SQL} AS unsuppressed FROM sales_prospects p WHERE prospect_id=$1 FOR UPDATE`,[prospectId]);
    const row=locked.rows[0];
    if(!row) throw salesError('prospect_not_found','Prospect not found.',404);
    if(Number(row.assigned_rep_user_id)!==Number(repId)) throw salesError('prospect_forbidden','This prospect belongs to another rep.',403);
    if(expectedRowVersion!=null && Number(expectedRowVersion)!==Number(row.row_version)) throw salesError('prospect_version_conflict','This contact changed. Refresh and try again.',409);
    const active=await db.query(`SELECT 1 FROM sales_call_sessions WHERE prospect_id=$1 AND state NOT IN (${SALES_TERMINAL_SQL}) LIMIT 1`,[prospectId]);
    if(active.rowCount) throw salesError('sales_call_end_required','End the call before changing this contact.',409);
    const blocked=row.do_not_call||row.suppressed||!row.unsuppressed||['paid','not_interested','do_not_call','deleted'].includes(row.status)||row.last_outcome==='paid';
    if(action==='restore') {
      if(row.status!=='removed'||blocked) throw salesError('contact_restore_blocked','Only removed contacts without permanent suppression can be restored.',409);
      await db.query("UPDATE sales_prospects SET status='queued',removed_reason=NULL,callback_at=NULL,row_version=row_version+1,updated_at=NOW() WHERE prospect_id=$1",[prospectId]);
    } else if(action==='remove') {
      if(blocked) throw salesError('contact_remove_blocked','This contact has a permanent status and cannot be removed.',409);
      await db.query("UPDATE sales_prospects SET status='removed',removed_reason='attempts_exhausted',callback_at=NULL,row_version=row_version+1,updated_at=NOW() WHERE prospect_id=$1",[prospectId]);
    } else if(action==='callback') {
      if(callbackAt!==null&&(blocked||!['queued','ready_to_call'].includes(row.status))) throw salesError('contact_callback_blocked','This contact cannot be scheduled for a call.',409);
      await db.query('UPDATE sales_prospects SET callback_at=$2,row_version=row_version+1,updated_at=NOW() WHERE prospect_id=$1',[prospectId,callbackAt]);
    } else throw salesError('invalid_contact_action','Unsupported contact action.');
    return getSalesProspect(db,prospectId);
  });
}
