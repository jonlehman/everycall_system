import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import {
  prepareTenantPromptProfileCompanyDescriptionSnapshot,
  persistTenantPromptProfileCompanyDescriptionSnapshot
} from "../pages/api/_lib/promptBlueprints.js";

// Expose the actual private transaction functions only in this test process.
// Production has no test hooks or alternative implementation.
const buildUrl = new URL("../pages/api/_lib/knowledgeReceptionistBuilds.js", import.meta.url).href;
const hook = registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (url === buildUrl) {
    const source = String(loaded.source);
    const draftBody = source.slice(source.indexOf("async function persistCompiledBuildDraft("), source.indexOf("async function preparePublicationCatalog("));
    assert.match(draftBody, /FOR KEY SHARE/, "long draft lock must allow non-key heartbeat updates");
    assert.doesNotMatch(draftBody, /FOR UPDATE|FOR NO KEY UPDATE/, "no exclusive lock before slow draft inserts");
    const insertBody = source.slice(source.indexOf("async function insertCompiledArtifacts("), source.indexOf("async function persistDraftCheckpoint("));
    assert.doesNotMatch(insertBody, /UPDATE knowledge_builds/, "metadata must not acquire an early exclusive build lock");
    return { ...loaded, source: `${source}\nexport { persistCompiledBuildDraft, persistDraftCheckpoint, updateBuildAfterValidation, assertBuildCommitLease, loadPublicationPointerForUpdate };` };
  }
  return loaded;
} });
const { persistCompiledBuildDraft, persistDraftCheckpoint, updateBuildAfterValidation, assertBuildCommitLease, loadPublicationPointerForUpdate } = await import(buildUrl);
hook.deregister();

const db = new PGlite();
const query = db.query.bind(db);
db.query = async (...args) => {
  const result = await query(...args);
  return { ...result, rowCount: result.affectedRows ?? result.rows.length };
};
await db.exec(`
  CREATE TABLE tenants (tenant_key TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE knowledge_builds (tenant_key TEXT, build_id TEXT PRIMARY KEY, status TEXT,
    artifact_counts_json JSONB, validation_summary_json JSONB, quality_summary_json JSONB,
    warnings_json JSONB, execution_lease_token TEXT, execution_lease_expires_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(), compiler_version TEXT, topic_inventory_summary_json JSONB,
    embedding_model TEXT, planner_model TEXT);
  CREATE TABLE knowledge_build_facts (knowledge_fact_id TEXT PRIMARY KEY, build_id TEXT REFERENCES knowledge_builds(build_id));
  CREATE TABLE kb_catalog_revisions (id TEXT PRIMARY KEY, tenant_key TEXT, knowledge_build_id TEXT REFERENCES knowledge_builds(build_id));
  CREATE TABLE kb_candidates (id TEXT PRIMARY KEY, revision_id TEXT REFERENCES kb_catalog_revisions(id),
    knowledge_fact_id TEXT REFERENCES knowledge_build_facts(knowledge_fact_id) ON DELETE CASCADE);
  CREATE TABLE tenant_prompt_profiles (tenant_key TEXT PRIMARY KEY, company_description TEXT,
    basic_no_tool_allowed_statement TEXT, updated_by_id TEXT, updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE tenant_bootstrap_profiles (tenant_key TEXT PRIMARY KEY, company_description TEXT);
  CREATE TABLE knowledge_build_source_summaries (tenant_key TEXT, build_id TEXT, source_ref_id TEXT, summary_text TEXT, status TEXT);
  CREATE TABLE source_refs (tenant_key TEXT, build_id TEXT, source_ref_id TEXT, page_type TEXT, title TEXT, source_locator TEXT);
  CREATE TABLE source_intake_items (tenant_key TEXT, build_id TEXT, source_ref_id TEXT, text_content TEXT);
  CREATE TABLE knowledge_build_topics (tenant_key TEXT, build_id TEXT, topic_name TEXT, description TEXT);
  CREATE TABLE tenant_active_knowledge_builds (tenant_key TEXT PRIMARY KEY, active_build_id TEXT);
  CREATE TABLE audit_log (tenant_key TEXT, actor TEXT, action TEXT, details JSONB);
  INSERT INTO tenants VALUES ('tenant-a','Example Painting');
  INSERT INTO tenant_prompt_profiles (tenant_key, company_description, basic_no_tool_allowed_statement)
    VALUES ('tenant-a','We paint local homes and business interiors.','We paint local homes and business interiors.');
  INSERT INTO tenant_bootstrap_profiles VALUES ('tenant-a','We paint local homes and business interiors.');
  INSERT INTO knowledge_build_topics VALUES ('tenant-a','draft','Painting','We paint residential homes and locally owned commercial buildings.');
  INSERT INTO tenant_active_knowledge_builds VALUES ('tenant-a','old');
  INSERT INTO knowledge_builds (tenant_key,build_id,status,artifact_counts_json,validation_summary_json,warnings_json,execution_lease_token,execution_lease_expires_at)
    VALUES ('tenant-a','draft','running','{"facts":1,"cards":1,"sourceRefs":1}',
      '{"draft_checkpoint":{"compiler_warnings":["source_artifact_stage_no_model_completed_sources"]}}',
      '["interrupted_model"]','lease-a',NOW() + INTERVAL '60 seconds');
  INSERT INTO knowledge_build_facts VALUES ('fact-a','draft');
  INSERT INTO kb_catalog_revisions VALUES ('catalog-a','tenant-a','draft');
  INSERT INTO kb_candidates VALUES ('candidate-a','catalog-a','fact-a');
`);

const buildInfo = { tenant_key: "tenant-a", build_id: "draft" };
// The approved prior pointer can change while a long compilation is running.
// Publication must compare that original expectation under its commit locks.
await db.query("UPDATE tenant_active_knowledge_builds SET active_build_id = 'newer-build'");
await db.query("BEGIN");
await db.query("SELECT tenant_key FROM tenants WHERE tenant_key = 'tenant-a' FOR UPDATE");
await assert.rejects(loadPublicationPointerForUpdate(db, "tenant-a", "old"), /active_pointer_conflict/);
await db.query("ROLLBACK");
assert.equal((await db.query("SELECT active_build_id FROM tenant_active_knowledge_builds")).rows[0].active_build_id, "newer-build");
await db.query("BEGIN");
assert.equal(await loadPublicationPointerForUpdate(db, "tenant-a", "newer-build"), "newer-build");
assert.equal(await loadPublicationPointerForUpdate(db, "tenant-a", undefined), "newer-build", "ordinary cron keeps existing behavior");
await assert.rejects(loadPublicationPointerForUpdate(db, "tenant-a", null), /active_pointer_conflict/);
assert.equal(await loadPublicationPointerForUpdate(db, "tenant-without-pointer", null), null);
await db.query("ROLLBACK");
await db.query("UPDATE tenant_active_knowledge_builds SET active_build_id = 'old'");
const resumed = await persistCompiledBuildDraft(db, buildInfo, {}, null, "lease-a");
assert.equal(resumed.counts.facts, 1);
assert.deepEqual(resumed.compilerWarnings, ["source_artifact_stage_no_model_completed_sources"]);
assert.equal((await db.query("SELECT count(*)::int AS n FROM kb_candidates")).rows[0].n, 1,
  "retry preserves candidates instead of cascade-deleting facts behind an existing catalog");
assert.equal(await updateBuildAfterValidation(db, "draft", resumed.counts, {}, resumed.compilerWarnings, { executionLeaseToken: "lease-a" }), "qa_blocked",
  "original compiler blockers survive interrupted processing and retry");
await db.query("UPDATE knowledge_builds SET status = 'running'");
await persistCompiledBuildDraft(db, buildInfo, {}, null, "lease-a");
await assert.rejects(persistCompiledBuildDraft(db, buildInfo, {}, null, "stale-lease"), /execution_lease_lost/);
await assert.rejects(updateBuildAfterValidation(db, "draft", resumed.counts, {}, [], { executionLeaseToken: "stale-lease" }), /execution_lease_lost/);
assert.equal((await db.query("SELECT status FROM knowledge_builds")).rows[0].status, "running");
await db.query("UPDATE knowledge_builds SET validation_summary_json = '{}'::jsonb");
await assert.rejects(persistCompiledBuildDraft(db, buildInfo, {}, null, "lease-a"), /draft_checkpoint_invalid/);
assert.equal((await db.query("SELECT count(*)::int AS n FROM kb_candidates")).rows[0].n, 1);

const prepare = () => prepareTenantPromptProfileCompanyDescriptionSnapshot(db, "tenant-a", {
  buildId: "draft", refreshNoToolStatement: true, actor: "system:test"
});
const before = (await db.query("SELECT * FROM tenant_prompt_profiles")).rows[0];
const prepared = await prepare();
assert.deepEqual((await db.query("SELECT * FROM tenant_prompt_profiles")).rows[0], before, "preparation does not activate a profile");
await db.query("UPDATE tenant_prompt_profiles SET company_description = 'An owner changed this description.'");
await db.query("BEGIN");
await db.query("UPDATE tenant_active_knowledge_builds SET active_build_id = 'draft'");
await assert.rejects(persistTenantPromptProfileCompanyDescriptionSnapshot(db, prepared), /snapshot_conflict/);
await db.query("ROLLBACK");
assert.equal((await db.query("SELECT active_build_id FROM tenant_active_knowledge_builds")).rows[0].active_build_id, "old",
  "profile conflict rolls back the publication pointer with the transaction");
assert.equal((await db.query("SELECT company_description FROM tenant_prompt_profiles")).rows[0].company_description, "An owner changed this description.");
const fresh = await prepare();
await db.query("BEGIN");
await db.query("UPDATE tenant_active_knowledge_builds SET active_build_id = 'draft'");
await persistTenantPromptProfileCompanyDescriptionSnapshot(db, fresh);
await assert.rejects(assertBuildCommitLease(db, "tenant-a", "draft", "stale-lease"), /execution_lease_lost/);
await db.query("ROLLBACK");
assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_log")).rows[0].n, 0, "failed publication rolls back profile audit too");
await db.query("BEGIN");
await db.query("UPDATE tenant_active_knowledge_builds SET active_build_id = 'draft'");
await persistTenantPromptProfileCompanyDescriptionSnapshot(db, fresh);
await assertBuildCommitLease(db, "tenant-a", "draft", "lease-a");
await db.query("COMMIT");
const profile = (await db.query("SELECT * FROM tenant_prompt_profiles")).rows[0];
assert.equal(profile.company_description, "We paint residential homes and locally owned commercial buildings.");
assert.equal(profile.basic_no_tool_allowed_statement, profile.company_description);
assert.equal((await db.query("SELECT active_build_id FROM tenant_active_knowledge_builds")).rows[0].active_build_id, "draft");

const compiled = { compilerVersion: "test", embeddingModel: "test", plannerModel: "test" };
// PGlite has one backend: this tests the real final SQL fence and rollback, not
// concurrent PostgreSQL lock compatibility. Source assertions guard lock choice.
await db.query("UPDATE knowledge_builds SET status = 'running', execution_lease_token = 'successor', execution_lease_expires_at = clock_timestamp() + INTERVAL '60 seconds'");
await db.query("BEGIN");
await db.query("INSERT INTO knowledge_build_facts VALUES ('stale-fact','draft')");
await db.query("INSERT INTO kb_candidates VALUES ('stale-candidate','catalog-a','stale-fact')");
await assert.rejects(persistDraftCheckpoint(db, buildInfo, compiled, resumed.counts, [], "lease-a"), /execution_lease_lost/);
await db.query("ROLLBACK");
assert.equal((await db.query("SELECT count(*)::int AS n FROM knowledge_build_facts WHERE knowledge_fact_id = 'stale-fact'")).rows[0].n, 0);
assert.equal((await db.query("SELECT count(*)::int AS n FROM kb_candidates WHERE id = 'stale-candidate'")).rows[0].n, 0);
assert.equal((await db.query("SELECT execution_lease_token FROM knowledge_builds")).rows[0].execution_lease_token, "successor");

await db.query("UPDATE knowledge_builds SET execution_lease_token = 'lease-a', execution_lease_expires_at = clock_timestamp() + INTERVAL '100 milliseconds'");
await db.query("BEGIN");
await db.query("SELECT build_id FROM knowledge_builds WHERE build_id = 'draft' FOR KEY SHARE");
await db.query("INSERT INTO knowledge_build_facts VALUES ('expired-fact','draft')");
await new Promise((resolve) => setTimeout(resolve, 150));
await assert.rejects(persistDraftCheckpoint(db, buildInfo, compiled, resumed.counts, [], "lease-a"), /execution_lease_lost/,
  "final fence checks wall clock, not transaction-start NOW(), after a slow draft");
await db.query("ROLLBACK");
assert.equal((await db.query("SELECT count(*)::int AS n FROM knowledge_build_facts WHERE knowledge_fact_id = 'expired-fact'")).rows[0].n, 0);

await db.query("UPDATE knowledge_builds SET execution_lease_expires_at = clock_timestamp() + INTERVAL '60 seconds'");
await db.query("BEGIN");
await db.query("INSERT INTO knowledge_build_facts VALUES ('fresh-fact','draft')");
await persistDraftCheckpoint(db, buildInfo, compiled, resumed.counts, ["saved-warning"], "lease-a");
await db.query("COMMIT");
assert.equal((await db.query("SELECT count(*)::int AS n FROM knowledge_build_facts WHERE knowledge_fact_id = 'fresh-fact'")).rows[0].n, 1);
assert.deepEqual((await db.query("SELECT validation_summary_json FROM knowledge_builds")).rows[0].validation_summary_json.draft_checkpoint.compiler_warnings, ["saved-warning"]);
await db.close();
console.log("PASS knowledge build transactions: immutable draft retry, preserved blockers, lease fencing, profile conflict/rollback and atomic publication");
