import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { MailtrapClient } from 'mailtrap';
import { createSalesIntroEmailDraft, sendSalesIntroEmail, validateSalesIntroEmailMessage, reconcileSalesIntroEmailDelivery } from '../pages/api/_lib/salesIntroEmail.js';
import { sendTransactionalEmail } from '../pages/api/_lib/mail.js';
import { updateSalesProspectEmailState } from '../pages/api/_lib/salesRepository.js';
import { setSalesPhoneTestMode } from '../pages/api/_lib/salesPhoneTestMode.js';
import { SALES_INTRO_EMAIL_SUBJECT, salesIntroEmailText } from '../lib/salesIntroEmail.js';

const target=process.env.EVERYCALL_TEST_POSTGRES_URL;
if(target)assert(['127.0.0.1','localhost','[::1]'].includes(new URL(target).hostname),'Only isolated loopback PostgreSQL is allowed.');
const schema=`intro_email_${crypto.randomBytes(6).toString('hex')}`;
let pool,db,admin;
if(target){
  admin=new pg.Pool({connectionString:target});await admin.query(`CREATE SCHEMA ${schema}`);
  pool=new pg.Pool({connectionString:target,options:`-c search_path=${schema},public`});
  db={exec:sql=>pool.query(sql),close:async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
}else{
  db=new PGlite();const query=async(sql,args=[])=>{const r=await db.query(sql,args);return {...r,rowCount:r.rows?.length||r.affectedRows||0};};
  pool={query,connect:async()=>({query,release(){}})};
}
const q=(sql,args=[])=>pool.query(sql,args);
const blocked=code=>error=>error.code===code;
const migration=async name=>db.exec(await fs.readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
const providerCalls=[];
const mail=async payload=>{providerCalls.push(payload);return {id:`email-${providerCalls.length}`,provider:'stub'};};
const sessionFor=id=>({id:`session-${id}`,role:id===3?'admin':'sales'});
const draft=(id='company',extra={})=>createSalesIntroEmailDraft(pool,{prospectId:id,repId:1,authenticatedSession:sessionFor(extra.repId||1),contactId:`contact_legacy_${id}`,...extra});
const send=(value,extra={})=>sendSalesIntroEmail(pool,{prospectId:'company',repId:1,authenticatedSession:sessionFor(extra.repId||1),draftToken:value.draftToken,subject:value.subject,text:value.text,idempotencyKey:`key-${value.draftToken}`,mail,...extra});
try {
  await db.exec(`CREATE TABLE admin_users(id BIGSERIAL PRIMARY KEY,email TEXT,role TEXT);
    CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id BIGINT,role TEXT,tenant_key TEXT,expires_at TIMESTAMPTZ);
    CREATE TABLE tenants(tenant_key TEXT PRIMARY KEY,name TEXT,industry TEXT,app_access_status TEXT,billing_status TEXT,live_prompt_mode TEXT,updated_at TIMESTAMPTZ,status TEXT,telnyx_voice_number TEXT,telnyx_voice_status TEXT,service_access_status TEXT,billing_lock_reason TEXT);
    CREATE TABLE audit_log(id BIGSERIAL PRIMARY KEY,tenant_key TEXT,actor TEXT,action TEXT,details TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
    INSERT INTO admin_users(id,email,role) VALUES(1,'rep@example.test','sales'),(2,'other@example.test','sales'),(3,'admin@example.test','admin');
    INSERT INTO sessions(id,user_id,role,expires_at) VALUES('session-1',1,'sales',NOW()+INTERVAL '1 day'),('session-2',2,'sales',NOW()+INTERVAL '1 day'),('session-3',3,'admin',NOW()+INTERVAL '1 day');`);
  await assert.rejects(draft(),blocked('intro_email_schema_not_ready'));
  for(const name of ['0032_outbound_sales_demo.sql','0056_sales_dialer_v2.sql','0057_sales_phone_test_mode.sql','0058_sales_prospect_checkout.sql','0059_sales_company_contacts.sql','0062_sales_contact_notes.sql','0060_sales_intro_email.sql'])await migration(name);
  await migration('0060_sales_intro_email.sql'); // Idempotent migration.
  await q("INSERT INTO sales_operator_settings(admin_user_id,active) VALUES(1,TRUE),(2,TRUE)");
  for(const id of ['company','foreign','uncertain','timeout','audit-failure','phone-test','race','reconcile','session-revoke']) {
    await q("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,contact_name,contact_email,numbers_json,permission_granted,email_permission,assigned_rep_user_id,timezone) VALUES($1,$1,$1,'+12065550100','Pat Person',$2,$3::jsonb,TRUE,TRUE,1,'UTC')",[id,`${id}@example.test`,JSON.stringify([{type:'cell',phoneE164:'+12065550100'}])]);
  }
  await q("INSERT INTO sales_prospect_contacts(contact_id,prospect_id,first_name,last_name,email) VALUES('second','company','Selected','Person','selected@example.test')");
  const base=await draft();assert.equal(base.recipient,'company@example.test');assert.equal(base.replyTo,'rep@example.test');
  assert.equal(base.requiresEmailPermissionConfirmation,false);assert.equal(base.subject,SALES_INTRO_EMAIL_SUBJECT);
  assert.equal(base.text,salesIntroEmailText('Pat'));assert.match(base.text,/Best regards,\nRam\nEverycall Team$/);
  assert.equal(providerCalls.length,0);
  await assert.rejects(draft('company',{repId:2}),blocked('prospect_forbidden'));
  await assert.rejects(draft('company',{contactId:'contact_legacy_foreign'}),blocked('contact_unavailable'));
  const adminDraft=await draft('company',{repId:3,isAdmin:true});assert.equal(adminDraft.replyTo,'admin@example.test');
  await assert.rejects(draft('company',{repId:2,isAdmin:true}),blocked('unauthorized'));
  await assert.rejects(send(base,{authenticatedSession:sessionFor(2)}),blocked('unauthorized'));
  await q("UPDATE sessions SET expires_at=NOW()-INTERVAL '1 minute' WHERE id='session-1'");
  await assert.rejects(send(base),blocked('unauthorized'));await q("UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day' WHERE id='session-1'");
  await q("UPDATE sales_operator_settings SET active=FALSE WHERE admin_user_id=1");
  await assert.rejects(draft(),blocked('prospect_forbidden'));await assert.rejects(send(base),blocked('prospect_forbidden'));await q("UPDATE sales_operator_settings SET active=TRUE WHERE admin_user_id=1");
  // Interpose precisely after the durable reservation commits, before dispatch.
  for(const [change,code] of [["DELETE FROM sessions WHERE id='session-1'",'unauthorized'],["UPDATE sessions SET expires_at=NOW()-INTERVAL '1 minute' WHERE id='session-1'",'unauthorized'],["UPDATE sessions SET tenant_key='wrong-namespace' WHERE id='session-1'",'unauthorized'],["UPDATE sales_operator_settings SET active=FALSE WHERE admin_user_id=1",'prospect_forbidden']]) {
    const revokedDraft=await draft('session-revoke');let committed=false,dispatches=0;
    const boundaryPool={query:pool.query.bind(pool),connect:async()=>{
      const client=await pool.connect();return {release:()=>client.release(),query:async(sql,args)=>{
        const result=await client.query(sql,args);
        if(sql==='COMMIT'&&!committed){committed=true;await q(change);}
        return result;
      }};
    }};
    await assert.rejects(sendSalesIntroEmail(boundaryPool,{prospectId:'session-revoke',repId:1,authenticatedSession:sessionFor(1),draftToken:revokedDraft.draftToken,subject:revokedDraft.subject,text:revokedDraft.text,idempotencyKey:`revoke-${revokedDraft.draftToken}`,mail:async()=>{dispatches++;return {id:'must-not-send'};}}),blocked(code));
    assert.equal(dispatches,0);assert.equal((await q('SELECT status FROM sales_intro_email_deliveries WHERE draft_token=$1',[revokedDraft.draftToken])).rows[0].status,'canceled');
    await q("INSERT INTO sessions(id,user_id,role,tenant_key,expires_at) VALUES('session-1',1,'sales',NULL,NOW()+INTERVAL '1 day') ON CONFLICT(id) DO UPDATE SET role='sales',tenant_key=NULL,expires_at=NOW()+INTERVAL '1 day'");
    await q("UPDATE sales_operator_settings SET active=TRUE WHERE admin_user_id=1");
  }
  const selected=await draft('company',{contactId:'second'});assert.equal(selected.recipient,'selected@example.test');assert.equal(selected.requiresEmailPermissionConfirmation,true);assert.match(selected.text,/^Hi Selected,/);
  await assert.rejects(send(selected),blocked('intro_email_permission_required'));
  await assert.rejects(send(base,{subject:'Subject\r\nBcc: other@example.test'}),blocked('invalid_email_subject'));
  await assert.rejects(send(base,{text:'bad\0message'}),blocked('invalid_email_text'));
  await assert.rejects(send(base,{idempotencyKey:''}),blocked('idempotency_key_required'));
  assert.throws(()=>validateSalesIntroEmailMessage('x'.repeat(201),'body'),blocked('invalid_email_subject'));
  assert.throws(()=>validateSalesIntroEmailMessage('subject','x'.repeat(12001)),blocked('invalid_email_text'));
  const edited={subject:'A personal introduction',text:'Hi Selected,\nHere is my edited note.'};
  const result=await send(selected,{...edited,confirmedEmailPermission:true});assert.equal(result.status,'sent');
  assert.deepEqual(providerCalls[0],{to:'selected@example.test',replyTo:'rep@example.test',...edited,category:'sales_intro',idempotencyKey:`sales-intro-${selected.draftToken}`});
  assert.equal((await send(selected,{...edited,confirmedEmailPermission:true})).deliveryId,result.deliveryId);assert.equal(providerCalls.length,1);
  await assert.rejects(send(selected,{...edited,confirmedEmailPermission:true,idempotencyKey:'another'}),blocked('intro_email_request_changed'));
  await assert.rejects(send(selected,{...edited,confirmedEmailPermission:true,text:'changed'}),blocked('intro_email_request_changed'));
  await assert.rejects(send(selected,{repId:2}),blocked('intro_email_draft_unavailable'));
  assert.equal((await q('SELECT email_permission FROM sales_prospects WHERE prospect_id=$1',['company'])).rows[0].email_permission,true);
  await q("UPDATE admin_users SET email='changed@example.test' WHERE id=1");
  await assert.rejects(send(base),blocked('intro_email_context_changed'));await q("UPDATE admin_users SET email='rep@example.test' WHERE id=1");
  await q("UPDATE sales_prospects SET row_version=row_version+1 WHERE prospect_id='company'");
  await assert.rejects(send(base),blocked('intro_email_context_changed'));
  const changed=await draft('company',{contactId:'second'});
  await q("UPDATE sales_prospect_contacts SET email='changed-contact@example.test' WHERE contact_id='second'");
  await assert.rejects(send(changed,{confirmedEmailPermission:true}),blocked('intro_email_context_changed'));
  const expired=await draft();
  // Expiry is immutable. Use a transaction-local clock-independent old insert.
  await q("INSERT INTO sales_intro_email_deliveries(draft_token,prospect_id,contact_id,rep_user_id,sales_call_id,expected_row_version,recipient_hash,reply_to_hash,requires_email_permission,created_at,expires_at) SELECT repeat('a',64),prospect_id,contact_id,rep_user_id,sales_call_id,expected_row_version,recipient_hash,reply_to_hash,requires_email_permission,NOW()-INTERVAL '2 hours',NOW()-INTERVAL '1 hour' FROM sales_intro_email_deliveries WHERE draft_token=$1",[expired.draftToken]);
  await assert.rejects(send({...expired,draftToken:'a'.repeat(64)}),blocked('intro_email_draft_expired'));
  await q("UPDATE sales_prospects SET assigned_rep_user_id=2 WHERE prospect_id='company'");
  await assert.rejects(send(expired),blocked('prospect_forbidden'));await q("UPDATE sales_prospects SET assigned_rep_user_id=1 WHERE prospect_id='company'");
  await q("UPDATE sales_prospects SET email_permission=FALSE WHERE prospect_id='company'");
  assert.equal((await draft()).requiresEmailPermissionConfirmation,true);
  await q("UPDATE sales_prospects SET email_permission=TRUE WHERE prospect_id='company'");
  await q("UPDATE sales_prospects SET email_suppressed_at=NOW() WHERE prospect_id='company'");
  await assert.rejects(draft(),blocked('prospect_suppressed'));await assert.rejects(send(expired,{confirmedEmailPermission:true}),blocked('prospect_suppressed'));
  await q("UPDATE sales_prospects SET email_suppressed_at=NULL WHERE prospect_id='company'");
  // Independent DNC registry guard even if projected suppression has not run.
  await q("INSERT INTO sales_dnc_registry VALUES('phone','+12065550100','fixture',NOW())");
  await assert.rejects(draft(),blocked('prospect_suppressed'));await q('DELETE FROM sales_dnc_registry');
  const phoneDraft=await draft('phone-test');await setSalesPhoneTestMode(pool,true);
  await assert.rejects(draft('phone-test'),blocked('sales_phone_test_external_action_blocked'));
  await assert.rejects(send(phoneDraft,{prospectId:'phone-test'}),blocked('sales_phone_test_external_action_blocked'));
  await q(`INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state,metadata_json) VALUES('old-test-call','company',1,'ended',$1::jsonb)`,[JSON.stringify({contact_id:'contact_legacy_company',contact_snapshot:{contactId:'contact_legacy_company',email:'company@example.test'}})]);
  await setSalesPhoneTestMode(pool,false);
  await assert.rejects(send(phoneDraft,{prospectId:'phone-test'}),blocked('intro_email_context_changed'));
  await q(`INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state,metadata_json) VALUES('ended-call','company',1,'ended',$1::jsonb)`,[JSON.stringify({contact_id:'contact_legacy_company',contact_snapshot:{contactId:'contact_legacy_company',email:'company@example.test'}})]);
  const callDraft=await draft('company',{salesCallId:'ended-call'});assert(callDraft.draftToken);
  await assert.rejects(draft('company',{salesCallId:'ended-call',contactId:'second'}),blocked('intro_email_call_contact_changed'));
  await assert.rejects(draft('foreign',{salesCallId:'ended-call'}),blocked('intro_email_call_forbidden'));
  await assert.rejects(draft('company',{salesCallId:'old-test-call'}),blocked('sales_phone_test_external_action_blocked'));
  const uncertain=await draft('uncertain'),alternate=await draft('uncertain');let attempts=0;
  const failing=async()=>{attempts++;throw Error('private recipient/body provider detail');};
  await assert.rejects(send(uncertain,{prospectId:'uncertain',mail:failing}),e=>e.code==='intro_email_delivery_pending'&&!e.message.includes('private'));
  await assert.rejects(send(uncertain,{prospectId:'uncertain',mail:failing}),blocked('intro_email_delivery_pending'));
  await assert.rejects(send(alternate,{prospectId:'uncertain',mail:failing}),blocked('intro_email_delivery_pending'));
  await assert.rejects(draft('uncertain'),blocked('intro_email_delivery_pending'));assert.equal(attempts,1);
  await assert.rejects(q("UPDATE sales_intro_email_deliveries SET status='sent' WHERE draft_token=$1",[uncertain.draftToken]),blocked('P6001'));
  const reconcileOptions={deliveryId:uncertain.draftToken,adminUserId:3,resolution:'sent',evidenceReference:'case:EMAIL-001',providerMessageId:'provider-verified-id'};
  await assert.rejects(reconcileSalesIntroEmailDelivery(pool,{...reconcileOptions,adminUserId:1}),blocked('forbidden'));
  await assert.rejects(reconcileSalesIntroEmailDelivery(pool,reconcileOptions),blocked('intro_email_reconciliation_too_soon'));
  await assert.rejects(reconcileSalesIntroEmailDelivery(pool,{...reconcileOptions,evidenceReference:'private@email.test'}),blocked('intro_email_reconciliation_evidence_required'));
  const reconciliationDraft=await draft('reconcile');
  const insertOld=async token=>q(`INSERT INTO sales_intro_email_deliveries(draft_token,prospect_id,contact_id,rep_user_id,expected_row_version,recipient_hash,reply_to_hash,requires_email_permission,status,request_hash,idempotency_key,attempted_at)
    SELECT $2,prospect_id,contact_id,rep_user_id,expected_row_version,recipient_hash,reply_to_hash,requires_email_permission,'sending','old-request',$2,NOW()-INTERVAL '1 hour' FROM sales_intro_email_deliveries WHERE draft_token=$1`,[reconciliationDraft.draftToken,token]);
  await insertOld('b'.repeat(64));await q("UPDATE sales_intro_email_deliveries SET status='uncertain' WHERE draft_token=$1",['b'.repeat(64)]);
  await db.exec(`CREATE FUNCTION reject_reconciliation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sales.intro_email.reconciled' THEN RAISE EXCEPTION 'reconciliation audit failed'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_reconciliation_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_audit();`);
  await assert.rejects(reconcileSalesIntroEmailDelivery(pool,{...reconcileOptions,deliveryId:'b'.repeat(64)}),/reconciliation audit failed/);
  assert.equal((await q('SELECT status FROM sales_intro_email_deliveries WHERE draft_token=$1',['b'.repeat(64)])).rows[0].status,'uncertain');
  await db.exec('DROP TRIGGER reject_reconciliation_audit ON audit_log');
  const reconciled=await reconcileSalesIntroEmailDelivery(pool,{...reconcileOptions,deliveryId:'b'.repeat(64)});assert.equal(reconciled.status,'sent');
  await assert.rejects(reconcileSalesIntroEmailDelivery(pool,{...reconcileOptions,deliveryId:'b'.repeat(64)}),blocked('intro_email_reconciliation_not_pending'));
  await insertOld('c'.repeat(64));
  assert.equal((await reconcileSalesIntroEmailDelivery(pool,{...reconcileOptions,deliveryId:'c'.repeat(64),resolution:'not_sent',providerMessageId:null})).status,'canceled');
  assert((await draft('reconcile')).draftToken,'Verified reconciliation releases the fence without sending.');
  assert.equal(attempts,1);assert.equal(providerCalls.length,1);
  await assert.rejects(q("INSERT INTO sales_intro_email_deliveries(draft_token,prospect_id,contact_id,rep_user_id,expected_row_version,recipient_hash,reply_to_hash,requires_email_permission) VALUES($1,'reconcile','contact_legacy_foreign',1,1,'a','b',FALSE)",['d'.repeat(64)]),blocked('23503'));
  await assert.rejects(q("UPDATE sales_prospect_contacts SET email='replacement@example.test' WHERE prospect_id='uncertain'"),blocked('P6002'));
  await assert.rejects(q("UPDATE sales_prospects SET assigned_rep_user_id=2 WHERE prospect_id='uncertain'"),blocked('P6002'));
  await assert.rejects(setSalesPhoneTestMode(pool,true),blocked('P6002'));
  // Opt-outs must continue to work while uncertainty blocks identity changes.
  await updateSalesProspectEmailState(pool,'uncertain@example.test',{emailPermission:false,emailSuppressed:true,emailSuppressionReason:'unsubscribed'});
  await q("UPDATE sales_prospects SET last_outcome='no_answer',row_version=row_version+1 WHERE prospect_id='uncertain'");
  assert.equal((await q("SELECT email_suppressed_at IS NOT NULL AS opted_out FROM sales_prospects WHERE prospect_id='uncertain'")).rows[0].opted_out,true);
  let complete;const timeoutDraft=await draft('timeout');
  await assert.rejects(send(timeoutDraft,{prospectId:'timeout',dispatchTimeoutMs:5,mail:()=>new Promise(resolve=>{complete=resolve;})}),blocked('intro_email_delivery_pending'));
  complete({id:'late-accepted',provider:'stub'});await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await q('SELECT status FROM sales_intro_email_deliveries WHERE draft_token=$1',[timeoutDraft.draftToken])).rows[0].status,'uncertain');
  await assert.rejects(send(timeoutDraft,{prospectId:'timeout'}),blocked('intro_email_delivery_pending'));
  // Audit failure before dispatch rolls back reservation; after dispatch fences it.
  const auditDraft=await draft('audit-failure');
  await db.exec(`CREATE FUNCTION reject_intro_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sales.intro_email.reserved' THEN RAISE EXCEPTION 'audit failed'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_intro_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_intro_audit();`);
  const before=providerCalls.length;await assert.rejects(send(auditDraft,{prospectId:'audit-failure'}),/audit failed/);assert.equal(providerCalls.length,before);
  await db.exec(`CREATE OR REPLACE FUNCTION reject_intro_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sales.intro_email.sent' THEN RAISE EXCEPTION 'audit failed'; END IF; RETURN NEW; END $$;`);
  await assert.rejects(send(auditDraft,{prospectId:'audit-failure'}),blocked('intro_email_delivery_pending'));assert.equal(providerCalls.length,before+1);
  await db.exec('DROP TRIGGER reject_intro_audit ON audit_log');
  if(target){
    // Exercise the real independent writers used by disable and logout, not a
    // simulated lock or a check based only on elapsed time.
    for(const [name,sql] of [['operator-disable',"UPDATE sales_operator_settings SET active=FALSE WHERE admin_user_id=1"],['session-revoke',"DELETE FROM sessions WHERE id='session-1'"]]) {
      const lockedDraft=await draft('session-revoke');
      const writer=await pool.connect();let releaseProvider,enteredProvider,writerFinished=false,writerError;
      const entered=new Promise(resolve=>{enteredProvider=resolve;});
      const heldProvider=new Promise(resolve=>{releaseProvider=resolve;});
      let dispatch,write;
      try {
        const pid=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='8s'");await writer.query("SET LOCAL statement_timeout='10s'");
        dispatch=send(lockedDraft,{prospectId:'session-revoke',mail:async()=>{enteredProvider();await heldProvider;return {id:`locked-${name}`,provider:'stub'};}});
        await Promise.race([entered,dispatch.then(()=>{throw Error('Dispatch completed without the held provider');})]);
        write=writer.query(sql).then(()=>{writerFinished=true;},error=>{writerError=error;writerFinished=true;});
        let observed=false;const deadline=Date.now()+5000;
        while(Date.now()<deadline&&!writerFinished){
          const waiting=(await q('SELECT wait_event_type,cardinality(pg_blocking_pids(pid)) AS blockers FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
          if(waiting?.wait_event_type==='Lock'&&Number(waiting.blockers)>0){observed=true;break;}
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        assert(observed,`${name} must be blocked by the dispatch transaction`);assert.equal(writerFinished,false);
        if(name==='operator-disable')assert.equal((await q('SELECT active FROM sales_operator_settings WHERE admin_user_id=1')).rows[0].active,true);
        else assert.equal((await q("SELECT 1 FROM sessions WHERE id='session-1'")).rowCount,1);
        releaseProvider();assert.equal((await dispatch).status,'sent');await write;if(writerError)throw writerError;
        assert.equal(writerFinished,true);await writer.query('COMMIT');
        if(name==='operator-disable')assert.equal((await q('SELECT active FROM sales_operator_settings WHERE admin_user_id=1')).rows[0].active,false);
        else assert.equal((await q("SELECT 1 FROM sessions WHERE id='session-1'")).rowCount,0);
      }finally{
        releaseProvider();await Promise.allSettled([dispatch,write].filter(Boolean));await writer.query('ROLLBACK').catch(()=>{});writer.release();
        await q("UPDATE sales_operator_settings SET active=TRUE WHERE admin_user_id=1");
        await q("INSERT INTO sessions(id,user_id,role,expires_at) VALUES('session-1',1,'sales',NOW()+INTERVAL '1 day') ON CONFLICT(id) DO UPDATE SET expires_at=NOW()+INTERVAL '1 day'");
      }
    }
    const duplicate=await draft('race');let duplicateCalls=0;
    const duplicateMail=async()=>{duplicateCalls++;return {id:'same-request',provider:'stub'};};
    const duplicateResults=await Promise.allSettled([send(duplicate,{prospectId:'race',mail:duplicateMail}),send(duplicate,{prospectId:'race',mail:duplicateMail})]);
    assert(duplicateResults.some(r=>r.status==='fulfilled'));
    for(const r of duplicateResults)if(r.status==='rejected')assert.equal(r.reason.code,'intro_email_delivery_pending');
    assert.equal(duplicateCalls,1);
    const a=await draft('race'),b=await draft('race');let release,entered;
    const start=new Promise(resolve=>{entered=resolve;});let calls=0;
    const held=async()=>{calls++;entered();await new Promise(resolve=>{release=resolve;});throw Error('uncertain concurrent attempt');};
    const first=assert.rejects(send(a,{prospectId:'race',mail:held}),blocked('intro_email_delivery_pending'));await start;
    const second=assert.rejects(send(b,{prospectId:'race',mail:held}),blocked('intro_email_delivery_pending'));
    release();await Promise.all([first,second]);assert.equal(calls,1);
  }
  assert.equal(Number((await q('SELECT count(*) AS n FROM sales_checkout_sessions')).rows[0].n),0);
  assert.equal(Number((await q('SELECT count(*) AS n FROM sales_setup_bookings')).rows[0].n),0);
  assert.equal(Number((await q('SELECT count(*) AS n FROM sales_followup_jobs')).rows[0].n),0);
  assert.equal(Number((await q('SELECT count(*) AS n FROM sales_call_sessions WHERE link_sent_at IS NOT NULL OR paid_at IS NOT NULL OR booked_at IS NOT NULL')).rows[0].n),0);
  const auditText=JSON.stringify((await q('SELECT * FROM audit_log')).rows);
  assert(!auditText.includes('@example.test'));assert(!auditText.includes(edited.text));assert(!auditText.includes(edited.subject));
  // Both real adapters exercised locally, with transport replaced before use.
  const previous={MAIL_PROVIDER:process.env.MAIL_PROVIDER,RESEND_API_KEY:process.env.RESEND_API_KEY,MAILTRAP_TOKEN:process.env.MAILTRAP_TOKEN};
  const oldFetch=globalThis.fetch,oldSend=MailtrapClient.prototype.send;
  try {
    const requests=[];
    globalThis.fetch=async(url,request)=>{assert.equal(url,'https://api.resend.com/emails');requests.push(JSON.parse(request.body));return {ok:true,json:async()=>({id:'resend-stub'})};};
    process.env.MAIL_PROVIDER='resend';process.env.RESEND_API_KEY='fixture';
    await sendTransactionalEmail({to:'to@example.test',subject:'Subject',text:'Text',replyTo:'rep@example.test'});
    assert.equal(requests[0].reply_to,'rep@example.test');
    await sendTransactionalEmail({to:'old@example.test',subject:'Old caller',html:'<b>Previous behavior</b>'});assert(!('reply_to' in requests[1]));assert.equal(requests[1].html,'<b>Previous behavior</b>');
    const trap=[];MailtrapClient.prototype.send=async payload=>{trap.push(payload);return {message_ids:['mailtrap-stub']};};
    process.env.MAIL_PROVIDER='mailtrap';process.env.MAILTRAP_TOKEN='fixture';
    await sendTransactionalEmail({to:'to@example.test',subject:'Subject',text:'Text',replyTo:'rep@example.test'});assert.deepEqual(trap[0].reply_to,{email:'rep@example.test'});
    await sendTransactionalEmail({to:'old@example.test',subject:'Old caller',text:'Text'});assert(!('reply_to' in trap[1]));
    await assert.rejects(sendTransactionalEmail({to:'to@example.test',subject:'Subject',text:'Text',replyTo:'rep@example.test\r\nBcc:other@example.test'}),/invalid_reply_to/);
  }finally{globalThis.fetch=oldFetch;MailtrapClient.prototype.send=oldSend;for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  console.log(`PASS Sales introduction email (${target?'native PostgreSQL with actual operator-disable/session-revoke lock contention':'PGlite'}): selected contact and consent, ownership, immutable drafts, Reply-To adapters, stale edits, phone-test isolation, suppression, bounded uncertainty, durable replay and audit without PII; no live providers.`);
}finally{await db.close();}
