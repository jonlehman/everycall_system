import { getPool } from '../../_lib/db.js';
import { requireSession, resolveTenantKey } from '../../_lib/auth.js';
import { requireTenantBillingAccess, requireTenantRoles } from '../../_lib/billing.js';
import { loadKnowledgeReadiness, saveKnowledgeReadinessReview } from '../../_lib/knowledgeGovernance.js';
export default async function handler(req, res) {
  try {
    if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
    const db = getPool();
    if (!db) return res.status(503).json({ error: 'database_unavailable' });
    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, String(req.query?.tenantKey || req.body?.tenantKey || ''));
    if (!await requireTenantBillingAccess(res, db, session, tenantKey)) return;
    if (!await requireTenantRoles(res, session, ['owner', 'admin'])) return;
    const readiness = req.method === 'GET'
      ? await loadKnowledgeReadiness(db, tenantKey, String(req.query?.buildId || ''))
      : await saveKnowledgeReadinessReview(db, tenantKey, req.body || {}, session);
    return res.status(200).json({ ok: true, readiness });
  } catch (error) {
    const message = String(error?.message || 'unknown');
    const status = error.code === '42P01' ? 503 : message.includes('forbidden') ? 403 : message.includes('not_found') ? 404 : message.startsWith('knowledge_') ? 409 : 500;
    return res.status(status).json({ ok: false, error: error.code === '42P01' ? 'knowledge_governance_migrations_required' : message });
  }
}
