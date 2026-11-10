// Operator-reviewed, additive maintenance only. No crawling, model calls or delivery.
// SALES-CONTACT-002/004/007/008: preserve default, phone identities and permissions.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { assertSalesCompanyEditable } from '../pages/api/_lib/salesCompanyContacts.js';
import { writeAuditLog } from '../pages/api/_lib/auditLog.js';

const action = 'sales_company_contacts_source_backfill';
const fail = code => { throw Object.assign(new Error(code), { code }); };
export function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function sourceSnapshot(prospect, demo) {
  const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key] ?? null]));
  return {
    prospect: pick(prospect, ['prospect_id', 'source_key', 'business_name', 'website_url', 'contact_name', 'owner_first_name', 'metadata_json']),
    demo: demo ? pick(demo, ['demo_profile_id', 'source_website_url', 'scrape_pages_json']) : null
  };
}
const normalized = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const nameKey = candidate => normalized(`${candidate.firstName} ${candidate.lastName}`);
function near(left, right) {
  if (left === right) return true;
  if (!left || !right || Math.abs(left.length - right.length) > 1) return false;
  let i = 0, j = 0, differences = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i++; j++; continue; }
    if (++differences > 1) return false;
    if (left.length >= right.length) i++;
    if (right.length >= left.length) j++;
  }
  return differences + (i < left.length || j < right.length ? 1 : 0) <= 1;
}
function rowNames(row) {
  const legacy = String(row.legacy_name || '').trim().split(/\s+/);
  const names = [
    { firstName: row.first_name || '', lastName: row.last_name || '' },
    { firstName: legacy[0] || '', lastName: legacy.slice(1).join(' ') }
  ].filter(name => nameKey(name));
  const ownerFirst = normalized(row.legacy_owner_first_name);
  // A redundant legacy first name must not turn a known full name into an
  // ambiguous partial identity and block another explicitly named John/Jane.
  if (ownerFirst && !names.some(name => name.lastName && normalized(name.firstName) === ownerFirst)) {
    names.push({ firstName: row.legacy_owner_first_name, lastName: '' });
  }
  return names;
}

// False positives are held for review; never merge a partial/fuzzy identity.
export function duplicateReason(candidate, rows) {
  const first = normalized(candidate.firstName), last = normalized(candidate.lastName), full = nameKey(candidate);
  for (const row of rows) for (const other of rowNames(row)) {
    const key = nameKey(other), otherFirst = normalized(other.firstName), otherLast = normalized(other.lastName);
    if (key === full) return row.archived_at ? 'archived_identity' : 'existing_identity';
    if (((!last || !otherLast) && near(first, otherFirst)) ||
        (last && otherLast && near(first, otherFirst) && near(last, otherLast)) ||
        (last && otherLast === last && (first.length === 1 || otherFirst.length === 1) && first[0] === otherFirst[0]) ||
        key.replaceAll(' ', '') === full.replaceAll(' ', '')) return 'ambiguous_identity';
  }
  return null;
}
function validateCandidate(candidate, source) {
  if (!candidate || typeof candidate !== 'object') fail('invalid_candidate');
  if (Object.keys(candidate).some(key => !['firstName', 'lastName', 'title', 'evidence'].includes(key))) fail('unexpected_candidate_field');
  for (const key of ['firstName', 'lastName']) {
    const value = candidate[key];
    if (key === 'lastName' && value === '') continue;
    if (typeof value !== 'string' || value !== value.trim() || value.length > 120 || !/^[\p{L}][\p{L}\p{M} .’'\-]*$/u.test(value) || normalized(value).length < 2) fail('person_name_required');
  }
  if (candidate.title !== undefined && (typeof candidate.title !== 'string' || candidate.title.length > 160 || /[\r\n\x00-\x1f]/.test(candidate.title))) fail('invalid_title');
  if (!Array.isArray(candidate.evidence) || !candidate.evidence.length || candidate.evidence.length > 10) fail('evidence_required');
  const passages = [];
  for (const evidence of candidate.evidence) {
    if (!Array.isArray(evidence.path) || !['prospect', 'demo'].includes(evidence.path[0]) || evidence.path.length > 12 || typeof evidence.quote !== 'string' || !evidence.quote.trim() || evidence.quote.length > 5000) fail('invalid_evidence');
    let value = source;
    for (const key of evidence.path) {
      if (!['string', 'number'].includes(typeof key) || ['__proto__', 'prototype', 'constructor'].includes(String(key)) || !value || !Object.hasOwn(value, key)) fail('evidence_path_missing');
      value = value[key];
    }
    if (typeof value !== 'string' || !value.includes(evidence.quote)) fail('evidence_quote_mismatch');
    passages.push(normalized(evidence.quote));
  }
  // Ground the complete name in one passage; do not assemble names across sources.
  const namedPassages = passages.filter(passage => (` ${passage} `).includes(` ${nameKey(candidate)} `));
  if (!namedPassages.length) fail('name_not_in_evidence');
  if (candidate.title && !namedPassages.some(passage => (` ${passage} `).includes(` ${normalized(candidate.title)} `))) fail('title_not_in_named_evidence');
}
function validateManifest(manifest) {
  if (!manifest || !/^[a-zA-Z0-9_-]{8,100}$/.test(manifest.runId || '') || !Array.isArray(manifest.companies) || manifest.companies.length > 5000) fail('invalid_manifest');
  const seen = new Set();
  for (const company of manifest.companies) {
    if (typeof company.prospectId !== 'string' || !company.prospectId || seen.has(company.prospectId) || !Number.isSafeInteger(company.expectedRowVersion) || company.expectedRowVersion < 1 || !/^[a-f0-9]{64}$/.test(company.sourceFingerprint || '') || !Array.isArray(company.candidates) || !company.candidates.length || company.candidates.length > 49) fail('invalid_company');
    seen.add(company.prospectId);
  }
}

export async function backfillCompany(db, runId, company, { apply = false } = {}) {
  const manifestFingerprint = fingerprint(company);
  const mode = (await db.query('SELECT phone_test_mode FROM sales_dialer_config WHERE id=TRUE FOR SHARE')).rows[0];
  if (!mode || mode.phone_test_mode) fail('sales_phone_test_mode_active');
  // Acquire the company lock in its own statement. The following pending-work
  // subqueries need a fresh READ COMMITTED snapshot after any lock wait.
  await db.query('SELECT prospect_id FROM sales_prospects WHERE prospect_id=$1 FOR UPDATE', [company.prospectId]);
  await assertSalesCompanyEditable(db, company.prospectId);
  const row = (await db.query('SELECT * FROM sales_prospects WHERE prospect_id=$1', [company.prospectId])).rows[0];
  if (row.test_original_phone_e164 != null || row.test_original_numbers_json != null) fail('sales_phone_test_backup_present');
  const receipts = (await db.query(`SELECT details FROM audit_log WHERE action=$1 AND details::jsonb->>'runId'=$2 AND details::jsonb->>'prospectId'=$3`, [action, runId, company.prospectId])).rows;
  if (receipts.length) {
    const receipt = typeof receipts[0].details === 'string' ? JSON.parse(receipts[0].details) : receipts[0].details;
    if (receipts.length !== 1 || receipt.manifestFingerprint !== manifestFingerprint) fail('run_id_conflict');
    return { prospectId: company.prospectId, status: 'already_applied', inserted: 0, contactIds: receipt.contactIds };
  }
  if (Number(row.row_version) !== company.expectedRowVersion) fail('prospect_version_conflict');
  const demo = (await db.query('SELECT * FROM sales_demo_profiles WHERE prospect_id=$1 FOR SHARE', [company.prospectId])).rows[0];
  const source = sourceSnapshot(row, demo);
  if (fingerprint(source) !== company.sourceFingerprint) fail('source_fingerprint_conflict');
  if (company.candidates.some(c => c.evidence?.some(e => e.path?.[0] === 'demo')) && demo?.source_website_url !== row.website_url) fail('stale_website_capture');
  const contacts = (await db.query('SELECT * FROM sales_prospect_contacts WHERE prospect_id=$1 ORDER BY contact_id', [company.prospectId])).rows;
  if (!contacts.some(c => c.contact_id === row.default_contact_id && !c.archived_at)) fail('invalid_default_contact');
  const additions = [], skipped = [];
  for (let index = 0; index < company.candidates.length; index++) {
    const candidate = company.candidates[index];
    validateCandidate(candidate, source);
    const reason = duplicateReason(candidate, contacts);
    if (reason) { skipped.push({ index, reason }); continue; }
    const contactId = `contact_source_${fingerprint([company.prospectId, nameKey(candidate)]).slice(0, 40)}`;
    if (contacts.some(c => c.contact_id === contactId)) fail('contact_id_conflict');
    additions.push({ candidate, contactId });
    contacts.push({ contact_id: contactId, first_name: candidate.firstName, last_name: candidate.lastName });
  }
  if (contacts.filter(c => !c.archived_at).length > 50) fail('contact_limit');
  const result = { prospectId: company.prospectId, status: apply ? 'applied' : 'dry_run', inserted: additions.length, skipped, contactIds: additions.map(a => a.contactId), manifestFingerprint, sourceFingerprint: company.sourceFingerprint, rowVersionBefore: Number(row.row_version), rowVersionAfter: Number(row.row_version) + (additions.length ? 1 : 0) };
  if (!apply) return result;
  result.contactRecordFingerprints = {};
  for (const { candidate, contactId } of additions) {
    // No permissions, email, phone, role flags, legacy projection or default writes.
    const inserted = await db.query(`INSERT INTO sales_prospect_contacts(contact_id,prospect_id,first_name,last_name,title) VALUES($1,$2,$3,$4,$5) RETURNING *`, [contactId, company.prospectId, candidate.firstName, candidate.lastName, candidate.title || null]);
    result.contactRecordFingerprints[contactId] = fingerprint(inserted.rows[0]);
  }
  if (additions.length) {
    const updated = (await db.query('UPDATE sales_prospects SET row_version=row_version+1,updated_at=NOW() WHERE prospect_id=$1 RETURNING *', [company.prospectId])).rows[0];
    const preserved = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['row_version', 'updated_at'].includes(key)));
    // Normal triggers stay enabled: reject and roll back if they reconcile a
    // DNC identity or otherwise change any protected company field.
    if (!updated || Number(updated.row_version) !== Number(row.row_version) + 1 || fingerprint(preserved(updated)) !== fingerprint(preserved(row))) fail('company_preservation_conflict');
  }
  await writeAuditLog(db, { actor: 'system:sales-contact-enrichment', action, details: { runId, ...result } });
  return result;
}

export async function runBackfill(pool, manifest, { apply = false, onResult = async () => {} } = {}) {
  validateManifest(manifest);
  const results = [];
  for (const company of manifest.companies) {
    const db = await pool.connect();
    let result;
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL lock_timeout='5s'");
      await db.query("SET LOCAL statement_timeout='30s'");
      result = await backfillCompany(db, manifest.runId, company, { apply });
      await db.query(apply ? 'COMMIT' : 'ROLLBACK');
    } catch (error) {
      await db.query('ROLLBACK');
      // Fixed codes only: PostgreSQL error messages may contain source PII.
      const code = String(error.code || 'backfill_failed');
      result = { prospectId: company.prospectId, status: 'blocked', code: /^[a-zA-Z0-9_]{1,80}$/.test(code) ? code : 'backfill_failed' };
    } finally { db.release(); }
    results.push(result);
    await onResult(result);
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const positional = args.filter(arg => arg !== '--apply');
  if (positional.length !== 2 || positional.some(arg => arg.startsWith('--'))) fail('usage_manifest_json_result_jsonl_optional_apply');
  if (!process.env.DATABASE_URL) fail('database_url_required');
  const manifest = JSON.parse(await fs.readFile(positional[0], 'utf8'));
  validateManifest(manifest);
  // Exclusive, private journal. Keep reviewed manifest privately as quote provenance.
  const journal = await fs.open(positional[1], 'wx', 0o600);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const results = await runBackfill(pool, manifest, { apply, onResult: result => journal.writeFile(`${JSON.stringify(result)}\n`) });
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry_run', companies: results.length, inserted: results.reduce((n, r) => n + (r.inserted || 0), 0), blocked: results.filter(r => r.status === 'blocked').length }));
    if (results.some(r => r.status === 'blocked')) process.exitCode = 2;
  } finally { await pool.end(); await journal.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(/^[a-zA-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : 'backfill_failed'); process.exitCode = 1; });
