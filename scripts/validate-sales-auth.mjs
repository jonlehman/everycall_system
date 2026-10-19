import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import bcrypt from 'bcryptjs';
import { PGlite } from '@electric-sql/pglite';
import { ensureTables } from '../pages/api/_lib/db.js';
import { getSalesSession, getSession } from '../pages/api/_lib/auth.js';
import { requireSalesAdmin } from '../pages/api/_lib/salesApi.js';
import adminLogin from '../pages/api/v1/auth/login.js';
import adminMe from '../pages/api/v1/auth/me.js';
import salesLogin from '../pages/api/v1/sales/auth/login.js';
import salesMe from '../pages/api/v1/sales/auth/me.js';
import adminOverview from '../pages/api/v1/admin/overview.js';
import adminUsers from '../pages/api/v1/admin/users.js';
import { getSalesReport, salesReportFilters } from '../pages/api/_lib/salesReporting.js';
import salesReports from '../pages/api/v1/admin/sales/reports.js';
import operatorSettings from '../pages/api/v1/admin/sales/operator-settings/index.js';

process.env.DATABASE_URL = 'postgres://sales-auth-fixture';
delete process.env.ADMIN_BOOTSTRAP_EMAIL;
delete process.env.ADMIN_BOOTSTRAP_PASSWORD;

const db = new PGlite();
const adapt = (result) => ({
  ...result,
  rowCount: result.rows?.length || Number(result.affectedRows) || 0
});
const query = async (sql, params = []) => adapt(await db.query(sql, params));
const client = { query, release() {} };
const pool = { query, connect: async () => client };
globalThis.__everycallPool = pool;

function request(cookie = '', method = 'GET', body = {}) {
  return { method, body, headers: { cookie, 'idempotency-key': globalThis.crypto.randomUUID() }, socket: { remoteAddress: '127.0.0.1' } };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    getHeader(name) { return this.headers[name.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

async function call(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}

try {
  await db.exec(`CREATE TABLE knowledge_coverage_events (
    knowledge_coverage_event_id TEXT PRIMARY KEY,
    top_scores_json JSONB NOT NULL DEFAULT '[]'::jsonb
  );`);
  await ensureTables(pool);
  await db.exec(await fs.readFile(new URL('../migrations/0032_outbound_sales_demo.sql', import.meta.url), 'utf8'));
  await db.exec('DROP INDEX admin_users_email_unique_idx;');
  const adminEmailMigration = await fs.readFile(
    new URL('../migrations/0033_sales_auth_admin_user_email_unique.sql', import.meta.url), 'utf8'
  );
  await db.exec(adminEmailMigration);
  await db.exec(adminEmailMigration);
  const hash = await bcrypt.hash('correct-horse-battery', 4);
  const sales = (await query(
    `INSERT INTO admin_users (username, email, password_hash, role)
     VALUES ('seller', 'seller@example.com', $1, 'sales') RETURNING id`, [hash]
  )).rows[0];
  const admin = (await query(
    `INSERT INTO admin_users (username, email, password_hash, role)
     VALUES ('owner', 'owner@example.com', $1, 'admin') RETURNING id`, [hash]
  )).rows[0];
  await query(`INSERT INTO sales_operator_settings (admin_user_id, active) VALUES ($1, TRUE)`, [sales.id]);
  await query(
    `INSERT INTO sessions (id, user_id, role, expires_at) VALUES
      ('sales-token', $1, 'sales', NOW() + INTERVAL '1 day'),
      ('admin-token', $2, 'admin', NOW() + INTERVAL '1 day')`,
    [sales.id, admin.id]
  );

  const salesCookie = 'everycall_sales_session=sales-token';
  const adminCookie = 'everycall_session=admin-token';
  const copiedCookie = 'everycall_session=sales-token';
  assert.equal((await getSalesSession(request(salesCookie)))?.role, 'sales');
  assert.equal(await getSession(request(salesCookie)), null);
  assert.equal(await getSession(request(copiedCookie)), null);
  assert.equal((await call(adminMe, request(salesCookie))).body.authenticated, false);
  assert.equal((await call(adminMe, request(copiedCookie))).body.authenticated, false);
  assert.equal((await call(salesMe, request(salesCookie))).body.role, 'sales');
  assert.equal((await call(salesMe, request(adminCookie))).body.role, 'admin');
  assert.equal((await call(adminOverview, request(salesCookie))).statusCode, 401);
  assert.equal((await call(adminOverview, request(copiedCookie))).statusCode, 401);
  assert.equal((await call(operatorSettings, request(salesCookie, 'PUT', { active: true }))).statusCode, 403);

  const operatorListRequest = (cookie) => ({ ...request(cookie), query: { list: 'true' } });
  assert.equal((await call(operatorSettings, operatorListRequest(salesCookie))).statusCode, 403);
  const operators = await call(operatorSettings, operatorListRequest(adminCookie));
  assert.equal(operators.statusCode, 200);
  assert.equal(operators.body.operators.length, 2);
  assert.equal((await call(operatorSettings, request(salesCookie))).body.settings.active, true);
  assert.equal((await call(salesReports, request(salesCookie))).statusCode, 403);
  assert.equal((await call(salesReports, request(copiedCookie))).statusCode, 401);
  assert.equal((await call(salesReports, request(''))).statusCode, 401);
  assert.equal((await call(salesReports, request(adminCookie))).body.totals.sessions, 0);
  assert.equal((await call(salesReports, { ...request(adminCookie), query: { from: '2026-02-30' } })).statusCode, 400);
  await query(`INSERT INTO sales_prospects (prospect_id, source_key, business_name, phone_e164, timezone, permission_granted)
    VALUES ('report-prospect', 'report-fixture', 'Reporting fixture', '+12065550111', 'UTC', TRUE)`);
  await query(`INSERT INTO sales_call_sessions (sales_call_id, prospect_id, admin_user_id, state,
      created_at, connected_at, demo_started_at, ended_at, outcome, outcome_recorded_at) VALUES
    ('r1', 'report-prospect', $1, 'ended', '2026-10-01T00:00:00Z', '2026-10-01T00:00:10Z', '2026-10-01T00:01:00Z', '2026-10-01T00:02:00Z', 'demo_completed', '2026-10-01T00:03:00Z'),
    ('r2', 'report-prospect', $1, 'failed', '2026-10-01T23:59:59Z', NULL, NULL, '2026-10-02T00:00:01Z', 'no_answer', '2026-10-02T00:01:00Z'),
    ('r3', 'report-prospect', $2, 'ended', '2026-10-01T12:00:00Z', '2026-10-01T12:00:10Z', NULL, '2026-10-01T12:01:00Z', NULL, NULL),
    ('r4', 'report-prospect', $1, 'created', '2026-10-02T00:00:00Z', NULL, NULL, NULL, NULL, NULL),
    ('r5', 'report-prospect', NULL, 'failed', '2026-10-01T10:00:00Z', NULL, NULL, NULL, NULL, NULL),
    ('r0', 'report-prospect', $1, 'failed', '2026-09-30T23:59:59Z', NULL, NULL, NULL, NULL, NULL)`, [sales.id, admin.id]);
  // Query boundaries remain UTC even when the database connection is not.
  await query("SET TIME ZONE 'America/Los_Angeles'");
  const report = await getSalesReport(pool, { from: '2026-10-01', to: '2026-10-01' });
  assert.deepEqual(report.totals, { sessions: 4, connected: 2, demosStarted: 1, ended: 3, outcomesRecorded: 2 });
  assert.equal(report.summary.length, 3);
  assert.deepEqual(report.recent.map((row) => row.id), ['r2', 'r3', 'r5', 'r1']);
  assert.equal(report.outcomes.find((row) => row.outcome === 'not_recorded').count, 2);
  const singleRep = await getSalesReport(pool, { from: '2026-10-01', to: '2026-10-01', operator: String(sales.id) });
  assert.equal(singleRep.totals.sessions, 2);
  const unassigned = await getSalesReport(pool, { from: '2026-10-01', to: '2026-10-01', operator: 'unassigned' });
  assert.equal(unassigned.totals.sessions, 1);
  assert.equal((await getSalesReport(pool, { from: '2026-01-01', to: '2026-01-01' })).recent.length, 0);
  assert.throws(() => salesReportFilters({ from: '2026-10-02', to: '2026-10-01' }), /valid UTC/);
  assert.throws(() => salesReportFilters({ from: '2024-01-01', to: '2026-10-01' }), /valid UTC/);
  assert.throws(() => salesReportFilters({ operator: '1 OR 1=1' }), /valid sales rep/);
  // The detail cap must never cap aggregate totals.
  await query(`INSERT INTO sales_call_sessions (sales_call_id, prospect_id, admin_user_id, created_at)
    SELECT 'cap-' || value, 'report-prospect', $1, '2026-10-03T12:00:00Z'::timestamptz FROM generate_series(1, 105) value`, [sales.id]);
  const capped = await getSalesReport(pool, { from: '2026-10-03', to: '2026-10-03' });
  assert.equal(capped.totals.sessions, 105);
  assert.equal(capped.recent.length, 100);
  await query("SET TIME ZONE 'UTC'");
  const savedSettings = await call(operatorSettings, request(adminCookie, 'PUT', {
    adminUserId: sales.id, displayName: 'Updated rep', callerIdNumber: '+12065550123',
    telnyxTelephonyCredentialId: 'dedicated-sales-credential', active: true
  }));
  assert.equal(savedSettings.statusCode, 200);
  const listedSettings = (await call(operatorSettings, operatorListRequest(adminCookie))).body.operators.find((row) => Number(row.id) === Number(sales.id));
  assert.equal(listedSettings.displayName, 'Updated rep');
  assert.equal(listedSettings.telnyxTelephonyCredentialId, 'dedicated-sales-credential');
  const salesSettings = (await call(operatorSettings, request(salesCookie))).body.settings;
  assert.deepEqual(Object.keys(salesSettings).sort(), ['active', 'displayName']);

  // Exercise the real proxy against the fixture auth endpoints. Resolve the
  // Next module explicitly because this validator runs directly in Node.
  const proxySource = stripTypeScriptTypes(await fs.readFile(new URL('../proxy.ts', import.meta.url), 'utf8'))
    .replace("'next/server'", JSON.stringify(import.meta.resolve('next/server.js')));
  const { proxy } = await import(`data:text/javascript;base64,${Buffer.from(proxySource).toString('base64')}`);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options = {}) => {
      const pathname = new URL(url).pathname;
      assert.ok(['/api/v1/auth/me', '/api/v1/sales/auth/me'].includes(pathname));
      const result = await call(pathname === '/api/v1/auth/me' ? adminMe : salesMe,
        request(options.headers?.cookie || ''));
      return Response.json(result.body, { status: result.statusCode });
    };
    const route = (pathname, cookie) => proxy(new Request(`https://everycall.test${pathname}`, { headers: { cookie } }));
    assert.equal((await route('/admin/sales', adminCookie)).headers.get('x-middleware-next'), '1');
    for (const cookie of [salesCookie, copiedCookie, '']) {
      const result = await route('/admin/sales', cookie);
      assert.equal(new URL(result.headers.get('location')).pathname, '/admin/login');
    }
    assert.equal((await route('/sales', salesCookie)).headers.get('x-middleware-next'), '1');
    assert.equal((await route('/sales', adminCookie)).headers.get('x-middleware-next'), '1');
    assert.equal(new URL((await route('/sales', '')).headers.get('location')).pathname, '/sales/login');
  } finally {
    globalThis.fetch = originalFetch;
  }

  const newSalesAccount = {
    email: 'new-seller@example.com', username: 'new-seller',
    password: 'correct-horse-battery', role: 'sales'
  };
  assert.equal((await call(adminUsers, request(adminCookie, 'POST', newSalesAccount))).statusCode, 200);
  const created = (await query(
    `SELECT u.id, u.role, settings.active
     FROM admin_users u
     JOIN sales_operator_settings settings ON settings.admin_user_id = u.id
     WHERE u.email = $1`, [newSalesAccount.email]
  )).rows[0];
  assert.equal(created.role, 'sales');
  assert.equal(created.active, true);
  await query(
    `INSERT INTO sessions (id, user_id, role, expires_at)
     VALUES ('old-sales-token', $1, 'sales', NOW() + INTERVAL '1 day')`,
    [created.id]
  );
  assert.equal((await call(adminUsers, request(adminCookie, 'POST', {
    ...newSalesAccount, password: 'replaced-password'
  }))).statusCode, 200);
  assert.equal((await query(`SELECT id FROM admin_users WHERE email = $1`, [newSalesAccount.email])).rows[0].id, created.id);
  assert.equal((await query(`SELECT id FROM sessions WHERE id = 'old-sales-token'`)).rowCount, 0);
  assert.equal((await query(
    `SELECT COUNT(*)::int AS count FROM audit_log WHERE action = 'admin.user.saved'`
  )).rows[0].count, 2);
  assert.equal((await call(salesLogin, request('', 'POST', {
    email: newSalesAccount.email, password: newSalesAccount.password
  }))).statusCode, 401);
  assert.equal((await call(salesLogin, request('', 'POST', {
    email: newSalesAccount.email, password: 'replaced-password'
  }))).statusCode, 200);

  const salesContext = await requireSalesAdmin(request(salesCookie), response());
  assert.equal(salesContext?.session.role, 'sales');
  const adminContext = await requireSalesAdmin(request(adminCookie), response());
  assert.equal(adminContext?.session.role, 'admin');
  const invalidSalesCookie = 'everycall_sales_session=invalid; everycall_session=admin-token';
  const invalidResponse = response();
  assert.equal(await requireSalesAdmin(request(invalidSalesCookie), invalidResponse), null);
  assert.equal(invalidResponse.statusCode, 401);

  assert.equal((await call(adminLogin, request('', 'POST', {
    email: 'seller@example.com', password: 'correct-horse-battery', role: 'admin'
  }))).statusCode, 401);
  assert.equal((await call(salesLogin, request('', 'POST', {
    email: 'owner@example.com', password: 'correct-horse-battery'
  }))).statusCode, 401);
  assert.equal((await call(salesLogin, request('', 'POST', {
    email: 'seller@example.com', password: 'correct-horse-battery'
  }))).statusCode, 200);
  const recoveredAdmin = await call(adminLogin, request(
    'everycall_sales_session=revoked-token', 'POST', {
      email: 'owner@example.com', password: 'correct-horse-battery', role: 'admin'
    }
  ));
  assert.equal(recoveredAdmin.statusCode, 200);
  assert.equal(recoveredAdmin.headers['set-cookie'].length, 2);
  assert.match(recoveredAdmin.headers['set-cookie'][0], /everycall_sales_session=;.*Max-Age=0/);
  const switchedToSales = await call(salesLogin, request(adminCookie, 'POST', {
    email: 'seller@example.com', password: 'correct-horse-battery'
  }));
  assert.equal(switchedToSales.statusCode, 200);
  assert.equal(switchedToSales.headers['set-cookie'].length, 2);
  assert.match(switchedToSales.headers['set-cookie'][0], /everycall_session=;.*Max-Age=0/);

  await query(`UPDATE sales_operator_settings SET active = FALSE WHERE admin_user_id = $1`, [sales.id]);
  assert.equal(await getSalesSession(request(salesCookie)), null);
  assert.equal((await call(salesLogin, request('', 'POST', {
    email: 'seller@example.com', password: 'correct-horse-battery'
  }))).statusCode, 401);
  assert.equal((await call(salesMe, request(salesCookie))).body.authenticated, false);
  console.log('sales auth isolation checks passed');
} finally {
  delete globalThis.__everycallPool;
  await db.close();
}
