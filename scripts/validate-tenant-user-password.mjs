import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { bootstrapFixtureSchema } from './lib/schema-migrations.mjs';
import users from '../pages/api/v1/tenant/users.js';
import login from '../pages/api/v1/auth/login.js';
import reset from '../pages/api/v1/auth/reset.js';
import { createSession } from '../pages/api/_lib/auth.js';
import { issueAuthToken, issueTenantPasswordReset } from '../pages/api/_lib/authTokens.js';

const nativeUrl = process.env.TENANT_PASSWORD_TEST_DATABASE_URL;
if (nativeUrl && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(nativeUrl).hostname)) throw Error('Loopback disposable database required');
const schema = `tenant_password_${Date.now()}`;
const database = nativeUrl ? null : new PGlite();
const rootPool = nativeUrl ? new pg.Pool({ connectionString: nativeUrl }) : null;
if (rootPool) await rootPool.query(`CREATE SCHEMA ${schema}`);
const nativePool = nativeUrl ? new pg.Pool({ connectionString: nativeUrl, options: `-c search_path=${schema}`, max: 12 }) : null;
const query = async (sql, params = []) => {
  const r = nativePool ? await nativePool.query(sql, params) : await database.query(sql, params);
  return { ...r, rowCount: r.rowCount ?? (r.rows?.length || Number(r.affectedRows) || 0) };
};
let beforeConnect = null, afterClientQuery = null;
const pool = { query, async connect() {
  if (beforeConnect) { const hook = beforeConnect; beforeConnect = null; await hook(); }
  if (!nativePool) return { query, release() {} };
  const client = await nativePool.connect();
  return { async query(sql, params) { const result = await client.query(sql, params); if (afterClientQuery) await afterClientQuery(sql, params, result); return result; }, release() { client.release(); } };
} };
globalThis.__everycallPool = pool;
process.env.DATABASE_URL = nativeUrl || 'postgres://tenant-password-fixture';
const req = (cookie, body, method = 'POST', tenantKey) => ({ method, body, query: tenantKey ? {tenantKey} : {}, headers: { cookie }, socket: { remoteAddress: '127.0.0.1' } });
async function call(fn, request) {
  const res = { statusCode: 200, body: null, headers: {}, setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, getHeader(k) { return this.headers[k.toLowerCase()]; }, status(n) { this.statusCode=n; return this; }, json(body) { this.body=body; return this; } };
  await fn(request,res); return res;
}
let nextSession = 0;
async function session(user, role = 'tenant', tenantKey = user.tenant_key) {
  const id = `fixture-session-${++nextSession}`;
  await query(`INSERT INTO sessions (id,user_id,role,tenant_key,expires_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day')`,[id,user.id,role,tenantKey || null]);
  return `everycall_session=${id}`;
}
const oldPassword = 'Original-fixture-password';
const newPassword = ' New-fixture-password ';
const hash = await bcrypt.hash(oldPassword,4);
async function user(id, role='member', status='active', tenant='password-a') {
  return (await query(`INSERT INTO tenant_users (id,tenant_key,name,email,role,status,password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[id,tenant,`Person ${id}`,`person${id}@example.test`,role,status,hash])).rows[0];
}
const row = async id => (await query('SELECT * FROM tenant_users WHERE id=$1',[id])).rows[0];
async function check(status, auth, id, password=newPassword, extra={}) {
  const r = await call(users,req(auth,{action:'password',id,password,...extra}));
  assert.equal(r.statusCode,status,JSON.stringify(r.body)); return r;
}
const token = (u, type='password_reset') => issueAuthToken(pool,{tokenType:type,userId:u.id,email:u.email,tenantKey:u.tenant_key,expiresAt:new Date(Date.now()+60000)});
try {
  if (nativePool) { const client=await nativePool.connect();try { await bootstrapFixtureSchema(client); } finally { client.release(); } }
  else await bootstrapFixtureSchema(pool,{executeSql:sql=>database.exec(sql)});
  await query(`INSERT INTO tenants (tenant_key,name) VALUES ('password-a','Password A'),('password-b','Password B')`);
  const owner=await user(101,'owner'), admin=await user(102,'admin'), member=await user(103), viewer=await user(104,'viewer');
  const target=await user(105), foreign=await user(106,'member','active','password-b'), disabled=await user(107,'member','disabled'), invited=await user(108,'member','invited');
  let ownerAuth=await session(owner); const adminAuth=await session(admin), memberAuth=await session(member), viewerAuth=await session(viewer);
  await query(`INSERT INTO admin_users (id,username,email,role,password_hash) VALUES ($1,'Collision','platform@example.test','admin',$2)`,[target.id,hash]);
  const platform={id:target.id}; const platformAuth=await session(platform,'admin');
  const salesAuth=await session(platform,'sales'), targetAuth=await session(target); await session(target,'tenant','password-b');
  const resetToken=await token(target);
  await query(`INSERT INTO auth_tokens (token,token_type,user_id,email,tenant_key,expires_at) VALUES
    ('platform-token','password_reset',$1,'platform@example.test',NULL,NOW()+INTERVAL '1 day'),
    ('legacy-tenant-token','password_reset',$1,$2,NULL,NOW()+INTERVAL '1 day'),
    ('other-tenant-token','password_reset',$1,$2,'password-b',NOW()+INTERVAL '1 day')`,[target.id,target.email]);
  const before=await row(target.id);
  const expiredAuth=await session(owner); await query("UPDATE sessions SET expires_at=NOW()-INTERVAL '1 day' WHERE id=$1",[expiredAuth.split('=')[1]]);
  await check(401,expiredAuth,target.id); await check(401,salesAuth,target.id);
  await check(401,'',target.id); await check(403,memberAuth,target.id); await check(403,viewerAuth,target.id);
  await check(404,ownerAuth,foreign.id); await check(409,ownerAuth,disabled.id); await check(409,ownerAuth,invited.id);
  for (const password of ['', 'short', 123, '😀'.repeat(19)]) await check(400,ownerAuth,target.id,password);
  await check(400,ownerAuth,'9223372036854775808'); await check(400,ownerAuth,target.id,newPassword,{role:'owner'});
  assert.deepEqual(await row(target.id),before);
  assert.equal((await query(`SELECT count(*)::int n FROM audit_log WHERE action='tenant.team_user.password_updated'`)).rows[0].n,0);
  // Tenant query parameters cannot redirect the session to another tenant.
  const scoped=await call(users,req(ownerAuth,{action:'password',id:foreign.id,password:newPassword},'POST','password-b'));
  assert.equal(scoped.statusCode,404); assert.equal((await row(foreign.id)).password_hash,hash);
  const result=await check(200,adminAuth,target.id); assert.equal(result.body.reauthenticate,false);
  const after=await row(target.id);
  assert.equal((await query('SELECT count(*)::int n FROM sessions WHERE id=$1',[targetAuth.split('=')[1]])).rows[0].n,0);
  await check(401,targetAuth,target.id);
  for (const key of Object.keys(before).filter(k=>!['password_hash','updated_at'].includes(k))) assert.deepEqual(after[key],before[key],key);
  assert.ok(await bcrypt.compare(newPassword,after.password_hash)); assert.equal(after.password_hash.startsWith('$2'),true);
  const old=await call(login,req('',{role:'client',email:target.email,password:oldPassword})); assert.equal(old.statusCode,401);
  const fresh=await call(login,req('',{role:'client',email:target.email,password:newPassword})); assert.equal(fresh.statusCode,200); assert.ok(fresh.headers['set-cookie']);
  assert.equal((await query(`SELECT count(*)::int n FROM sessions WHERE user_id=$1 AND role IN ('admin','sales')`,[target.id])).rows[0].n,2);
  assert.equal((await query(`SELECT count(*)::int n FROM sessions WHERE user_id=$1 AND role='tenant' AND tenant_key='password-b'`,[target.id])).rows[0].n,1);
  assert.equal((await query(`SELECT password_hash FROM admin_users WHERE id=$1`,[target.id])).rows[0].password_hash,hash);
  assert.deepEqual((await query(`SELECT token FROM auth_tokens WHERE user_id=$1 ORDER BY token`,[target.id])).rows.map(x=>x.token),['other-tenant-token','platform-token']);
  assert.equal((await call(reset,req('',{token:resetToken,password:'stale-reset-password'}))).statusCode,400);
  assert.equal((await call(reset,req('',{token:'legacy-tenant-token',password:'stale-reset-password'}))).statusCode,400);
  assert.equal(await createSession({userId:target.id,tenantKey:target.tenant_key,role:'tenant',expectedUser:target}),null);
  assert.equal(await issueTenantPasswordReset(pool,target,new Date(Date.now()+60000)),null);
  // In-flight reset redemption reads its token, then a manager changes the password.
  const inFlight=await token(target);
  beforeConnect=async()=>{await check(200,ownerAuth,target.id,'manager-wins-password');};
  assert.equal((await call(reset,req('',{token:inFlight,password:'in-flight-reset-password'}))).statusCode,400);
  assert.ok(await bcrypt.compare('manager-wins-password',(await row(target.id)).password_hash));
  // Token-free active users can receive their first password without activation.
  await query('UPDATE tenant_users SET password_hash=NULL WHERE id=$1',[member.id]);
  const setup=await token(await row(member.id),'account_setup');
  await check(200,ownerAuth,member.id); assert.equal((await query('SELECT count(*)::int n FROM auth_tokens WHERE token_hash IS NOT NULL AND user_id=$1',[member.id])).rows[0].n,0);
  assert.equal((await call(login,req('',{email:member.email,password:newPassword,role:'client'}))).statusCode,200);
  // Revoked/demoted managers cannot use an authorization read made before hashing.
  const stable=await row(target.id);
  beforeConnect=async()=>{await query('DELETE FROM sessions WHERE id=$1',[adminAuth.split('=')[1]]);};
  await check(401,adminAuth,target.id,'stale-manager-password'); assert.deepEqual(await row(target.id),stable);
  const adminAgain=await session(admin);
  beforeConnect=async()=>{await query("UPDATE tenant_users SET role='member' WHERE id=$1",[admin.id]);};
  await check(401,adminAgain,target.id,'demoted-manager-password'); assert.deepEqual(await row(target.id),stable);
  // Audit failures roll back both credential and session/token revocation.
  const savedSession=await session(target), savedToken=await token(await row(target.id));
  await query(`CREATE FUNCTION fail_password_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='tenant.team_user.password_updated' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$`);
  await query(`CREATE TRIGGER fail_password_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_password_audit()`);
  await check(500,ownerAuth,target.id,'rollback-secret'); assert.deepEqual(await row(target.id),stable);
  assert.equal((await query('SELECT count(*)::int n FROM sessions WHERE id=$1',[savedSession.split('=')[1]])).rows[0].n,1);
  await query('DROP TRIGGER fail_password_audit ON audit_log'); await query('DROP FUNCTION fail_password_audit()');
  assert.equal((await call(reset,req('',{token:savedToken,password:'valid-reset-password'}))).statusCode,200);
  assert.ok(await bcrypt.compare('valid-reset-password',(await row(target.id)).password_hash));
  // Existing platform managers act only on tenant principal storage, even on ID collision.
  const platformResult=await call(users,req(platformAuth,{action:'password',id:target.id,password:newPassword},'POST','password-a'));
  assert.equal(platformResult.statusCode,200); assert.equal(platformResult.body.reauthenticate,false);
  assert.equal((await query('SELECT password_hash FROM admin_users WHERE id=$1',[target.id])).rows[0].password_hash,hash);
  const self=await check(200,ownerAuth,owner.id); assert.equal(self.body.reauthenticate,true); assert.ok(JSON.stringify(self.headers['set-cookie']).includes('Max-Age=0'));
  await check(401,ownerAuth,target.id); ownerAuth=await session(owner);
  // An ambiguous historical token is preserved for the platform namespace and fails closed.
  await query('UPDATE admin_users SET email=$1 WHERE id=$2',[target.email,target.id]);
  await query(`INSERT INTO auth_tokens (token,token_type,user_id,email,expires_at) VALUES ('ambiguous-token','password_reset',$1,$2,NOW()+INTERVAL '1 day')`,[target.id,target.email]);
  await check(200,ownerAuth,target.id);
  assert.equal((await query("SELECT count(*)::int n FROM auth_tokens WHERE token='ambiguous-token'")).rows[0].n,1);
  assert.equal((await call(reset,req('',{token:'ambiguous-token',password:'ambiguous-secret'}))).statusCode,400);
  const listing=await call(users,req(ownerAuth,{},'GET'));
  assert.equal(listing.body.canManagePasswords,true); assert.ok(!JSON.stringify(listing.body).includes('password_hash'));
  const viewerListing=await call(users,req(viewerAuth,{},'GET')); assert.equal(viewerListing.body.canManagePasswords,false);
  const audit=(await query("SELECT details FROM audit_log WHERE action='tenant.team_user.password_updated'")).rows;
  assert.ok(audit.length>0); for (const entry of audit) assert.deepEqual(Object.keys(JSON.parse(entry.details)).sort(),['sessions_revoked','user_id']);
  if (nativePool) {
    const waitBlocked=async(event='advisory')=>{for(let n=0;n<100;n++) { const r=await nativePool.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event=$1 AND pid<>pg_backend_pid()',[event]); if(r.rows[0].n>0)return; await new Promise(resolve=>setTimeout(resolve,20)); } throw Error('Expected blocked request');};
    const blocker=await nativePool.connect(); await blocker.query('BEGIN'); await blocker.query('SELECT pg_advisory_xact_lock(200705,hashtext($1))',['password-a']);
    const staleManager=call(users,req(ownerAuth,{action:'password',id:target.id,password:'concurrent-stale-password'}));
    await waitBlocked(); await blocker.query('DELETE FROM sessions WHERE id=$1',[ownerAuth.split('=')[1]]); await blocker.query('COMMIT'); blocker.release();
    assert.equal((await staleManager).statusCode,401);
    // A real manager request holds the updated tenant row while old login/reset
    // requests run on independent connections and see the previous credential.
    ownerAuth=await session(owner);
    const overlappingToken=await token(await row(target.id));
    const legacyUser=await user(109);
    await query(`INSERT INTO auth_tokens (token,token_type,user_id,email,expires_at) VALUES ('legacy-overlap','password_reset',$1,$2,NOW()+INTERVAL '1 day')`,[legacyUser.id,legacyUser.email]);
    async function holdManagerUpdate(id, password) {
      let announce, release;
      const reached=new Promise(resolve=>{announce=resolve;});
      const gate=new Promise(resolve=>{release=resolve;});
      afterClientQuery=async(sql,params)=>{if(sql.startsWith('UPDATE tenant_users SET password_hash') && String(params[1])===String(id)){afterClientQuery=null;announce();await gate;}};
      const pending=call(users,req(ownerAuth,{action:'password',id,password}));
      await reached; return {pending,release};
    }
    const oldSnapshot=await row(target.id);
    const held=await holdManagerUpdate(target.id,'winner-overlap-password');
    const loginPending=call(login,req('',{role:'client',email:target.email,password:newPassword}));
    const resetPending=call(reset,req('',{token:overlappingToken,password:'losing-overlap-password'}));
    const issuancePending=issueTenantPasswordReset(pool,oldSnapshot,new Date(Date.now()+60000));
    for(let n=0;n<100;n++){
      const waiting=await nativePool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event IN ('transactionid','tuple') AND pid<>pg_backend_pid()");
      if(waiting.rows[0].n>=3)break;
      if(n===99)throw Error('Expected three overlapping credential requests');
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    held.release(); assert.equal((await held.pending).statusCode,200);
    assert.equal((await loginPending).statusCode,401); assert.equal((await resetPending).statusCode,400); assert.equal(await issuancePending,null);
    const legacyHeld=await holdManagerUpdate(legacyUser.id,'legacy-manager-wins');
    const legacyPending=call(reset,req('',{token:'legacy-overlap',password:'legacy-must-not-win'}));
    await waitBlocked('transactionid'); legacyHeld.release(); assert.equal((await legacyHeld.pending).statusCode,200); assert.equal((await legacyPending).statusCode,400);
    assert.ok(await bcrypt.compare('legacy-manager-wins',(await row(legacyUser.id)).password_hash));
    const snapshot=await row(target.id); const loginBlocker=await nativePool.connect(); await loginBlocker.query('BEGIN'); await loginBlocker.query('SELECT id FROM tenant_users WHERE id=$1 FOR UPDATE',[target.id]);
    const staleLogin=createSession({userId:target.id,tenantKey:target.tenant_key,role:'tenant',expectedUser:snapshot});
    await waitBlocked('transactionid'); await loginBlocker.query('UPDATE tenant_users SET password_hash=$1 WHERE id=$2',[hash,target.id]); await loginBlocker.query('COMMIT'); loginBlocker.release();
    assert.equal(await staleLogin,null);
  }
  console.log(`Tenant password regression passed (${nativePool?'PostgreSQL with overlapping transactions':'PGlite with controlled stale-request interleavings'}).`);
} finally {
  delete globalThis.__everycallPool;
  if (nativePool) { await nativePool.end(); await rootPool.query(`DROP SCHEMA ${schema} CASCADE`); await rootPool.end(); }
  else await database.close();
}
