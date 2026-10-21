import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {createSmsInboundHandler} from '../pages/api/v1/telnyx/webhooks/sms/inbound.js';
import {importSalesProspects,getSalesProspect,createSalesCallSession} from '../pages/api/_lib/salesRepository.js';
import {sendSalesCheckout} from '../pages/api/_lib/salesCheckout.js';
import pg from 'pg';
import {PGlite} from '@electric-sql/pglite';
import {bootstrapFixtureSchema,readMigration,migrationBody} from './lib/schema-migrations.mjs';
import {processSalesPaidActivations} from '../pages/api/_lib/salesActivation.js';
import {enqueueKnowledgeBuild,enqueueSalesPaidKnowledgeBuild} from '../pages/api/_lib/knowledgeReceptionistBuilds.js';
import {assertKnowledgeReviewer,saveKnowledgeReadinessReview,assertKnowledgePublishAllowed} from '../pages/api/_lib/knowledgeGovernance.js';
const url=process.env.EVERYCALL_TEST_POSTGRES_URL;
let db,cleanup;
if(url){assert(['127.0.0.1','localhost'].includes(new URL(url).hostname));db=new pg.Client({connectionString:url});await db.connect();const schema='sales_paid_qa_'+crypto.randomBytes(6).toString('hex');await db.query(`CREATE SCHEMA ${schema}`);await db.query(`SET search_path TO ${schema}`);cleanup=async()=>{await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.end();};}else{db=new PGlite();cleanup=()=>db.close();}
const query=async(sql,params)=>{const r=await db.query(sql,params);return {...r,rowCount:r.rowCount??r.affectedRows??r.rows?.length??0};};const pool={query,connect:async()=>({query,release(){}})};const exec=sql=>db.exec?db.exec(sql):db.query(sql);
try{
 await bootstrapFixtureSchema(pool,{executeSql:exec});
 await exec(migrationBody(await readMigration('0049_live_prompt_settings.sql')));
 await query("INSERT INTO admin_users(id,username,email,role) VALUES(11,'sales_rep','sales@example.test','sales')");
 await query("INSERT INTO sales_prospects(prospect_id,source_key,business_name,website_url,phone_e164,status,assigned_rep_user_id,permission_granted) VALUES('paid_prospect','paid_prospect_source','Actual Paid Test','https://paid.example.test/','+12065550991','queued',11,TRUE)");
 await query("INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state) VALUES('paid_call','paid_prospect',11,'ended')");
 await query("INSERT INTO sales_checkout_sessions(checkout_id,sales_call_id,prospect_id,rep_user_id,channel,recipient,status,paid_at,stripe_session_id,stripe_event_id,activation_status) VALUES('verified_paid','paid_call','paid_prospect',11,'email','owner@example.test','paid',NOW(),'cs_verified','evt_verified','queued')");
 const result=await processSalesPaidActivations(pool);if(result.results[0]?.status==='failed')console.error((await query('SELECT activation_error FROM sales_checkout_sessions')).rows);
 assert.equal(result.results[0]?.status,'awaiting_knowledge_review');const key=result.results[0].tenantKey;
 const build=(await query('SELECT * FROM knowledge_builds WHERE tenant_key=$1',[key])).rows[0];assert.equal(build.status,'queued');assert.equal(build.created_by_type,'sales');assert.equal(build.created_by_id,'11');assert.equal(build.build_kind,'website_base');
 assert.equal((await query('SELECT website_url FROM tenant_bootstrap_profiles WHERE tenant_key=$1',[key])).rows[0].website_url,'https://paid.example.test/');
 assert.equal((await query('SELECT service_access_status FROM tenants WHERE tenant_key=$1',[key])).rows[0].service_access_status,'disabled');
 assert((await query("SELECT * FROM audit_log WHERE tenant_key=$1 AND actor='sales:11' AND action='sales.payment.knowledge_build_enqueued'",[key])).rows.length);
 await assert.rejects(assertKnowledgeReviewer(pool,key,{role:'admin',user_id:11}),/knowledge_reviewer_forbidden/);
 await assert.rejects(assertKnowledgeReviewer(pool,key,{role:'sales',user_id:11}),/knowledge_reviewer_forbidden/);
 await assert.rejects(enqueueSalesPaidKnowledgeBuild(pool,key,{checkoutId:'unpaid',websiteUrl:'https://paid.example.test/'}),/sales_verified_payment_required/);
 await assert.rejects(enqueueSalesPaidKnowledgeBuild(pool,'wrong_tenant',{checkoutId:'verified_paid'}),/sales_verified_payment_required/);
 await assert.rejects(assertKnowledgePublishAllowed(pool,key,build.build_id,{automatic:true}),/knowledge_explicit_publication_required/);
 await query("INSERT INTO knowledge_governance_policies(tenant_key,review_mode) VALUES($1,'reviewed') ON CONFLICT(tenant_key) DO UPDATE SET review_mode='reviewed'",[key]);
 await query("UPDATE admin_users SET role='admin' WHERE id=11");
 await assert.rejects(saveKnowledgeReadinessReview(pool,key,{build_id:build.build_id,evidence_note:'Promoted creator cannot self-review'}, {role:'admin',user_id:11}),/knowledge_second_reviewer_required/);
 await query("UPDATE admin_users SET role='sales' WHERE id=11");
 // Caller JSON cannot forge the private service capability.
 await assert.rejects(enqueueKnowledgeBuild(pool,key,{websiteUrl:'https://other.example.test/',actor:{role:'sales',user_id:11},checkoutId:'verified_paid'}),/knowledge_reviewer_forbidden/);
 const originalKey=process.env.TELNYX_PUBLIC_KEY;const keys=crypto.generateKeyPairSync('ed25519');process.env.TELNYX_PUBLIC_KEY=keys.publicKey.export({type:'spki',format:'pem'});
 const handler=createSmsInboundHandler({getDatabase:()=>pool});
 async function smsEvent(id,word,phone,valid=true){const raw=JSON.stringify({data:{id,event_type:'message.received',payload:{from:{phone_number:phone},to:[{phone_number:'+12065550639'}],text:word}}});const timestamp=String(Math.floor(Date.now()/1000));const req=Readable.from([raw]);req.method='POST';req.headers={'telnyx-timestamp':timestamp,'telnyx-signature-ed25519':valid?crypto.sign(null,Buffer.from(`${timestamp}|${raw}`),keys.privateKey).toString('base64'):'invalid'};const res={statusCode:0,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};await handler(req,res);return res;}
 assert.equal((await smsEvent('bad_stop','STOP','+12065550991',false)).statusCode,403);
 assert.equal((await smsEvent('stop_1','STOP','+12065550991')).statusCode,200);
 assert.equal((await smsEvent('stop_1','STOP','+12065550991')).body.duplicate,true);
 assert.equal((await getSalesProspect(pool,'paid_prospect')).doNotCall,true);
 await assert.rejects(sendSalesCheckout(pool,{salesCallId:'paid_call',repId:11,channel:'sms'}),e=>e.code==='prospect_suppressed');
 await assert.rejects(createSalesCallSession(pool,{prospectId:'paid_prospect',adminUserId:11}),e=>e.code==='prospect_not_eligible'&&e.message==='This prospect is marked do not call.');
 assert.equal((await smsEvent('stop_2','UNSUBSCRIBE','+12065550992')).statusCode,200);
 assert.equal((await smsEvent('stop_2','UNSUBSCRIBE','+12065550992')).body.duplicate,true);
 const imported=await importSalesProspects(pool,{adminUserId:11,records:[{business_name:'Later import',phone:'+12065550992',website:'https://later.example.test',permission:'yes',timezone:'UTC'}]});assert.equal((await getSalesProspect(pool,imported.imported[0].prospectId)).doNotCall,true);
 if(originalKey===undefined)delete process.env.TELNYX_PUBLIC_KEY;else process.env.TELNYX_PUBLIC_KEY=originalKey;
 console.log('PASS signed STOP/UNSUBSCRIBE retry receipts, suppression, reimport, SMS/call rejection; provider owns single confirmation');
 console.log('PASS real paid activation, actual build enqueue, actor audit, and unchanged publication authority');
}catch(error){console.error(error.stack);process.exitCode=1;}finally{await cleanup();}
