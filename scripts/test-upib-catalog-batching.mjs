import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createUpibTestFixture} from './lib/upib-test-fixture.mjs';
import {readMigration} from './lib/schema-migrations.mjs';
import {referenceUpibCatalogContract} from './lib/upib-catalog-reference.mjs';
import {upibCatalogContract,upibMigrationDigest,upibTargetFingerprint,applyUnifiedPaidBillingMigrations,UPIB_MIGRATIONS} from './lib/unified-paid-billing-migrations.mjs';
const contracts=JSON.parse(fs.readFileSync(new URL('./lib/unified-paid-billing-migrations.mjs',import.meta.url),'utf8').split('/* CONTRACTS_START */')[1].split('/* CONTRACTS_END */')[0].trim().replace(/;$/,''));
const fixture=await createUpibTestFixture({label:'catalogbatch',migrations:[]}),{pool}=fixture;
const additions={tenant_billing_accounts:['paid_purchase_id','usage_anchor_at','initial_period_end','paid_base_through','service_ended_at','changed_number_ack_required','stripe_subscription_status'],billing_periods:['invoice_attempted_at','invoice_payload']};
let parityCount=0;
async function parity(table,expected,excluded=[]){
 let oldQueries=0,newQueries=0;
 const old=await referenceUpibCatalogContract({query:(...args)=>{oldQueries++;return pool.query(...args);}},table,excluded);
 const current=await upibCatalogContract({query:(...args)=>{newQueries++;return pool.query(...args);}},table,excluded);
 assert.equal(JSON.stringify(current),JSON.stringify(old),`exact JSON byte/order parity ${table}`);
 assert.equal(upibMigrationDigest(JSON.stringify(current)),expected,`unchanged frozen fingerprint ${table}`);
 assert.equal(oldQueries,5);assert.equal(newQueries,1);parityCount++;
}
try{
 await pool.query(await readMigration('0049_live_prompt_settings.sql'));await pool.query("INSERT INTO schema_migrations(name) VALUES('0049_live_prompt_settings.sql')");
 await pool.query("INSERT INTO schema_migrations(name) VALUES('0050_live_brief_curation.sql') ON CONFLICT DO NOTHING");
 for(const [table,expected] of Object.entries(contracts.base))await parity(table,expected);
 await assert.rejects(upibCatalogContract(pool,'fixture_missing_relation'),/missing_relation_fixture_missing_relation/);
 await assert.rejects(referenceUpibCatalogContract(pool,'fixture_missing_relation'),/missing_relation_fixture_missing_relation/);
 let queryCount=0;const delayMs=75;
 const latencyPool={connect:async()=>{const client=await pool.connect();return{query:async(...args)=>{queryCount++;await new Promise(resolve=>setTimeout(resolve,delayMs));return client.query(...args);},on:(...args)=>client.on(...args),off:(...args)=>client.off(...args),release:error=>client.release(error)};}};
 const options={execute:true,databaseUrl:fixture.databaseUrl,expectedTargetFingerprint:upibTargetFingerprint(fixture.databaseUrl),reviewedRevision:'a'.repeat(40),currentRevision:'a'.repeat(40),expectedMigrationSha256:Object.fromEntries(await Promise.all(UPIB_MIGRATIONS.map(async n=>[n,upibMigrationDigest(await readMigration(n))]))),releaseEvidenceReference:'release:catalog-batch-native',inventoryEvidenceReference:'inventory:catalog-batch-native'};
 // Execute the frozen five-query reader under the same simulated transport
 // latency. Only test routing changes: transaction/SQL/locks/deadlines stay real.
 let legacyQueries=0;const legacyServerErrors=[];
 const legacyLatencyPool={connect:async()=>{const client=await pool.connect();client.on('error',error=>legacyServerErrors.push(error.code));const delayed={query:async(...args)=>{legacyQueries++;await new Promise(resolve=>setTimeout(resolve,delayMs));return client.query(...args);}};return{query:async(sql,args)=>{if(sql.startsWith('WITH target AS')){const old=await referenceUpibCatalogContract(delayed,args[0],args[1]);return{rows:[{...old,relation:{...old.relation,nspname:fixture.schema}}]};}return delayed.query(sql,args);},on:(...args)=>client.on(...args),off:(...args)=>client.off(...args),release:error=>client.release(error)};}};
 await assert.rejects(applyUnifiedPaidBillingMigrations(legacyLatencyPool,options),error=>error.code==='25P04'||legacyServerErrors.includes('25P04'));
 assert.equal((await pool.query('SELECT 1 FROM schema_migrations WHERE name=ANY($1::text[])',[UPIB_MIGRATIONS])).rowCount,0);
 assert.equal((await pool.query("SELECT 1 FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relname='paid_intake_release'")).rowCount,0);
 assert.equal((await pool.query("SELECT 1 FROM pg_attribute WHERE attrelid='tenant_billing_accounts'::regclass AND attname='paid_purchase_id' AND NOT attisdropped")).rowCount,0);
 const result=await applyUnifiedPaidBillingMigrations(latencyPool,options);
 assert.equal(result.applied,true);assert.equal(result.gateEnabled,false);assert.ok(result.transactionElapsedMs<10000);
 for(const [table,expected] of Object.entries(contracts.installed))await parity(table,expected);
 for(const [table,expected] of Object.entries(contracts.base))await parity(table,expected,additions[table]||[]);
 console.log(JSON.stringify({status:'PASS',parityComparisons:parityCount,oldQueriesPerContract:5,newQueriesPerContract:1,simulatedDelayPerQueryMs:delayMs,legacyQueriesBeforeTimeout:legacyQueries,legacyServerErrors,migrationQueries:queryCount,transactionElapsedMs:result.transactionElapsedMs,limitsUnchanged:true,productionAccess:false}));
}finally{await fixture.close();}
