import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const ROOT='/tmp/everycall-production-cutover',REV='b748a9be20ce24ee772d6a75bb3ca8f1832f4a3d',TARGET='455767609f536fbe6e3f3cd80358cd9df1711aea9ea149dcfa6f24468fc9059f';
const ITEMS=[{table:'source_segments',oid:'2023945',index:'source_segments_tenant_key_idx'},{table:'source_chunks',oid:'2024570',index:'source_chunks_tenant_key_idx'}];
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const fail=s=>{throw Error(`source_index_${s}`);};
const [mode,out,prePath,prePin]=process.argv.slice(2);
if(!['preflight','dry-run','apply','verify'].includes(mode)||!out||fs.existsSync(out))fail('new_output_and_mode');
const source=fs.readFileSync(new URL(import.meta.url),'utf8'),sourceSha256=hash(source);
if(execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim()!==REV||execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:ROOT,encoding:'utf8'}).trim())fail('source_pin');
const {upibTargetFingerprint,verifyUnifiedPaidBillingInstalled}=await import(`${ROOT}/scripts/lib/unified-paid-billing-migrations.mjs`);
const {verifyPrivateOwnerMigration}=await import(`${ROOT}/scripts/lib/private-owner-migration.mjs`);
if(upibTargetFingerprint(process.env.DATABASE_URL)!==TARGET)fail('target_pin');
const sqls=Object.fromEntries(['0063_unified_paid_intake.sql','0064_paid_billing_lifecycle.sql','0065_private_owner_billing.sql'].map(n=>[n,fs.readFileSync(`${ROOT}/migrations/${n}`,'utf8')]));
const frozenSqlSha256=Object.fromEntries(Object.entries(sqls).map(([n,s])=>[n,hash(s)]));
const require=createRequire(`${ROOT}/package.json`),{Pool}=require('pg'),pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,query_timeout:125000});
const db=await pool.connect();let journal=null;
function save(){fs.writeFileSync(out,JSON.stringify(journal,null,2)+'\n',{mode:0o600,flush:true});}
async function metadata(){
 const tables=(await db.query("SELECT c.oid::text,c.relname,c.relkind,pg_relation_size(c.oid)::text AS heap_bytes,a.attnum,a.atttypid::regtype::text AS tenant_type,a.attnotnull FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='tenant_key' WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname",[ITEMS.map(i=>i.table)])).rows;
 for(const i of ITEMS){const t=tables.find(t=>t.relname===i.table);if(!t||t.oid!==i.oid||t.relkind!=='r'||t.tenant_type!=='text'||!t.attnotnull||BigInt(t.heap_bytes)>1073741824n)fail('table_contract_or_size');}
 const indexes=(await db.query("SELECT c.relname,c.relkind,i.indisvalid,i.indisready,i.indislive,pg_get_indexdef(i.indexrelid) AS definition,i.indrelid::text AS table_oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_index i ON i.indexrelid=c.oid WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname",[ITEMS.map(i=>i.index)])).rows;
 for(const x of indexes){const item=ITEMS.find(i=>i.index===x.relname);if(x.relkind!=='i'||x.table_oid!==item.oid||!x.indisvalid||!x.indisready||!x.indislive||x.definition!==`CREATE INDEX ${item.index} ON public.${item.table} USING btree (tenant_key)`)fail('index_collision_or_invalid');}
 const constraints=(await db.query("SELECT conname,conrelid::text AS table_oid,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=ANY($1::oid[]) ORDER BY conrelid,conname",[ITEMS.map(i=>i.oid)])).rows;
 const originalIndexes=(await db.query("SELECT c.relname,pg_get_indexdef(i.indexrelid) AS definition,i.indisvalid,i.indisready,i.indislive FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=ANY($1::oid[]) AND NOT(c.relname=ANY($2::text[])) ORDER BY c.relname",[ITEMS.map(i=>i.oid),ITEMS.map(i=>i.index)])).rows;
 const gate=(await db.query('SELECT * FROM paid_intake_release WHERE id=TRUE')).rows[0];if(gate?.enabled!==false||gate.reviewed_revision!==null||gate.inventory_reference!==null||gate.enabled_at!==null)fail('gate_not_pristine');
 const receipts=(await db.query("SELECT name FROM schema_migrations WHERE name=ANY($1::text[]) ORDER BY name",[Object.keys(sqls)])).rows;if(receipts.length!==3)fail('frozen_receipts');
 return {tables,indexes,constraints,originalIndexes,gate,receipts};
}
async function readState(){await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{await db.query("SET LOCAL transaction_timeout='10s'");await db.query("SET LOCAL statement_timeout='5s'");await verifyUnifiedPaidBillingInstalled(db,sqls['0064_paid_billing_lifecycle.sql']);await verifyPrivateOwnerMigration(db,sqls['0065_private_owner_billing.sql']);const state=await metadata();await db.query('COMMIT');return state;}catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}}
try{
 await db.query("SET statement_timeout='5s'");await db.query("SET lock_timeout='250ms'");await db.query("SET idle_in_transaction_session_timeout='5s'");
 const before=await readState();
 let pre;if(mode!=='preflight'){if(!prePath||!prePin)fail('preflight_required');const raw=fs.readFileSync(prePath,'utf8');if(hash(raw)!==prePin)fail('preflight_file_pin');pre=JSON.parse(raw);if(pre.mode!=='preflight'||pre.sourceSha256!==sourceSha256||pre.reviewedRevision!==REV||pre.targetFingerprint!==TARGET||hash(pre.frozenSqlSha256)!==hash(frozenSqlSha256))fail('preflight_contract');}
 if(['preflight','dry-run'].includes(mode)){
  if(before.indexes.length)fail('preexisting_owned_indexes');
  journal={mode,observedAt:new Date().toISOString(),sourceSha256,reviewedRevision:REV,targetFingerprint:TARGET,frozenSqlSha256,state:before,ddl:ITEMS.map(i=>`CREATE INDEX CONCURRENTLY ${i.index} ON public.${i.table} USING btree (tenant_key)`),providerEffects:0};fs.writeFileSync(out,JSON.stringify(journal,null,2)+'\n',{mode:0o600,flag:'wx',flush:true});
 }else if(mode==='verify'){
  if(before.indexes.length!==ITEMS.length)fail('not_all_indexes_valid');
  if(hash(before.constraints)!==hash(pre.state.constraints)||hash(before.originalIndexes)!==hash(pre.state.originalIndexes)||hash(before.gate)!==hash(pre.state.gate))fail('protected_schema_changed');
  journal={mode,observedAt:new Date().toISOString(),sourceSha256,reviewedRevision:REV,state:before,providerEffects:0};fs.writeFileSync(out,JSON.stringify(journal,null,2)+'\n',{mode:0o600,flag:'wx',flush:true});
 }else{
  const at=Date.parse(pre.observedAt);if(!Number.isFinite(at)||at>Date.now()||Date.now()-at>600000)fail('stale_preflight');
  if(process.env.EVERYCALL_APPLY_SOURCE_TENANT_INDEXES!=='1'||process.env.EVERYCALL_REVIEWED_SOURCE_INDEX_OPS_SHA256!==sourceSha256||!process.env.EVERYCALL_SOURCE_INDEX_REVIEW_REFERENCE)fail('explicit_reviewed_apply');
  if((await db.query('SELECT role FROM admin_users WHERE id=1')).rows[0]?.role!=='admin')fail('operator_actor');
  if(before.indexes.length||hash(before.constraints)!==hash(pre.state.constraints)||hash(before.originalIndexes)!==hash(pre.state.originalIndexes)||hash(before.gate)!==hash(pre.state.gate))fail('preflight_drift');
  if(!(await db.query('SELECT pg_try_advisory_lock(1763910421) AS locked')).rows[0].locked)fail('operator_busy');
  // Session bounds are separate from unchanged 10s/5s purge guards. CONCURRENTLY
  // cannot execute inside a transaction and may leave an invalid index on failure.
  await db.query("SET maintenance_work_mem='64MB'");await db.query('SET max_parallel_maintenance_workers=0');await db.query("SET statement_timeout='120s'");
  journal={mode,observedAt:new Date().toISOString(),sourceSha256,reviewedRevision:REV,targetFingerprint:TARGET,preflightSha256:prePin,reviewReference:process.env.EVERYCALL_SOURCE_INDEX_REVIEW_REFERENCE,state:'prepared',effects:[],providerEffects:0};fs.writeFileSync(out,JSON.stringify(journal,null,2)+'\n',{mode:0o600,flag:'wx',flush:true});
  for(const i of ITEMS){
   const ddl=`CREATE INDEX CONCURRENTLY ${i.index} ON public.${i.table} USING btree (tenant_key)`;
   const effect={index:i.index,ddl,ddlSha256:hash(ddl),state:'submitted',submittedAt:new Date().toISOString()};journal.effects.push(effect);save();
   await db.query("SET statement_timeout='120s'");await db.query(ddl);await db.query("SET statement_timeout='5s'");effect.state='response_received';effect.observedAt=new Date().toISOString();save();
   const check=await metadata();if(!check.indexes.some(x=>x.relname===i.index))fail('readback_missing');effect.state='canonically_verified';save();
  }
  await db.query("SET statement_timeout='5s'");const after=await readState();if(hash(after.constraints)!==hash(before.constraints)||hash(after.originalIndexes)!==hash(before.originalIndexes)||hash(after.gate)!==hash(before.gate))fail('protected_schema_changed');
  await db.query("INSERT INTO audit_log(actor,action,details) VALUES('admin:1','schema.source_tenant_indexes.installed',$1)",[JSON.stringify({sourceSha256,reviewedRevision:REV,preflightSha256:prePin,reviewReference:journal.reviewReference,indexes:after.indexes,frozenSqlSha256})]);journal.state='complete';journal.completedAt=new Date().toISOString();journal.after=after;save();
 }
 console.log(JSON.stringify({mode,file:out,fileSha256:hash(fs.readFileSync(out,'utf8')),state:journal.state||'read_only'}));
}catch(e){if(journal&&mode==='apply'){journal.state='outcome_requires_read_only_reconciliation';journal.error=e.code||e.message;save();}console.error(JSON.stringify({error:e.code||e.message,mutationPossible:mode==='apply',nextAction:'read_only_canonical_reconciliation_no_replay_or_drop'}));process.exitCode=1;}finally{db.release();await pool.end();}
