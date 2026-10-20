// Actual unmodified Config + governance + explicit migrations, isolated PGlite.
// No loader hooks, external fetches, provider/model calls, or production writes.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { bootstrapFixtureSchema } from './lib/schema-migrations.mjs';
import { saveUploadedDocument, listUploadedDocuments } from '../pages/api/_lib/knowledgeReceptionistConfig.js';
import { saveKnowledgeGovernancePolicy, reviewKnowledgeChange } from '../pages/api/_lib/knowledgeGovernance.js';

const p = new PGlite();
const query = async (sql, args) => {
  const result = args ? await p.query(sql, args) : (await p.exec(sql)).at(-1);
  return { ...result, rowCount: result.rows?.length || result.affectedRows || 0 };
};
const db = { query, connect: async () => ({ query, release() {} }) };
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('source_preservation_fixture_network_forbidden'); };
try {
  await bootstrapFixtureSchema(db, { executeSql: sql => p.exec(sql) });
  await query("INSERT INTO tenants(tenant_key,name) VALUES ('capture','Capture fixture')");
  await query("INSERT INTO tenant_users(id,tenant_key,email,name,role,status) VALUES (901,'capture','owner@example.test','Owner','owner','active'),(902,'capture','reviewer@example.test','Reviewer','admin','active')");
  const owner = { role: 'tenant', user_id: '901' }, reviewer = { role: 'tenant', user_id: '902' };
  const raw = 'Office   hours\r\nMonday 9am to 5pm.\r\n';
  let document = await saveUploadedDocument(db, 'capture', {
    uploadedDocumentId: 'raw', title: 'Office hours', filename: 'hours.txt', mimeType: 'text/plain',
    fileBase64: Buffer.from(raw).toString('base64'), sourceAuthority: 'uploaded_unclassified_pending_review'
  }, owner);
  assert.ok(!('original_capture_json' in document));
  assert.notEqual(document.body_text, raw, 'fixture exercises normalized evidence vs exact raw bytes');
  const load = async (id = 'raw') => (await query('SELECT * FROM uploaded_documents WHERE uploaded_document_id=$1', [id])).rows[0];
  const original = (await load()).original_capture_json;
  assert.equal(Buffer.from(original.body, 'base64').toString(), raw);
  assert.equal(original.sha256, crypto.createHash('sha256').update(raw).digest('hex'));
  document = await saveUploadedDocument(db, 'capture', {
    ...document, source_authority: 'uploaded_first_party_operational', document_class: 'operational',
    original_capture_json: { body: 'caller cannot replace capture metadata' }
  }, owner);
  assert.deepEqual((await load()).original_capture_json, original, 'returned-row authority promotion preserves bytes, SHA256, capture time and provenance');
  document = await saveUploadedDocument(db, 'capture', {
    uploadedDocumentId: 'raw', title: 'Operational hours', metadata: { reviewed: true }
  }, owner);
  assert.deepEqual((await load()).original_capture_json, original, 'metadata-only patch need not resend body');
  assert.equal(document.body_text, 'Office hours\nMonday 9am to 5pm.');

  await saveKnowledgeGovernancePolicy(db, 'capture', { review_mode: 'reviewed' }, owner);
  const draft = await saveUploadedDocument(db, 'capture', {
    ...document, source_authority: 'uploaded_first_party_policy', document_class: 'policy'
  }, owner);
  assert.equal(draft.status, 'draft');
  assert.equal((await load()).source_authority, 'uploaded_first_party_operational');
  assert.deepEqual((await load()).original_capture_json, original);
  await reviewKnowledgeChange(db, 'capture', draft.change_id, { decision: 'approve', note: 'Confirmed source classification.' }, reviewer);
  document = (await listUploadedDocuments(db, 'capture')).find(row => row.uploaded_document_id === 'raw');
  assert.equal(document.source_authority, 'uploaded_first_party_policy');
  assert.deepEqual((await load()).original_capture_json, original, 'reviewed promotion preserves original capture');

  const replacementRaw = 'New   office hours\r\nTuesday 10am to 6pm.\r\n';
  const replacementDraft = await saveUploadedDocument(db, 'capture', {
    ...document, fileBase64: Buffer.from(replacementRaw).toString('base64')
  }, owner);
  assert.deepEqual((await load()).original_capture_json, original, 'pending replacement cannot alter live source');
  await reviewKnowledgeChange(db, 'capture', replacementDraft.change_id, { decision: 'approve' }, reviewer);
  const replaced = await load();
  assert.equal(Buffer.from(replaced.original_capture_json.body, 'base64').toString(), replacementRaw);
  assert.equal(replaced.original_capture_json.sha256, crypto.createHash('sha256').update(replacementRaw).digest('hex'));
  assert.equal(replaced.body_text, 'New office hours\nTuesday 10am to 6pm.', 'new file bytes replace stale returned-row evidence too');
  assert.notEqual(replaced.content_fingerprint, document.content_fingerprint);
  const audits = (await query("SELECT details FROM audit_log WHERE action='knowledge_receptionist.uploaded_document.saved' ORDER BY id")).rows.map(row => typeof row.details === 'string' ? JSON.parse(row.details) : row.details);
  assert.ok(audits.some(row => row.source_replaced === false && row.capture_sha256 === original.sha256));
  assert.ok(audits.some(row => row.source_replaced === true && row.previous_capture_sha256 === original.sha256 && row.capture_sha256 === replaced.original_capture_json.sha256));

  // Explicit text replacement can refresh exact bytes even when trim-normalized
  // evidence is unchanged; an ordinary returned row cannot do this implicitly.
  document = (await listUploadedDocuments(db, 'capture')).find(row => row.uploaded_document_id === 'raw');
  const replacementText = `  ${document.body_text}\r\n`;
  const textDraft = await saveUploadedDocument(db, 'capture', {
    ...document, body_text: replacementText, replaceSource: true
  }, owner);
  await reviewKnowledgeChange(db, 'capture', textDraft.change_id, { decision: 'approve' }, reviewer);
  assert.equal(Buffer.from((await load()).original_capture_json.body, 'base64').toString(), replacementText);
  assert.equal((await load()).body_text, document.body_text);

  // Returned URL documents must not be fetched again merely to classify them.
  await query("UPDATE uploaded_documents SET source_kind='single_page_url',source_locator='https://example.test/hours',fetch_status='fetched',fetch_metadata_json='{\"final_url\":\"https://example.test/hours\",\"captured_at\":\"fixture-time\"}' WHERE uploaded_document_id='raw'");
  document = (await listUploadedDocuments(db, 'capture')).find(row => row.uploaded_document_id === 'raw');
  const urlBefore = await load();
  const urlDraft = await saveUploadedDocument(db, 'capture', {
    ...document, title: 'URL source metadata review', source_authority: 'uploaded_first_party_operational', document_class: 'operational'
  }, owner);
  await reviewKnowledgeChange(db, 'capture', urlDraft.change_id, { decision: 'approve' }, reviewer);
  assert.deepEqual((await load()).original_capture_json, urlBefore.original_capture_json);
  assert.deepEqual((await load()).fetch_metadata_json, urlBefore.fetch_metadata_json);
  assert.equal((await load()).fetch_status, 'fetched');
  assert.equal((await load()).body_text, urlBefore.body_text);
  assert.equal((await load()).source_authority, 'uploaded_first_party_operational');

  // Historical missing raw bytes stay missing; metadata edits must not fabricate
  // an original capture from the normalized projection.
  await query("UPDATE uploaded_documents SET original_capture_json=NULL WHERE uploaded_document_id='raw'");
  document = (await listUploadedDocuments(db, 'capture')).find(row => row.uploaded_document_id === 'raw');
  const legacyDraft = await saveUploadedDocument(db, 'capture', { ...document, title: 'Historical source' }, owner);
  await reviewKnowledgeChange(db, 'capture', legacyDraft.change_id, { decision: 'approve' }, reviewer);
  assert.equal((await load()).original_capture_json, null);
  console.log('Knowledge source preservation passed: unmodified Config and migrations, exact CRLF/spacing captures, direct/reviewed metadata promotion, explicit file replacement, URL provenance, missing historical raw bytes.');
} finally {
  globalThis.fetch = originalFetch;
  await p.close();
}
