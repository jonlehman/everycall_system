import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { bootstrapFixtureSchema } from './lib/schema-migrations.mjs';
import handler from '../pages/api/v1/admin/users.js';
import adminLogin from '../pages/api/v1/auth/login.js';
import salesLogin from '../pages/api/v1/sales/auth/login.js';
import resetPassword from '../pages/api/v1/auth/reset.js';
import { issuePlatformPasswordReset } from '../pages/api/_lib/authTokens.js';
import { createSession } from '../pages/api/_lib/auth.js';

const nativeUrl = process.env.ADMIN_USERS_TEST_DATABASE_URL;
if (nativeUrl && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(nativeUrl).hostname)) throw Error('Loopback disposable database required');
const schema = `admin_user_edit_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const database = nativeUrl ? null : new PGlite();
const rootPool = nativeUrl ? new pg.Pool({ connectionString: nativeUrl }) : null;
if (rootPool) await rootPool.query(`CREATE SCHEMA ${schema}`);
const nativePool = nativeUrl ? new pg.Pool({ connectionString: nativeUrl, options: `-c search_path=${schema}`, max: 12 }) : null;
const query = async (sql, params = []) => {
  const result = nativePool ? await nativePool.query(sql, params) : await database.query(sql, params);
  return { ...result, rowCount: result.rowCount ?? (result.rows?.length || Number(result.affectedRows) || 0) };
};
const pool = nativePool || { query, connect: async () => ({ query, release() {} }) };
globalThis.__everycallPool = pool;
process.env.DATABASE_URL = nativeUrl || 'postgres://admin-user-edit-fixture';
delete process.env.ADMIN_BOOTSTRAP_EMAIL;
delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
const req = (cookie, method = 'PATCH', body = {}) => ({ method, body, headers: { cookie }, socket: { remoteAddress: '127.0.0.1' } });
async function call(fn, request) {
  const res = { statusCode: 200, body: null, headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, getHeader(key) { return this.headers[key.toLowerCase()]; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await fn(request, res); return res;
}
const cookie = id => `everycall_session=${id}`;
const hash = await bcrypt.hash('correct-horse-battery', 4);
async function account(name, role = 'admin', passwordHash = hash) {
  return (await query(`INSERT INTO admin_users (username,email,role,password_hash) VALUES ($1,$2,$3,$4) RETURNING *`, [name, `${name}@example.test`, role, passwordHash])).rows[0];
}
async function session(user, id = `session-${user.id}-${Math.random()}`, role = 'admin', tenant = null) {
  await query(`INSERT INTO sessions (id,user_id,role,tenant_key,expires_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day')`, [id, user.id, role, tenant]); return cookie(id);
}
const edit = (user, values = {}) => ({ id: user.id, username: user.username, email: user.email, role: user.role, password: '', ...values });
async function check(status, body, auth, method = 'PATCH') {
  const result = await call(handler, req(auth, method, body)); assert.equal(result.statusCode, status, JSON.stringify(result.body)); return result;
}
const row = async id => (await query('SELECT * FROM admin_users WHERE id=$1', [id])).rows[0];
try {
  if (nativePool) {
    const client = await nativePool.connect();
    try { await bootstrapFixtureSchema(client); } finally { client.release(); }
  } else await bootstrapFixtureSchema(pool, { executeSql: sql => database.exec(sql) });
  process.env.ADMIN_BOOTSTRAP_EMAIL = 'bootstrap@example.test';
  process.env.ADMIN_BOOTSTRAP_PASSWORD = 'bootstrap-fixture-password';
  const bootstrap = await call(adminLogin, req('', 'POST', { email: process.env.ADMIN_BOOTSTRAP_EMAIL, password: process.env.ADMIN_BOOTSTRAP_PASSWORD, role: 'admin' }));
  assert.equal(bootstrap.statusCode, 200);
  assert.ok(JSON.stringify(bootstrap.headers['set-cookie']).includes('everycall_session='));
  await query("DELETE FROM sessions WHERE role='admin'");
  await query("DELETE FROM admin_users WHERE email='bootstrap@example.test'");
  delete process.env.ADMIN_BOOTSTRAP_EMAIL; delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const owner = await account('owner'); const other = await account('other'); const seller = await account('seller', 'sales');
  let ownerAuth = await session(owner); const otherAuth = await session(other);
  await query(`INSERT INTO sales_operator_settings (admin_user_id,display_name,telnyx_telephony_credential_id,caller_id_number,active) VALUES ($1,'Custom Rep','fixture-credential','+12065550101',FALSE)`, [seller.id]);
  // Real foreign keys: history and ownership remain bound to the immutable account.
  await query(`INSERT INTO sales_prospects (prospect_id,source_key,business_name,phone_e164,assigned_rep_user_id) VALUES ('edit-prospect','edit-source','Fixture Business','+12065550102',$1)`, [seller.id]);
  await query(`INSERT INTO sales_call_sessions (sales_call_id,prospect_id,admin_user_id,state) VALUES ('edit-call','edit-prospect',$1,'ended')`, [seller.id]);
  const settingsBefore = (await query('SELECT * FROM sales_operator_settings WHERE admin_user_id=$1', [seller.id])).rows[0];
  const sellerSession = await session(seller, 'old-sales', 'sales');
  await session(seller, 'old-admin');
  await session(seller, 'unrelated-tenant', 'tenant', 'default');
  await query(`INSERT INTO auth_tokens (token,token_type,user_id,email,expires_at) VALUES ('reset-fixture','password_reset',$1,$2,NOW()+INTERVAL '1 day')`, [seller.id, seller.email]);
  await query(`INSERT INTO auth_tokens (token,token_type,user_id,email,expires_at) VALUES ('legacy-tenant-reset','password_reset',$1,'legacy-tenant@example.test',NOW()+INTERVAL '1 day')`, [seller.id]);
  let result = await check(200, edit(seller, { username: 'renamed', email: 'renamed@example.test' }), ownerAuth);
  assert.equal(String(result.body.user.id), String(seller.id));
  assert.equal((await row(seller.id)).password_hash, hash);
  assert.equal((await query(`SELECT count(*)::int n FROM sessions WHERE user_id=$1 AND role IN ('admin','sales')`, [seller.id])).rows[0].n, 0);
  assert.equal((await query(`SELECT count(*)::int n FROM sessions WHERE id='unrelated-tenant'`)).rows[0].n, 1);
  assert.equal((await query("SELECT count(*)::int n FROM auth_tokens WHERE user_id=$1 AND token='reset-fixture'", [seller.id])).rows[0].n, 0);
  assert.equal((await query("SELECT count(*)::int n FROM auth_tokens WHERE token='legacy-tenant-reset'")).rows[0].n, 1);
  assert.deepEqual((await query('SELECT * FROM sales_operator_settings WHERE admin_user_id=$1', [seller.id])).rows[0], settingsBefore);
  assert.equal(String((await query("SELECT assigned_rep_user_id FROM sales_prospects WHERE prospect_id='edit-prospect'")).rows[0].assigned_rep_user_id), String(seller.id));
  assert.equal(String((await query("SELECT admin_user_id FROM sales_call_sessions WHERE sales_call_id='edit-call'")).rows[0].admin_user_id), String(seller.id));
  const renamed = await row(seller.id);
  result = await check(200, edit(renamed, { role: 'super_admin', password: 'updated-password-123' }), ownerAuth);
  assert.ok(await bcrypt.compare('updated-password-123', (await row(seller.id)).password_hash));
  assert.equal((await query('SELECT active FROM sales_operator_settings WHERE admin_user_id=$1', [seller.id])).rows[0].active, false);
  assert.equal((await call(adminLogin, req('', 'POST', { email: renamed.email, password: 'correct-horse-battery', role: 'admin' }))).statusCode, 401);
  assert.equal((await call(adminLogin, req('', 'POST', { email: renamed.email, password: 'updated-password-123', role: 'admin' }))).statusCode, 200);
  await check(200, edit(await row(seller.id), { role: 'sales' }), ownerAuth);
  assert.equal((await call(salesLogin, req('', 'POST', { email: renamed.email, password: 'updated-password-123' }))).statusCode, 401);
  const noSettings = await account('new-rep');
  await check(200, edit(noSettings, { role: 'sales' }), ownerAuth);
  assert.equal((await query('SELECT active FROM sales_operator_settings WHERE admin_user_id=$1', [noSettings.id])).rows[0].active, true);
  assert.equal((await call(salesLogin, req('', 'POST', { email: noSettings.email, password: 'correct-horse-battery' }))).statusCode, 200);
  assert.equal((await call(adminLogin, req('', 'POST', { email: noSettings.email, password: 'correct-horse-battery', role: 'admin' }))).statusCode, 401);
  const beforeInvalid = await row(seller.id);
  for (const [body, status, error] of [
    [edit(beforeInvalid, { email: owner.email, password: 'must-not-change' }), 409, 'email_in_use'],
    [edit(beforeInvalid, { username: owner.username.toUpperCase() }), 409, 'username_in_use'],
    [edit(beforeInvalid, { email: owner.email.toUpperCase() }), 409, 'email_in_use'],
    [edit(beforeInvalid, { id: '9223372036854775808' }), 400, 'invalid_user_id'],
    [edit(beforeInvalid, { id: '99999999' }), 404, 'user_not_found'],
    [edit(beforeInvalid, { id: '-1' }), 400, 'invalid_user_id'],
    [edit(beforeInvalid, { password_hash: hash }), 400, 'unexpected_fields'],
    [edit(beforeInvalid, { password: 'short' }), 400, 'password_too_short'],
    [edit(beforeInvalid, { password: 'é'.repeat(40) }), 400, 'password_too_long'],
    [edit(beforeInvalid, { username: '' }), 400, 'missing_fields'],
    [edit(beforeInvalid, { email: 'invalid' }), 400, 'invalid_email'],
    [edit(beforeInvalid, { role: 'owner' }), 400, 'invalid_role'],
    [edit(beforeInvalid, { email: {} }), 400, 'invalid_fields']
  ]) { result = await check(status, body, ownerAuth); assert.equal(result.body.error, error); }
  assert.deepEqual(await row(seller.id), beforeInvalid);
  await check(401, edit(other), sellerSession);
  await check(401, edit(other), 'everycall_sales_session=old-sales');
  const activeSales = await session(noSettings, 'sales-copy', 'sales');
  await check(401, edit(other), activeSales);
  await check(403, edit(other), cookie('unrelated-tenant'));
  await check(401, edit(other), await session(owner, 'tenant-bound-admin', 'admin', 'default'));
  result = await check(200, edit(owner, { username: 'Owner Renamed' }), ownerAuth);
  assert.equal(result.body.reauthenticate, false);
  result = await check(200, edit(await row(owner.id), { email: 'owner-renamed@example.test' }), ownerAuth);
  assert.equal(result.body.reauthenticate, true); assert.ok(JSON.stringify(result.headers['set-cookie']).includes('Max-Age=0'));
  await check(401, edit(other), ownerAuth); ownerAuth = await session(await row(owner.id));
  // Rollback includes credential changes, revocation, operator creation and audit.
  const rollbackUser = await account('rollback'); const rollbackSession = await session(rollbackUser, 'rollback-session');
  await query(`CREATE FUNCTION fail_edit_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='admin.user.updated' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`);
  await query(`CREATE TRIGGER fail_edit_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_edit_audit()`);
  await check(500, edit(rollbackUser, { email: 'rollback-new@example.test', role: 'sales', password: 'rollback-password' }), ownerAuth);
  assert.deepEqual(await row(rollbackUser.id), rollbackUser);
  assert.equal((await query('SELECT count(*)::int n FROM sales_operator_settings WHERE admin_user_id=$1', [rollbackUser.id])).rows[0].n, 0);
  await check(200, {}, rollbackSession, 'GET');
  await query('DROP TRIGGER fail_edit_audit ON audit_log');
  await query('DROP FUNCTION fail_edit_audit()');
  // Existing create/reset callers keep their supported semantics.
  await check(200, { username: 'created', email: 'created@example.test', role: 'sales', password: 'created-password' }, ownerAuth, 'POST');
  const created = (await query("SELECT * FROM admin_users WHERE email='created@example.test'")).rows[0];
  await check(200, { username: 'created-renamed', email: 'created@example.test', role: 'sales', password: 'reset-password' }, ownerAuth, 'POST');
  assert.equal(String((await query("SELECT id FROM admin_users WHERE email='created@example.test'")).rows[0].id), String(created.id));
  // Unscoped legacy tokens cannot guess between independent principal ID spaces.
  const resetUser = await account('reset-owner');
  await query(`INSERT INTO tenant_users (id,tenant_key,name,email,password_hash) VALUES ($1,'fixture-tenant','Fixture Tenant',$2,$3)`, [resetUser.id, resetUser.email, hash]);
  await query(`INSERT INTO auth_tokens (token,token_type,user_id,email,expires_at) VALUES ('ambiguous-reset','password_reset',$1,$2,NOW()+INTERVAL '1 day')`, [resetUser.id, resetUser.email]);
  assert.equal((await call(resetPassword, req('', 'POST', { token: 'ambiguous-reset', password: 'ambiguous-password' }))).statusCode, 400);
  assert.equal((await row(resetUser.id)).password_hash, hash);
  assert.equal((await query('SELECT password_hash FROM tenant_users WHERE id=$1', [resetUser.id])).rows[0].password_hash, hash);
  assert.equal(await issuePlatformPasswordReset(pool, resetUser, new Date(Date.now()+60000)), null);
  await query(`UPDATE tenant_users SET email='different-tenant@example.test' WHERE id=$1`, [resetUser.id]);
  await query(`INSERT INTO auth_tokens (token,token_type,user_id,email,expires_at) VALUES ('unrelated-reset','password_reset',$1,'different-tenant@example.test',NOW()+INTERVAL '1 day')`, [resetUser.id]);
  const platformToken = await issuePlatformPasswordReset(pool, resetUser, new Date(Date.now()+60000));
  assert.ok(platformToken);
  assert.equal((await call(resetPassword, req('', 'POST', { token: platformToken, password: 'platform-reset-password' }))).statusCode, 200);
  assert.ok(await bcrypt.compare('platform-reset-password', (await row(resetUser.id)).password_hash));
  assert.equal((await query('SELECT password_hash FROM tenant_users WHERE id=$1', [resetUser.id])).rows[0].password_hash, hash);
  assert.equal((await query(`SELECT count(*)::int n FROM auth_tokens WHERE token='unrelated-reset'`)).rows[0].n, 1);
  assert.equal((await call(resetPassword, req('', 'POST', { token: 'unrelated-reset', password: 'legacy-tenant-password' }))).statusCode, 200);
  assert.ok(await bcrypt.compare('legacy-tenant-password', (await query('SELECT password_hash FROM tenant_users WHERE id=$1', [resetUser.id])).rows[0].password_hash));
  assert.ok(await bcrypt.compare('platform-reset-password', (await row(resetUser.id)).password_hash));
  await query(`INSERT INTO auth_tokens (token,token_type,user_id,email,tenant_key,expires_at) VALUES ('scoped-tenant-reset','password_reset',$1,'different-tenant@example.test','fixture-tenant',NOW()+INTERVAL '1 day')`, [resetUser.id]);
  assert.equal((await call(resetPassword, req('', 'POST', { token: 'scoped-tenant-reset', password: 'scoped-tenant-password' }))).statusCode, 200);
  assert.equal((await call(adminLogin, req('', 'POST', { email: 'different-tenant@example.test', password: 'scoped-tenant-password', role: 'client' }))).statusCode, 200);
  assert.ok(await bcrypt.compare('platform-reset-password', (await row(resetUser.id)).password_hash));
  // Last-admin safety includes the legacy reset endpoint and unusable admin rows.
  await query(`UPDATE admin_users SET role='sales' WHERE id <> $1`, [owner.id]);
  await account('unusable', 'super_admin', null);
  result = await check(409, edit(await row(owner.id), { role: 'sales' }), ownerAuth); assert.equal(result.body.error, 'last_admin_required');
  const postBody = edit(await row(owner.id), { role: 'sales', password: 'reset-password' }); delete postBody.id;
  assert.equal((await check(409, postBody, ownerAuth, 'POST')).body.error, 'last_admin_required');
  // A session may only be issued for the credential snapshot actually checked.
  assert.equal(await createSession({ userId: seller.id, role: 'sales', expectedUser: seller }), null);
  const audit = (await query("SELECT details FROM audit_log WHERE action IN ('admin.user.updated','admin.user.saved')")).rows;
  assert.ok(audit.length > 0);
  for (const entry of audit) assert.ok(!/password_hash|@example|correct-horse|updated-password|session-/.test(JSON.stringify(entry)));
  if (nativePool) {
    const second = await account('concurrent'); const firstUser = await row(owner.id);
    const secondAuth = await session(second);
    const blocker = await nativePool.connect();
    await blocker.query('BEGIN'); await blocker.query('SELECT pg_advisory_xact_lock(200704, 1)');
    const a = call(handler, req(ownerAuth, 'PATCH', edit(firstUser, { role: 'sales' })));
    const b = call(handler, req(secondAuth, 'PATCH', edit(second, { role: 'sales' })));
    // Verify both independent connections really overlap at the mutation lock.
    async function waitBlocked(count, waitEvent = 'advisory') {
      for (let i = 0; i < 100; i++) {
        const waiting = await nativePool.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event=$1 AND pid<>pg_backend_pid()`, [waitEvent]);
        if (waiting.rows[0].n >= count) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw Error('Expected overlapping blocked transactions');
    }
    await waitBlocked(2); await blocker.query('COMMIT'); blocker.release();
    const outcomes = await Promise.all([a, b]); assert.deepEqual(outcomes.map(r => r.statusCode).sort(), [200, 409]);
    assert.equal((await query(`SELECT count(*)::int n FROM admin_users WHERE role IN ('admin','super_admin') AND password_hash IS NOT NULL`)).rows[0].n, 1);
    const survivor = (await query(`SELECT * FROM admin_users WHERE role IN ('admin','super_admin') AND password_hash IS NOT NULL`)).rows[0];
    const survivorAuth = await session(survivor);
    const guard = await nativePool.connect(); await guard.query('BEGIN'); await guard.query('SELECT pg_advisory_xact_lock(200704, 1)');
    const staleActor = call(handler, req(survivorAuth, 'PATCH', edit(await row(seller.id), { username: 'stale-mutation' })));
    await waitBlocked(1);
    await guard.query('DELETE FROM sessions WHERE user_id=$1 AND role=\'admin\'', [survivor.id]);
    await guard.query('COMMIT'); guard.release(); assert.equal((await staleActor).statusCode, 401);
    assert.notEqual((await row(seller.id)).username, 'stale-mutation');
    const loginGuard = await nativePool.connect(); await loginGuard.query('BEGIN');
    await loginGuard.query('SELECT id FROM admin_users WHERE id=$1 FOR UPDATE', [survivor.id]);
    const staleLogin = createSession({ userId: survivor.id, role: 'admin', expectedUser: survivor });
    await waitBlocked(1, 'transactionid');
    await loginGuard.query('UPDATE admin_users SET password_hash=$2 WHERE id=$1', [survivor.id, await bcrypt.hash('new-concurrent-password', 4)]);
    await loginGuard.query('COMMIT'); loginGuard.release(); assert.equal(await staleLogin, null);
    const issuanceSnapshot = await row(survivor.id);
    const issuanceGuard = await nativePool.connect(); await issuanceGuard.query('BEGIN'); await issuanceGuard.query('SELECT pg_advisory_xact_lock(200704, 1)');
    const issuance = issuePlatformPasswordReset(pool, issuanceSnapshot, new Date(Date.now()+60000));
    await waitBlocked(1);
    await issuanceGuard.query('UPDATE admin_users SET password_hash=$2 WHERE id=$1', [survivor.id, await bcrypt.hash('post-issuance-password', 4)]);
    await issuanceGuard.query('COMMIT'); issuanceGuard.release(); assert.equal(await issuance, null);
    assert.equal((await query(`SELECT count(*)::int n FROM auth_tokens WHERE user_id=$1 AND email=$2 AND tenant_key IS NULL`, [survivor.id, issuanceSnapshot.email])).rows[0].n, 0);
    // A reset already read its token while hashing, then waits behind an edit.
    const fresh = await row(survivor.id); const freshAuth = await session(fresh);
    await query(`INSERT INTO auth_tokens (token,token_type,user_id,email,expires_at) VALUES ('concurrent-reset','password_reset',$1,$2,NOW()+INTERVAL '1 day')`, [fresh.id, fresh.email]);
    const resetGuard = await nativePool.connect(); await resetGuard.query('BEGIN'); await resetGuard.query('SELECT pg_advisory_xact_lock(200704, 1)');
    const reset = call(resetPassword, req('', 'POST', { token: 'concurrent-reset', password: 'stale-reset-password' }));
    await waitBlocked(1);
    await resetGuard.query('DELETE FROM auth_tokens WHERE user_id=$1 AND tenant_key IS NULL', [fresh.id]);
    await resetGuard.query('COMMIT'); resetGuard.release(); assert.equal((await reset).statusCode, 400);
    assert.equal((await row(fresh.id)).password_hash, fresh.password_hash);
    await check(200, {}, freshAuth, 'GET');
  }
  console.log(`Admin user edit regression passed (${nativePool ? 'PostgreSQL with overlapping transactions' : 'PGlite; concurrency requires ADMIN_USERS_TEST_DATABASE_URL'}).`);
} finally {
  delete globalThis.__everycallPool;
  if (nativePool) { await nativePool.end(); await rootPool.query(`DROP SCHEMA ${schema} CASCADE`); await rootPool.end(); }
  if (database) await database.close();
}
