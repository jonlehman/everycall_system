import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { bootstrapFixtureSchema,readMigration } from './lib/schema-migrations.mjs';
import { applySalesHistoryMigration,verifySalesHistorySchema,SALES_HISTORY_MIGRATION,historyMigrationDigest,salesHistoryTargetFingerprint } from './lib/sales-change-history-migration.mjs';
import { salesAuditPool } from '../pages/api/_lib/salesAuditContext.js';
import { getSalesChangeHistory,assertSalesHistoryReady } from '../pages/api/_lib/salesChangeHistory.js';
import { SALES_HISTORY_INVENTORY } from '../lib/salesHistoryInventory.js';
import historyHandler from '../pages/api/v1/admin/sales/change-history.js';
import noteHandler from '../pages/api/v1/admin/sales/prospects/[prospectId]/notes.js';
import companyHandler from '../pages/api/v1/admin/sales/prospects/[prospectId].js';
import queueHandler from '../pages/api/v1/admin/sales/queue/index.js';
import { saveSalesLiveNotes } from '../pages/api/_lib/salesDialer.js';
import { recordSalesCallOutcome } from '../pages/api/_lib/salesRepository.js';

const target=process.env.EVERYCALL_TEST_POSTGRES_URL;
if(!target||!['127.0.0.1','localhost','[::1]'].includes(new URL(target).hostname))throw Error('Native PostgreSQL loopback fixture required');
const schema=`history_${crypto.randomBytes(6).toString('hex')}`;
const admin=new pg.Pool({connectionString:target});await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new pg.Pool({connectionString:target,options:`-c search_path=${schema},public`,max:8});
const q=(sql,args=[])=>pool.query(sql,args);
const sql=await readMigration(SALES_HISTORY_MIGRATION);
const opts={databaseUrl:target,expectedTargetFingerprint:salesHistoryTargetFingerprint(target),reviewedRevision:'a'.repeat(40),currentRevision:'a'.repeat(40),expectedMigrationSha256:historyMigrationDigest(sql),releaseEvidenceReference:'release:0066-native-fixture'};
const apply=(changes={},db=pool)=>applySalesHistoryMigration(db,{...opts,...changes});
const count=async()=>Number((await q('SELECT count(*) AS count FROM sales_change_history')).rows[0].count);
async function request(handler,{method='GET',cookie='',query={},body={},headers={}}={}) {
  const response={statusCode:200,headers:{},setHeader(name,value){this.headers[name]=value;},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}};
  await handler({method,url:'/api/v1/admin/sales/change-history',headers:{cookie,...headers},query,body},response);return response;
}
const oldUrl=process.env.DATABASE_URL,oldPool=globalThis.__everycallPool;
try {
 await bootstrapFixtureSchema(pool,{includeSalesHistory:false});
 await q("INSERT INTO schema_migrations(name) VALUES('0050_live_brief_curation.sql') ON CONFLICT DO NOTHING");
 await assert.rejects(assertSalesHistoryReady(pool),e=>e.statusCode===503);
 for(const changes of [{expectedTargetFingerprint:'bad'},{reviewedRevision:'b'.repeat(40)},{expectedMigrationSha256:'bad'},{releaseEvidenceReference:''}])await assert.rejects(apply(changes));
 // The whole capture set is fenced, with no source-data writes or job drain.
 const blocker=await pool.connect();
 await blocker.query('BEGIN');await blocker.query('LOCK TABLE sales_call_sessions IN ROW EXCLUSIVE MODE');
 await assert.rejects(apply(),e=>e.code==='55P03');await blocker.query('ROLLBACK');blocker.release();
 assert.equal((await q("SELECT to_regclass('sales_change_history') AS object")).rows[0].object,null);
 await q('CREATE FUNCTION sales_capture_field_changes(int) RETURNS int LANGUAGE SQL AS $$ SELECT $1 $$');
 await assert.rejects(apply(),/unreceipted/);await q('DROP FUNCTION sales_capture_field_changes(int)');
 // An unsuccessful receipt cannot leave installed capture objects.
 const receiptFailure={connect:async()=>{const c=await pool.connect();return {query:(text,args)=>{if(text.startsWith('INSERT INTO schema_migrations'))throw Error('receipt_failure');return c.query(text,args);},on:(...a)=>c.on(...a),off:(...a)=>c.off(...a),release:e=>c.release(e)};}};
 await assert.rejects(apply({},receiptFailure),/receipt_failure/);
 assert.equal((await q("SELECT to_regclass('sales_change_history') AS object")).rows[0].object,null);
 assert.equal((await apply()).applied,true);assert.equal((await apply()).applied,false);
 await assertSalesHistoryReady(pool);
 await q('ALTER TABLE sales_prospect_contacts DISABLE TRIGGER sales_history_sales_prospect_contacts');
 await assert.rejects(verifySalesHistorySchema(pool),/trigger_drift/);await assert.rejects(assertSalesHistoryReady(pool),e=>e.statusCode===503);
 await q('ALTER TABLE sales_prospect_contacts ENABLE TRIGGER sales_history_sales_prospect_contacts');
 assert.equal(await count(),0,'No fabricated historical events');
 await q("INSERT INTO admin_users(id,username,email,role) VALUES(1,'Editor One','one@example.test','sales'),(2,'Editor Two','two@example.test','sales'),(3,'Admin Name','admin@example.test','admin')");
 await q("INSERT INTO sales_operator_settings(admin_user_id) VALUES(1),(2)");
 const one=await salesAuditPool(pool,{admin:{id:1},session:{role:'sales'}}),two=await salesAuditPool(pool,{admin:{id:2},session:{role:'sales'}});
 await one.query("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,permission_granted,assigned_rep_user_id,timezone) VALUES('company','company','Original business','+12065550101',TRUE,1,'UTC')");
 await one.query("INSERT INTO sales_prospect_contacts(contact_id,prospect_id,first_name) VALUES('person','company','Person')");
 const memo='  café 📝\n第二行\n'+'=formula <script>alert(1)</script> long text '.repeat(600)+'\n  ';
 await one.query('UPDATE sales_prospect_contacts SET notes=$1 WHERE contact_id=\'person\'',[memo]);
 let event=(await q("SELECT * FROM sales_change_history WHERE entity_id='person' AND field_path='notes' ORDER BY event_id DESC LIMIT 1")).rows[0];
 assert.equal(event.new_value,memo);assert.equal(event.old_value,'');assert.equal(event.actor_id,'1');assert.equal(event.actor_name,'Editor One');assert.equal(event.actor_role,'sales');
 const before=await count();await one.query('UPDATE sales_prospect_contacts SET notes=$1,updated_at=NOW() WHERE contact_id=\'person\'',[memo]);assert.equal(await count(),before);
 await two.query("UPDATE sales_prospect_contacts SET notes='' WHERE contact_id='person'");
 event=(await q("SELECT * FROM sales_change_history WHERE entity_id='person' AND field_path='notes' ORDER BY event_id DESC LIMIT 1")).rows[0];assert.equal(event.action,'clear');assert.equal(event.old_value,memo);assert.equal(event.new_value,'');assert.equal(event.actor_id,'2');
 // All source tables are real migration-backed relations; allowlist exactly
 // matches each deployed trigger's argument, including every named field path.
 for(const [table,entry] of Object.entries(SALES_HISTORY_INVENTORY))assert(sql.includes(`'${entry.entityType}','${entry.idColumn}','${entry.fields.join(' ')}'`),table);
 await one.query("UPDATE sales_prospects SET metadata_json=metadata_json || $1::jsonb WHERE prospect_id='company'",[JSON.stringify({researchNotes:memo,city:'Tacoma',privateToken:'MUST_NOT_CAPTURE',recording_url:'MUST_NOT_CAPTURE'})]);
 await one.query("UPDATE sales_operator_settings SET telnyx_telephony_credential_id='MUST_NOT_CAPTURE',display_name='Desk rep',caller_id_number='+12065550999' WHERE admin_user_id=1");
 assert.equal((await q("SELECT count(*)::int AS n FROM sales_change_history WHERE old_value::text LIKE '%MUST_NOT_CAPTURE%' OR new_value::text LIKE '%MUST_NOT_CAPTURE%'")).rows[0].n,0);
 // Pool reuse, rollback and simultaneous editors never leak local attribution.
 const tx=await one.connect();await tx.query('BEGIN');await tx.query("UPDATE sales_prospect_contacts SET first_name='Rolled back' WHERE contact_id='person'");await tx.query('ROLLBACK');tx.release();
 assert.equal((await q("SELECT count(*)::int AS n FROM sales_change_history WHERE new_value='\"Rolled back\"'::jsonb")).rows[0].n,0);
 await q("UPDATE sales_prospect_contacts SET first_name='System change' WHERE contact_id='person'");
 assert.equal((await q("SELECT actor_kind FROM sales_change_history WHERE new_value='\"System change\"'::jsonb")).rows[0].actor_kind,'system');
 const savepoint=await one.connect();await savepoint.query('BEGIN');await savepoint.query('SAVEPOINT note_draft');
 await savepoint.query("UPDATE sales_prospect_contacts SET first_name='Savepoint rollback' WHERE contact_id='person'");
 await savepoint.query('ROLLBACK TO SAVEPOINT note_draft');await savepoint.query("UPDATE sales_prospect_contacts SET first_name='Savepoint retained' WHERE contact_id='person'");await savepoint.query('COMMIT');savepoint.release();
 assert.equal((await q("SELECT count(*)::int AS n FROM sales_change_history WHERE new_value='\"Savepoint rollback\"'::jsonb")).rows[0].n,0);
 assert.equal((await q("SELECT actor_id FROM sales_change_history WHERE new_value='\"Savepoint retained\"'::jsonb")).rows[0].actor_id,'1');
 await q("CREATE FUNCTION history_commit_fail_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.first_name='Commit failure' THEN RAISE EXCEPTION 'commit_failure'; END IF; RETURN NULL; END $$");
 await q('CREATE CONSTRAINT TRIGGER history_commit_fail_fixture AFTER UPDATE ON sales_prospect_contacts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION history_commit_fail_fixture()');
 const beforeCommit=await count(),commitFailure=await one.connect();await commitFailure.query('BEGIN');await commitFailure.query("UPDATE sales_prospect_contacts SET first_name='Commit failure' WHERE contact_id='person'");
 await assert.rejects(commitFailure.query('COMMIT'),/commit_failure/);await commitFailure.query('ROLLBACK');commitFailure.release();assert.equal(await count(),beforeCommit);
 await q('DROP TRIGGER history_commit_fail_fixture ON sales_prospect_contacts');
 await Promise.all([one.query("UPDATE sales_prospect_contacts SET first_name='Concurrent one' WHERE contact_id='person'"),two.query("UPDATE sales_operator_settings SET display_name='Concurrent two' WHERE admin_user_id=2")]);
 assert.equal((await q("SELECT actor_id FROM sales_change_history WHERE new_value='\"Concurrent one\"'::jsonb")).rows[0].actor_id,'1');
 assert.equal((await q("SELECT actor_id FROM sales_change_history WHERE new_value='\"Concurrent two\"'::jsonb")).rows[0].actor_id,'2');
 // Audit sink failure rolls back the source mutation even without app transactions.
 await q("CREATE FUNCTION history_fail_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sink_failure'; END $$");
 await q('CREATE TRIGGER zz_history_failure BEFORE INSERT ON sales_change_history FOR EACH ROW EXECUTE FUNCTION history_fail_fixture()');
 await assert.rejects(one.query("UPDATE sales_prospect_contacts SET first_name='Lost mutation' WHERE contact_id='person'"),/sink_failure/);
 assert.equal((await q("SELECT first_name FROM sales_prospect_contacts WHERE contact_id='person'")).rows[0].first_name,'Concurrent one');
 await q('DROP TRIGGER zz_history_failure ON sales_change_history');
 for(const statement of ['UPDATE sales_change_history SET actor_name=\'forged\'','DELETE FROM sales_change_history','TRUNCATE sales_change_history','UPDATE sales_change_history_capture SET started_at=NOW()','TRUNCATE sales_change_history_capture'])await assert.rejects(q(statement),e=>e.code==='P6601');
 // Real authenticated handler, ownership transaction and idempotency replay.
 process.env.DATABASE_URL=target;globalThis.__everycallPool=pool;
 await q("INSERT INTO sessions(id,user_id,role,expires_at) VALUES('sales-one',1,'sales',NOW()+interval '1 day'),('sales-two',2,'sales',NOW()+interval '1 day'),('admin-session',3,'admin',NOW()+interval '1 day'),('client-session',1,'tenant',NOW()+interval '1 day')");
 const salesCookie='everycall_sales_session=sales-one',adminCookie='everycall_session=admin-session';
 const beforeBlocked=await count();await q('ALTER TABLE sales_prospect_contacts DISABLE TRIGGER sales_history_sales_prospect_contacts');
 assert.equal((await request(queueHandler,{cookie:salesCookie})).statusCode,503);assert.equal(await count(),beforeBlocked);
 assert.equal((await request(companyHandler,{method:'PATCH',cookie:salesCookie,query:{prospectId:'company'},body:{businessName:'Unaudited'}})).statusCode,503);
 await q('ALTER TABLE sales_prospect_contacts ENABLE TRIGGER sales_history_sales_prospect_contacts');
 assert.equal((await request(historyHandler,{cookie:adminCookie,query:{format:'csv'}})).statusCode,400);
 for(const query of [{},{eventId:event.event_id},{format:'csv'},{actor:'3',prospectId:'company'}]){
  assert.equal((await request(historyHandler,{cookie:salesCookie,query})).statusCode,403);
  assert.equal((await request(historyHandler,{query})).statusCode,401);
 }
 assert.equal((await request(historyHandler,{cookie:'everycall_session=client-session'})).statusCode,403);
 assert.equal((await request(historyHandler,{cookie:adminCookie,method:'POST'})).statusCode,405);
 const noteRequest={method:'POST',cookie:salesCookie,query:{prospectId:'company'},body:{body:memo,actor_id:2,actor_name:'Spoof'},headers:{'idempotency-key':'note-replay','x-actor-id':'2'}};
 let response=await request(noteHandler,noteRequest);assert.equal(response.statusCode,201,JSON.stringify(response.body));
 const noteId=response.body.note.noteId;
 event=(await q("SELECT * FROM sales_change_history WHERE entity_id=$1 AND field_path='body'",[noteId])).rows[0];assert.equal(event.new_value,memo);assert.equal(event.actor_id,'1');
 const afterNote=await count();response=await request(noteHandler,noteRequest);assert.equal(response.statusCode,201);assert.equal(await count(),afterNote);
 await q("INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state,metadata_json) VALUES('call','company',1,'prospect_connected','{}')");
 let rowVersion=(await q("SELECT row_version FROM sales_prospects WHERE prospect_id='company'")).rows[0].row_version;
 response=await request(companyHandler,{method:'PATCH',cookie:salesCookie,headers:{'idempotency-key':'company-edit'},query:{prospectId:'company'},body:{businessName:'Corrected in call',expectedRowVersion:rowVersion}});assert.equal(response.statusCode,200,JSON.stringify(response.body));
 assert.equal((await q("SELECT actor_id FROM sales_change_history WHERE field_path='business_name' ORDER BY event_id DESC LIMIT 1")).rows[0].actor_id,'1');
 // Report previews label truncation; detail preserves complete raw content.
 response=await request(historyHandler,{cookie:adminCookie,query:{field:'body'}});assert.equal(response.statusCode,200);assert.equal(response.headers['Cache-Control'],'private, no-store');assert.equal(response.body.events[0].new_truncated,true);
 response=await request(historyHandler,{cookie:adminCookie,query:{eventId:event.event_id}});assert.equal(response.body.event.new_value,memo);
 const companyBefore=(await q("SELECT business_name FROM sales_prospects WHERE prospect_id='company'")).rows[0].business_name;
 assert.equal((await q("SELECT state FROM sales_call_sessions WHERE sales_call_id='call'")).rows[0].state,'prospect_connected');
 await saveSalesLiveNotes(one,'call',1,memo);
 await q("UPDATE sales_call_sessions SET state='closed' WHERE sales_call_id='call'");
 await recordSalesCallOutcome(one,{salesCallId:'call',dispositions:['no_answer'],notes:memo});
 assert.equal((await q("SELECT outcome_notes FROM sales_call_sessions WHERE sales_call_id='call'")).rows[0].outcome_notes,memo);
 await recordSalesCallOutcome(one,{salesCallId:'call',dispositions:['no_answer'],notes:''});
 assert.equal((await q("SELECT outcome_notes FROM sales_call_sessions WHERE sales_call_id='call'")).rows[0].outcome_notes,'');

 // Incoming-company matching changes the call's company ID with before/after.
 await q("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,permission_granted,assigned_rep_user_id,timezone) VALUES('company2','company2','Matched business','+12065550202',TRUE,1,'UTC')");
 await one.query("UPDATE sales_call_sessions SET prospect_id='company2' WHERE sales_call_id='call'");
 const matched=(await q("SELECT * FROM sales_change_history WHERE entity_id='call' AND field_path='prospect_id' ORDER BY event_id DESC LIMIT 1")).rows[0];assert.equal(matched.old_value,'company');assert.equal(matched.new_value,'company2');assert.equal(matched.prospect_id,'company2');assert.equal(matched.actor_id,'1');
 await one.query("UPDATE sales_call_sessions SET prospect_id='company' WHERE sales_call_id='call'");
 const contactPage=await getSalesChangeHistory(pool,{contact:'person',company:'company'});assert(contactPage.events.length);assert(contactPage.events.every(e=>e.contact_id==='person'));
 // Every captured relation emits business-field events on real source writes.
 await one.query("UPDATE sales_dialer_config SET scripts_json=$1::jsonb WHERE id=TRUE",[JSON.stringify({opener:'Exact opener',objections:[{title:'Cost',text:'Full objection'}]})]);
 await one.query("INSERT INTO sales_dnc_registry(identity_type,identity_value,reason) VALUES('phone','+12065550901','asked_not_to_be_called')");
 await one.query("INSERT INTO sales_setup_bookings(booking_id,sales_call_id,rep_user_id,calendar_owner,starts_at,ends_at,attendee_email,paid_at_booking) VALUES('booking','call',1,'owner@example.test','2030-11-16T18:00:00Z','2030-11-16T18:15:00Z','attendee@example.test',FALSE)");
 await one.query("INSERT INTO sales_checkout_sessions(checkout_id,sales_call_id,prospect_id,rep_user_id,channel,recipient,is_test,activation_status) VALUES('checkout','call','company',1,'email','recipient@example.test',TRUE,'test_only')");
 await q("INSERT INTO sales_incoming_calls(incoming_id,provider_call_control_id,phone_e164,prospect_id,sales_call_id,message) VALUES('incoming','private-provider-identity','+12065550901','company','call','Caller asked for a callback')");
 const covered=new Set((await q('SELECT DISTINCT entity_type FROM sales_change_history')).rows.map(r=>r.entity_type));
 for(const entry of Object.values(SALES_HISTORY_INVENTORY))assert(covered.has(entry.entityType),`Missing real-table coverage: ${entry.entityType}`);
 assert.equal((await q("SELECT prospect_id FROM sales_change_history WHERE entity_id='booking' LIMIT 1")).rows[0].prospect_id,'company');
 assert.equal((await q("SELECT actor_kind FROM sales_change_history WHERE entity_id='incoming' LIMIT 1")).rows[0].actor_kind,'system');
 // Source-level null is distinct from empty, then removal is distinct again.
 await one.query("UPDATE sales_prospect_contacts SET title='' WHERE contact_id='person'");
 await one.query("UPDATE sales_prospect_contacts SET title=NULL WHERE contact_id='person'");
 const cleared=(await q("SELECT * FROM sales_change_history WHERE entity_id='person' AND field_path='title' ORDER BY event_id DESC LIMIT 1")).rows[0];
 assert.equal(cleared.old_value,'');assert.equal(cleared.new_value,null);assert.equal(cleared.new_present,true);

 // More than one page, preserving microseconds in each cursor; exact tied
 // timestamps are tested below by a fixture-only column default.
 await q("ALTER TABLE sales_change_history ALTER COLUMN occurred_at SET DEFAULT '2030-11-15T12:00:00.123456Z'::timestamptz");
 for(let i=0;i<65;i++)await one.query("UPDATE sales_prospect_contacts SET first_name=$1 WHERE contact_id='person'",[`Page ${i}`]);
 await q('ALTER TABLE sales_change_history ALTER COLUMN occurred_at SET DEFAULT clock_timestamp()');
 const ids=[];let cursor='';do{const page=await getSalesChangeHistory(pool,{entity:'contact',field:'first_name',cursor});ids.push(...page.events.map(e=>e.event_id));cursor=page.nextCursor;}while(cursor);
 assert.equal(new Set(ids).size,ids.length);assert.equal(ids.length,Number((await q("SELECT count(*) FROM sales_change_history WHERE entity_type='contact' AND field_path='first_name'")).rows[0].count));
 await one.query("UPDATE sales_prospect_contacts SET archived_at=NOW() WHERE contact_id='person'");
 await assert.rejects(one.query("DELETE FROM sales_prospect_contacts WHERE contact_id='person'"),e=>e.code==='P5901');
 await one.query('DELETE FROM sales_prospect_notes WHERE sales_prospect_note_id=$1',[noteId]);
 await q("UPDATE admin_users SET username='Renamed' WHERE id=1");
 assert.equal((await q('SELECT actor_name FROM sales_change_history WHERE event_id=$1',[event.event_id])).rows[0].actor_name,'Editor One');
 assert.equal((await q("SELECT count(*)::int AS n FROM sales_change_history WHERE entity_id=$1 AND action='delete'",[noteId])).rows[0].n>0,true);
 await q("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164) VALUES('deleted-company','deleted-company','Delete company','+12065550104')");
 await q("UPDATE sales_prospects SET status='deleted' WHERE prospect_id='deleted-company'");
 await q('DELETE FROM admin_users WHERE id=2');
 assert.equal((await q("SELECT actor_id FROM sales_change_history WHERE new_value='\"Concurrent two\"'::jsonb")).rows[0].actor_id,'2');
 assert.equal((await q("SELECT count(*)::int AS n FROM sales_change_history WHERE prospect_id='deleted-company'")).rows[0].n>0,true);
 assert(companyBefore);
 console.log('PASS native Sales history: migration gates, trigger allowlists, full notes, real handlers/auth/idempotency, rollback, concurrent actors, System attribution, append-only retention, secret exclusions, previews/detail and stable pagination');
} finally {
 globalThis.__everycallPool=oldPool;if(oldUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldUrl;
 await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
}
