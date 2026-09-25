import { getPool } from '../../_lib/db.js';
import { requireSession, resolveTenantKey } from '../../_lib/auth.js';
import { requireTenantBillingAccess, requireTenantRoles } from '../../_lib/billing.js';
import { acceptLiveBriefProposal, loadLiveBriefBlock, saveLiveBriefSlot } from '../../_lib/liveBriefCuration.js';

const fail = (res, status, error) => res.status(status).json({ ok: false, error });

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return fail(res, 405, 'method_not_allowed');
  }
  try {
    const pool = getPool();
    if (!pool) return fail(res, 500, 'database_unavailable');
    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, String(req.query?.tenantKey || req.body?.tenantKey || ''));
    if (!await requireTenantBillingAccess(res, pool, session, tenantKey)) return;
    let brief;
    if (req.method === 'POST') {
      if (!await requireTenantRoles(res, session, ['owner', 'admin'], {
        message: 'Only account admins and owners can change the live brief.'
      })) return;
      const body = typeof req.body === 'object' && req.body ? req.body : {};
      const options = {
        tenantKey,
        slot: body.slot,
        text: body.text,
        expectedRevision: Number(body.expected_revision),
        actor: session.userId || session.user_id || session.email,
        priceAuthorization: body.price_authorization
      };
      brief = body.action === 'accept_proposal'
        ? await acceptLiveBriefProposal(pool, options)
        : body.action === 'edit' ? await saveLiveBriefSlot(pool, options) : null;
      if (!brief) return fail(res, 400, 'unknown_action');
    } else {
      brief = await loadLiveBriefBlock(pool, tenantKey);
    }
    return res.status(200).json({ ok: true, brief });
  } catch (error) {
    const code = String(error?.message || 'live_brief_error');
    if (code === 'live_brief_revision_conflict') return fail(res, 409, code);
    if (code === 'live_brief_active_block_required') return fail(res, 409, code);
    if (code.startsWith('live_brief_')) return fail(res, 400, code);
    return fail(res, 500, 'live_brief_error');
  }
}
