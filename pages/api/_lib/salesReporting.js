import { salesError } from './salesRepository.js';

export function salesReportFilters(query = {}, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const fromDefault = new Date(now.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const from = query.from ?? fromDefault;
  const to = query.to ?? today;
  const validDate = (value) => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(from) || !validDate(to) || from > to || Date.parse(to) - Date.parse(from) > 365 * 86400000) {
    throw salesError('invalid_report_dates', 'Choose a valid UTC date range of at most 366 days.', 400);
  }
  const operator = query.operator ?? '';
  if (typeof operator !== 'string' || (operator && operator !== 'unassigned' && (!/^[1-9]\d*$/.test(operator) || !Number.isSafeInteger(Number(operator))))) {
    throw salesError('invalid_report_operator', 'Choose a valid sales rep.', 400);
  }
  return { from, to, operator };
}

export async function getSalesReport(pool, query = {}) {
  const filters = salesReportFilters(query);
  const params = [filters.from, filters.to];
  let where = `c.created_at >= $1::date::timestamp AT TIME ZONE 'UTC'
    AND c.created_at < ($2::date + 1)::timestamp AT TIME ZONE 'UTC'`;
  if (filters.operator === 'unassigned') where += ' AND c.admin_user_id IS NULL';
  else if (filters.operator) {
    params.push(Number(filters.operator));
    where += ' AND c.admin_user_id = $3';
  }
  const repName = "COALESCE(NULLIF(s.display_name, ''), NULLIF(u.username, ''), u.email, 'Unassigned / deleted user')";
  const reps = await pool.query(`SELECT u.id, ${repName} AS name, u.role
    FROM admin_users u LEFT JOIN sales_operator_settings s ON s.admin_user_id = u.id
    WHERE u.role IN ('sales', 'admin', 'super_admin') OR EXISTS (
      SELECT 1 FROM sales_call_sessions c WHERE c.admin_user_id = u.id)
    ORDER BY name, u.id`);
  const summary = await pool.query(`SELECT c.admin_user_id AS "operatorId", ${repName} AS "operatorName",
      COUNT(*)::int AS sessions,
      COUNT(*) FILTER (WHERE c.connected_at IS NOT NULL)::int AS connected,
      COUNT(*) FILTER (WHERE c.demo_started_at IS NOT NULL)::int AS "demosStarted",
      COUNT(*) FILTER (WHERE c.ended_at IS NOT NULL)::int AS ended,
      COUNT(*) FILTER (WHERE c.outcome_recorded_at IS NOT NULL)::int AS "outcomesRecorded"
    FROM sales_call_sessions c
    LEFT JOIN admin_users u ON u.id = c.admin_user_id
    LEFT JOIN sales_operator_settings s ON s.admin_user_id = c.admin_user_id
    WHERE ${where}
    GROUP BY c.admin_user_id, u.username, u.email, s.display_name
    ORDER BY sessions DESC, "operatorName", c.admin_user_id`, params);
  const outcomes = await pool.query(`SELECT COALESCE(NULLIF(c.outcome, ''), 'not_recorded') AS outcome,
      COUNT(*)::int AS count FROM sales_call_sessions c WHERE ${where}
    GROUP BY COALESCE(NULLIF(c.outcome, ''), 'not_recorded') ORDER BY count DESC, outcome`, params);
  const recent = await pool.query(`SELECT c.sales_call_id AS id, c.created_at AS "createdAt",
      c.admin_user_id AS "operatorId", ${repName} AS "operatorName",
      p.business_name AS "businessName", c.state, c.outcome,
      c.connected_at AS "connectedAt", c.demo_started_at AS "demoStartedAt"
    FROM sales_call_sessions c
    JOIN sales_prospects p ON p.prospect_id = c.prospect_id
    LEFT JOIN admin_users u ON u.id = c.admin_user_id
    LEFT JOIN sales_operator_settings s ON s.admin_user_id = c.admin_user_id
    WHERE ${where} ORDER BY c.created_at DESC, c.sales_call_id DESC LIMIT 100`, params);
  const totals = summary.rows.reduce((total, row) => {
    for (const key of Object.keys(total)) total[key] += Number(row[key]);
    return total;
  }, { sessions: 0, connected: 0, demosStarted: 0, ended: 0, outcomesRecorded: 0 });
  return { filters, reps: reps.rows, summary: summary.rows, outcomes: outcomes.rows, recent: recent.rows, totals };
}
