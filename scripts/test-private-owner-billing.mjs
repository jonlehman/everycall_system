import assert from 'node:assert/strict';
import {createUpibTestFixture} from './lib/upib-test-fixture.mjs';
import {readMigration} from './lib/schema-migrations.mjs';
import {upibMigrationDigest,upibTargetFingerprint} from './lib/unified-paid-billing-migrations.mjs';
import {applyPrivateOwnerMigration,PRIVATE_OWNER_MIGRATION} from './lib/private-owner-migration.mjs';
import {PRIVATE_OWNER_ACCOUNT as c} from '../lib/privateOwnerBillingContract.js';
import {reconcilePrivateOwnerBilling} from '../pages/api/_lib/privateOwnerBilling.js';
import {runBillingLifecycleJobs} from '../pages/api/_lib/billingLifecycle.js';
const f=await createUpibTestFixture({label:'privateowner'}),{pool}=f;
const now=new Date('2026-11-13T10:00:00Z'),start=1792601983,end=1795280383;
const sub={id:c.subscriptionId,customer:c.customerId,livemode:true,metadata:{tenant_key:c.tenantKey},status:'active',cancel_at_period_end:false,items:{data:[{quantity:1,current_period_start:start,current_period_end:end,price:{id:c.priceId,product:c.productId,unit_amount:150,currency:'usd',recurring:{interval:'month',interval_count:1}}}]}};
let invoices=[{id:'in_synthetic',livemode:true,customer:c.customerId,subscription:c.subscriptionId,currency:'usd',status:'paid',amount_remaining:0,amount_paid:150,total:150,lines:{data:[{amount:150,price:c.priceId,subscription:c.subscriptionId,period:{start,end}}]}}];
const stripe={subscriptions:{retrieve:async()=>structuredClone(sub)},invoices:{async *list(){yield* structuredClone(invoices);}}};
const q=(sql,params)=>pool.query(sql,params),admit=async(at=now)=>(await q('SELECT * FROM reserve_private_or_paid_call($1,$2,$3)',[c.tenantKey,'owner_call',at])).rows[0];
try{
 await q(await readMigration('0049_live_prompt_settings.sql'));
 const options={execute:true,databaseUrl:f.databaseUrl,targetFingerprint:upibTargetFingerprint(f.databaseUrl),currentRevision:'a'.repeat(40),reviewedRevision:'a'.repeat(40),sqlSha256:upibMigrationDigest(await readMigration(PRIVATE_OWNER_MIGRATION)),evidenceReference:'fixture:private-owner-schema'};
 assert.equal((await applyPrivateOwnerMigration(pool,{...options,execute:false})).dryRun,true);
 await q('CREATE TABLE private_owner_billing_pkey(id integer)');await assert.rejects(applyPrivateOwnerMigration(pool,options),/owned_object_collision/);await q('DROP TABLE private_owner_billing_pkey');
 const lock=await pool.connect();await lock.query('BEGIN');await lock.query('LOCK TABLE tenants IN SHARE ROW EXCLUSIVE MODE');await assert.rejects(applyPrivateOwnerMigration(pool,options),/lock|obtain/i);await lock.query('ROLLBACK');lock.release();
 await q('CREATE FUNCTION reserve_private_or_paid_call() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$');await assert.rejects(applyPrivateOwnerMigration(pool,options),/owned_object_collision/);await q('DROP FUNCTION reserve_private_or_paid_call()');
 const failReceipt={connect:async()=>{const db=await pool.connect();return {query:(sql,args)=>sql.startsWith('INSERT INTO schema_migrations')?Promise.reject(Error('fixture_receipt_failure')):db.query(sql,args),release:()=>db.release()};}};
 await assert.rejects(applyPrivateOwnerMigration(failReceipt,options),/fixture_receipt_failure/);assert.equal((await q("SELECT to_regclass(current_schema()||'.private_owner_billing') AS name")).rows[0].name,null);
 assert.equal((await applyPrivateOwnerMigration(pool,options)).applied,true);assert.equal((await applyPrivateOwnerMigration(pool,options)).verified,true);
 await q("INSERT INTO tenants(tenant_key,name,status,service_access_status,telnyx_voice_number_id) VALUES($1,'Owner fixture','active','enabled','phone_fixture'),('ordinary_unpaid','Unpaid','active','enabled',NULL)",[c.tenantKey]);
 await q('INSERT INTO tenant_billing_accounts(tenant_key,stripe_customer_id,stripe_subscription_id,stripe_price_id) VALUES($1,$2,$3,$4)',[c.tenantKey,c.customerId,c.subscriptionId,c.priceId]);
 await q("INSERT INTO private_owner_billing(tenant_key,stripe_customer_id,stripe_subscription_id,stripe_price_id,phone_number_id,owner_decision_reference,evidence_sha256,reviewed_revision,enabled,current_period_start,current_period_end,paid_through,paid_invoice_id,subscription_status) VALUES($1,$2,$3,$4,'phone_fixture','fixture:owner',$5,$6,TRUE,to_timestamp($7),to_timestamp($8),to_timestamp($8),'in_synthetic','active')",[c.tenantKey,c.customerId,c.subscriptionId,c.priceId,'b'.repeat(64),'a'.repeat(40),start,end]);
 await q("INSERT INTO calls(call_sid,tenant_key,status) VALUES('owner_call',$1,'in_progress'),('unpaid_call','ordinary_unpaid','in_progress')",[c.tenantKey]);await q('UPDATE paid_intake_release SET enabled=TRUE');
 assert.equal((await admit()).allowed,true);
 assert.equal((await q("SELECT * FROM reserve_private_or_paid_call('ordinary_unpaid','unpaid_call',$1)",[now])).rows[0].allowed,false);
 const accountBefore=(await q('SELECT to_jsonb(b) AS value FROM tenant_billing_accounts b WHERE tenant_key=$1',[c.tenantKey])).rows[0].value;
 await reconcilePrivateOwnerBilling(pool,{stripe,now});assert.equal((await admit()).allowed,true);
 assert.deepEqual((await q('SELECT to_jsonb(b) AS value FROM tenant_billing_accounts b WHERE tenant_key=$1',[c.tenantKey])).rows[0].value,accountBefore);
 await q("UPDATE tenants SET service_access_status='disabled' WHERE tenant_key=$1",[c.tenantKey]);await reconcilePrivateOwnerBilling(pool,{stripe,now});assert.equal((await admit()).allowed,false);await q("UPDATE tenants SET service_access_status='enabled' WHERE tenant_key=$1",[c.tenantKey]);
 // Slow provider reads never own the tenant/admission lock.
 let release;const delayed=new Promise(r=>release=r);let entered;const began=new Promise(r=>entered=r);
 const pending=reconcilePrivateOwnerBilling(pool,{stripe:{...stripe,subscriptions:{retrieve:async()=>{entered();await delayed;return sub;}}},now});await began;
 assert.equal((await Promise.race([admit(),new Promise((_,reject)=>setTimeout(()=>reject(Error('admission_blocked')),500))])).allowed,true);release();await pending;
 // A new payable invoice without an attempted payment is not a paid term/grace.
 await q('UPDATE private_owner_billing SET paid_through=$2,amount_owed_cents=150,grace_ends_at=NULL,first_failed_at=NULL WHERE tenant_key=$1',[c.tenantKey,new Date(now-1000)]);
 assert.equal((await admit()).allowed,false);
 await q('UPDATE private_owner_billing SET paid_through=to_timestamp($2) WHERE tenant_key=$1',[c.tenantKey,end]);
 invoices=[{...invoices[0],status:'open',amount_remaining:150,amount_paid:0,attempt_count:1,created:start,status_transitions:{finalized_at:start}}];
 const failureAt=Math.floor(now.getTime()/1000)-60;
 await reconcilePrivateOwnerBilling(pool,{stripe,now,event:{id:'evt_failure',type:'invoice.payment_failed',created:failureAt,data:{object:{id:'in_synthetic'}}}});
 let ledger=(await q('SELECT * FROM private_owner_billing')).rows[0];assert.equal(new Date(ledger.first_failed_at).getTime(),failureAt*1000);assert.equal((await admit()).allowed,true);
 await reconcilePrivateOwnerBilling(pool,{stripe,now:new Date(now.getTime()+86400000),event:{id:'evt_retry',type:'invoice.payment_failed',created:failureAt+86400,data:{object:{id:'in_synthetic'}}}});
 ledger=(await q('SELECT * FROM private_owner_billing')).rows[0];assert.equal(new Date(ledger.first_failed_at).getTime(),failureAt*1000);assert.equal((await admit(new Date(failureAt*1000+5*86400000))).allowed,false);
 invoices[0]={...invoices[0],status:'paid',amount_remaining:0,amount_paid:150};await reconcilePrivateOwnerBilling(pool,{stripe,now});assert.equal((await admit()).allowed,true);
 sub.cancel_at_period_end=true;await reconcilePrivateOwnerBilling(pool,{stripe,now});assert.equal((await admit(new Date(end*1000))).allowed,false);
 // A positively paid new monthly term renews automatically without rewriting legacy usage/account snapshots.
 sub.cancel_at_period_end=false;sub.items.data[0].current_period_start=end;sub.items.data[0].current_period_end=end+30*86400;
 invoices[0].id='in_renewal';invoices[0].lines.data[0].period={start:end,end:end+30*86400};
 const renewalTime=new Date(end*1000+86400000);await reconcilePrivateOwnerBilling(pool,{stripe,now:renewalTime});assert.equal((await admit(renewalTime)).allowed,true);
 assert.deepEqual((await q('SELECT to_jsonb(b) AS value FROM tenant_billing_accounts b WHERE tenant_key=$1',[c.tenantKey])).rows[0].value,accountBefore);
 // Missing first-attempt evidence must not restart grace from a third retry.
 invoices[0]={...invoices[0],status:'open',amount_remaining:150,amount_paid:0,attempt_count:3};
 await reconcilePrivateOwnerBilling(pool,{stripe,now:renewalTime,event:{id:'evt_third_first_delivery',type:'invoice.payment_failed',created:Math.floor(renewalTime.getTime()/1000),data:{object:{id:'in_renewal'}}}});
 assert.equal((await q('SELECT review_required FROM private_owner_billing')).rows[0].review_required,true);assert.equal((await admit(renewalTime)).allowed,false);
 assert.equal((await q('SELECT count(*)::integer AS n FROM paid_purchases')).rows[0].n,0);
 // Failure of the private provider read cannot prevent normal paid lifecycle work.
 await q("INSERT INTO paid_intakes(intake_id,owner_email,payload_json,verified_at) VALUES('standard_lifecycle','standard@fixture.invalid','{}',NOW())");
 await q("INSERT INTO paid_purchases(purchase_id,intake_id,owner_email,tenant_key,plan_code,billing_interval,livemode,amount_cents,payment_status,paid_at,recurring_consent_at) VALUES('standard_lifecycle','standard_lifecycle','standard@fixture.invalid','ordinary_unpaid','starter','year',TRUE,10000,'paid','2026-11-01','2026-11-01')");
 await q("INSERT INTO tenant_billing_accounts(tenant_key,paid_purchase_id,billing_interval,usage_anchor_at,paid_base_through,current_period_start,current_period_end) VALUES('ordinary_unpaid','standard_lifecycle','year','2026-11-01','2030-11-01','2026-11-01','2030-11-01')");
 const originalSecret=process.env.STRIPE_SECRET_KEY;delete process.env.STRIPE_SECRET_KEY;
 try{const result=await runBillingLifecycleJobs(pool);assert.equal(result.privateOwner.reconciliationFailed,true);assert.equal(result.paidLifecycle.accounts,1);assert.equal((await q("SELECT restriction FROM billing_delinquencies WHERE tenant_key='ordinary_unpaid'")).rows[0].restriction,'normal');}finally{if(originalSecret!==undefined)process.env.STRIPE_SECRET_KEY=originalSecret;}
 console.log(JSON.stringify({status:'PASS',suite:'private owner native migration/admission/renewal/grace/isolation',providerWrites:0}));
}finally{await f.close();}
