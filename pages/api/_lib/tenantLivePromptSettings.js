import crypto from 'node:crypto';

const TRADE_DEFAULTS = [
  [/paint/i, ['an estimator', 'walk through the project with you and put together a written estimate']],
  [/plumb/i, ['one of our plumbers', "take a look at what's going on and tell you what it'll take to fix it"]],
  [/hvac|heating|air condition/i, ['a technician', 'look at your system and walk you through your options']],
  [/electric/i, ['an electrician', 'check it out and tell you what needs to happen']],
  [/roof/i, ['an estimator', 'inspect the roof and give you a written estimate']],
  [/general contract/i, ['our project manager', 'go over the project with you in detail']]
];

const normalize = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const fieldSafe = (value) => {
  const text = normalize(value);
  return text.length > 0 && text.length <= 160 && !/[\r\n{}<>]/.test(String(value ?? ''))
    && !/\b(?:ignore|disregard|override)\b.{0,40}\b(?:instructions?|rules?|policy)\b/i.test(text)
    && !/\b(?:system|developer)\s+(?:prompt|message|instructions?)\b/i.test(text);
};
const confirmationHash = (role, does) => crypto.createHash('sha256')
  .update(JSON.stringify([role, does, 'v20.1'])).digest('hex');

export function suggestCallbackRole(industry) {
  const match = TRADE_DEFAULTS.find(([pattern]) => pattern.test(normalize(industry)));
  return match ? { callback_role: match[1][0], callback_role_does: match[1][1] } : {
    callback_role: '', callback_role_does: ''
  };
}

export function hasConfirmedCallbackRole(row) {
  return fieldSafe(row?.callback_role) && fieldSafe(row?.callback_role_does)
    && row.callback_role === row.confirmed_role && row.callback_role_does === row.confirmed_role_does
    && Boolean(row.confirmed_by && row.confirmed_at)
    && row.confirmed_hash === confirmationHash(row.callback_role, row.callback_role_does);
}

export function isConfirmedLivePromptSettings(row) {
  return row?.mode === 'v20_1' && hasConfirmedCallbackRole(row);
}

export async function loadTenantLivePromptSettings(db, tenantKey) {
  const result = await db.query(
    `SELECT tenant_key, mode, callback_role, callback_role_does, confirmed_role,
            confirmed_role_does, confirmed_by, confirmed_at, confirmed_hash,
            revision, updated_at
       FROM tenant_live_prompt_settings WHERE tenant_key = $1 LIMIT 1`,
    [tenantKey]
  );
  return result.rows?.[0] || null;
}

export async function loadTenantLivePromptEditorState(db, tenantKey) {
  const [settings, tenant] = await Promise.all([
    loadTenantLivePromptSettings(db, tenantKey),
    db.query('SELECT industry FROM tenants WHERE tenant_key = $1 LIMIT 1', [tenantKey])
  ]);
  const suggestions = suggestCallbackRole(tenant.rows?.[0]?.industry);
  return {
    mode: settings?.mode || 'legacy',
    callback_role: settings?.callback_role || suggestions.callback_role,
    callback_role_does: settings?.callback_role_does || suggestions.callback_role_does,
    confirmed: hasConfirmedCallbackRole(settings),
    confirmed_at: settings?.confirmed_at || null,
    revision: Number(settings?.revision || 0),
    defaulted: !settings?.callback_role || !settings?.callback_role_does
  };
}

/** Invoke inside the active-build publication transaction, after its pointer swap. */
export async function maybeActivateTenantLivePrompt(db, tenantKey) {
  const settings = await loadTenantLivePromptSettings(db, tenantKey);
  if (!hasConfirmedCallbackRole(settings)) return false;
  const activeBrief = await db.query(
    `SELECT b.block_text FROM live_brief_blocks b JOIN tenant_active_knowledge_builds a
       ON a.tenant_key = b.tenant_key AND a.active_build_id = b.build_id
     WHERE b.tenant_key = $1 LIMIT 1`, [tenantKey]
  );
  if (!activeBrief.rows?.[0]) return false;
  await db.query("UPDATE tenant_live_prompt_settings SET mode = 'v20_1', updated_at = NOW() WHERE tenant_key = $1", [tenantKey]);
  await db.query("UPDATE tenants SET live_prompt_mode = 'v20_1' WHERE tenant_key = $1", [tenantKey]);
  return true;
}

export async function saveTenantLivePromptSettings(db, tenantKey, values, actor) {
  const role = normalize(values?.callback_role);
  const does = normalize(values?.callback_role_does);
  const confirm = values?.confirm === true;
  const expectedRevision = Number(values?.expected_revision);
  if (!fieldSafe(role) || !fieldSafe(does)) throw new Error('invalid_callback_role');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('invalid_revision');
  if (!actor) throw new Error('missing_confirmation_actor');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query('SELECT live_prompt_mode FROM tenants WHERE tenant_key = $1 FOR UPDATE', [tenantKey]);
    if (!tenant.rows?.[0]) throw new Error('tenant_not_found');
    const previousMode = tenant.rows[0].live_prompt_mode || 'legacy';
    await client.query(
      `INSERT INTO tenant_live_prompt_settings (tenant_key, mode)
       VALUES ($1, 'pending_v20') ON CONFLICT (tenant_key) DO NOTHING`, [tenantKey]
    );
    const current = await client.query(
      'SELECT revision FROM tenant_live_prompt_settings WHERE tenant_key = $1 FOR UPDATE', [tenantKey]
    );
    if (Number(current.rows?.[0]?.revision) !== expectedRevision) throw new Error('stale_live_prompt_settings');
    const activeBrief = await client.query(
      `SELECT 1 FROM live_brief_blocks b JOIN tenant_active_knowledge_builds a
         ON a.tenant_key = b.tenant_key AND a.active_build_id = b.build_id
       WHERE b.tenant_key = $1 LIMIT 1`, [tenantKey]
    );
    const nextMode = confirm && activeBrief.rows?.length ? 'v20_1'
      : previousMode === 'legacy' ? 'legacy' : 'pending_v20';
    const next = await client.query(
      `UPDATE tenant_live_prompt_settings SET
         mode = $2, callback_role = $3, callback_role_does = $4,
         confirmed_role = $5, confirmed_role_does = $6,
         confirmed_by = $7, confirmed_at = CASE WHEN $8 THEN NOW() ELSE NULL END,
         confirmed_hash = $9, revision = revision + 1, updated_at = NOW()
       WHERE tenant_key = $1
       RETURNING tenant_key, mode, callback_role, callback_role_does, confirmed_role,
                 confirmed_role_does, confirmed_by, confirmed_at, confirmed_hash,
                 revision, updated_at`,
      [tenantKey, nextMode, role, does,
        confirm ? role : null, confirm ? does : null,
        confirm ? String(actor) : null, confirm, confirm ? confirmationHash(role, does) : null]
    );
    await client.query(
      'UPDATE tenants SET live_prompt_mode = $2 WHERE tenant_key = $1',
      [tenantKey, nextMode]
    );
    await client.query(
      `INSERT INTO audit_log (tenant_key, actor, action, details)
       VALUES ($1, $2, $3, $4)`,
      [tenantKey, String(actor), confirm ? 'tenant.live_prompt.confirmed' : 'tenant.live_prompt.edited',
        JSON.stringify({ revision: next.rows[0].revision, mode: next.rows[0].mode })]
    );
    await client.query('COMMIT');
    return next.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
