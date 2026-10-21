import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
const approvedChange = new AsyncLocalStorage();
const text = v => String(v || '').trim();
export const READINESS_CHECKS = ['hours_confirmed', 'address_confirmed', 'phone_confirmed', 'after_hours_configured', 'service_area_confirmed', 'dangerous_question_reviewed', 'hard_overrides_reviewed', 'temporary_notices_checked', 'approved_answer_snippets_reviewed', 'sample_calls_passed', 'handoff_path_tested', 'outcome_capture_tested', 'pack_eval_suites_passed'];
export function governanceActorId(actor) {
  if (!actor || typeof actor !== 'object' || !text(actor.user_id || actor.id)) throw new Error('knowledge_reviewer_required');
  return `${['admin', 'super_admin'].includes(actor.role) ? 'admin' : actor.role}:${text(actor.user_id || actor.id)}`;
}
function knownBuildCreator(build) {
  const kind = text(build?.created_by_type);
  const id = text(build?.created_by_id);
  if (!['tenant', 'admin', 'super_admin', 'sales'].includes(kind) || !id) return null;
  return `${['super_admin', 'sales'].includes(kind) ? 'admin' : kind}:${id}`;
}
function assertDistinctBuildReviewer(build, reviewer) {
  const creator = knownBuildCreator(build);
  if (!creator) throw new Error('knowledge_build_creator_required');
  if (reviewer === creator) throw new Error('knowledge_second_reviewer_required');
}

export async function assertKnowledgeReviewer(db, tenantKey, actor) {
  const id = governanceActorId(actor);
  const userId = text(actor.user_id || actor.id);
  if (['admin', 'super_admin'].includes(actor.role)) {
    const row = (await db.query('SELECT role FROM admin_users WHERE id = $1', [userId])).rows[0];
    if (!row || !['admin', 'super_admin'].includes(row.role)) throw new Error('knowledge_reviewer_forbidden');
  } else if (actor.role === 'tenant') {
    const row = (await db.query('SELECT tenant_key, role, status FROM tenant_users WHERE id = $1', [userId])).rows[0];
    if (!row || row.tenant_key !== tenantKey || row.status !== 'active' || !['owner', 'admin'].includes(row.role)) throw new Error('knowledge_reviewer_forbidden');
  } else throw new Error('knowledge_reviewer_forbidden');
  return id;
}
export async function governanceTransaction(db, work) {
  const owns = typeof db.connect === 'function' && typeof db.release !== 'function';
  const client = owns ? await db.connect() : db;
  if (owns) await client.query('BEGIN');
  try { const result = await work(client); if (owns) await client.query('COMMIT'); return result; }
  catch (e) { if (owns) await client.query('ROLLBACK'); throw e; }
  finally { if (owns) client.release(); }
}
async function lockPolicy(db, tenantKey) {
  await db.query('SELECT tenant_key FROM tenants WHERE tenant_key = $1 FOR UPDATE', [tenantKey]);
  await db.query('INSERT INTO knowledge_governance_policies (tenant_key) VALUES ($1) ON CONFLICT (tenant_key) DO NOTHING', [tenantKey]);
  return (await db.query('SELECT * FROM knowledge_governance_policies WHERE tenant_key = $1 FOR UPDATE', [tenantKey])).rows[0];
}
export async function loadKnowledgeGovernance(db, tenantKey) {
  const policy = (await db.query('SELECT * FROM knowledge_governance_policies WHERE tenant_key = $1', [tenantKey])).rows[0]
    || { tenant_key: tenantKey, review_mode: 'single_admin', publication_mode: 'manual_only', revision: 0 };
  const changes = (await db.query('SELECT * FROM knowledge_change_requests WHERE tenant_key = $1 ORDER BY created_at DESC LIMIT 100', [tenantKey])).rows;
  return { policy, changes };
}
async function audit(db, tenantKey, actor, action, details) {
  await db.query('INSERT INTO audit_log (tenant_key, actor, action, details) VALUES ($1,$2,$3,$4)', [tenantKey, actor, `knowledge_governance.${action}`, JSON.stringify(details)]);
}
// `apply` is server-owned code; no request payload can create an approved context.
export async function submitKnowledgeChange(db, { tenantKey, actor, kind, payload, apply }) {
  const approved = approvedChange.getStore();
  if (approved?.tenantKey === tenantKey && approved.kind === kind) return apply(db);
  return governanceTransaction(db, async client => {
    const policy = await lockPolicy(client, tenantKey);
    const actorId = actor && typeof actor === 'object' ? await assertKnowledgeReviewer(client, tenantKey, actor) : text(actor) || 'system';
    if (policy.review_mode === 'reviewed') {
      const duplicate = (await client.query("SELECT change_id FROM knowledge_change_requests WHERE tenant_key=$1 AND kind=$2 AND payload_json=$3::jsonb AND requested_by=$4 AND base_revision=$5 AND status='draft' LIMIT 1", [tenantKey, kind, JSON.stringify(payload), actorId, policy.revision])).rows[0];
      if (duplicate) return { change_id: duplicate.change_id, status: 'draft', review_required: true };
      const changeId = `kcr_${crypto.randomUUID()}`;
      await client.query('INSERT INTO knowledge_change_requests (change_id,tenant_key,kind,payload_json,base_revision,requested_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6)', [changeId, tenantKey, kind, JSON.stringify(payload), policy.revision, actorId]);
      await audit(client, tenantKey, actorId, 'draft_created', { change_id: changeId, kind });
      return { change_id: changeId, status: 'draft', review_required: true };
    }
    const result = await apply(client);
    await client.query('UPDATE knowledge_governance_policies SET revision=revision+1, updated_at=NOW() WHERE tenant_key=$1', [tenantKey]);
    await audit(client, tenantKey, actorId, 'immediate_change', { kind });
    return result;
  });
}
async function applyPolicy(db, tenantKey, payload) {
  if (!['single_admin', 'reviewed'].includes(payload.review_mode) || (payload.publication_mode && payload.publication_mode !== 'manual_only')) throw new Error('knowledge_policy_invalid');
  return (await db.query("UPDATE knowledge_governance_policies SET review_mode=$2, publication_mode='manual_only', updated_at=NOW() WHERE tenant_key=$1 RETURNING *", [tenantKey, payload.review_mode])).rows[0];
}
export async function saveKnowledgeGovernancePolicy(db, tenantKey, payload, actor) {
  if (!['single_admin', 'reviewed'].includes(payload.review_mode) || (payload.publication_mode && payload.publication_mode !== 'manual_only')) throw new Error('knowledge_policy_invalid');
  await assertKnowledgeReviewer(db, tenantKey, actor);
  return submitKnowledgeChange(db, { tenantKey, actor, kind: 'policy', payload, apply: client => applyPolicy(client, tenantKey, payload) });
}
async function applyReviewedChange(db, row, actor) {
  const config = await import('./knowledgeReceptionistConfig.js');
  const handlers = { override: config.saveKnowledgeOverride, guardrail: config.saveKnowledgeGuardrail, business_call_intent: config.saveBusinessCallIntent, uploaded_document: config.saveUploadedDocument };
  if (row.kind === 'policy') return applyPolicy(db, row.tenant_key, row.payload_json);
  if (row.kind === 'setup_interview' || row.kind === 'setup_interview_session') {
    const interview = await import('./knowledgeReceptionistSetupInterview.js');
    return (row.kind === 'setup_interview' ? interview.saveSetupInterviewSubmission : interview.createSetupInterviewSessionSkeleton)(db, row.tenant_key, row.payload_json, actor);
  }
  if (!handlers[row.kind]) throw new Error('knowledge_change_kind_invalid');
  return handlers[row.kind](db, row.tenant_key, row.payload_json, actor);
}
export async function reviewKnowledgeChange(db, tenantKey, changeId, { decision, note = '' }, actor) {
  return governanceTransaction(db, async client => {
    const reviewer = await assertKnowledgeReviewer(client, tenantKey, actor);
    const policy = await lockPolicy(client, tenantKey);
    const row = (await client.query('SELECT * FROM knowledge_change_requests WHERE tenant_key=$1 AND change_id=$2 FOR UPDATE', [tenantKey, changeId])).rows[0];
    if (!row) throw new Error('knowledge_change_not_found');
    if (row.status !== 'draft') throw new Error('knowledge_change_already_reviewed');
    if (row.requested_by === reviewer) throw new Error('knowledge_second_reviewer_required');
    if (!['approve', 'reject'].includes(decision)) throw new Error('knowledge_review_decision_invalid');
    let result = null;
    if (decision === 'approve') {
      if (Number(row.base_revision) !== Number(policy.revision)) throw new Error('knowledge_change_stale');
      result = await approvedChange.run({ tenantKey, kind: row.kind }, () => applyReviewedChange(client, row, actor));
      await client.query('UPDATE knowledge_governance_policies SET revision=revision+1, updated_at=NOW() WHERE tenant_key=$1', [tenantKey]);
    }
    const status = decision === 'approve' ? 'approved_live' : 'rejected';
    await client.query('UPDATE knowledge_change_requests SET status=$3, reviewed_by=$4, review_note=$5, reviewed_at=NOW() WHERE tenant_key=$1 AND change_id=$2', [tenantKey, changeId, status, reviewer, text(note)]);
    await audit(client, tenantKey, reviewer, status, { change_id: changeId, kind: row.kind, requested_by: row.requested_by, note: text(note) });
    return { change_id: changeId, status, result };
  });
}
export async function loadKnowledgeReadiness(db, tenantKey, buildId = '') {
  const build = (await db.query(`SELECT * FROM knowledge_builds WHERE tenant_key=$1 AND ($2='' OR build_id=$2) ORDER BY created_at DESC LIMIT 1`, [tenantKey, buildId])).rows[0];
  const policy = (await db.query('SELECT * FROM knowledge_governance_policies WHERE tenant_key=$1', [tenantKey])).rows[0] || { review_mode: 'single_admin', revision: 0 };
  const blockers = [];
  if (!build) return { status: 'not_started', blockers: ['knowledge_build_required'], warnings: [] };
  const qa = build.validation_summary_json || {};
  blockers.push(...(qa.blockers || []));
  if (!['ready_to_publish', 'published', 'superseded'].includes(build.status)) blockers.push('build_not_ready_to_publish');
  if (qa.content_qa?.version !== 'content_qa_v1') blockers.push('content_qa_required');
  blockers.push(...(qa.content_qa?.blockers || []));
  const intent = (await db.query("SELECT * FROM business_call_intents WHERE tenant_key=$1 AND status IN ('approved','approved_live') ORDER BY updated_at DESC LIMIT 1", [tenantKey])).rows[0];
  if (!intent) blockers.push('business_call_intent_required');
  else {
    if (!intent.conversation_stage_playbook_json?.length) blockers.push('stage_playbook_required');
    if (!Object.keys(intent.disclosure_strategy_json || {}).length) blockers.push('disclosure_strategy_required');
    if (!intent.preferred_outcomes_json?.length) blockers.push('preferred_outcomes_required');
    if (!Object.keys(intent.after_hours_strategy_json || {}).length) blockers.push('after_hours_strategy_required');
  }
  if (policy.review_mode === 'reviewed' && !knownBuildCreator(build)) blockers.push('knowledge_build_creator_required');
  if (!build.domain_assignments_json?.length) blockers.push('domain_assignment_required');
  if (!build.source_channels_json?.length) blockers.push('approved_source_coverage_required');
  const pending = await db.query("SELECT change_id FROM knowledge_change_requests WHERE tenant_key=$1 AND status='draft' LIMIT 1", [tenantKey]);
  if (pending.rows.length) blockers.push('configuration_review_pending');
  const review = (await db.query('SELECT * FROM knowledge_readiness_reviews WHERE tenant_key=$1 AND build_id=$2', [tenantKey, build.build_id])).rows[0];
  if (!review || Number(review.config_revision) !== Number(policy.revision)) blockers.push('current_readiness_review_required');
  for (const check of READINESS_CHECKS) if (review?.checklist_json?.[check] !== true) blockers.push(check);
  return { status: blockers.length ? 'blocked' : build.status === 'published' ? 'live' : 'ready_for_go_live', build_id: build.build_id, blockers: [...new Set(blockers)], warnings: [...(qa.warnings || []), ...(qa.content_qa?.warnings || [])], review: review || null, policy };
}
export async function saveKnowledgeReadinessReview(db, tenantKey, { build_id: buildId, checklist = {}, evidence_note: note }, actor) {
  if (!text(note)) throw new Error('knowledge_readiness_evidence_required');
  return governanceTransaction(db, async client => {
    const reviewer = await assertKnowledgeReviewer(client, tenantKey, actor);
    const policy = await lockPolicy(client, tenantKey);
    const build = (await client.query('SELECT build_id,created_by_type,created_by_id FROM knowledge_builds WHERE tenant_key=$1 AND build_id=$2 FOR UPDATE', [tenantKey, buildId])).rows[0];
    if (!build) throw new Error('build_not_found');
    if (policy.review_mode === 'reviewed') assertDistinctBuildReviewer(build, reviewer);
    const safeChecklist = Object.fromEntries(READINESS_CHECKS.map(check => [check, checklist[check] === true]));
    await client.query(`INSERT INTO knowledge_readiness_reviews (tenant_key,build_id,config_revision,checklist_json,evidence_note,reviewed_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT (tenant_key,build_id) DO UPDATE SET config_revision=EXCLUDED.config_revision, checklist_json=EXCLUDED.checklist_json,evidence_note=EXCLUDED.evidence_note,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=NOW()`, [tenantKey, buildId, policy.revision, JSON.stringify(safeChecklist), text(note), reviewer]);
    await audit(client, tenantKey, reviewer, 'readiness_reviewed', { build_id: buildId, checklist: safeChecklist, evidence_note: text(note) });
    return loadKnowledgeReadiness(client, tenantKey, buildId);
  });
}
export async function assertKnowledgePublishAllowed(db, tenantKey, buildId, { actor, automatic = false, recordAudit = true } = {}) {
  if (automatic || !actor) throw new Error('knowledge_explicit_publication_required');
  const reviewer = await assertKnowledgeReviewer(db, tenantKey, actor);
  const policy = await lockPolicy(db, tenantKey);
  const readiness = await loadKnowledgeReadiness(db, tenantKey, buildId);
  if (readiness.blockers.length) { const error = new Error('knowledge_readiness_blocked'); error.blockers = readiness.blockers; throw error; }
  const build = (await db.query('SELECT created_by_type,created_by_id FROM knowledge_builds WHERE tenant_key=$1 AND build_id=$2', [tenantKey, buildId])).rows[0];
  if (policy.review_mode === 'reviewed') assertDistinctBuildReviewer(build, reviewer);
  if (recordAudit) await audit(db, tenantKey, reviewer, 'publication_approved', { build_id: buildId, readiness_reviewed_by: readiness.review.reviewed_by });
  return readiness;
}

// Resume a reviewed owner-confirmation workflow only for the exact approved
// payload and still-current configuration. Approval never authorizes new text.
export async function findCurrentApprovedKnowledgeChange(db, tenantKey, kind, payload, actor) {
  const requester = await assertKnowledgeReviewer(db, tenantKey, actor);
  return (await db.query(`SELECT c.change_id FROM knowledge_change_requests c
    JOIN knowledge_governance_policies p ON p.tenant_key=c.tenant_key
    WHERE c.tenant_key=$1 AND c.kind=$2 AND c.payload_json=$3::jsonb AND c.requested_by=$4
      AND c.status='approved_live' AND p.revision=c.base_revision+1 LIMIT 1`,
    [tenantKey, kind, JSON.stringify(payload), requester])).rows[0] || null;
}
