import assert from 'node:assert/strict';
import {createUpibTestFixture} from './lib/upib-test-fixture.mjs';
import {upibTargetFingerprint} from './lib/unified-paid-billing-migrations.mjs';
import {cutoverDigest} from './lib/paid-intake-release-cutover.mjs';
import {RETIRED_ACCOUNT as c,captureRetiredAccountInventory,deleteRetiredLegacyAccount} from './lib/delete-retired-legacy-account.mjs';
const f=await createUpibTestFixture({label:'deletelegacy'}),{pool}=f,q=(sql,p)=>pool.query(sql,p),revision='a'.repeat(40);
try{
 await q("INSERT INTO admin_users(id,username,email,role) VALUES(901,'deletion_fixture','operator@fixture.invalid','admin')");
 await q("INSERT INTO tenants(tenant_key,name,status,telnyx_voice_number_id) VALUES($1,'Retired fixture','active',$2),('creative_dynamic','Owner fixture','active','owner_number')",[c.tenantKey,c.phoneNumberId]);
 await q("INSERT INTO tenant_users(id,tenant_key,name,email,role) VALUES(41,$1,'Retired','retired@fixture.invalid','owner'),(29,'creative_dynamic','Owner','owner@fixture.invalid','owner')",[c.tenantKey]);
 await q("INSERT INTO sessions(id,user_id,tenant_key,role,expires_at) VALUES('dave_session',41,$1,'owner',NOW()-INTERVAL '1 day'),('owner_session',29,'creative_dynamic','owner',NOW()+INTERVAL '1 day')",[c.tenantKey]);
 await q('INSERT INTO tenant_billing_accounts(tenant_key,stripe_customer_id,stripe_subscription_id,stripe_price_id) VALUES($1,$2,$3,\'price_retired\')',[c.tenantKey,c.customerId,c.subscriptionId]);
 await q("INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,'fixture','historical','retained')",[c.tenantKey]);
 await q("INSERT INTO billing_lifecycle_events(tenant_key,event_type) VALUES($1,'historical')",[c.tenantKey]);
 await q("INSERT INTO billing_periods(tenant_key,period_start,period_end,status) VALUES($1,'2026-11-01','2026-12-01','open')",[c.tenantKey]);
 await q("INSERT INTO knowledge_builds(build_id,tenant_key,status,version) VALUES('dave_failed',$1,'failed','v1')",[c.tenantKey]);
 const provider={observedAt:new Date().toISOString(),stripeAccount:'acct_16FSzlFgMKdd4EaW',livemode:true,unknownEffects:0,subscription:{id:c.subscriptionId,customer:c.customerId,status:'canceled',livemode:true,schedule:null},invoices:{hasMore:false,data:[{id:'in_preserved_debt',customer:c.customerId,subscription:c.subscriptionId,livemode:true,status:'open',auto_advance:false,next_payment_attempt:null,amount_remaining:9950}]},pendingInvoiceItems:{count:0,hasMore:false},schedules:{activeCount:0,hasMore:false},number:{id:c.phoneNumberId,absent:true,canonicalReadback:true,releaseEvidenceReference:'fixture:positive-number-absence'}};
 const runtime={observedAt:new Date().toISOString(),...Object.fromEntries(['app','gateway','worker'].map(k=>[k,{revision,healthy:true}])),retirement:{oldCanonicalIngressRemoved:true,oldWorkerInstancesAbsent:true,oldRevision:'17195749a3cd70b421db34c2f4f244d9f153b0e3',configuredFunctionMaximumSeconds:300,canonicalChangedAt:new Date(Date.now()-900000).toISOString(),completedAt:new Date(Date.now()-1000).toISOString()}};
 const make=async()=>({runtime,reviewedRevision:revision,targetFingerprint:upibTargetFingerprint(f.databaseUrl),actorAdminUserId:901,ownerDecisionReference:'fixture:explicit-dave-delete',ownerDecisionQuote:'SYNTHETIC ONLY delete the retired account and stop billing.',independentReviewReference:'fixture:review',provider,inventory:await captureRetiredAccountInventory(pool)});
 const run=b=>deleteRetiredLegacyAccount(pool,{bundle:b,bundleSha256:cutoverDigest(b),currentRevision:revision,databaseUrl:f.databaseUrl,execute:true});
 let bundle=await make();assert.equal((await deleteRetiredLegacyAccount(pool,{bundle,bundleSha256:cutoverDigest(bundle),currentRevision:revision,databaseUrl:f.databaseUrl})).dryRun,true);
 let bad=structuredClone(bundle);bad.provider.invoices.data[0].auto_advance=true;await assert.rejects(run(bad),/invoice_collection_not_stopped/);
 bad=structuredClone(bundle);bad.provider.number.absent=false;await assert.rejects(run(bad),/number_release_unresolved/);
 await q("UPDATE tenants SET name='changed' WHERE tenant_key=$1",[c.tenantKey]);await assert.rejects(run(bundle),/inventory_changed/);bundle=await make();
 // A cross-tenant child of a deleted knowledge build must never cascade.
 await q("INSERT INTO source_refs(source_ref_id,tenant_key,build_id,source_channel,source_kind,source_authority,source_locator,content_hash) VALUES('hostile_cross','creative_dynamic','dave_failed','website','page','website','https://fixture.invalid','fixture_hash')");
 await assert.rejects(run(await make()),/indirect_or_cross_tenant_dependents/);await q("DELETE FROM source_refs WHERE source_ref_id='hostile_cross'");
 // Unknown indirect children are fenced even though they have no tenant_key.
 await q('CREATE TABLE deletion_indirect(id integer PRIMARY KEY,build_id text REFERENCES knowledge_builds(build_id) ON DELETE CASCADE)');await q("INSERT INTO deletion_indirect VALUES(1,'dave_failed')");
 await assert.rejects(run(await make()),/indirect_or_cross_tenant_dependents/);await q('DROP TABLE deletion_indirect');
 // Retained state can exist without a calls row; tenant cascades must not erase it.
 await q("INSERT INTO call_states(call_id,tenant_key,runtime_entry_mode,current_stage) VALUES('retained_state',$1,'guided','opening')",[c.tenantKey]);
 await assert.rejects(run(await make()),/retained_cascade_dependency/);await q("DELETE FROM call_states WHERE call_id='retained_state'");
 await q("INSERT INTO auth_tokens(token,token_type,user_id,email,expires_at) VALUES('unscoped_fixture','password_reset',41,'retired@fixture.invalid',NOW()+INTERVAL '1 hour')");
 await assert.rejects(run(await make()),/shared_local_identity/);await q("DELETE FROM auth_tokens WHERE token='unscoped_fixture'");
 // The entire delete rolls back if the durable completion receipt fails.
 await q("CREATE FUNCTION reject_deletion_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='tenant.legacy_account.deleted' THEN RAISE EXCEPTION 'fixture_receipt_failure'; END IF; RETURN NEW; END $$");
 await q('CREATE TRIGGER reject_delete BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_deletion_receipt()');bundle=await make();await assert.rejects(run(bundle),/fixture_receipt_failure/);assert.equal((await q('SELECT 1 FROM tenants WHERE tenant_key=$1',[c.tenantKey])).rowCount,1);await q('DROP TRIGGER reject_delete ON audit_log');await q('DROP FUNCTION reject_deletion_receipt()');
 bundle=await make();assert.equal((await run(bundle)).deleted,true);assert.equal((await run(bundle)).alreadyDeleted,true);
 assert.equal((await q('SELECT 1 FROM tenants WHERE tenant_key=$1',[c.tenantKey])).rowCount,0);assert.equal((await q('SELECT 1 FROM tenant_users WHERE tenant_key=$1',[c.tenantKey])).rowCount,0);
 for(const table of ['billing_lifecycle_events','billing_periods','tenant_billing_accounts'])assert.equal((await q(`SELECT 1 FROM ${table} WHERE tenant_key=$1`,[c.tenantKey])).rowCount,1);
 assert.equal((await q("SELECT 1 FROM audit_log WHERE tenant_key=$1 AND action='historical'",[c.tenantKey])).rowCount,1);
 assert.equal((await q("SELECT 1 FROM sessions WHERE id='owner_session'")).rowCount,1);assert.equal((await q("SELECT 1 FROM tenants WHERE tenant_key='creative_dynamic'")).rowCount,1);
 console.log(JSON.stringify({status:'PASS',suite:'guarded retired account deletion native retention/isolation/rollback/replay',providerWrites:0}));
}finally{await f.close();}
