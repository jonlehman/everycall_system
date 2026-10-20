import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { registerHooks } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import * as gov from '../pages/api/_lib/knowledgeGovernance.js';
import { sourcePrecedenceScoreFromMetadata as score } from '../packages/contracts/dist/knowledgeSourcePrecedence.js';

const buildUrl = new URL('../pages/api/_lib/knowledgeReceptionistBuilds.js', import.meta.url).href;
const configUrl = new URL('../pages/api/_lib/knowledgeReceptionistConfig.js', import.meta.url).href;
const hook = registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (url === buildUrl) {
    let source = String(loaded.source)
      .replace('await syncCanonicalKnowledgePacks(db);', 'undefined;')
      .replace('await resolveTenantDomainAssignments(db, tenantKey, input.assignments || [])', '[{ domainId: "fixture-domain", subdomainId: null }]');
    // Expose actual private helpers. Only costly rollback preparation is replaced;
    // eligibility, database locks and activation SQL remain production code.
    const start = source.indexOf('export async function rollbackKnowledgeBuild(');
    const end = source.indexOf('export async function getKnowledgeBuild(', start);
    const rollback = source.slice(start, end)
      .replace('await preparePublicationCatalog(db, tenantKey, buildId)', 'await globalThis.__integrityPrepare()')
      .replace('await curateLiveBriefBuild(db, { tenantKey, buildId })', 'undefined')
      .replace('await prepareLiveBriefPublication(db, { tenantKey, buildId })', '{}')
      .replace('await loadBuildAssetsFromDb(client, tenantKey, buildId)', '{}')
      .replace('await publishKnowledgeHeartCatalog(client, { tenantKey, buildId })', 'undefined')
      .replace('await publishLiveBriefBuild(client, { tenantKey, buildId, prepared: preparedBrief })', 'undefined')
      .replace('await maybeActivateTenantLivePrompt(client, tenantKey)', 'undefined')
      .replace(/await recordCoreFactActivationChanges\(client, \{[\s\S]*?\}\);/, '');
    source = source.slice(0, start) + rollback + source.slice(end);
    return { ...loaded, source: source + '\nexport { crawlWebsiteSources, extractLinkInventory, buildDiscoveryEntryFromSourceItem, upsertSourceIntakeItemBatch, buildSourceItemFromIntakeRow, assertBuildRateLimit, updateCapturedSourceChannels, assertRollbackTargetEligible, withTransaction };' };
  }
  if (url === configUrl) {
    // Full save/upsert/readback and audit paths are real; fixture schemas omit
    // unrelated readiness tables that this module checks on every entry.
    return { ...loaded, source: String(loaded.source).replaceAll('await assertConfigTablesReady(db);', '') };
  }
  return loaded;
} });
const builds = await import(buildUrl);
const config = await import(configUrl);
hook.deregister();
const db = new PGlite();
const query = db.query.bind(db);
db.query = async (...args) => {
  const result = await query(...args);
  return { ...result, rowCount: result.affectedRows ?? result.rows.length };
};
await db.exec(`
  CREATE TABLE tenants (tenant_key TEXT PRIMARY KEY);
  INSERT INTO tenants VALUES ('a'), ('b'), ('race'), ('abort'), ('initial');
  CREATE TABLE knowledge_builds (build_id TEXT PRIMARY KEY, tenant_key TEXT,
    status TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ, validation_summary_json JSONB DEFAULT '{"blockers":[]}',
    source_channels_json JSONB, build_kind TEXT, base_build_id TEXT, overlay_build_id TEXT,
    composite_parent_build_ids_json JSONB, source_fingerprint_json JSONB);
  CREATE TABLE source_intake_sessions (source_intake_session_id TEXT PRIMARY KEY,
    tenant_key TEXT, build_id TEXT, source_channels_json JSONB);
  CREATE TABLE source_refs (source_ref_id TEXT PRIMARY KEY, tenant_key TEXT, build_id TEXT, source_channel TEXT);
  CREATE TABLE tenant_active_knowledge_builds (tenant_key TEXT PRIMARY KEY,
    active_build_id TEXT, previous_build_id TEXT, updated_at TIMESTAMPTZ);
  CREATE TABLE audit_log (tenant_key TEXT, actor TEXT, action TEXT, details JSONB);
  INSERT INTO knowledge_builds(build_id,tenant_key,build_kind,created_at) VALUES
    ('old','a','website_base', NOW() - INTERVAL '1 hour'),
    ('overlay','b','document_overlay', NOW());
`);
const stageMigration = await fs.readFile(new URL('../migrations/0009_knowledge_receptionist_stage_a_durable_persistence.sql', import.meta.url), 'utf8');
await db.exec(`ALTER TABLE knowledge_builds
  ADD COLUMN version TEXT, ADD COLUMN domain_assignments_json JSONB,
  ADD COLUMN source_snapshot_id TEXT, ADD COLUMN artifact_counts_json JSONB,
  ADD COLUMN quality_summary_json JSONB, ADD COLUMN warnings_json JSONB,
  ADD COLUMN created_by_type TEXT, ADD COLUMN created_by_id TEXT;
  ALTER TABLE source_intake_sessions ADD COLUMN runtime_entry_mode TEXT,
  ADD COLUMN status TEXT, ADD COLUMN website_root_url TEXT, ADD COLUMN metadata_json JSONB,
  ADD COLUMN started_at TIMESTAMPTZ, ADD COLUMN updated_at TIMESTAMPTZ,
  ADD COLUMN completed_at TIMESTAMPTZ, ADD COLUMN errors_json JSONB,
  ADD COLUMN crawl_summary_json JSONB, ADD COLUMN persistence_checkpoint_json JSONB;
  INSERT INTO tenants VALUES ('enqueue'), ('enqueue-abort'), ('enqueue-admin');
  CREATE TABLE tenant_users(id TEXT PRIMARY KEY,tenant_key TEXT,role TEXT,status TEXT);
  INSERT INTO tenant_users VALUES ('creator','enqueue','owner','active'),('reviewer','enqueue','admin','active');
  CREATE TABLE admin_users(id TEXT PRIMARY KEY,role TEXT);
  INSERT INTO admin_users VALUES ('platform','super_admin');`);
await db.exec(stageMigration.match(/CREATE TABLE IF NOT EXISTS source_intake_items \([\s\S]*?\n\);/)[0]);
const configMigration = await fs.readFile(new URL('../migrations/0003_knowledge_receptionist_slice_two.sql', import.meta.url), 'utf8');
for (const name of ['knowledge_overrides', 'knowledge_guardrails']) {
  await db.exec(configMigration.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name}_v2 \\([\\s\\S]*?\\n\\);`))[0].replaceAll(`${name}_v2`, name));
}
await db.exec(configMigration.match(/CREATE TABLE IF NOT EXISTS uploaded_documents \([\s\S]*?\n\);/)[0]);
await db.exec(`ALTER TABLE uploaded_documents ADD COLUMN source_kind TEXT,
  ADD COLUMN source_locator TEXT, ADD COLUMN fetch_status TEXT,
  ADD COLUMN fetch_metadata_json JSONB, ADD COLUMN content_fingerprint TEXT`);
const migration = await fs.readFile(new URL('../migrations/0052_knowledge_source_integrity.sql', import.meta.url), 'utf8');
await db.exec(migration);
await db.exec(migration); // additive and safe to reapply
await db.exec(await fs.readFile(new URL('../migrations/0053_knowledge_governance.sql', import.meta.url), 'utf8'));
assert.equal((await db.query('SELECT count(*)::int AS n FROM knowledge_build_allocations')).rows[0].n, 2);
assert.equal((await db.query("SELECT build_id FROM knowledge_build_allocations WHERE tenant_key='b'")).rows[0].build_id,'overlay','migration seeds overlay initiations too');

const content = builds.extractStructuredPageContent('<p>Hours are 8–5; call today for an appointment.</p><p>We repair heat pumps. Call today.</p><p>You can book online for Saturday appointments.</p><p>Privacy policy applies to customer records.</p><p>Call today.</p><p>Book online</p><p>Privacy policy</p>');
assert.deepEqual(content.lines, ['Hours are 8–5; call today for an appointment.', 'We repair heat pumps. Call today.', 'You can book online for Saturday appointments.', 'Privacy policy applies to customer records.']);
const inventory = builds.extractLinkInventory('https://example.test/services/', '<a href="details">Details</a><a href="files/policy.pdf">Policy</a><a href="../contact/">Contact</a><a href="https://elsewhere.test/">Foreign</a><a href="javascript:alert(1)">Bad</a>');
assert.deepEqual(inventory.pageLinks, ['https://example.test/services/details', 'https://example.test/contact']);
assert.deepEqual(inventory.fileLinks, ['https://example.test/services/files/policy.pdf']);

// Run the actual crawler with deterministic public DNS/fetch substitutes. No
// socket/network/model is opened, and the production SSRF/origin checks still run.
const realLookup = dns.lookup;
const realFetch = globalThis.fetch;
const requests = [];
const rawHtml = '<html><title>Services</title><body><p>We repair heat pumps. Call today.</p><p>Call today.</p><a href="details">Details</a><a href="files/policy.pdf">Policy</a></body></html>';
const responses = new Map([
  ['https://example.test/', { body: '<p>Home</p><a href="/services/">Services</a>' }],
  ['https://example.test/services', { redirect: '/services/' }],
  ['https://example.test/services/', { body: rawHtml }],
  ['https://example.test/services/details', { body: '<p>We service compressors.</p>' }],
  ['https://example.test/services/files/policy.pdf', { body: '(Call us before visiting.) Tj', type: 'application/pdf' }]
]);
try {
  dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const item = responses.get(String(url));
    assert.ok(item, `unexpected URL: ${url}`);
    if (item.redirect) return new Response(null, { status: 301, headers: { location: item.redirect } });
    return new Response(item.body, { headers: { 'content-type': item.type || 'text/html' } });
  };
  const website = await builds.crawlWebsiteSources('https://example.test/');
  assert.ok(requests.includes('https://example.test/services/details'));
  assert.ok(requests.includes('https://example.test/services/files/policy.pdf'));
  const page = builds.buildWebsiteSourceItems(website).find((item) => item.sourceLocator === 'https://example.test/services/');
  const capture = page.originalCapture;
  const download = builds.buildWebsiteSourceItems(website).find((item) => item.sourceChannel === 'website_file');
  assert.equal(Buffer.from(download.originalCapture.body, 'base64').toString(), '(Call us before visiting.) Tj');
  const imported = await config.saveUploadedDocument(db, 'a', {
    uploadedDocumentId: 'imported', sourceKind: 'single_page_url',
    sourceLocator: 'https://example.test/services/'
  });
  assert.equal(imported.original_capture_json, undefined, 'normal API payload does not include raw bytes');
  const storedImport = (await db.query("SELECT original_capture_json FROM uploaded_documents WHERE uploaded_document_id='imported'")).rows[0];
  assert.equal(Buffer.from(storedImport.original_capture_json.body, 'base64').toString(), rawHtml);
  assert.equal(storedImport.original_capture_json.sha256, capture.sha256);
  assert.equal(Buffer.from(capture.body, 'base64').toString(), rawHtml);
  assert.equal(capture.sha256, crypto.createHash('sha256').update(rawHtml).digest('hex'));
  assert.equal(capture.status, 200);
  assert.equal(capture.fetched_url, page.sourceLocator);
  assert.ok(Number.isFinite(Date.parse(capture.fetched_at)));
  assert.ok(!JSON.stringify(page.metadata).includes(capture.body));
  assert.ok(!page.lines.includes('Call today.'));
  await db.query("INSERT INTO source_intake_sessions(source_intake_session_id,tenant_key,build_id,source_channels_json) VALUES ('intake', 'a', 'old', '[]')");
  const entry = builds.buildDiscoveryEntryFromSourceItem({ tenant_key: 'a', build_id: 'old' }, 'intake', page);
  await builds.upsertSourceIntakeItemBatch(db, [entry]);
  // A retry with only normalized evidence must not erase the original capture.
  await builds.upsertSourceIntakeItemBatch(db, [{ ...entry, original_capture_json: null }]);
  const row = (await db.query('SELECT * FROM source_intake_items')).rows[0];
  assert.deepEqual(builds.buildSourceItemFromIntakeRow(row).originalCapture, capture);
  const oversized = builds.buildWebsiteSourceItems({ pages: [{ ...website.pages[1], text: 'FACT '.repeat(30000), lines: ['FACT '.repeat(30000)] }] })[0];
  assert.equal(oversized.metadata.page_document.truncated, true);
  assert.deepEqual(oversized.originalCapture, capture, 'page budget does not truncate recoverable original bytes');
  const blocked = await builds.fetchWebsitePage('http://127.0.0.1/private');
  assert.equal(blocked.ok, false);
  const crossOrigin = await builds.fetchWebsitePage('https://elsewhere.test/', { allowedOrigin: 'https://example.test' });
  assert.equal(crossOrigin.ok, false);
} finally { dns.lookup = realLookup; globalThis.fetch = realFetch; }

// Actual write functions reject known foreign IDs without writing an audit or
// returning the foreign row; owner writes still create and update normally.
for (const [save, idKey, table, bodyKey] of [
  [config.saveKnowledgeOverride, 'knowledgeOverrideId', 'knowledge_overrides', 'body'],
  [config.saveKnowledgeGuardrail, 'knowledgeGuardrailId', 'knowledge_guardrails', 'approvedResponsePattern']
]) {
  const own = await save(db, 'a', { [idKey]: table, [bodyKey]: 'Protected original' });
  assert.equal(own.tenant_key, 'a');
  const audits = (await db.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n;
  await assert.rejects(save(db, 'b', { [idKey]: table, [bodyKey]: 'Attacker replacement' }), /not_found/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n, audits);
  const unchanged = (await db.query(`SELECT * FROM ${table}`)).rows[0];
  assert.equal(unchanged[bodyKey === 'body' ? 'body' : 'approved_response_pattern'], 'Protected original');
  assert.equal((await save(db, 'a', { [idKey]: table, [bodyKey]: 'Owner update' })).tenant_key, 'a');
}

const uploaded = await config.saveUploadedDocument(db, 'a', {
  uploadedDocumentId: 'upload-owned', title: 'Office hours', bodyText: ' Hours: 8–5. Call today. '
});
assert.equal(uploaded.source_authority, 'uploaded_unclassified_pending_review', 'preserve upload authority default');
const rawUpload = (await db.query("SELECT original_capture_json FROM uploaded_documents WHERE uploaded_document_id='upload-owned'")).rows[0].original_capture_json;
assert.equal(Buffer.from(rawUpload.body, 'base64').toString(), ' Hours: 8–5. Call today. ');
const auditCountBefore = (await db.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n;
await assert.rejects(config.saveUploadedDocument(db, 'b', { uploadedDocumentId: 'upload-owned', title: 'Attack', bodyText: 'Injected' }), /uploaded_document_not_found/);
assert.equal((await db.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n, auditCountBefore);
assert.equal((await db.query("SELECT body_text FROM uploaded_documents WHERE uploaded_document_id='upload-owned'")).rows[0].body_text, 'Hours: 8–5. Call today.');
assert.equal((await config.listUploadedDocuments(db, 'b')).length, 0);
assert.ok((await config.listUploadedDocuments(db, 'a')).every((row) => !('original_capture_json' in row)));
const updatedUpload = await config.saveUploadedDocument(db, 'a', { uploadedDocumentId: 'upload-owned', title: 'Changed hours', bodyText: 'Hours: 9–5.' });
assert.equal(updatedUpload.body_text, 'Hours: 9–5.');

await assert.rejects(builds.assertBuildRateLimit(db, 'a', { buildKind: 'website_base', buildId: 'denied' }), /rate_limited/);
await assert.rejects(builds.assertBuildRateLimit(db, 'a', { buildKind: 'document_overlay', buildId: 'denied-overlay' }), /rate_limited/);
await assert.rejects(builds.assertBuildRateLimit(db, 'b', { buildKind: 'document_overlay', buildId: 'second-overlay' }), /rate_limited/);
assert.equal((await db.query("SELECT build_id FROM knowledge_build_allocations WHERE tenant_key='a'")).rows[0].build_id, 'old');
await assert.rejects(builds.assertBuildRateLimit(db, 'a', { buildId: 'bad-override', rateLimitOverride: true, actor: { role: 'tenant', user_id: 'owner' } }), /override_forbidden/);
await builds.withTransaction(db, (client) => builds.assertBuildRateLimit(client, 'a', { buildId: 'admin-build', rateLimitOverride: true, actor: { role: 'admin', user_id: 'platform-admin' } }));
assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='knowledge_receptionist.build.rate_limit_override'")).rows[0].n, 1);
await assert.rejects(builds.withTransaction(db, async (client) => {
  await builds.assertBuildRateLimit(client, 'abort', { buildId: 'aborted' });
  throw new Error('simulated_build_insert_failure');
}), /simulated/);
assert.equal((await db.query("SELECT count(*)::int AS n FROM knowledge_build_allocations WHERE tenant_key='abort'")).rows[0].n, 0);
// PGlite has one backend. Concurrent callers exercise the real single-statement
// allocator; PostgreSQL ON CONFLICT provides inter-connection row serialization.
const raced = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => builds.assertBuildRateLimit(db, 'race', { buildId: `race-${i}` })));
assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1);
assert.ok(raced.filter((r) => r.status === 'rejected').every((r) => /rate_limited/.test(r.reason.message)));
await db.query("UPDATE knowledge_build_allocations SET allocated_at=clock_timestamp()-INTERVAL '24 hours' WHERE tenant_key='race'");
await builds.assertBuildRateLimit(db, 'race', { buildId: 'next-day' });
await builds.assertBuildRateLimit(db, 'initial', { buildId: 'onboarding' });
await assert.rejects(builds.assertBuildRateLimit(db, 'initial', { buildId: 'repeat-onboarding' }), /rate_limited/);

const enqueue = { enqueueOnly: true, buildKind: 'website_base', websiteUrl: 'https://example.test/', forceRescrape: true };
const creator = { role:'tenant', user_id:'creator' }, reviewer = { role:'tenant', user_id:'reviewer' };
const enqueued = await builds.enqueueKnowledgeBuild(db, 'enqueue', { ...enqueue, actor:creator });
assert.equal(enqueued.status, 'queued');
assert.equal(enqueued.build.created_by_type,'tenant');assert.equal(enqueued.build.created_by_id,'creator');
assert.deepEqual(enqueued.build.source_channels_json,[],'queued inventory is not inferred from requested channels');
const adminEnqueue=await builds.enqueueKnowledgeBuild(db,'enqueue-admin',{...enqueue,actor:{role:'super_admin',user_id:'platform'}});
assert.equal(adminEnqueue.build.created_by_type,'admin');assert.equal(adminEnqueue.build.created_by_id,'platform');
await gov.saveKnowledgeGovernancePolicy(db,'enqueue-admin',{review_mode:'reviewed'},{role:'super_admin',user_id:'platform'});
await assert.rejects(gov.saveKnowledgeReadinessReview(db,'enqueue-admin',{build_id:adminEnqueue.build.build_id,checklist:{},evidence_note:'Same platform identity under another admin role.'},{role:'admin',user_id:'platform'}),/second_reviewer/);
await gov.saveKnowledgeGovernancePolicy(db,'enqueue',{review_mode:'reviewed'},creator);
const reviewPayload={build_id:enqueued.build.build_id,checklist:Object.fromEntries(gov.READINESS_CHECKS.map(k=>[k,true])),evidence_note:'Offline fixture review.'};
await assert.rejects(gov.saveKnowledgeReadinessReview(db,'enqueue',reviewPayload,creator),/second_reviewer/);
const baseSchema=await fs.readFile(new URL('../migrations/0001_knowledge_receptionist_slice.sql',import.meta.url),'utf8');
await db.exec(baseSchema.match(/CREATE TABLE IF NOT EXISTS business_call_intents \([\s\S]*?\n\);/)[0]);
await db.query(`INSERT INTO business_call_intents(business_call_intent_id,tenant_key,version,status,primary_goal,preferred_outcomes_json,disclosure_strategy_json,after_hours_strategy_json,conversation_stage_playbook_json) VALUES ('enqueue-intent','enqueue','1','approved_live','Help callers','["callback"]','{"mode":"reactive"}','{"mode":"callback"}','[{"stage_id":"greet"}]')`);
// Preserve real enqueue attribution; emulate successful compiler output only.
await db.query(`UPDATE knowledge_builds SET status='ready_to_publish',source_channels_json='["website_page"]',validation_summary_json='{"blockers":[],"content_qa":{"version":"content_qa_v1","blockers":[]}}' WHERE build_id=$1`,[enqueued.build.build_id]);
await gov.saveKnowledgeReadinessReview(db,'enqueue',reviewPayload,reviewer);
await assert.rejects(gov.assertKnowledgePublishAllowed(db,'enqueue',enqueued.build.build_id,{actor:creator}),/second_reviewer/);
await gov.assertKnowledgePublishAllowed(db,'enqueue',enqueued.build.build_id,{actor:reviewer,recordAudit:false});
await db.query('UPDATE knowledge_builds SET created_by_id=NULL WHERE build_id=$1',[enqueued.build.build_id]);
await assert.rejects(gov.saveKnowledgeReadinessReview(db,'enqueue',reviewPayload,reviewer),/creator_required/);
await assert.rejects(gov.assertKnowledgePublishAllowed(db,'enqueue',enqueued.build.build_id,{actor:reviewer}),error=>error.blockers?.includes('knowledge_build_creator_required'));
await db.query("UPDATE knowledge_builds SET status='queued',created_by_id='creator' WHERE build_id=$1",[enqueued.build.build_id]);

assert.equal((await db.query("SELECT build_id FROM knowledge_build_allocations WHERE tenant_key='enqueue'")).rows[0].build_id, enqueued.build.build_id);
await assert.rejects(builds.createKnowledgeBuild(db, 'enqueue', enqueue), /rate_limited/);
assert.equal((await db.query("SELECT count(*)::int AS n FROM knowledge_builds WHERE tenant_key='enqueue'")).rows[0].n, 1);
const resumed = await builds.createKnowledgeBuild(db, 'enqueue', { ...enqueue, forceRescrape: false, buildId: enqueued.build.build_id });
assert.equal(resumed.resumed, true, 'resuming queued work consumes no new allocation');
assert.equal(resumed.build.created_by_id,'creator','worker resume preserves original requester');
const normalQuery = db.query;
db.query = async (sql, params) => {
  if (sql.includes('INSERT INTO source_intake_sessions')) throw new Error('simulated_intake_insert_failure');
  return normalQuery(sql, params);
};
await assert.rejects(builds.createKnowledgeBuild(db, 'enqueue-abort', enqueue), /simulated_intake/);
db.query = normalQuery;
assert.equal((await db.query("SELECT count(*)::int AS n FROM knowledge_builds WHERE tenant_key='enqueue-abort'")).rows[0].n, 0);
assert.equal((await db.query("SELECT count(*)::int AS n FROM knowledge_build_allocations WHERE tenant_key='enqueue-abort'")).rows[0].n, 0);

await db.query("INSERT INTO source_refs VALUES ('ref-a','a','old','website_page'),('ref-b','b','old','website_file')");
await builds.updateCapturedSourceChannels(db, 'a', 'old', 'intake');
assert.deepEqual((await db.query("SELECT source_channels_json FROM knowledge_builds WHERE build_id='old'")).rows[0].source_channels_json, ['website_page']);
assert.deepEqual((await db.query("SELECT source_channels_json FROM source_intake_sessions WHERE source_intake_session_id='intake'")).rows[0].source_channels_json, ['website_page']);

let preparations = 0;
globalThis.__integrityPrepare = async () => { preparations += 1; };
await db.query("INSERT INTO tenant_active_knowledge_builds VALUES ('a','current',NULL,NOW())");
await db.query("INSERT INTO knowledge_builds(build_id,tenant_key,status,published_at) VALUES ('current','a','published',NOW())");
for (const status of ['qa_blocked', 'failed', 'ready_to_publish', 'compiled_unpublished', 'rolled_back']) {
  await db.query('UPDATE knowledge_builds SET status=$1,published_at=NOW() WHERE build_id=$2', [status, 'old']);
  await assert.rejects(builds.rollbackKnowledgeBuild(db, 'a', 'old'), /not_eligible/);
}
await db.query("UPDATE knowledge_builds SET status='superseded', published_at=NULL WHERE build_id='old'");
await assert.rejects(builds.rollbackKnowledgeBuild(db, 'a', 'old'), /not_eligible/);
await db.query("UPDATE knowledge_builds SET published_at=NOW(),validation_summary_json='{\"blockers\":[\"unsafe\"]}' WHERE build_id='old'");
await assert.rejects(builds.rollbackKnowledgeBuild(db, 'a', 'old'), /not_eligible/);
await assert.rejects(builds.rollbackKnowledgeBuild(db, 'b', 'old'), /build_not_found/);
assert.equal(preparations, 0, 'reject invalid targets before preparation');
await db.query("UPDATE knowledge_builds SET validation_summary_json='{\"blockers\":[]}' WHERE build_id='old'");
globalThis.__integrityPrepare = async () => {
  preparations += 1;
  await db.query("UPDATE knowledge_builds SET status='qa_blocked' WHERE build_id='old'");
};
await assert.rejects(builds.rollbackKnowledgeBuild(db, 'a', 'old'), /not_eligible/);
assert.equal((await db.query("SELECT active_build_id FROM tenant_active_knowledge_builds WHERE tenant_key='a'")).rows[0].active_build_id, 'current');
await db.query("UPDATE knowledge_builds SET status='superseded' WHERE build_id='old'");
globalThis.__integrityPrepare = async () => { preparations += 1; };
assert.equal((await builds.rollbackKnowledgeBuild(db, 'a', 'old')).active_build_id, 'old');
assert.equal((await db.query("SELECT status FROM knowledge_builds WHERE build_id='current'")).rows[0].status, 'rolled_back');
delete globalThis.__integrityPrepare;

const operational = (authority, channel) => score({ source_authority: authority, source_channel: channel, content_class: 'operational_core' });
const website = operational('website_public_page', 'website_page');
for (const [authority, channel] of [['uploaded_unclassified_pending_review', 'uploaded_document'], ['owner_interview_unconfirmed', 'owner_interview'], ['', 'owner_interview'], ['uploaded_first_party_marketing', 'uploaded_document']]) {
  assert.ok(operational(authority, channel) < website, `${authority || 'missing authority'} must not outrank operational website evidence`);
}
assert.ok(operational('owner_interview_confirmed', 'owner_interview') > operational('uploaded_first_party_policy', 'uploaded_document'));
assert.ok(operational('uploaded_first_party_operational', 'uploaded_document') > website);
assert.ok(score({ source_authority: 'website_public_page', content_class: 'educational' }) < 0);
assert.ok(score({ source_authority: 'website_public_page', content_classes: ['marketing', 'unknown'] }) < 0);
assert.equal(score({ source_authority: 'website_public_page', source_channel: 'owner_interview', content_class: 'operational_core' }), website, 'channel alone confers no precedence');
// Actual caller-FAQ HTTP handler + actual allocator: a rejected overlay must
// call neither manual-fact mutation nor confirmation completion. Auth/source
// adapters are deterministic fixture substitutes, not a claim of auth coverage.
const faqRouteUrl = new URL('../pages/api/v1/knowledge/caller-faq-confirmation.js', import.meta.url).href;
const faqEvents=[];
globalThis.__faqQuotaFixture = {
  getPool:()=>db,
  requireSession:async()=>({role:'tenant',user_id:'creator'}),
  resolveTenantKey:()=> 'a',
  requireTenantBillingAccess:async()=>true,
  requireTenantRoles:async()=>true,
  loadCallerFaqConfirmation:async()=>({status:'pending',trigger_build_id:'old'}),
  normalizeCallerFaqAnswers:value=>value,
  callerFaqSummaryBlocks:()=>[{blockKey:'hours',summaryText:'We open Monday.'}],
  callerFaqConfirmationIds:()=>({intentId:'faq-intent',sessionId:'faq-session'}),
  findCurrentApprovedKnowledgeChange:async()=>null,
  saveSetupInterviewSubmission:async()=>({session:{setup_interview_session_id:'faq-session'}}),
  loadSetupInterviewState:async()=>({sessions:[]}),
  enqueueKnowledgeBuild:async()=>{faqEvents.push('allocate');await builds.assertBuildRateLimit(db,'a',{buildKind:'document_overlay',buildId:'faq-overlay'});throw new Error('fixture_expected_rate_limit');},
  confirmKnowledgeHeartFacts:async()=>{faqEvents.push('manual_mutation');},
  completeCallerFaqConfirmation:async()=>{faqEvents.push('confirmation_complete');}
};
const faqModule='data:text/javascript;base64,'+Buffer.from(Object.keys(globalThis.__faqQuotaFixture).map(name=>`export const ${name}=globalThis.__faqQuotaFixture.${name};`).join('\n')).toString('base64');
const faqHook=registerHooks({resolve(specifier,context,next){return context.parentURL===faqRouteUrl&&specifier.includes('_lib/')?{url:faqModule,shortCircuit:true}:next(specifier,context);}});
const faqHandler=(await import(faqRouteUrl)).default;
let faqStatus=0,faqBody;
await faqHandler({method:'POST',query:{},body:{answers:{hours:'We open Monday.'}},headers:{}},{status(code){faqStatus=code;return this;},json(body){faqBody=body;return this;},setHeader(){}});
assert.equal(faqStatus,429,JSON.stringify(faqBody));
assert.equal(faqBody.error,'knowledge_build_rate_limited');
assert.deepEqual(faqEvents,['allocate']);
faqHook.deregister();delete globalThis.__faqQuotaFixture;

await db.close();
console.log('knowledge-integrity-remediation: PASS (capture, nested crawl, tenant writes, allocation race/rollback, inventory, rollback admission, precedence)');
