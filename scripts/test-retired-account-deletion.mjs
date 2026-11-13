import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import {captureRetiredAccountInventory as captureBeforeBatching} from './fixtures/retired-account-inventory-before-batching.mjs';
import {createUpibTestFixture} from './lib/upib-test-fixture.mjs';
import {upibTargetFingerprint} from './lib/unified-paid-billing-migrations.mjs';
import {cutoverDigest} from './lib/paid-intake-release-cutover.mjs';
import {RETIRED_ACCOUNT as c,captureRetiredAccountInventory,deleteRetiredLegacyAccount} from './lib/delete-retired-legacy-account.mjs';
const buildsUrl=new URL('../pages/api/_lib/knowledgeReceptionistBuilds.js',import.meta.url).href;
const allocatorHook=registerHooks({load(url,context,nextLoad){const result=nextLoad(url,context);return url===buildsUrl?{...result,source:String(result.source)+'\nexport {assertBuildRateLimit};'}:result;}});
const {assertBuildRateLimit}=await import(buildsUrl);allocatorHook.deregister();
const f=await createUpibTestFixture({label:'deletelegacy'}),{pool}=f,q=(sql,p)=>pool.query(sql,p),revision='a'.repeat(40);
const latencyMs=Number(process.argv.find(v=>v.startsWith('--latency-ms='))?.split('=')[1]||0);
assert.ok([0,80,90,100].includes(latencyMs),'latency fixture supports only 0/80/90/100ms');
let queryCount=0,maxOperationQueries=0,maxOperationMs=0,inventoryComparisons=0;
const delayed=target=>async(...args)=>{queryCount++;if(latencyMs)await sleep(latencyMs);return target.query(...args);};
const timedPool={query:delayed(pool),connect:async()=>{const db=await pool.connect();return {query:delayed(db),release:()=>db.release()};}};
async function capture(){
 const priorQueries=queryCount,actual=await captureRetiredAccountInventory(timedPool);
 assert.ok(queryCount-priorQueries<=7,'capture must use at most seven database round trips');
 const original=await captureBeforeBatching(pool);
 // The previous UNION had no global ordering; all row/field values must match.
 original.tables.sort((a,b)=>a.table.localeCompare(b.table));
 const ordered=structuredClone(actual);ordered.tables.sort((a,b)=>a.table.localeCompare(b.table));
 assert.deepEqual(ordered,original);inventoryComparisons++;return actual;
}

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
 // Exercise the real 0052 schema/backfill and existing 0046 retained audit schema.
 const auditSchema=await readFile(new URL('../migrations/0046_knows_by_heart_catalog.sql',import.meta.url),'utf8');
 await q(auditSchema.match(/CREATE TABLE IF NOT EXISTS kb_purge_audit \([\s\S]*?\n\);/)[0]);
 // Failed build starts retain their rolling allocation too.
 await q("INSERT INTO knowledge_builds(build_id,tenant_key,status,version) VALUES('owner_failed','creative_dynamic','failed','v1')");
 await q(await readFile(new URL('../migrations/0052_knowledge_source_integrity.sql',import.meta.url),'utf8'));
 await q("UPDATE knowledge_build_allocations SET allocated_at='2026-11-13T18:00:00.123456Z',override_actor_id='fixture-admin-original' WHERE tenant_key=$1",[c.tenantKey]);
 const allocationRows=async key=>(await q('SELECT to_jsonb(a) AS row FROM knowledge_build_allocations a WHERE tenant_key=$1',[key])).rows.map(r=>r.row);
 const daveAllocation=await allocationRows(c.tenantKey),ownerAllocation=await allocationRows('creative_dynamic');
 assert.equal(daveAllocation[0].build_id,'dave_failed');
 await assert.rejects(assertBuildRateLimit(pool,'creative_dynamic',{buildId:'owner-second-build'}),/rate_limited/);
 const provider={observedAt:new Date().toISOString(),stripeAccount:'acct_16FSzlFgMKdd4EaW',livemode:true,unknownEffects:0,subscription:{id:c.subscriptionId,customer:c.customerId,status:'canceled',livemode:true,schedule:null},invoices:{hasMore:false,data:[{id:'in_preserved_debt',customer:c.customerId,subscription:c.subscriptionId,livemode:true,status:'open',auto_advance:false,next_payment_attempt:null,amount_remaining:9950}]},pendingInvoiceItems:{count:0,hasMore:false},schedules:{activeCount:0,hasMore:false},number:{id:c.phoneNumberId,absent:true,canonicalReadback:true,releaseEvidenceReference:'fixture:positive-number-absence'}};
 const runtime={observedAt:new Date().toISOString(),...Object.fromEntries(['app','gateway','worker'].map(k=>[k,{revision,healthy:true}])),retirement:{oldCanonicalIngressRemoved:true,oldWorkerInstancesAbsent:true,oldRevision:'17195749a3cd70b421db34c2f4f244d9f153b0e3',configuredFunctionMaximumSeconds:300,canonicalChangedAt:new Date(Date.now()-900000).toISOString(),completedAt:new Date(Date.now()-1000).toISOString()}};
 const make=async()=>({runtime,reviewedRevision:revision,targetFingerprint:upibTargetFingerprint(f.databaseUrl),actorAdminUserId:901,ownerDecisionReference:'fixture:explicit-dave-delete',ownerDecisionQuote:'SYNTHETIC ONLY delete the retired account and stop billing.',independentReviewReference:'fixture:review',provider,inventory:await capture()});
 const run=async(b,execute=true)=>{const start=performance.now(),priorQueries=queryCount;try{return await deleteRetiredLegacyAccount(timedPool,{bundle:b,bundleSha256:cutoverDigest(b),currentRevision:revision,databaseUrl:f.databaseUrl,execute});}finally{const count=queryCount-priorQueries,elapsed=performance.now()-start;maxOperationQueries=Math.max(maxOperationQueries,count);maxOperationMs=Math.max(maxOperationMs,elapsed);assert.ok(count<=30,`operation exceeded 30 round trips: ${count}`);if(latencyMs)assert.ok(elapsed<9000,`operation approached 10s transaction deadline: ${elapsed}ms`);}};
 let bundle=await make();assert.equal((await run(bundle,false)).dryRun,true);
 let bad=structuredClone(bundle);bad.provider.invoices.data[0].auto_advance=true;await assert.rejects(run(bad),/invoice_collection_not_stopped/);
 bad=structuredClone(bundle);bad.provider.number.absent=false;await assert.rejects(run(bad),/number_release_unresolved/);
 await q("UPDATE tenants SET name='changed' WHERE tenant_key=$1",[c.tenantKey]);await assert.rejects(run(bundle),/inventory_changed/);bundle=await make();
 // A cross-tenant child of a deleted knowledge build must never cascade.
 await q("INSERT INTO source_refs(source_ref_id,tenant_key,build_id,source_channel,source_kind,source_authority,source_locator,content_hash) VALUES('hostile_cross','creative_dynamic','dave_failed','website','page','website','https://fixture.invalid','fixture_hash')");
 await assert.rejects(run(await make()),/indirect_or_cross_tenant_dependents/);await q("DELETE FROM source_refs WHERE source_ref_id='hostile_cross'");
 // Unknown indirect children are fenced even though they have no tenant_key.
 await q('CREATE TABLE deletion_indirect(id integer PRIMARY KEY,build_id text REFERENCES knowledge_builds(build_id) ON DELETE CASCADE)');await q("INSERT INTO deletion_indirect VALUES(1,'dave_failed')");
 await assert.rejects(run(await make()),/indirect_or_cross_tenant_dependents/);await q('DROP TABLE deletion_indirect');
 // Newly classified allocations also fence indirect children; the frozen old
 // oracle intentionally lacked this new parent disposition, so assert it directly.
 const allocationDependencyBase=await make();
 await q('CREATE TABLE allocation_indirect(id integer PRIMARY KEY,allocation_tenant text REFERENCES knowledge_build_allocations(tenant_key) ON DELETE CASCADE)');await q("INSERT INTO allocation_indirect VALUES(1,'daved')");
 const allocationDependencyInventory=await captureRetiredAccountInventory(timedPool);
 assert.equal(allocationDependencyInventory.dependencies.find(d=>d.child==='allocation_indirect').count,1);
 await assert.rejects(run({...allocationDependencyBase,inventory:allocationDependencyInventory}),/indirect_or_cross_tenant_dependents/);await q('DROP TABLE allocation_indirect');
 await q('CREATE TABLE deletion_unknown_scope(tenant_key text,value text)');await q("INSERT INTO deletion_unknown_scope VALUES('daved','must refuse')");
 await assert.rejects(run(await make()),/unresolved_rows_deletion_unknown_scope/);await q('DROP TABLE deletion_unknown_scope');
 // Retained state can exist without a calls row; tenant cascades must not erase it.
 await q("INSERT INTO call_states(call_id,tenant_key,runtime_entry_mode,current_stage) VALUES('retained_state',$1,'guided','opening')",[c.tenantKey]);
 await assert.rejects(run(await make()),/retained_cascade_dependency/);await q("DELETE FROM call_states WHERE call_id='retained_state'");
 await q("INSERT INTO auth_tokens(token,token_type,user_id,email,expires_at) VALUES('unscoped_fixture','password_reset',41,'retired@fixture.invalid',NOW()+INTERVAL '1 hour')");
 await assert.rejects(run(await make()),/shared_local_identity/);await q("DELETE FROM auth_tokens WHERE token='unscoped_fixture'");
 // A delete-side trigger cannot silently alter retained financial history.
 await q("CREATE FUNCTION mutate_retained_period() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE billing_periods SET period_end=period_end+INTERVAL '1 day' WHERE tenant_key=OLD.tenant_key; RETURN OLD; END $$");
 await q('CREATE TRIGGER mutate_retained_period BEFORE DELETE ON tenants FOR EACH ROW EXECUTE FUNCTION mutate_retained_period()');
 bundle=await make();await assert.rejects(run(bundle),/retained_history_changed/);assert.deepEqual(await capture(),bundle.inventory);
 await q('DROP TRIGGER mutate_retained_period ON tenants');await q('DROP FUNCTION mutate_retained_period()');
 // A nonempty allocation cannot be removed without durable complete audit storage.
 await q('ALTER TABLE kb_purge_audit RENAME TO allocation_fixture_audit_backup');
 await assert.rejects(run(await make()),/allocation_audit_required/);
 await q('ALTER TABLE allocation_fixture_audit_backup RENAME TO kb_purge_audit');
 await q("CREATE FUNCTION redact_allocation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.metadata_json=NEW.metadata_json-'knowledgeBuildAllocation'; RETURN NEW; END $$");
 await q('CREATE TRIGGER redact_allocation BEFORE INSERT ON kb_purge_audit FOR EACH ROW EXECUTE FUNCTION redact_allocation_audit()');
 bundle=await make();await assert.rejects(run(bundle),/allocation_audit_mismatch/);assert.deepEqual(await allocationRows(c.tenantKey),daveAllocation);assert.equal((await q('SELECT 1 FROM kb_purge_audit WHERE tenant_key=$1',[c.tenantKey])).rowCount,0);
 await q('DROP TRIGGER redact_allocation ON kb_purge_audit');await q('DROP FUNCTION redact_allocation_audit()');
 // The entire delete rolls back if the durable completion receipt fails.
 await q("CREATE FUNCTION reject_deletion_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='tenant.legacy_account.deleted' THEN RAISE EXCEPTION 'fixture_receipt_failure'; END IF; RETURN NEW; END $$");
 await q('CREATE TRIGGER reject_delete BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_deletion_receipt()');bundle=await make();await assert.rejects(run(bundle),/fixture_receipt_failure/);assert.equal((await q('SELECT 1 FROM tenants WHERE tenant_key=$1',[c.tenantKey])).rowCount,1);assert.deepEqual(await allocationRows(c.tenantKey),daveAllocation);assert.equal((await q('SELECT 1 FROM kb_purge_audit WHERE tenant_key=$1',[c.tenantKey])).rowCount,0);await q('DROP TRIGGER reject_delete ON audit_log');await q('DROP FUNCTION reject_deletion_receipt()');
 bundle=await make();assert.equal((await run(bundle)).deleted,true);assert.equal((await run(bundle)).alreadyDeleted,true);
 assert.equal((await q('SELECT 1 FROM tenants WHERE tenant_key=$1',[c.tenantKey])).rowCount,0);assert.equal((await q('SELECT 1 FROM tenant_users WHERE tenant_key=$1',[c.tenantKey])).rowCount,0);
 for(const table of ['billing_lifecycle_events','billing_periods','tenant_billing_accounts'])assert.equal((await q(`SELECT 1 FROM ${table} WHERE tenant_key=$1`,[c.tenantKey])).rowCount,1);
 assert.equal((await q("SELECT 1 FROM audit_log WHERE tenant_key=$1 AND action='historical'",[c.tenantKey])).rowCount,1);
 const archived=(await q('SELECT metadata_json FROM kb_purge_audit WHERE tenant_key=$1',[c.tenantKey])).rows[0].metadata_json.knowledgeBuildAllocation;
 assert.deepEqual(archived.rows,daveAllocation);assert.equal(archived.rowCount,1);assert.equal(archived.fingerprint,bundle.inventory.tables.find(t=>t.table==='knowledge_build_allocations').fingerprint);
 assert.deepEqual(await allocationRows(c.tenantKey),[]);assert.deepEqual(await allocationRows('creative_dynamic'),ownerAllocation);
 await assert.rejects(assertBuildRateLimit(pool,'creative_dynamic',{buildId:'owner-after-delete'}),/rate_limited/);
 assert.deepEqual(await allocationRows('creative_dynamic'),ownerAllocation);
 assert.equal((await q("SELECT 1 FROM sessions WHERE id='owner_session'")).rowCount,1);assert.equal((await q("SELECT 1 FROM tenants WHERE tenant_key='creative_dynamic'")).rowCount,1);
 console.log(JSON.stringify({status:'PASS',suite:'guarded retired account deletion native retention/allocation-audit/budget/isolation/rollback/replay',latencyMs,inventoryComparisons,maxOperationQueries,maxOperationMs:Math.round(maxOperationMs),providerWrites:0}));
}finally{await f.close();}
