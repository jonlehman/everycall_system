import crypto from 'node:crypto';

export async function createSupportSession(pool,{staffSession,tenantKey,now=new Date()}) {
  if(!staffSession || staffSession.role!=='admin' || !tenantKey)throw Error('support_forbidden');
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const actor=(await db.query(`SELECT u.id,u.email FROM admin_users u JOIN sessions s ON s.user_id=u.id
      WHERE s.id=$1 AND s.role='admin' AND s.expires_at>$2 AND u.role IN ('admin','super_admin') FOR UPDATE OF u,s`,[staffSession.id,now])).rows[0];
    if(!actor)throw Error('support_forbidden');
    if(!(await db.query('SELECT 1 FROM tenants WHERE tenant_key=$1',[tenantKey])).rowCount)throw Error('support_tenant_not_found');
    const support={id:crypto.randomBytes(32).toString('hex'),tenantKey,actorEmail:actor.email,expiresAt:new Date(new Date(now).getTime()+30*60000).toISOString()};
    await db.query(`INSERT INTO staff_support_sessions(id,staff_session_id,actor_user_id,tenant_key,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)`,[support.id,staffSession.id,actor.id,tenantKey,now,support.expiresAt]);
    await db.query(`INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,$2,'support.session.started',$3)`,[tenantKey,`admin:${actor.id}`,`support_session=${support.id.slice(0,12)} expires=${support.expiresAt}`]);
    await db.query('COMMIT');return support;
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

export async function resolveSupportSession(pool,{supportId,staffSession,requestedTenantKey=null,method='GET',path='',now=new Date()}) {
  if(!supportId || !staffSession || staffSession.role!=='admin' || !['GET','HEAD','OPTIONS'].includes(method))return null;
  const support=(await pool.query(`SELECT s.*,u.email AS actor_email FROM staff_support_sessions s
    JOIN sessions a ON a.id=s.staff_session_id JOIN admin_users u ON u.id=s.actor_user_id
    WHERE s.id=$1 AND a.id=$2 AND a.user_id=s.actor_user_id AND a.role='admin' AND a.expires_at>$3
    AND s.ended_at IS NULL AND s.expires_at>$3 AND u.role IN ('admin','super_admin')`,[supportId,staffSession.id,now])).rows[0];
  if(!support || (requestedTenantKey && String(requestedTenantKey)!==support.tenant_key))return null;
  await pool.query(`INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,$2,'support.session.access',$3)`,[support.tenant_key,`admin:${support.actor_user_id}`,`support_session=${support.id.slice(0,12)} method=${method} path=${String(path).split('?')[0].slice(0,200)}`]);
  return {id:staffSession.id,user_id:support.actor_user_id,role:'tenant',tenant_key:support.tenant_key,expires_at:support.expires_at,
    support_session:{tenantKey:support.tenant_key,actorEmail:support.actor_email,expiresAt:support.expires_at,readOnly:true}};
}

export async function endSupportSession(pool,{supportId,staffSession}) {
  if(!staffSession || staffSession.role!=='admin')return false;
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const row=(await db.query(`UPDATE staff_support_sessions SET ended_at=COALESCE(ended_at,NOW()) WHERE id=$1 AND staff_session_id=$2 RETURNING *`,[supportId,staffSession.id])).rows[0];
    if(row)await db.query(`INSERT INTO audit_log(tenant_key,actor,action,details) VALUES($1,$2,'support.session.ended',$3)`,[row.tenant_key,`admin:${row.actor_user_id}`,`support_session=${row.id.slice(0,12)}`]);
    await db.query('COMMIT');return Boolean(row);
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
