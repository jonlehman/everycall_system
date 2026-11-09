import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { getSalesProspect, updateSalesProspect, createSalesCallSession, importSalesProspects, getSalesProspectByNormalizedEmail, updateSalesProspectEmailState } from '../pages/api/_lib/salesRepository.js';
import { loadSalesCompanyContacts, resolveSalesContactTarget } from '../pages/api/_lib/salesCompanyContacts.js';
import { setSalesPhoneTestMode, SALES_TEST_NUMBERS } from '../pages/api/_lib/salesPhoneTestMode.js';
import { runSalesOwnedProspectMutation } from '../pages/api/_lib/salesApi.js';
import { CSV_HEADERS, prospectRow } from '../pages/api/v1/admin/sales/prospects/export.js';
import { parseSalesProspectCsv } from '../pages/api/_lib/salesRepository.js';
import { listSalesContacts, mutateSalesContact } from '../pages/api/_lib/salesContacts.js';

const url=process.env.SALES_CONTACTS_TEST_DATABASE_URL;
if(url&&!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname))throw Error('Only an isolated loopback test database is allowed.');
const schema=`sales_contacts_test_${Date.now()}`;
let db,admin,pool;
if(url){admin=new pg.Pool({connectionString:url});await admin.query(`CREATE SCHEMA ${schema}`);pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public`});db={exec:sql=>pool.query(sql),close:async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};}
else{db=new PGlite();const query=async(sql,args=[])=>{const r=await db.query(sql,args);return {...r,rowCount:r.rows?.length||r.affectedRows||0};};pool={query,connect:async()=>({query,release(){}})};}
const q=(sql,args=[])=>pool.query(sql,args);
const migration=async name=>db.exec(await fs.readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
const blocked=code=>error=>error.code===code;
process.env.SALES_CALL_WINDOW_START_LOCAL='00:00';process.env.SALES_CALL_WINDOW_END_LOCAL='00:00';process.env.SALES_CALL_MISSING_TIMEZONE_POLICY='allow';
const newContact=(id,name,phone)=>({id,firstName:name,lastName:'Owner',email:`${name.toLowerCase()}@example.test`,title:'Owner',decisionMaker:true,influencer:true,numbers:phone?[{id:`new_phone_${id}`,phoneE164:phone,type:'cell',label:'Mobile'}]:[]});
const patch=p=>({editorMode:'company_contacts',expectedRowVersion:p.rowVersion,contacts:p.contacts,sharedNumbers:p.sharedNumbers,defaultContactId:p.defaultContactId});
try {
 await db.exec(`CREATE TABLE admin_users(id BIGSERIAL PRIMARY KEY,email TEXT,username TEXT,role TEXT);CREATE TABLE tenants(tenant_key TEXT PRIMARY KEY,name TEXT,industry TEXT,app_access_status TEXT,billing_status TEXT,live_prompt_mode TEXT,updated_at TIMESTAMPTZ,status TEXT,telnyx_voice_number TEXT,telnyx_voice_status TEXT,service_access_status TEXT,billing_lock_reason TEXT);CREATE TABLE tenant_bootstrap_profiles(tenant_key TEXT PRIMARY KEY,website_url TEXT,company_description TEXT,business_category TEXT,source_mode TEXT,marketing_attribution_json JSONB DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());CREATE TABLE tenant_active_knowledge_builds(tenant_key TEXT,active_build_id TEXT);CREATE TABLE knowledge_builds(build_id TEXT,tenant_key TEXT,status TEXT);CREATE TABLE provisioning_jobs(id BIGSERIAL PRIMARY KEY,tenant_key TEXT,status TEXT,provider TEXT,stage TEXT,status_detail TEXT,provider_reference TEXT,error_code TEXT,error_message TEXT,updated_at TIMESTAMPTZ,completed_at TIMESTAMPTZ);INSERT INTO admin_users(id,email) VALUES(1,'rep@example.test'),(2,'other@example.test');`);
 for(const name of ['0032_outbound_sales_demo.sql','0056_sales_dialer_v2.sql','0057_sales_phone_test_mode.sql','0058_sales_prospect_checkout.sql'])await migration(name);
 const original=[{phoneE164:'+12065550101',type:'shop',label:'',extension:'8',verified:true},{phoneE164:'+12065550102',type:'cell',label:'Owner cell'}];
 await q("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,numbers_json,contact_name,owner_first_name,contact_email,website_url,permission_granted,timezone,assigned_rep_user_id,status) VALUES('company','external:company','Company','+12065550101',$1,'Pat Legacy','Different','pat@example.test','https://old.example',TRUE,'UTC',1,'ready_to_call')",[JSON.stringify(original)]);
 await setSalesPhoneTestMode(pool,true);
 // Reject missing/malformed/inconsistent originals before any new table is created.
 for(const corrupt of ["test_original_phone_e164=NULL,test_original_numbers_json=NULL","test_original_numbers_json='[{\"phoneE164\":\"broken\"}]'::jsonb","phone_e164='+12065559999'"]) {
  const client=await pool.connect();
  try {await client.query('BEGIN');await client.query("SELECT set_config('everycall.sales_test_transition','on',TRUE)");await client.query(`UPDATE sales_prospects SET ${corrupt} WHERE prospect_id='company'`);const sql=await fs.readFile(new URL('../migrations/0059_sales_company_contacts.sql',import.meta.url),'utf8');await assert.rejects(url?client.query(sql):db.exec(sql),blocked('P5904'));}
  finally {await client.query('ROLLBACK');client.release();}
 }
 await migration('0059_sales_company_contacts.sql');
 let p=await getSalesProspect(pool,'company');
 assert.equal(p.contacts.length,1);assert.equal(p.contacts[0].firstName,'Pat');assert.equal(p.sharedNumbers[0].phoneE164,SALES_TEST_NUMBERS[0].phoneE164);
 assert(!JSON.stringify(p).includes('+12065550101'));assert(!JSON.stringify(p).includes('+12065550102'));
 const raw=(await q('SELECT * FROM sales_prospect_contacts')).rows[0];assert.equal(raw.legacy_owner_first_name,'Different');assert.equal(raw.legacy_name,'Pat Legacy');
 const real=(await q('SELECT phone_e164 FROM sales_prospect_contact_numbers ORDER BY phone_e164')).rows.map(n=>n.phone_e164);assert.deepEqual(real,['+12065550101','+12065550102']);
 p=await updateSalesProspect(pool,'company',{...patch(p),contacts:p.contacts.map(c=>({...c,title:'Manager'}))});
 assert.equal(p.contacts[0].title,'Manager');
 await assert.rejects(updateSalesProspect(pool,'company',{...patch(p),sharedNumbers:p.sharedNumbers.map(n=>({...n,phoneE164:'+12065559999'}))}),blocked('sales_phone_test_mode_active'));
 await assert.rejects(updateSalesProspect(pool,'company',{...patch(p),contacts:[...p.contacts,newContact('new_alex','Alex','+12065550103')]}),blocked('sales_phone_test_mode_active'));
 await setSalesPhoneTestMode(pool,false);
 const restored=(await q("SELECT * FROM sales_prospects WHERE prospect_id='company'")).rows[0];assert.deepEqual(restored.numbers_json,original);assert.equal(restored.phone_e164,'+12065550101');
 p=await getSalesProspect(pool,'company');
 const oldVersion=p.rowVersion;
 await q("UPDATE sales_prospects SET email_permission=TRUE WHERE prospect_id='company'");
 p=await updateSalesProspect(pool,'company',{...patch(p),contacts:[...p.contacts,newContact('new_alex','Alex','+12065550103')],defaultContactId:'new_alex',metro:'Seattle',competitorName:'Competitor'});
 const alex=p.contacts.find(c=>c.firstName==='Alex');const pat=p.contacts.find(c=>c.firstName==='Pat');
 assert.equal(p.defaultContactId,alex.id);assert.equal(p.contactName,'Alex Owner');assert.equal(alex.decisionMaker,true);assert.equal(alex.influencer,true);assert.equal(p.numbers.length,3);assert.equal(p.numbers.find(n=>n.phoneE164==='+12065550101').extension,'8');assert.equal(p.emailPermission,false,'Changing default email cannot inherit prior permission');
 p=await updateSalesProspect(pool,'company',{...patch(p),contacts:p.contacts.map(c=>c.id===alex.id?{...c,email:'confirmed@example.test'}:c),emailPermission:true,emailPermissionConfirmation:{contactId:alex.id,email:'confirmed@example.test'}});
 assert.equal(p.emailPermission,true);
 await assert.rejects(updateSalesProspect(pool,'company',{...patch(p),expectedRowVersion:oldVersion,businessName:'stale'}),blocked('prospect_version_conflict'));
 await assert.rejects(updateSalesProspect(pool,'company',{...patch(p),status:'paid'}),blocked('company_field_not_editable'));
 await assert.rejects(updateSalesProspect(pool,'company',{...patch(p),contacts:[]}),blocked('invalid_contacts'));
 await assert.rejects(updateSalesProspect(pool,'company',{...patch(p),contacts:p.contacts.filter(c=>c.id!==alex.id)}),blocked('default_contact_required'));
 await q("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,assigned_rep_user_id) VALUES('foreign','foreign','Foreign','+12065550200',2)");
 const other=await getSalesProspect(pool,'foreign');
 await assert.rejects(updateSalesProspect(pool,'company',{...patch(p),contacts:[...p.contacts,other.contacts[0]]}),blocked('contact_forbidden'));
 await assert.rejects(resolveSalesContactTarget(pool,'company',{contactId:alex.id,numberId:pat.numbers[0].id}),blocked('invalid_contact_number'));
 const shared=await resolveSalesContactTarget(pool,'company',{contactId:alex.id,numberId:p.sharedNumbers[0].id});assert.equal(shared.contactSnapshot.firstName,'Alex');
 await q("INSERT INTO sales_demo_profiles(demo_profile_id,prospect_id,status,business_name) VALUES('demo','company','ready','Company')");
 p=await getSalesProspect(pool,'company');
 const call=await createSalesCallSession(pool,{salesCallId:'call',prospectId:'company',adminUserId:1,idempotencyKey:'same',contactId:alex.id,numberId:alex.numbers[0].id,expectedRowVersion:p.rowVersion,metadata:{prospect_number:alex.numbers[0].phoneE164}});
 assert.equal(call.metadata.contact_snapshot.firstName,'Alex');
 const replay=await createSalesCallSession(pool,{prospectId:'company',adminUserId:1,idempotencyKey:'same',contactId:alex.id,numberId:alex.numbers[0].id,expectedRowVersion:p.rowVersion,metadata:{prospect_number:alex.numbers[0].phoneE164}});assert.equal(replay.salesCallId,call.salesCallId);
 await assert.rejects(createSalesCallSession(pool,{prospectId:'company',adminUserId:1,idempotencyKey:'same',contactId:pat.id}),blocked('idempotency_key_conflict'));
 await assert.rejects(updateSalesProspect(pool,'company',{...patch(p),businessName:'active'}),blocked('company_edit_pending'));
 await assert.rejects(q("UPDATE sales_call_sessions SET metadata_json=metadata_json||'{\"contact_id\":\"other\"}' WHERE sales_call_id='call'"),blocked('P5903'));
 await q("UPDATE sales_call_sessions SET state='ended',ended_at=NOW() WHERE sales_call_id='call'");
 p=await getSalesProspect(pool,'company');
 await mutateSalesContact(pool,{prospectId:'company',repId:1,action:'callback',callbackAt:new Date(Date.now()+3600000).toISOString(),expectedRowVersion:p.rowVersion,contactId:alex.id,numberId:alex.numbers[0].id});
 p=await getSalesProspect(pool,'company');
 await setSalesPhoneTestMode(pool,true);
 assert(!JSON.stringify(await getSalesProspect(pool,'company')).includes('+12065550103'),'Callback snapshot must not reveal saved original phone during testing');
 await setSalesPhoneTestMode(pool,false);
 p=await getSalesProspect(pool,'company');
 p=await updateSalesProspect(pool,'company',{...patch(p),contacts:p.contacts.map(c=>c.id===alex.id?{...c,numbers:c.numbers.map(n=>({...n,phoneE164:'+12065550104'}))}:c)});
 assert.equal(p.callbackTarget.requiresSelection,true,'Edited phone under same ID needs explicit callback selection');
 p=await updateSalesProspect(pool,'company',{...patch(p),contacts:p.contacts.filter(c=>c.id!==alex.id),defaultContactId:pat.id,websiteUrl:'https://new.example'});
 assert.equal(p.callbackTarget.requiresSelection,true);assert.equal(p.demo.status,'stale');
 assert.equal((await q("SELECT metadata_json->'contact_snapshot' AS snapshot FROM sales_call_sessions WHERE sales_call_id='call'")).rows[0].snapshot.firstName,'Alex');
 const identities=(await q("SELECT identity_value FROM sales_prospect_identities WHERE prospect_id='company'")).rows.map(r=>r.identity_value);assert(identities.includes('+12065550103'));assert(identities.includes('old.example'));assert(identities.includes('new.example'));
 await q("UPDATE sales_prospects SET do_not_call=TRUE WHERE prospect_id='company'");
 const dnc=(await q('SELECT identity_value FROM sales_dnc_registry')).rows.map(r=>r.identity_value);assert(dnc.includes('+12065550103'));assert(dnc.includes('old.example'));
 assert.equal((await listSalesContacts(pool,{repId:2,search:'Pat'})).total,0);
 // Legacy CSV is additive and does not replace the selected default/contact list.
 const added=await importSalesProspects(pool,{records:[{id:'csv',business:'CSV',phone:'+12065550300',contact_name:'CSV Owner',permission:true,timezone:'UTC'}],adminUserId:1});
 let csv=await getSalesProspect(pool,added.imported[0].prospectId);
 csv=await updateSalesProspect(pool,csv.prospectId,{...patch(csv),contacts:[...csv.contacts,newContact('new_csv','Second','+12065550301')],defaultContactId:'new_csv'});
 await importSalesProspects(pool,{records:[{id:'csv',business:'CSV',phone:'+12065550300',contact_name:'CSV Changed',permission:true,timezone:'UTC'}],adminUserId:1});
 const updated=await getSalesProspect(pool,csv.prospectId);assert.equal(updated.contacts.length,2);assert.equal(updated.defaultContactId,csv.defaultContactId);assert.equal(updated.contactName,'Second Owner');
 const exported=parseSalesProspectCsv(CSV_HEADERS.join(',')+'\n'+prospectRow(updated));
 assert.equal(JSON.parse(exported[0].contacts_json).length,2);
 const roundtrip={id:'csv',business:'CSV',phone:'+12065550300',permission:true,timezone:'UTC',contacts_json:JSON.stringify(updated.contacts),shared_numbers_json:JSON.stringify(updated.sharedNumbers),default_contact_id:updated.defaultContactId};
 await importSalesProspects(pool,{records:[roundtrip],adminUserId:1});assert.deepEqual((await getSalesProspect(pool,csv.prospectId)).contacts,updated.contacts);
 // An existing checked/imported permission never transfers to a different default.
 await q('UPDATE sales_prospects SET email_permission=FALSE WHERE prospect_id=$1',[csv.prospectId]);
 await importSalesProspects(pool,{records:[{id:'csv',business:'CSV',phone:'+12065550300',contact_email:'legacy@example.test',email_permission:true,permission:true,timezone:'UTC'}],adminUserId:1});
 assert.equal((await getSalesProspect(pool,csv.prospectId)).emailPermission,false,'Legacy CSV permission for legacy person cannot authorize selected second person');
 await q('UPDATE sales_prospects SET email_permission=TRUE WHERE prospect_id=$1',[csv.prospectId]);
 await importSalesProspects(pool,{records:[{id:'csv',business:'CSV',phone:'+12065550300',contact_email:'new@example.test',email_permission:true,permission:true,timezone:'UTC',contacts_json:JSON.stringify([...updated.contacts,newContact('new_import','Imported','+12065550302')]),shared_numbers_json:JSON.stringify(updated.sharedNumbers),default_contact_id:'new_import'}],adminUserId:1});
 assert.equal((await getSalesProspect(pool,csv.prospectId)).emailPermission,false,'Structured import changing default email clears existing permission');
 const beforeDraft=await getSalesProspect(pool,csv.prospectId);
 const draftContact=newContact('new_confirmed','Fresh','+12065550303');
 const confirmedDraft=await updateSalesProspect(pool,csv.prospectId,{...patch(beforeDraft),contacts:[...beforeDraft.contacts,draftContact],defaultContactId:draftContact.id,emailPermission:true,emailPermissionConfirmation:{contactId:draftContact.id,email:draftContact.email}});
 assert.equal(confirmedDraft.emailPermission,true);assert.notEqual(confirmedDraft.defaultContactId,draftContact.id);assert.equal(confirmedDraft.contacts.find(c=>c.id===confirmedDraft.defaultContactId).email,draftContact.email);

 // Contact opt-outs still reach the company after default switches, email edits and archival.
 const legacy=confirmedDraft.contacts.find(c=>c.id!==confirmedDraft.defaultContactId&&c.email);
 await updateSalesProspectEmailState(pool,legacy.email,{emailSuppressed:true,emailSuppressionReason:'nondefault_optout'});
 let suppressed=await getSalesProspect(pool,csv.prospectId);assert(suppressed.emailSuppressedAt);assert.equal(suppressed.defaultContactId,confirmedDraft.defaultContactId);
 suppressed=await updateSalesProspect(pool,csv.prospectId,{...patch(suppressed),contacts:suppressed.contacts.map(c=>c.id===legacy.id?{...c,email:'changed-legacy@example.test'}:c)});
 assert.equal((await getSalesProspectByNormalizedEmail(pool,legacy.email)).prospectId,csv.prospectId,'Known previous email remains attributable');
 suppressed=await updateSalesProspect(pool,csv.prospectId,{...patch(suppressed),contacts:suppressed.contacts.filter(c=>c.id!==legacy.id)});
 await updateSalesProspectEmailState(pool,legacy.email,{emailSuppressed:true,emailSuppressionReason:'archived_optout'});
 assert.equal((await getSalesProspectByNormalizedEmail(pool,legacy.email)).emailSuppressionReason,'archived_optout');
 // Ownership is checked before receipts, including native overlapping reassignment.
 await q('UPDATE sales_prospects SET assigned_rep_user_id=1 WHERE prospect_id=$1',[csv.prospectId]);
 const context={pool,session:{role:'sales'},admin:{id:1}};
 const req={headers:{'idempotency-key':'contact-save-replay'}};
 const opts={scope:'contacts.test',request:{name:'first'},action:null};
 const receipt=await runSalesOwnedProspectMutation(req,context,csv.prospectId,opts,async()=>({status:200,body:{ok:true}}));assert.equal(receipt.status,200);
 await q('UPDATE sales_prospects SET assigned_rep_user_id=2 WHERE prospect_id=$1',[csv.prospectId]);
 await assert.rejects(runSalesOwnedProspectMutation(req,context,csv.prospectId,opts,async()=>{throw Error('must not run');}),blocked('prospect_forbidden'));
 if(url) {
  await q('UPDATE sales_prospects SET assigned_rep_user_id=1 WHERE prospect_id=$1',[csv.prospectId]);
  const lock=await pool.connect();await lock.query('BEGIN');await lock.query('SELECT prospect_id FROM sales_prospects WHERE prospect_id=$1 FOR UPDATE',[csv.prospectId]);
  let ran=false;
  const pending=runSalesOwnedProspectMutation({headers:{'idempotency-key':'contact-race'}},context,csv.prospectId,{...opts,scope:'contacts.race'},async()=>{ran=true;return {status:200,body:{ok:true}};});
  await lock.query('UPDATE sales_prospects SET assigned_rep_user_id=2 WHERE prospect_id=$1',[csv.prospectId]);await lock.query('COMMIT');lock.release();
  await assert.rejects(pending,blocked('prospect_forbidden'));assert.equal(ran,false);
 }
 await q("UPDATE sales_prospects SET assigned_rep_user_id=2 WHERE prospect_id='company'");
 await assert.rejects(createSalesCallSession(pool,{prospectId:'company',adminUserId:1,idempotencyKey:'same',contactId:alex.id,numberId:alex.numbers[0].id}),blocked('prospect_forbidden'));
 // Deferred constraint independently prevents a company pointing at another company's contact.
 await assert.rejects(q('UPDATE sales_prospects SET default_contact_id=$2 WHERE prospect_id=$1',['company',other.defaultContactId]),error=>['23503','P5902'].includes(error.code));
 console.log(`PASS Sales company contacts (${url?'native PostgreSQL':'PGlite'}): test-mode-active backfill/privacy/exact restore, multi-contact edit/default/archive, foreign IDs, stale versions, call snapshots/replay, retained DNC, callbacks, additive/lossless imports.`);
} finally {await db.close();}
