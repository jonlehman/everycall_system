import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { normalizeKnowledgeClaim, resolveKnowledgeConflicts, analyzeKnowledgeContent } from '../pages/api/_lib/knowledgeContentValidation.js';
import { consolidateArtifacts } from '../pages/api/_lib/knowledgeReceptionistCompiler.js';
import * as gov from '../pages/api/_lib/knowledgeGovernance.js';
// Offline only: fail any accidental network/model request. Actual compiler
// consolidation, governance/auth checks, configuration writes and SQL execute.
globalThis.fetch = async () => { throw new Error('offline_fixture_network_forbidden'); };
const configUrl = new URL('../pages/api/_lib/knowledgeReceptionistConfig.js', import.meta.url).href;
const buildUrl = new URL('../pages/api/_lib/knowledgeReceptionistBuilds.js', import.meta.url).href;
const interviewUrl = new URL('../pages/api/_lib/knowledgeReceptionistSetupInterview.js', import.meta.url).href;
const hook = registerHooks({ load(url, ctx, next) {
  const loaded = next(url, ctx);
  if (url === buildUrl) {
    let source = String(loaded.source).replaceAll('await assertSliceTablesReady(db);', '');
    const start = source.indexOf('export async function publishKnowledgeBuild(');
    const end = source.indexOf('export async function publishKnowledgeBuildWithExecutionLease', start);
    let publish = source.slice(start, end)
      .replace('await preparePublicationCatalog(db, tenantKey, buildId)', 'undefined')
      .replace('await curateLiveBriefBuild(db, { tenantKey, buildId, executionLeaseToken })', 'undefined')
      .replace('await prepareLiveBriefPublication(db, { tenantKey, buildId })', '{}')
      .replace(/await prepareTenantPromptProfileCompanyDescriptionSnapshot\(db, tenantKey, \{[\s\S]*?\}\)/, '{}')
      .replace('await loadBuildAssetsFromDb(client, tenantKey, buildId)', '{}')
      .replace('await publishKnowledgeHeartCatalog(client, { tenantKey, buildId })', 'await globalThis.__governancePublishCatalog()')
      .replace('await publishLiveBriefBuild(client, { tenantKey, buildId, prepared: preparedBrief })', 'undefined')
      .replace('await maybeActivateTenantLivePrompt(client, tenantKey)', 'undefined')
      .replace('await persistTenantPromptProfileCompanyDescriptionSnapshot(client, preparedProfile)', 'undefined')
      .replace(/await recordCoreFactActivationChanges\(client, \{[\s\S]*?\}\);/, '');
    return { ...loaded, source: source.slice(0,start)+publish+source.slice(end) };
  }
  if (url === configUrl) return { ...loaded, source: String(loaded.source).replaceAll('await assertConfigTablesReady(db);', '') };
  if (url === interviewUrl) return { ...loaded, source: String(loaded.source).replaceAll('await assertSetupInterviewTablesReady(db);', '') };
  return loaded;
} });
const config = await import(configUrl);
const interview = await import(interviewUrl);
const builds = await import(buildUrl);
globalThis.__governancePublishCatalog = async () => {};
// Keep the hook until dynamic approval imports have resolved (module cache).
const pg = new PGlite();
const client = { query: async (...args) => { const r = await pg.query(...args); return { ...r, rowCount: r.affectedRows || r.rows.length }; }, release() {} };
const db = { query: client.query, connect: async () => client };
await pg.exec(`CREATE TABLE tenants (tenant_key TEXT PRIMARY KEY); INSERT INTO tenants VALUES ('a'),('b');
CREATE TABLE tenant_users(id TEXT PRIMARY KEY,tenant_key TEXT,role TEXT,status TEXT); INSERT INTO tenant_users VALUES ('1','a','owner','active'),('2','a','admin','active'),('3','b','owner','active'),('4','a','member','active'),('5','a','admin','inactive');
CREATE TABLE admin_users(id TEXT PRIMARY KEY,role TEXT); INSERT INTO admin_users VALUES ('9','admin'),('10','sales');
CREATE TABLE audit_log (tenant_key TEXT,actor TEXT,action TEXT,details JSONB);`);
for (const file of ['0001_knowledge_receptionist_slice.sql','0003_knowledge_receptionist_slice_two.sql','0053_knowledge_governance.sql']) await pg.exec(await fs.readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
await pg.exec(await fs.readFile(new URL('../migrations/0053_knowledge_governance.sql', import.meta.url), 'utf8'));
await pg.exec(`ALTER TABLE knowledge_overrides_v2 RENAME TO knowledge_overrides;
ALTER TABLE knowledge_guardrails_v2 RENAME TO knowledge_guardrails;
ALTER TABLE uploaded_documents ADD COLUMN source_kind TEXT, ADD COLUMN source_locator TEXT, ADD COLUMN fetch_status TEXT, ADD COLUMN fetch_metadata_json JSONB, ADD COLUMN content_fingerprint TEXT, ADD COLUMN original_capture_json JSONB;`);
// Exercise the production readiness probe directly, not its save-fixture stub.
await pg.exec('CREATE TABLE call_outcome_schemas (id TEXT); CREATE TABLE knowledge_runtime_profiles (greeting_text TEXT, company_description TEXT);');
const probeSql=[];
await config.assertConfigTablesReady({query:async(sql,params)=>{probeSql.push(sql);return db.query(sql,params);}});
assert.ok(probeSql.every(sql=>! /\b(?:ALTER|CREATE|DROP|INSERT|UPDATE|DELETE)\b/i.test(sql)));
await pg.exec('ALTER TABLE uploaded_documents DROP COLUMN content_fingerprint');
await assert.rejects(config.assertConfigTablesReady(db),/migrations_not_applied/);
await pg.exec('ALTER TABLE uploaded_documents ADD COLUMN content_fingerprint TEXT');
await pg.exec('ALTER TABLE knowledge_runtime_profiles ALTER COLUMN greeting_text SET NOT NULL');
await assert.rejects(config.assertConfigTablesReady(db),/migrations_not_applied/);
await pg.exec('ALTER TABLE knowledge_runtime_profiles ALTER COLUMN greeting_text DROP NOT NULL');
const owner = { role: 'tenant', user_id: '1' }, second = { role: 'tenant', user_id: '2' }, foreign = { role: 'tenant', user_id: '3' };
for (const actor of [foreign, { role: 'tenant', user_id: '4' }, { role: 'tenant', user_id: '5' }, { role: 'admin', user_id: '10' }]) await assert.rejects(gov.assertKnowledgeReviewer(db, 'a', actor), /forbidden/);
await gov.assertKnowledgeReviewer(db, 'a', { role: 'admin', user_id: '9' });
const immediate = await config.saveKnowledgeOverride(db, 'a', { knowledgeOverrideId: 'hours', title: 'Hours', body: 'Open Monday 9am to 5pm.' }, owner);
assert.equal(immediate.status, 'approved_live');
await gov.saveKnowledgeGovernancePolicy(db, 'a', { review_mode: 'reviewed' }, owner);
const draft = await config.saveKnowledgeOverride(db, 'a', { knowledgeOverrideId: 'hours', title: 'Hours', body: 'Closed Monday.', status: 'approved_live' }, owner);
assert.equal(draft.status, 'draft');
assert.equal((await config.saveKnowledgeOverride(db, 'a', { knowledgeOverrideId: 'hours', title: 'Hours', body: 'Closed Monday.', status: 'approved_live' }, owner)).change_id,draft.change_id);
assert.equal((await config.listKnowledgeOverrides(db, 'a', {activeOnly:true}))[0].body, 'Open Monday 9am to 5pm.');
await assert.rejects(gov.reviewKnowledgeChange(db, 'a', draft.change_id, {decision:'approve'}, owner), /second_reviewer/);
await assert.rejects(gov.reviewKnowledgeChange(db, 'b', draft.change_id, {decision:'approve'}, foreign), /not_found/);
await gov.reviewKnowledgeChange(db, 'a', draft.change_id, {decision:'approve',note:'Verified holiday calendar.'}, second);
assert.equal((await config.listKnowledgeOverrides(db, 'a', {activeOnly:true}))[0].body, 'Closed Monday.');
await assert.rejects(gov.reviewKnowledgeChange(db, 'a', draft.change_id, {decision:'approve'}, second), /already_reviewed/);
const reject = await config.saveKnowledgeGuardrail(db, 'a', {title:'Emergency',approvedResponsePattern:'Call emergency services.'}, owner);
await gov.reviewKnowledgeChange(db, 'a', reject.change_id, {decision:'reject',note:'Needs local routing review.'}, second);
assert.equal((await config.listKnowledgeGuardrails(db,'a')).length,0);
const stale = await config.saveKnowledgeOverride(db, 'a', {title:'Old draft',body:'No longer current.'}, owner);
const newer = await config.saveKnowledgeOverride(db, 'a', {title:'New change',body:'Verified change.'}, owner);
await gov.reviewKnowledgeChange(db, 'a', newer.change_id, {decision:'approve'}, second);
await assert.rejects(gov.reviewKnowledgeChange(db, 'a', stale.change_id, {decision:'approve'}, second), /stale/);
await gov.reviewKnowledgeChange(db, 'a', stale.change_id, {decision:'reject'}, second);
const upload = await config.saveUploadedDocument(db,'a',{title:'Hours policy',bodyText:'Office is closed Monday.',documentClass:'policy',sourceAuthority:'uploaded_first_party_policy'},owner);
assert.equal((await config.listUploadedDocuments(db,'a')).length,0);
await gov.reviewKnowledgeChange(db,'a',upload.change_id,{decision:'approve'},second);
assert.equal((await config.listUploadedDocuments(db,'a'))[0].source_authority,'uploaded_first_party_policy');
const interviewDraft = await interview.createSetupInterviewSessionSkeleton(db,'a',{setupInterviewSessionId:'interview1',status:'completed',completionStatus:'completed',rawTranscriptText:'Owner confirmed hours.',confirmedSummaryBlocks:[{blockKey:'hours',title:'Hours',summaryText:'Closed Monday.',confirmationStatus:'confirmed'}]},owner);
assert.equal((await db.query('SELECT * FROM setup_interview_sessions')).rows.length,0);
await gov.reviewKnowledgeChange(db,'a',interviewDraft.change_id,{decision:'approve'},second);
assert.equal((await db.query('SELECT * FROM setup_interview_sessions')).rows.length,1);
const approvedInterviewPayload=(await db.query('SELECT payload_json FROM knowledge_change_requests WHERE change_id=$1',[interviewDraft.change_id])).rows[0].payload_json;
assert.ok(await gov.findCurrentApprovedKnowledgeChange(db,'a','setup_interview_session',approvedInterviewPayload,owner));
assert.equal(await gov.findCurrentApprovedKnowledgeChange(db,'a','setup_interview_session',{...approvedInterviewPayload,rawTranscriptText:'New unapproved values'},owner),null);
await assert.rejects(interview.createSetupInterviewSessionSkeleton(db,'b',{setupInterviewSessionId:'interview1',rawTranscriptText:'foreign overwrite'},foreign),/tenant_mismatch/);
// A policy downgrade also requires a different approver.
const downgrade = await gov.saveKnowledgeGovernancePolicy(db,'a',{review_mode:'single_admin'},owner);
assert.equal(downgrade.status,'draft');
await gov.reviewKnowledgeChange(db,'a',downgrade.change_id,{decision:'reject'},second);

const buildInfo = {tenant_key:'a',build_id:'build',primaryDomainId:'home_services',primarySubdomainId:null};
const topicRows = {topics:[],subtopics:[]};
function extracted(id, authority, page, claim, topic='Office hours', content='operational_core') {
  return {sourceRefId:id,sourceItem:{sourceAuthority:authority,sourceChannel:authority.startsWith('owner')?'owner_interview':authority.startsWith('uploaded')?'uploaded_document':page==='downloadable_resource'?'website_file':'website_page',sourceLocator:id,pageType:page,contentClass:content,title:topic},sourceChunks:[{source_chunk_id:`${id}-c`,text:claim}],facts:[{fact_key:'f',topic_name:topic,fact_role:'detail',claim_text:claim,source_chunk_ids:[`${id}-c`]}],cards:[{canonical_name:topic,topic_name:topic,summary:claim,support_summary:claim,supporting_fact_keys:['f'],source_chunk_ids:[`${id}-c`]}]};
}
function compile(records, info=buildInfo) {
  const base=consolidateArtifacts(info,topicRows,records);
  const resolved=resolveKnowledgeConflicts(base.facts,base.cards);
  return {...resolved,qa:analyzeKnowledgeContent({buildInfo:info,...resolved,sources:records})};
}
const publicHours = extracted('contact','website_public_page','contact','Office hours Monday to Friday 8am to 5pm.');
const unconfirmed = extracted('interview-draft','owner_interview_unconfirmed','owner_interview_transcript','Office hours Monday to Friday 9am to 6pm.');
const unclassified = extracted('upload-draft','uploaded_unclassified_pending_review','uploaded_operational_doc','Office hours Monday to Friday 10am to 6pm.');
let compiled=compile([unconfirmed,unclassified,publicHours]);
assert.equal(compiled.facts.length,1);assert.equal(compiled.facts[0].source_ref_ids_json[0],'contact');
assert.equal(compiled.conflicts[0].resolution,'source_precedence');
assert.equal(compiled.facts[0].evidence_text,publicHours.facts[0].claim_text);assert.equal(compiled.conflicts[0].evidence.length,3);
assert.equal(compiled.cards[0].answer_facts_json[0].claim,publicHours.facts[0].claim_text);
const footer = compile([publicHours,extracted('footer','website_public_page','home','We are open 24/7.','Office hours','marketing')]);
assert.equal(footer.facts.length,1);assert.equal(footer.facts[0].source_ref_ids_json[0],'contact');
const splitHours = compile([publicHours,extracted('sat','website_public_page','contact','Office hours Saturday 10am to 2pm.')]);
assert.equal(splitHours.conflicts.length,0);assert.equal(splitHours.facts.length,2);
const weekdayPartial=compile([publicHours,extracted('monday','owner_interview_confirmed','owner_interview_transcript','Office hours Monday 10am to 6pm.')]);
assert.ok(weekdayPartial.qa.blockers.includes('unresolved_high_conflict'));
assert.equal(weekdayPartial.conflicts[0].reason,'partial_claim_conflict_requires_atomic_review');
assert.ok(weekdayPartial.conflicts[0].evidence.some(e=>e.claim===publicHours.facts[0].claim_text));
const cityPartial=compile([extracted('cities','website_public_page','service_area','We serve Bellevue and Redmond.','Service area'),extracted('exclude-city','owner_interview_confirmed','owner_interview_transcript','We do not serve Bellevue.','Service area')]);
assert.ok(cityPartial.qa.blockers.includes('unresolved_high_conflict'));
assert.equal(cityPartial.conflicts[0].reason,'partial_claim_conflict_requires_atomic_review');
const mixed=extracted('mixed','website_public_page','contact','Office hours Monday to Friday 8am to 5pm.','Office hours');
mixed.facts.push({fact_key:'service',topic_name:'AC repair',fact_role:'detail',claim_text:'We offer AC repair.',source_chunk_ids:['mixed-c']});
mixed.sourceChunks[0].text+='\nWe offer AC repair.';
mixed.cards[0].supporting_fact_keys.push('service');mixed.cards[0].aliases=['8am office'];mixed.cards[0].caller_phrases=['Are you open at 8am?'];
const mixedResolved=compile([mixed,extracted('strong','owner_interview_confirmed','owner_interview_transcript','Office hours Monday to Friday 10am to 6pm.')]);
const mixedCard=mixedResolved.cards.find(card=>card.source_ref_ids_json.includes('mixed'));
assert.ok(mixedCard);assert.ok(!mixedCard.search_text.includes('8am'));assert.deepEqual(mixedCard.aliases_json,[]);assert.deepEqual(mixedCard.caller_phrases_json,[]);
const confirmed=extracted('interview','owner_interview_confirmed','owner_interview_transcript','Office hours Monday to Friday 9am to 6pm.');
compiled=compile([publicHours,confirmed]);assert.equal(compiled.facts[0].source_ref_ids_json[0],'interview');
const policy=extracted('policy','uploaded_first_party_policy','policy','Office hours Monday to Friday 10am to 6pm.');
compiled=compile([publicHours,policy]);assert.equal(compiled.facts[0].source_ref_ids_json[0],'policy');
compiled=compile([publicHours,extracted('contact2','website_public_page','contact','Office hours Monday to Friday 9am to 6pm.')]);
assert.equal(compiled.facts.length,0);assert.ok(compiled.qa.blockers.includes('unresolved_high_conflict'));
const types = [
  ['Price','$125 for an inspection.','policy','price'],['Contact','Call 206-555-0123.','contact_channel','phone'],
  ['Service area','We serve Bellevue and Redmond.','service_area','service_area'],['Referral policy','A referral is required.','policy','policy'],
  ['AC repair','We offer AC repair.','offering','offering_availability'],['Booking process','Call to request an appointment.','process','process_step']
];
for(const [topic,claim,objectType,factType] of types){const normalized=normalizeKnowledgeClaim({topic_name:topic,claim_text:claim});assert.equal(normalized.object_type,objectType);assert.equal(normalized.fact_type,factType);assert.ok(normalized.normalized_value_json);}
assert.equal(normalizeKnowledgeClaim({topic_name:'Price',claim_text:'Inspection costs $125.'}).normalized_value_json.tenant_price_authorization,false);
// Four approved channels, and interview-only builds, follow the same real compiler path.
for(const domain of ['home_services','healthcare','professional_services','real_estate']) {
  const records=[extracted('web','website_public_page','service_detail','We offer consultations.','Consultation service'),extracted('file','website_public_downloadable','downloadable_resource','A referral is required.','Referral policy'),extracted('upload','uploaded_first_party_policy','policy','Cancellation requires advance notice.','Cancellation policy'),extracted('owner','owner_interview_confirmed','owner_interview_transcript','Contact us at office@example.test.','Email')];
  const multi=compile(records,{...buildInfo,primaryDomainId:domain});assert.equal(multi.qa.blockers.length,0);assert.equal(new Set(multi.facts.flatMap(f=>f.scope_json.source_channel)).size,4);
  const only=compile([records[3]],{...buildInfo,primaryDomainId:domain});assert.equal(only.qa.blockers.length,0);assert.ok(only.qa.warnings.includes('operational_coverage_missing:hours'));
}
const areaConflict = compile([extracted('area1','website_public_page','service_area','We serve Bellevue and Redmond.','Service area'),extracted('area2','website_public_page','service_area','We do not serve Bellevue.','Service area')]);
assert.ok(areaConflict.qa.blockers.includes('unresolved_high_conflict'));
const missingEvidence=consolidateArtifacts(buildInfo,topicRows,[publicHours]);
missingEvidence.facts[0].source_span_refs_json=[];
assert.ok(analyzeKnowledgeContent({buildInfo,...missingEvidence,sources:[publicHours]}).blockers.includes('fact_source_span_missing'));
const diff=analyzeKnowledgeContent({buildInfo,...compile([publicHours]),sources:[publicHours],previousFacts:[{claim_text:'Old hours.'}],previousBuildId:'old'}).diff;
assert.equal(diff.removed_count,1);assert.equal(diff.added_count,1);
const qa=compile([publicHours,extracted('service','website_public_page','service_detail','We offer AC repair.','AC repair')]).qa;
await pg.exec('ALTER TABLE knowledge_builds ADD COLUMN execution_lease_token TEXT, ADD COLUMN execution_lease_expires_at TIMESTAMPTZ');
await db.query(`INSERT INTO knowledge_builds(build_id,tenant_key,status,version,domain_assignments_json,source_channels_json,validation_summary_json,created_by_type,created_by_id) VALUES ('build','a','ready_to_publish','1','[{"domain_id":"home_services"}]','["website_page"]',$1::jsonb,'tenant','1')`,[JSON.stringify({blockers:[],content_qa:qa})]);
await db.query(`INSERT INTO business_call_intents(business_call_intent_id,tenant_key,version,status,primary_goal,preferred_outcomes_json,disclosure_strategy_json,after_hours_strategy_json,conversation_stage_playbook_json) VALUES ('intent','a','1','approved_live','Help callers','["callback"]','{"mode":"reactive"}','{"mode":"callback"}','[{"stage_id":"greet"}]')`);
await assert.rejects(gov.assertKnowledgePublishAllowed(db,'a','build',{automatic:true}),/explicit_publication/);
await assert.rejects(gov.assertKnowledgePublishAllowed(db,'a','build',{actor:second}),/readiness_blocked/);
const checklist=Object.fromEntries(gov.READINESS_CHECKS.map(k=>[k,true]));
await assert.rejects(gov.saveKnowledgeReadinessReview(db,'a',{build_id:'build',checklist},second),/evidence_required/);
await assert.rejects(gov.saveKnowledgeReadinessReview(db,'a',{build_id:'build',checklist,evidence_note:'Reviewed'},owner),/second_reviewer/);
let readiness=await gov.saveKnowledgeReadinessReview(db,'a',{build_id:'build',checklist,evidence_note:'Fixture: sample call, callback and capture passed; operational overrides verified.'},second);
assert.equal(readiness.status,'ready_for_go_live');
// Actual publication lifecycle and SQL, with only model/catalog preparation
// replaced. A failed materialization rolls back both active pointer and audit.
const pubOptions={actor:second,allowUnleasedForValidation:true,expectedActiveBuildId:null};
await assert.rejects(builds.publishKnowledgeBuild(db,'a','build',{allowUnleasedForValidation:true}),/explicit_publication/);
assert.equal((await db.query('SELECT * FROM tenant_active_knowledge_builds')).rows.length,0);
globalThis.__governancePublishCatalog = async () => { throw new Error('fixture_materialization_failed'); };
const beforePublishAudit=(await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='knowledge_governance.publication_approved'")).rows[0].n;
await assert.rejects(builds.publishKnowledgeBuild(db,'a','build',pubOptions),/fixture_materialization/);
assert.equal((await db.query('SELECT * FROM tenant_active_knowledge_builds')).rows.length,0);
assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='knowledge_governance.publication_approved'")).rows[0].n,beforePublishAudit);
globalThis.__governancePublishCatalog = async () => {};
await builds.publishKnowledgeBuild(db,'a','build',pubOptions);
assert.equal((await db.query("SELECT active_build_id FROM tenant_active_knowledge_builds WHERE tenant_key='a'")).rows[0].active_build_id,'build');
assert.equal((await db.query("SELECT status FROM knowledge_builds WHERE build_id='build'")).rows[0].status,'published');

await gov.governanceTransaction(db,c=>gov.assertKnowledgePublishAllowed(c,'a','build',{actor:second}));
await assert.rejects(gov.assertKnowledgePublishAllowed(db,'a','build',{actor:owner}),/second_reviewer/);
await assert.rejects(gov.assertKnowledgePublishAllowed(db,'a','build',{actor:foreign}),/forbidden/);
const pending=await config.saveKnowledgeOverride(db,'a',{title:'New hours',body:'New hours'},owner);
assert.ok((await gov.loadKnowledgeReadiness(db,'a','build')).blockers.includes('configuration_review_pending'));
await gov.reviewKnowledgeChange(db,'a',pending.change_id,{decision:'approve'},second);
assert.ok((await gov.loadKnowledgeReadiness(db,'a','build')).blockers.includes('current_readiness_review_required'));
const audits=(await db.query('SELECT action FROM audit_log')).rows.map(r=>r.action);
for(const name of ['draft_created','approved_live','rejected','immediate_change','readiness_reviewed','publication_approved']) assert.ok(audits.includes(`knowledge_governance.${name}`));
hook.deregister();await pg.close();
console.log('Knowledge governance: actual compiler multi-source/cross-vertical fixtures, normalized values, authority conflicts, PGlite reviewed transitions, tenant isolation, readiness/publication gates passed. No provider/model calls.');
