import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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
  return { method, body, headers: { cookie }, socket: { remoteAddress: '127.0.0.1' } };
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
