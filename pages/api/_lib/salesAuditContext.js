import crypto from 'node:crypto';

// Only the authenticated server context enters this adapter. Never pass request
// body/header actor values. Each statement is atomic with its trigger writes;
// existing multi-statement transactions retain their original boundaries.
export async function salesAuditPool(pool, context) {
  const result = await pool.query('SELECT id,username,email,role FROM admin_users WHERE id=$1', [context.admin.id]);
  const user = result.rows[0];
  if (!user || (context.session.role === 'sales' ? user.role !== 'sales' : !['admin','super_admin'].includes(user.role))) {
    throw Object.assign(new Error('Authenticated Sales actor is no longer authorized.'), { code: 'forbidden', statusCode: 403 });
  }
  const actor = JSON.stringify({ kind: 'human', id: String(user.id),
    name: String(user.username || user.email || `User ${user.id}`),
    role: context.session.role === 'sales' ? 'sales' : (user.role || 'admin'),
    requestId: crypto.randomUUID() });
  const setContext = db => db.query("SELECT set_config('everycall.sales_actor',$1,TRUE)", [actor]);
  async function connect() {
    const client = await pool.connect();
    let transaction = false;
    let tail = Promise.resolve();
    const query = (sql, args) => {
      const execute = async () => {
        const text = typeof sql === 'string' ? sql : sql.text;
        if (/^\s*(BEGIN|START\s+TRANSACTION)\b/i.test(text)) {
          const result = await client.query(sql, args);
          transaction = true;
          await setContext(client);
          return result;
        }
        if (transaction) {
          const result = await client.query(sql, args);
          if (/^\s*(COMMIT|ROLLBACK|END)\s*;?\s*$/i.test(text)) transaction = false;
          return result;
        }
        await client.query('BEGIN');
        try {
          await setContext(client);
          const result = await client.query(sql, args);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        }
      };
      const result = tail.then(execute);
      tail = result.catch(() => {});
      return result;
    };
    return { query, release: error => client.release(error),
      on: (...args) => client.on(...args), off: (...args) => client.off(...args) };
  }
  return { connect, async query(sql, args) {
    const client = await connect();
    try { return await client.query(sql, args); } finally { client.release(); }
  } };
}
