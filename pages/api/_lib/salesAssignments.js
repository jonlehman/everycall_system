import crypto from 'node:crypto';
import { PROSPECT_WITH_DEMO_SELECT, serializeProspect, salesError, normalizeSalesText } from './salesRepository.js';
import { SALES_TERMINAL_SQL } from './salesDialer.js';
import { salesContactSearchSql } from './salesContacts.js';

const SORTS = Object.freeze({
  queue: 'p.queue_position',
  business: "lower(COALESCE(p.business_name,''))",
  contact: "lower(COALESCE(p.contact_name,''))",
  status: "lower(p.status)",
  rep: "lower(COALESCE(NULLIF(s.display_name,''),u.username,u.email,''))",
  updated: "to_char(p.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US')"
});

// Management-only listing. Keyset pagination covers the entire filtered set and
// binds cursors to the sort/filter scope; empty values and ties have stable IDs.
export async function listSalesManagedProspects(pool, {
  limit = 100, cursor = '', search = '', status = '', includeDeleted = false,
  assignment = 'all', sort = 'queue', direction = 'asc'
} = {}) {
  if (!Object.hasOwn(SORTS, sort) || !['asc', 'desc'].includes(direction)
      || !['all', 'assigned', 'unassigned'].includes(assignment)) {
    throw salesError('invalid_prospect_filter', 'Choose a valid assignment filter and sort.');
  }
  const safeLimit = Math.min(250, Math.max(1, Math.floor(Number(limit) || 100)));
  search = normalizeSalesText(search, 200);
  status = normalizeSalesText(status, 60);
  const values = [], where = ['TRUE'];
  if (!includeDeleted) where.push("p.status <> 'deleted'");
  if (status) { values.push(status); where.push(`p.status=$${values.length}`); }
  if (assignment !== 'all') where.push(`p.assigned_rep_user_id IS ${assignment === 'assigned' ? 'NOT ' : ''}NULL`);
  const searchSql = salesContactSearchSql(search, values);
  if (searchSql) where.push(searchSql);
  const scope = crypto.createHash('sha256').update(JSON.stringify([search, status, includeDeleted, assignment, sort, direction])).digest('hex');
  let after = 'TRUE';
  if (cursor) {
    let decoded;
    try {
      if (typeof cursor !== 'string' || cursor.length > 3000) throw Error();
      decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      if (decoded.scope !== scope || typeof decoded.id !== 'string' || !decoded.id
          || !['string', 'number'].includes(typeof decoded.key)) throw Error();
      if (sort === 'queue' && !/^\d+$/.test(String(decoded.key))) throw Error();
    } catch { throw salesError('invalid_prospect_cursor', 'Refresh the prospect list before loading more.'); }
    values.push(decoded.key, decoded.id);
    after = `(sort_key,prospect_id) ${direction === 'asc' ? '>' : '<'} ($${values.length - 1},$${values.length})`;
  }
  values.push(safeLimit + 1);
  const order = `sort_key ${direction}, prospect_id ${direction}`;
  const result = await pool.query(`WITH matching AS (
    SELECT p.*, ${SORTS[sort]} AS sort_key,
      COALESCE(NULLIF(s.display_name,''),u.username,u.email) AS assigned_rep_name,
      u.email AS assigned_rep_email
    FROM sales_prospects p
    LEFT JOIN admin_users u ON u.id=p.assigned_rep_user_id
    LEFT JOIN sales_operator_settings s ON s.admin_user_id=p.assigned_rep_user_id
    WHERE ${where.join(' AND ')}
  ), page AS (SELECT * FROM matching WHERE ${after} ORDER BY ${order} LIMIT $${values.length})
  SELECT (SELECT count(*) FROM matching) AS total,
    COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${order}) FROM page),'[]'::jsonb) AS rows`, values);
  const page = result.rows[0].rows;
  const hasMore = page.length > safeLimit;
  page.splice(safeLimit);
  // Preserve the existing detail/eligibility serializer without enlarging the
  // count query with call/demo joins. Page membership comes from one snapshot.
  const details = page.length ? await pool.query(`${PROSPECT_WITH_DEMO_SELECT} WHERE p.prospect_id=ANY($1::text[])`, [page.map(row => row.prospect_id)]) : { rows: [] };
  const byId = new Map(details.rows.map(row => [row.prospect_id, row]));
  const prospects = page.map(row => ({
    ...serializeProspect({ ...byId.get(row.prospect_id), ...row }),
    assignedRepName: row.assigned_rep_name || null,
    assignedRepEmail: row.assigned_rep_email || null
  }));
  const last = page.at(-1);
  return { prospects, total: Number(result.rows[0].total), nextCursor: hasMore
    ? Buffer.from(JSON.stringify({ scope, key: last.sort_key, id: last.prospect_id })).toString('base64url') : null };
}

// Caller owns the transaction so the assignment, audit and idempotency receipt
// commit together. NOWAIT makes lock contention an actionable atomic conflict.
export async function reassignSalesProspects(db, { targetRepUserId, prospects } = {}) {
  const target = Number(targetRepUserId);
  if (!Number.isSafeInteger(target) || target <= 0) throw salesError('invalid_assignment_target', 'Choose an active Sales rep.');
  if (!Array.isArray(prospects) || !prospects.length || prospects.length > 5000) {
    throw salesError('invalid_assignment_selection', 'Select between 1 and 5,000 loaded prospects.');
  }
  const selected = new Map();
  for (const row of prospects) {
    if (typeof row?.prospectId !== 'string' || !row.prospectId || row.prospectId.length > 200
        || !Number.isSafeInteger(row.expectedRowVersion) || row.expectedRowVersion < 1
        || !(row.assignedRepUserId === null || (Number.isSafeInteger(row.assignedRepUserId) && row.assignedRepUserId > 0))
        || selected.has(row.prospectId)) {
      throw salesError('invalid_assignment_selection', 'Refresh the list and select valid, distinct prospects.');
    }
    selected.set(row.prospectId, row);
  }
  const ids = [...selected.keys()].sort();
  await db.query('SAVEPOINT sales_assignment');
  try {
    // This same row fences phone transitions, call/incoming inserts, and external
    // action reservation. Do not wait while holding it: incoming take locks its
    // rep first and its call trigger then acquires this config lock.
    const config = await db.query('SELECT id FROM sales_dialer_config WHERE id=TRUE FOR UPDATE NOWAIT');
    if (!config.rowCount) throw salesError('sales_assignment_unavailable', 'Sales settings are unavailable. Refresh and retry.', 409);
    const users = [...new Set([target, ...prospects.map(row => row.assignedRepUserId).filter(Boolean)])].sort((a, b) => a - b);
    await db.query('SELECT id FROM admin_users WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE NOWAIT', [users]);
    const eligible = await db.query(`SELECT s.admin_user_id FROM sales_operator_settings s JOIN admin_users u ON u.id=s.admin_user_id
      WHERE s.admin_user_id=$1 AND s.active=TRUE AND u.role IN ('sales','admin','super_admin') FOR UPDATE OF s NOWAIT`, [target]);
    if (!eligible.rowCount) throw salesError('invalid_assignment_target', 'This rep is unavailable or inactive. Choose an active Sales operator.');
    const locked = await db.query('SELECT * FROM sales_prospects WHERE prospect_id=ANY($1::text[]) ORDER BY prospect_id FOR UPDATE NOWAIT', [ids]);
    if (locked.rowCount !== ids.length) throw salesError('assignment_selection_missing', 'A selected prospect no longer exists. Refresh and select again.', 409);
    for (const row of locked.rows) {
      const expected = selected.get(row.prospect_id);
      if (Number(row.row_version) !== expected.expectedRowVersion || (row.assigned_rep_user_id === null ? null : Number(row.assigned_rep_user_id)) !== expected.assignedRepUserId) {
        throw salesError('assignment_selection_stale', `${row.business_name}: ownership or details changed. Refresh and select again.`, 409);
      }
    }
    // Hold historical calls too: outcome saves lock calls before prospect updates.
    await db.query('SELECT sales_call_id FROM sales_call_sessions WHERE prospect_id=ANY($1::text[]) ORDER BY sales_call_id FOR UPDATE NOWAIT', [ids]);
    const busy = await db.query(`SELECT prospect_id FROM sales_call_sessions WHERE prospect_id=ANY($1::text[])
        AND (state NOT IN (${SALES_TERMINAL_SQL}) OR (admin_user_id IS NOT NULL AND outcome_recorded_at IS NULL))
      UNION ALL SELECT prospect_id FROM sales_incoming_calls WHERE prospect_id=ANY($1::text[]) AND (state='routing' OR (state='ringing' AND ring_expires_at>NOW()) OR (state='claimed' AND sales_call_id IS NULL))
      UNION ALL SELECT prospect_id FROM sales_checkout_sessions WHERE prospect_id=ANY($1::text[]) AND (status IN ('creating','created','sending','delivery_uncertain') OR (status='paid' AND provider_message_id IS NULL))
      UNION ALL SELECT c.prospect_id FROM sales_setup_bookings b JOIN sales_call_sessions c USING(sales_call_id) WHERE c.prospect_id=ANY($1::text[]) AND b.status='reserving'
      UNION ALL SELECT prospect_id FROM sales_followup_jobs WHERE prospect_id=ANY($1::text[]) AND status IN ('queued','leased')
      LIMIT 1`, [ids]);
    if (busy.rowCount) {
      const row = locked.rows.find(row => row.prospect_id === busy.rows[0].prospect_id);
      throw salesError('assignment_prospect_busy', `${row.business_name}: finish the call and wrap-up, or reconcile pending delivery, booking, or follow-up work, then refresh and retry. No prospects were reassigned.`, 409);
    }
    const updated = await db.query(`UPDATE sales_prospects SET assigned_rep_user_id=$2,row_version=row_version+1,updated_at=NOW()
      WHERE prospect_id=ANY($1::text[]) RETURNING *`, [ids, target]);
    const before = new Map(locked.rows.map(row => [row.prospect_id, row]));
    for (const row of updated.rows) {
      const previous = before.get(row.prospect_id);
      // Existing DNC triggers may reconcile a stale identity on any UPDATE. This
      // ownership action must never change consent/status or other protected data.
      for (const key of Object.keys(previous)) {
        if (['assigned_rep_user_id', 'row_version', 'updated_at'].includes(key)) continue;
        if (JSON.stringify(previous[key]) !== JSON.stringify(row[key])) {
          throw salesError('assignment_protected_state_changed', `${row.business_name}: its protected state needs reconciliation before reassignment. No prospects were reassigned.`, 409);
        }
      }
    }
    await db.query('RELEASE SAVEPOINT sales_assignment');
    return { assignedCount: ids.length, targetRepUserId: target, assignments: locked.rows.map(row => ({ prospectId: row.prospect_id, previousRepUserId: row.assigned_rep_user_id === null ? null : Number(row.assigned_rep_user_id) })) };
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT sales_assignment');
    if (error.code === '55P03' || error.code === '40P01') throw salesError('assignment_activity_pending', 'Sales activity is updating this selection. Wait for it to finish, refresh, and retry. No prospects were reassigned.', 409);
    throw error;
  }
}
