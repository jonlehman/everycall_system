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
  if (url === buildUrl) return { ...loaded, source: `${loaded.source}\nexport { persistCompiledBuildDraft, updateBuildAfterValidation, assertBuildCommitLease };` };
  return loaded;
} });
const { persistCompiledBuildDraft, updateBuildAfterValidation, assertBuildCommitLease } = await import(buildUrl);
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
    updated_at TIMESTAMPTZ DEFAULT NOW());
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
await db.close();
console.log("PASS knowledge build transactions: immutable draft retry, preserved blockers, lease fencing, profile conflict/rollback and atomic publication");
