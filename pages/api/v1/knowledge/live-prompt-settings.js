import { getPool } from '../../_lib/db.js';
import { requireSession, resolveTenantKey } from '../../_lib/auth.js';
import { requireTenantBillingAccess, requireTenantRoles } from '../../_lib/billing.js';
import {
  loadTenantLivePromptEditorState,
  saveTenantLivePromptSettings
} from '../../_lib/tenantLivePromptSettings.js';

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
    if (req.method === 'POST') {
      if (!await requireTenantRoles(res, session, ['owner', 'admin'], {
        message: 'Only account admins and owners can confirm the callback role.'
      })) return;
      const body = typeof req.body === 'object' && req.body ? req.body : {};
      await saveTenantLivePromptSettings(pool, tenantKey, body, session.userId || session.user_id || session.email);
    }
    const state = await loadTenantLivePromptEditorState(pool, tenantKey);
    return res.status(200).json({ ok: true, ...state });
  } catch (error) {
    const code = String(error?.message || 'live_prompt_settings_error');
    if (code === 'stale_live_prompt_settings') return fail(res, 409, code);
    if (code === 'invalid_callback_role' || code === 'invalid_revision') return fail(res, 400, code);
    return fail(res, 500, 'live_prompt_settings_error');
  }
}
