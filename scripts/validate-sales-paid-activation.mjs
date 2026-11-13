import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {createSmsInboundHandler} from '../pages/api/v1/telnyx/webhooks/sms/inbound.js';
import {importSalesProspects,getSalesProspect,createSalesCallSession} from '../pages/api/_lib/salesRepository.js';
import {sendSalesCheckout} from '../pages/api/_lib/salesCheckout.js';
import pg from 'pg';
import {PGlite} from '@electric-sql/pglite';
import {bootstrapFixtureSchema,readMigration,migrationBody} from './lib/schema-migrations.mjs';
import {convertPaidIntake} from '../pages/api/_lib/paidProvisioning.js';
import {processSalesPaidActivations} from '../pages/api/_lib/salesActivation.js';
import {enqueueKnowledgeBuild,enqueueSalesPaidKnowledgeBuild,enqueuePaidIntakeKnowledgeBuild} from '../pages/api/_lib/knowledgeReceptionistBuilds.js';
import {assertKnowledgeReviewer,saveKnowledgeReadinessReview,assertKnowledgePublishAllowed} from '../pages/api/_lib/knowledgeGovernance.js';
process.env.APP_BASE_URL='https://fixture.everycall.invalid';
const url=process.env.EVERYCALL_TEST_POSTGRES_URL;
let db,cleanup;
if(url){assert(['127.0.0.1','localhost'].includes(new URL(url).hostname));db=new pg.Client({connectionString:url});await db.connect();const schema='sales_paid_qa_'+crypto.randomBytes(6).toString('hex');await db.query(`CREATE SCHEMA ${schema}`);await db.query(`SET search_path TO ${schema}`);cleanup=async()=>{await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.end();};}else{db=new PGlite();cleanup=()=>db.close();}
const query=async(sql,params)=>{const r=await db.query(sql,params);return {...r,rowCount:r.rowCount??(r.rows?.length||r.affectedRows||0)};};const pool={query,connect:async()=>({query,release(){}})};const exec=sql=>db.exec?db.exec(sql):db.query(sql);
try{
 await bootstrapFixtureSchema(pool,{executeSql:exec});
 await exec(migrationBody(await readMigration('0049_live_prompt_settings.sql')));
 await query("INSERT INTO admin_users(id,username,email,role) VALUES(11,'sales_rep','sales@example.test','sales')");
 await query("INSERT INTO sales_prospects(prospect_id,source_key,business_name,website_url,phone_e164,status,assigned_rep_user_id,permission_granted) VALUES('paid_prospect','paid_prospect_source','Actual Paid Test','https://paid.example.test/','+12065550991','queued',11,TRUE)");
 await query("INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state) VALUES('paid_call','paid_prospect',11,'ended')");
 await query("INSERT INTO sales_checkout_sessions(checkout_id,sales_call_id,prospect_id,rep_user_id,channel,recipient,status,paid_at,stripe_session_id,stripe_event_id,activation_status) VALUES('verified_paid','paid_call','paid_prospect',11,'email','owner@example.test','paid',NOW(),'cs_verified','evt_verified','queued')");
 const retired=await processSalesPaidActivations(pool);assert.equal(retired.claimedCount,0);assert.equal(retired.reason,'unified_paid_intake_recurring_consent_required');
 // Synthetic server-verified ledger fixture. Payment/consent/provider uncertainty
 // are independently exercised by validate-paid-intake on native PostgreSQL.
 await query("INSERT INTO paid_intakes(intake_id,owner_email,payload_json,prospect_id,verified_at) VALUES('intake_fixture','owner@example.test',$1::jsonb,'paid_prospect',NOW())",[JSON.stringify({businessName:'Actual Paid Test',businessCategory:'service_business',website:'https://paid.example.test/',companyDescription:'A fixture service business.',leadPhone:'+12065550991',planCode:'growth',billingInterval:'month',marketingAttribution:{}})]);
 await query("INSERT INTO paid_purchases(purchase_id,intake_id,owner_email,prospect_id,plan_code,billing_interval,livemode,amount_cents,paid_at,usage_anchor_at,initial_period_end,recurring_consent_at,payment_status,provisioning_status,stripe_customer_id,stripe_subscription_id,stripe_price_id) VALUES('purchase_fixture','intake_fixture','owner@example.test','paid_prospect','growth','month',TRUE,10000,NOW(),NOW(),NOW()+interval '1 month',NOW(),'paid','queued','cus_fixture','sub_fixture','price_fixture')");
 const converted=await convertPaidIntake(pool,'purchase_fixture');const key=converted.tenant_key;
 await enqueuePaidIntakeKnowledgeBuild(pool,key,{purchaseId:'purchase_fixture',websiteUrl:'https://paid.example.test/'});
 const build=(await query('SELECT * FROM knowledge_builds WHERE tenant_key=$1',[key])).rows[0];assert.equal(build.status,'queued');assert.equal(build.created_by_type,'tenant');assert.equal(build.created_by_id,String(converted.ownerId));assert.equal(build.build_kind,'website_base');
 const replay=await enqueuePaidIntakeKnowledgeBuild(pool,key,{purchaseId:'purchase_fixture',websiteUrl:'https://paid.example.test/'});assert.equal(replay.build.build_id,build.build_id);
 assert.equal((await query('SELECT website_url FROM tenant_bootstrap_profiles WHERE tenant_key=$1',[key])).rows[0].website_url,'https://paid.example.test/');
 assert.equal((await query('SELECT service_access_status FROM tenants WHERE tenant_key=$1',[key])).rows[0].service_access_status,'disabled');
 await assert.rejects(assertKnowledgeReviewer(pool,key,{role:'admin',user_id:11}),/knowledge_reviewer_forbidden/);
 await assert.rejects(assertKnowledgeReviewer(pool,key,{role:'sales',user_id:11}),/knowledge_reviewer_forbidden/);
 await assert.rejects(enqueueSalesPaidKnowledgeBuild(pool,key,{checkoutId:'unpaid',websiteUrl:'https://paid.example.test/'}),/unified_paid_intake_recurring_consent_required/);
 await assert.rejects(enqueueSalesPaidKnowledgeBuild(pool,'wrong_tenant',{checkoutId:'verified_paid'}),/unified_paid_intake_recurring_consent_required/);
 await assert.rejects(assertKnowledgePublishAllowed(pool,key,build.build_id,{automatic:true}),/knowledge_explicit_publication_required/);
 await query("INSERT INTO knowledge_governance_policies(tenant_key,review_mode) VALUES($1,'reviewed') ON CONFLICT(tenant_key) DO UPDATE SET review_mode='reviewed'",[key]);
 await assert.rejects(saveKnowledgeReadinessReview(pool,key,{build_id:build.build_id,evidence_note:'Owner creator cannot self-review'}, {role:'tenant',user_id:converted.ownerId}),/knowledge_second_reviewer_required/);
 // Caller JSON cannot forge the private service capability.
 await assert.rejects(enqueueKnowledgeBuild(pool,key,{websiteUrl:'https://other.example.test/',actor:{role:'sales',user_id:11},checkoutId:'verified_paid'}),/knowledge_reviewer_forbidden/);
 const originalKey=process.env.TELNYX_PUBLIC_KEY;const keys=crypto.generateKeyPairSync('ed25519');process.env.TELNYX_PUBLIC_KEY=keys.publicKey.export({type:'spki',format:'pem'});
 const handler=createSmsInboundHandler({getDatabase:()=>pool});
 async function smsEvent(id,word,phone,valid=true){const raw=JSON.stringify({data:{id,event_type:'message.received',payload:{from:{phone_number:phone},to:[{phone_number:'+12065550639'}],text:word}}});const timestamp=String(Math.floor(Date.now()/1000));const req=Readable.from([raw]);req.method='POST';req.headers={'telnyx-timestamp':timestamp,'telnyx-signature-ed25519':valid?crypto.sign(null,Buffer.from(`${timestamp}|${raw}`),keys.privateKey).toString('base64'):'invalid'};const res={statusCode:0,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};await handler(req,res);return res;}
 assert.equal((await smsEvent('bad_stop','STOP','+12065550991',false)).statusCode,403);
 assert.equal((await smsEvent('stop_1','STOP','+12065550991')).statusCode,200);
 assert.equal((await smsEvent('stop_1','STOP','+12065550991')).body.duplicate,true);
 assert.equal((await getSalesProspect(pool,'paid_prospect')).doNotCall,true);
 await assert.rejects(sendSalesCheckout(pool,{salesCallId:'paid_call',repId:11,channel:'sms'}),e=>e.code==='sales_prospect_already_paid');
 // Exercise opt-out independently of the paid-customer checkout prohibition.
 await query("INSERT INTO sales_prospects(prospect_id,source_key,business_name,website_url,phone_e164,status,assigned_rep_user_id,permission_granted) VALUES('unpaid_stop','unpaid_stop_source','Unpaid Opt-out Test','https://unpaid-stop.example.test/','+12065550993','queued',11,TRUE)");
 await query("INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state) VALUES('unpaid_stop_call','unpaid_stop',11,'ended')");
 assert.equal((await smsEvent('unpaid_stop_1','STOP','+12065550993')).statusCode,200);
 await assert.rejects(sendSalesCheckout(pool,{salesCallId:'unpaid_stop_call',repId:11,channel:'sms'}),e=>e.code==='prospect_suppressed');
 await assert.rejects(createSalesCallSession(pool,{prospectId:'paid_prospect',adminUserId:11}),e=>e.code==='prospect_not_eligible'&&e.message==='This prospect is marked do not call.');
 assert.equal((await smsEvent('stop_2','UNSUBSCRIBE','+12065550992')).statusCode,200);
 assert.equal((await smsEvent('stop_2','UNSUBSCRIBE','+12065550992')).body.duplicate,true);
 const imported=await importSalesProspects(pool,{adminUserId:11,records:[{business_name:'Later import',phone:'+12065550992',website:'https://later.example.test',permission:'yes',timezone:'UTC'}]});assert.equal((await getSalesProspect(pool,imported.imported[0].prospectId)).doNotCall,true);
 if(originalKey===undefined)delete process.env.TELNYX_PUBLIC_KEY;else process.env.TELNYX_PUBLIC_KEY=originalKey;
 console.log('PASS signed STOP/UNSUBSCRIBE retry receipts, suppression, reimport, SMS/call rejection; provider owns single confirmation');
 console.log('PASS legacy activation retirement, verified-owner paid build, idempotent enqueue, and unchanged publication authority');
}catch(error){console.error(error.stack);process.exitCode=1;}finally{await cleanup();}
