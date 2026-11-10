import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { fingerprint, sourceSnapshot, runBackfill, duplicateReason } from './backfill-sales-company-contacts.mjs';

// Disposable migration-backed database: no credentials, network or provider calls.
const db = new PGlite();
const query = async (sql, args = []) => { const r = await db.query(sql, args); return { ...r, rowCount: r.rows?.length || r.affectedRows || 0 }; };
const pool = { query, connect: async () => ({ query, release() {} }) };
const rows = async table => (await query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
const run = async (manifest, apply = false) => (await runBackfill(pool, manifest, { apply }))[0];
try {
  await db.exec(`CREATE TABLE admin_users(id BIGSERIAL PRIMARY KEY,email TEXT,username TEXT,role TEXT);
    CREATE TABLE tenants(tenant_key TEXT PRIMARY KEY,name TEXT,industry TEXT,app_access_status TEXT,billing_status TEXT,live_prompt_mode TEXT,updated_at TIMESTAMPTZ,status TEXT,telnyx_voice_number TEXT,telnyx_voice_status TEXT,service_access_status TEXT,billing_lock_reason TEXT);
    CREATE TABLE tenant_bootstrap_profiles(tenant_key TEXT PRIMARY KEY,website_url TEXT,company_description TEXT,business_category TEXT,source_mode TEXT,marketing_attribution_json JSONB DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE tenant_active_knowledge_builds(tenant_key TEXT,active_build_id TEXT);
    CREATE TABLE knowledge_builds(build_id TEXT,tenant_key TEXT,status TEXT);
    CREATE TABLE provisioning_jobs(id BIGSERIAL PRIMARY KEY,tenant_key TEXT,status TEXT,provider TEXT,stage TEXT,status_detail TEXT,provider_reference TEXT,error_code TEXT,error_message TEXT,updated_at TIMESTAMPTZ,completed_at TIMESTAMPTZ);
    CREATE TABLE audit_log(id BIGSERIAL PRIMARY KEY,tenant_key TEXT,actor TEXT,action TEXT,details TEXT);
    INSERT INTO admin_users(id,email) VALUES(1,'rep@example.test');`);
  for (const name of ['0032_outbound_sales_demo.sql','0056_sales_dialer_v2.sql','0057_sales_phone_test_mode.sql','0058_sales_prospect_checkout.sql','0059_sales_company_contacts.sql']) await db.exec(await fs.readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  await query(`INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,website_url,metadata_json,permission_granted,email_permission,assigned_rep_user_id)
    VALUES('company','source:company','Company','+12065550101','https://example.test',$1,TRUE,TRUE,1)`, [JSON.stringify({ researchNotes: 'The team includes Jane Smith, Service Manager. Chris also works here.' })]);
  const original = (await rows('sales_prospects'))[0];
  const originals = { contacts: await rows('sales_prospect_contacts'), numbers: await rows('sales_prospect_contact_numbers'), identities: await rows('sales_prospect_identities') };
  const candidate = { firstName: 'Jane', lastName: 'Smith', title: 'Service Manager', evidence: [{ path: ['prospect','metadata_json','researchNotes'], quote: 'The team includes Jane Smith, Service Manager.' }] };
  const manifest = { runId: 'test_run_20261109', companies: [{ prospectId: 'company', expectedRowVersion: 1, sourceFingerprint: fingerprint(sourceSnapshot(original, null)), candidates: [candidate, { firstName: 'Chris', lastName: '', evidence: [{ path: ['prospect','metadata_json','researchNotes'], quote: 'Chris also works here.' }] }] }] };
  assert.equal((await run(manifest)).inserted, 2);
  assert.deepEqual(await rows('sales_prospect_contacts'), originals.contacts);
  assert.equal((await rows('audit_log')).length, 0);
  const bad = structuredClone(manifest); bad.companies[0].candidates[0].firstName = 'Invented';
  assert.equal((await run(bad, true)).code, 'name_not_in_evidence');
  assert.deepEqual(await rows('sales_prospect_contacts'), originals.contacts);
  const splitTitle = structuredClone(manifest);
  splitTitle.companies[0].candidates[0].evidence = [
    { path: ['prospect','metadata_json','researchNotes'], quote: 'Jane Smith' },
    { path: ['prospect','metadata_json','researchNotes'], quote: 'Service Manager.' }
  ];
  assert.equal((await run(splitTitle, true)).code, 'title_not_in_named_evidence');
  // Statement-boundary fixture only, not a substitute for native contention QA:
  // pending work appearing after the lock statement must reach the fresh check.
  let sawStandaloneLock = false;
  const boundaryPool = { connect: async () => ({ release() {}, query: async (sql, args) => {
    const result = await query(sql, args);
    if (sql === 'SELECT prospect_id FROM sales_prospects WHERE prospect_id=$1 FOR UPDATE') {
      sawStandaloneLock = true;
      await query("INSERT INTO sales_incoming_calls(incoming_id,provider_call_control_id,phone_e164,prospect_id,state) VALUES('pending','provider_pending','+12065550101','company','routing')");
    }
    return result;
  } }) };
  assert.equal((await runBackfill(boundaryPool, manifest, { apply: true }))[0].code, 'company_edit_pending');
  assert.equal(sawStandaloneLock, true);
  assert.deepEqual(await rows('sales_prospect_contacts'), originals.contacts);
  const stale = structuredClone(manifest); stale.companies[0].expectedRowVersion = 3;
  assert.equal((await run(stale, true)).code, 'prospect_version_conflict');
  const changed = structuredClone(manifest); changed.companies[0].sourceFingerprint = '0'.repeat(64);
  assert.equal((await run(changed, true)).code, 'source_fingerprint_conflict');
  await query('UPDATE sales_dialer_config SET phone_test_mode=TRUE WHERE id=TRUE');
  assert.equal((await run(manifest, true)).code, 'sales_phone_test_mode_active');
  await query('UPDATE sales_dialer_config SET phone_test_mode=FALSE WHERE id=TRUE');
  await query(`INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state) VALUES('busy','company',1,'starting')`);
  assert.equal((await run(manifest, true)).code, 'company_edit_pending');
  await query("UPDATE sales_call_sessions SET state='closed' WHERE sales_call_id='busy'");
  // A newly registered suppression identity causes the existing BEFORE UPDATE
  // trigger to reconcile protected company fields. Maintenance must roll back.
  await query("INSERT INTO sales_dnc_registry(identity_type,identity_value,reason) VALUES('phone','+12065550101','asked_not_to_be_called')");
  assert.equal((await run(manifest, true)).code, 'company_preservation_conflict');
  assert.deepEqual((await rows('sales_prospects'))[0], original);
  assert.deepEqual(await rows('sales_prospect_contacts'), originals.contacts);
  assert.equal((await rows('audit_log')).length, 0);
  await query("DELETE FROM sales_dnc_registry WHERE identity_type='phone' AND identity_value='+12065550101'");
  await db.exec("CREATE FUNCTION refuse_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit unavailable'; END $$; CREATE TRIGGER refuse_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION refuse_test_audit();");
  assert.equal((await run(manifest, true)).status, 'blocked');
  assert.deepEqual(await rows('sales_prospect_contacts'), originals.contacts);
  assert.deepEqual((await rows('sales_prospects'))[0], original);
  await db.exec('DROP TRIGGER refuse_audit ON audit_log');
  const applied = await run(manifest, true);
  assert.equal(applied.status, 'applied'); assert.equal(applied.inserted, 2);
  const after = (await rows('sales_prospects'))[0];
  assert.equal(after.row_version, 2);
  assert.deepEqual({ ...after, row_version: original.row_version, updated_at: original.updated_at }, original);
  assert.deepEqual(await rows('sales_prospect_contact_numbers'), originals.numbers);
  assert.deepEqual(await rows('sales_prospect_identities'), originals.identities);
  const contacts = await rows('sales_prospect_contacts');
  assert.deepEqual(contacts.find(c => c.contact_id === originals.contacts[0].contact_id), originals.contacts[0]);
  for (const added of contacts.filter(c => applied.contactIds.includes(c.contact_id))) {
    assert.equal(added.email, null); assert.equal(added.decision_maker, false); assert.equal(added.influencer, false);
  }
  const audit = await rows('audit_log');
  assert.equal(audit.length, 1); assert.equal(audit[0].actor, 'system:sales-contact-enrichment');
  assert.doesNotMatch(audit[0].details, /Jane|Smith|Chris|Service Manager|researchNotes/);
  assert.equal((await run(manifest, true)).status, 'already_applied');
  assert.equal((await rows('audit_log')).length, 1);
  const conflict = structuredClone(manifest); conflict.companies[0].candidates.pop();
  assert.equal((await run(conflict, true)).code, 'run_id_conflict');
  const repeated = structuredClone(manifest); repeated.runId += '_new'; repeated.companies[0].expectedRowVersion = 2;
  const repeat = await run(repeated, true); assert.equal(repeat.inserted, 0); assert.equal(repeat.skipped.length, 2);
  assert.equal((await rows('sales_prospects'))[0].row_version, 2);
  assert.equal(duplicateReason({ firstName: 'Jane', lastName: 'New' }, contacts), null);
  assert.equal(duplicateReason({ firstName: 'Chris', lastName: 'Named' }, contacts), 'ambiguous_identity');
  assert.equal(duplicateReason({ firstName: 'John', lastName: 'Smit' }, [{ first_name: 'Jon', last_name: 'Smith' }]), 'ambiguous_identity');
  assert.equal(duplicateReason({ firstName: 'Jane', lastName: 'Smith' }, [{ first_name: 'Jane', last_name: 'Smith', archived_at: 'now' }]), 'archived_identity');
  const john = [{ first_name: 'John', last_name: 'Smith', legacy_name: 'John Smith', legacy_owner_first_name: 'John' }];
  assert.equal(duplicateReason({ firstName: 'Mary', lastName: 'Smith' }, john), null);
  assert.equal(duplicateReason({ firstName: 'John', lastName: 'Jones' }, john), null);
  assert.equal(duplicateReason({ firstName: 'Jon', lastName: '' }, john), 'ambiguous_identity');
  assert.equal(duplicateReason({ firstName: 'John', lastName: 'Smith' }, [{ first_name: 'Jon', last_name: '' }]), 'ambiguous_identity');
  assert.equal(duplicateReason({ firstName: 'Jon', lastName: '' }, [{ first_name: 'John', last_name: '' }]), 'ambiguous_identity');
  console.log('Sales contact backfill: dry-run, same-passage title/evidence, version/source guards, post-lock pending-work check, protected-field trigger rollback, atomic audit, complete/partial/fuzzy dedupe and replay passed.');
} finally { await db.close(); }
