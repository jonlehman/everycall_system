import { createHash } from 'node:crypto';
import { salesError } from './salesRepository.js';
import { callDispositions } from '../../../lib/salesDispositions.js';
import { SALES_REPORT_FIELDS, SALES_REPORT_EXPORT_LIMIT, salesReportCsv } from '../../../lib/salesReportFields.js';

export function salesReportFilters(query = {}, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const fromDefault = new Date(now.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const from = query.from ?? fromDefault;
  const to = query.to ?? today;
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const range = query.range ?? 'dates';
  if (!['dates', 'all'].includes(range) || (range === 'dates' && (!validDate(from) || !validDate(to) || from > to
      || Date.parse(to) - Date.parse(from) > 365 * 86400000))) {
    throw salesError('invalid_report_dates', 'Choose a valid UTC date range of at most 366 days, or All time.', 400);
  }
  const operator = query.operator ?? '';
  if (typeof operator !== 'string' || (operator && operator !== 'unassigned' && (!/^[1-9]\d*$/.test(operator) || !Number.isSafeInteger(Number(operator))))) {
    throw salesError('invalid_report_operator', 'Choose a valid sales rep.', 400);
  }
  const direction = query.direction ?? 'all';
  if (!['all', 'inbound', 'outbound'].includes(direction)) throw salesError('invalid_report_direction', 'Choose inbound, outbound, or all directions.', 400);
  const mode = query.mode ?? 'live';
  if (!['live', 'test', 'all'].includes(mode)) throw salesError('invalid_report_mode', 'Choose live, test, or all calls.', 400);
  const outcome = query.outcome ?? '', state = query.state ?? '', search = query.search ?? '';
  if ([outcome, state].some(value => typeof value !== 'string' || (value && !/^[a-z][a-z0-9_]{0,63}$/.test(value)))
      || typeof search !== 'string' || search.length > 120) {
    throw salesError('invalid_report_filter', 'Use a valid outcome, call state, and search of at most 120 characters.', 400);
  }
  return { from: range === 'all' ? null : from, to: range === 'all' ? null : to, operator, range, mode, direction, outcome, state, search: search.trim() };
}

const REP_NAME = "COALESCE(NULLIF(s.display_name, ''), NULLIF(u.username, ''), u.email, 'Unassigned / deleted user')";
const JOINS = `FROM sales_call_sessions c LEFT JOIN sales_prospects p ON p.prospect_id = c.prospect_id
  LEFT JOIN admin_users u ON u.id = c.admin_user_id LEFT JOIN sales_operator_settings s ON s.admin_user_id = c.admin_user_id`;
const DIRECTION = "CASE WHEN c.metadata_json->>'direction' = 'inbound' THEN 'inbound' ELSE 'outbound' END";
const PROSPECT_NUMBER = `CASE WHEN ${DIRECTION} = 'inbound' THEN c.metadata_json->>'prospect_number' ELSE COALESCE(NULLIF(c.dialed_number, ''), c.metadata_json->>'prospect_number') END`;
const TEST_CALL = "COALESCE(c.metadata_json->>'phone_test_mode' = 'true', FALSE)";
const duration = (start, end) => `CASE WHEN c.${start} IS NOT NULL AND c.${end} >= c.${start} THEN EXTRACT(EPOCH FROM (c.${end} - c.${start}))::float8 END`;
const SESSION_DURATION = duration('started_at', 'ended_at');
const CONNECTED_DURATION = duration('connected_at', 'ended_at');
const TIMELINE_START = 'COALESCE(c.started_at, c.created_at)';
const TIMELINE_VALID = '(c.started_at IS NOT NULL AND c.ended_at IS NOT NULL AND c.ended_at >= c.started_at)';
const TIMELINE_LIMIT = 10000;
const DEMO_DURATION = duration('demo_started_at', 'demo_ended_at');
const METRICS = `COUNT(*)::int AS sessions,
  COUNT(*) FILTER (WHERE c.connected_at IS NOT NULL)::int AS connected,
  COUNT(*) FILTER (WHERE c.demo_started_at IS NOT NULL)::int AS "demosStarted",
  COUNT(*) FILTER (WHERE c.ended_at IS NOT NULL)::int AS ended,
  COUNT(*) FILTER (WHERE c.outcome_recorded_at IS NOT NULL)::int AS "outcomesRecorded"`;
const CALL_COLUMNS = {
  id: 'c.sales_call_id', prospectId: 'c.prospect_id', operatorId: 'c.admin_user_id', operatorName: REP_NAME,
  businessName: 'p.business_name', businessCategory: 'p.business_category', websiteUrl: 'p.website_url',
  prospectStatus: 'p.status', timezone: 'p.timezone', state: 'c.state', phoneTestMode: TEST_CALL,
  direction: DIRECTION, prospectNumber: PROSPECT_NUMBER,
  dialedNumber: `CASE WHEN ${DIRECTION} = 'outbound' THEN ${PROSPECT_NUMBER} END`,
  callerNumber: `CASE WHEN ${DIRECTION} = 'inbound' THEN c.metadata_json->>'prospect_number' END`,
  contactId: "c.metadata_json->>'contact_id'", numberId: "c.metadata_json->>'number_id'",
  outcome: 'c.outcome', dispositions: "c.metadata_json->'dispositions'", outcomeNotes: 'c.outcome_notes', liveNotes: 'c.live_notes',
  aiState: 'c.ai_state', providerErrorCode: 'c.provider_error_code',
  hasTranscript: "c.transcript_json IS NOT NULL AND c.transcript_json NOT IN ('null'::jsonb, '[]'::jsonb)",
  hasRecording: "NULLIF(c.recording_url, '') IS NOT NULL",
  sessionSeconds: SESSION_DURATION, connectedSeconds: CONNECTED_DURATION, demoSeconds: DEMO_DURATION,
};
for (const [key, source] of Object.entries({ contactName: 'displayName', contactFirstName: 'firstName', contactLastName: 'lastName',
  contactTitle: 'title', contactEmail: 'email', numberType: 'numberType', numberLabel: 'numberLabel' })) {
  CALL_COLUMNS[key] = `c.metadata_json->'contact_snapshot'->>'${source}'`;
}
for (const [key, source] of Object.entries({ contactDecisionMaker: 'decisionMaker', contactInfluencer: 'influencer' })) {
  CALL_COLUMNS[key] = `CASE c.metadata_json->'contact_snapshot'->>'${source}' WHEN 'true' THEN TRUE WHEN 'false' THEN FALSE END`;
}
for (const key of ['createdAt', 'updatedAt', 'startedAt', 'connectedAt', 'demoStartedAt', 'demoEndedAt', 'endedAt',
  'outcomeRecordedAt', 'callbackAt', 'linkSentAt', 'bookedAt', 'paidAt', 'conferenceId', 'operatorLegId', 'operatorSessionId',
  'prospectLegId', 'prospectSessionId', 'aiTelnyxLegId', 'aiTelnyxSessionId', 'openaiCallId']) {
  CALL_COLUMNS[key] = 'c.' + key.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
}
const SELECT_CALL = SALES_REPORT_FIELDS.flatMap(([, fields]) => fields)
  .map(([key]) => `${CALL_COLUMNS[key]} AS "${key}"`).join(',\n');

function reportWhere(filters) {
  const params = [], clauses = [];
  const bind = value => { params.push(value); return `$${params.length}`; };
  if (filters.range !== 'all') clauses.push(`c.created_at >= ${bind(filters.from)}::date::timestamp AT TIME ZONE 'UTC'`,
    `c.created_at < (${bind(filters.to)}::date + 1)::timestamp AT TIME ZONE 'UTC'`);
  if (filters.mode !== 'all') clauses.push(`${TEST_CALL} = ${filters.mode === 'test' ? 'TRUE' : 'FALSE'}`);
  if (filters.direction !== 'all') clauses.push(`${DIRECTION} = ${bind(filters.direction)}`);
  if (filters.operator === 'unassigned') clauses.push('c.admin_user_id IS NULL');
  else if (filters.operator) clauses.push(`c.admin_user_id = ${bind(Number(filters.operator))}`);
  if (filters.outcome) clauses.push(`COALESCE(NULLIF(c.outcome, ''), 'not_recorded') = ${bind(filters.outcome)}`);
  if (filters.state) clauses.push(`c.state = ${bind(filters.state)}`);
  if (filters.search) {
    const search = bind('%' + filters.search.replace(/[\\%_]/g, value => '\\' + value) + '%');
    clauses.push(`(p.business_name ILIKE ${search} OR c.sales_call_id ILIKE ${search}
      OR ${PROSPECT_NUMBER} ILIKE ${search}
      OR c.metadata_json->'contact_snapshot'->>'displayName' ILIKE ${search})`);
  }
  return { where: clauses.join(' AND ') || 'TRUE', params };
}
function pageOptions(query, filters) {
  const limit = query.limit ?? '100';
  if (!/^(?:[1-9]\d?|100)$/.test(String(limit)) || (typeof limit !== 'string' && typeof limit !== 'number')) {
    throw salesError('invalid_report_page', 'Choose a page size from 1 to 100.', 400);
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(filters)).digest('hex');
  let cursor = null;
  if (query.cursor) {
    try {
      if (typeof query.cursor !== 'string' || query.cursor.length > 2000) throw Error();
      cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
      if (cursor.filter !== fingerprint || typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 300
        || typeof cursor.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.at)
        || !Number.isFinite(Date.parse(cursor.at))) throw Error();
    } catch { throw salesError('invalid_report_cursor', 'Refresh the report before changing pages.', 400); }
  }
  return { limit: Number(limit), cursor, fingerprint };
}
function serializeCall(row) {
  const result = Object.fromEntries(SALES_REPORT_FIELDS.flatMap(([, fields]) => fields).map(([key]) => [key, row[key] ?? null]));
  result.dispositions = callDispositions({ outcome: row.outcome, dispositions: row.dispositions });
  if (result.operatorId !== null) result.operatorId = Number(result.operatorId);
  return result;
}
async function consistentRead(pool, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function getSalesReport(pool, query = {}) {
  const filters = salesReportFilters(query), paging = pageOptions(query, filters);
  const { where, params } = reportWhere(filters);
  return consistentRead(pool, async db => {
    const reps = await db.query(`SELECT u.id, ${REP_NAME} AS name, u.role
      FROM admin_users u LEFT JOIN sales_operator_settings s ON s.admin_user_id = u.id
      WHERE u.role IN ('sales', 'admin', 'super_admin') OR EXISTS (
        SELECT 1 FROM sales_call_sessions c WHERE c.admin_user_id = u.id) ORDER BY name, u.id`);
    const summary = await db.query(`SELECT c.admin_user_id AS "operatorId", ${REP_NAME} AS "operatorName", ${METRICS}
      ${JOINS} WHERE ${where} GROUP BY c.admin_user_id, u.username, u.email, s.display_name
      ORDER BY sessions DESC, "operatorName", c.admin_user_id`, params);
    const outcomes = await db.query(`SELECT COALESCE(NULLIF(c.outcome, ''), 'not_recorded') AS outcome, COUNT(*)::int AS count
      ${JOINS} WHERE ${where} GROUP BY COALESCE(NULLIF(c.outcome, ''), 'not_recorded') ORDER BY count DESC, outcome`, params);
    const states = await db.query(`SELECT c.state, COUNT(*)::int AS count ${JOINS} WHERE ${where} GROUP BY c.state ORDER BY count DESC, c.state`, params);
    // All-time charts use monthly buckets to keep decades of history readable. Bounded windows use UTC days.
    const interval = filters.range === 'all' ? 'month' : 'day';
    const activity = await db.query(`SELECT to_char(date_trunc('${interval}', c.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
      ${METRICS} ${JOINS} WHERE ${where} GROUP BY 1 ORDER BY 1`, params);
    const durations = await db.query(`SELECT COUNT(${SESSION_DURATION})::int AS "sessionCount", AVG(${SESSION_DURATION})::float8 AS "averageSessionSeconds",
      COUNT(${CONNECTED_DURATION})::int AS "connectedCount", AVG(${CONNECTED_DURATION})::float8 AS "averageConnectedSeconds",
      COUNT(${DEMO_DURATION})::int AS "demoCount", AVG(${DEMO_DURATION})::float8 AS "averageDemoSeconds",
      COUNT(*) FILTER (WHERE ${CONNECTED_DURATION} < 60)::int AS "underMinute",
      COUNT(*) FILTER (WHERE ${CONNECTED_DURATION} >= 60 AND ${CONNECTED_DURATION} < 180)::int AS "oneToThree",
      COUNT(*) FILTER (WHERE ${CONNECTED_DURATION} >= 180 AND ${CONNECTED_DURATION} < 600)::int AS "threeToTen",
      COUNT(*) FILTER (WHERE ${CONNECTED_DURATION} >= 600)::int AS "tenPlus"
      ${JOINS} WHERE ${where}`, params);
    const pageParams = [...params];
    let pageWhere = where;
    if (paging.cursor) {
      pageParams.push(paging.cursor.at, paging.cursor.id);
      pageWhere += ` AND (c.created_at, c.sales_call_id) < ($${pageParams.length - 1}::timestamptz, $${pageParams.length}::text)`;
    }
    pageParams.push(paging.limit + 1);
    const records = await db.query(`SELECT ${SELECT_CALL}, to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt"
      ${JOINS} WHERE ${pageWhere} ORDER BY c.created_at DESC, c.sales_call_id DESC LIMIT $${pageParams.length}`, pageParams);
    const hasMore = records.rows.length > paging.limit, rows = records.rows.slice(0, paging.limit), last = rows.at(-1);
    const nextCursor = hasMore ? Buffer.from(JSON.stringify({ at: last.cursorAt, id: last.id, filter: paging.fingerprint })).toString('base64url') : null;
    const totals = summary.rows.reduce((total, row) => {
      for (const key of Object.keys(total)) total[key] += Number(row[key]);
      return total;
    }, { sessions: 0, connected: 0, demosStarted: 0, ended: 0, outcomesRecorded: 0 });
    return { filters, reps: reps.rows, summary: summary.rows, outcomes: outcomes.rows, states: states.rows,
      activity: activity.rows, activityInterval: interval, durations: durations.rows[0],
      recent: rows.map(serializeCall), totals, nextCursor, pageSize: paging.limit, exportLimit: SALES_REPORT_EXPORT_LIMIT };
  });
}

export async function exportSalesReport(pool, query = {}) {
  const filters = salesReportFilters(query), { where, params } = reportWhere(filters);
  return consistentRead(pool, async db => {
    const count = await db.query(`SELECT COUNT(*)::int AS count ${JOINS} WHERE ${where}`, params);
    if (count.rows[0].count > SALES_REPORT_EXPORT_LIMIT) throw salesError('report_export_too_large',
      `Export supports up to ${SALES_REPORT_EXPORT_LIMIT.toLocaleString('en-US')} calls. Narrow the dates, rep, or other filters; no rows were exported.`, 400);
    const records = await db.query(`SELECT ${SELECT_CALL} ${JOINS} WHERE ${where}
      ORDER BY c.created_at DESC, c.sales_call_id DESC`, params);
    return salesReportCsv(records.rows.map(serializeCall));
  });
}

// A separate bounded read keeps day selection independent of report pagination.
export async function getSalesReportDay(pool, query = {}) {
  const filters = salesReportFilters(query);
  // The table is a creation cohort. A daily timeline instead needs every
  // overlapping session, including those created before the range boundary.
  const { where, params } = reportWhere({ ...filters, range: 'all' });
  const requested = query.day;
  if (requested !== undefined && (typeof requested !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(requested)
    || !Number.isFinite(Date.parse(requested)) || new Date(requested).toISOString().slice(0, 10) !== requested
    || (filters.range !== 'all' && (requested < filters.from || requested > filters.to)))) {
    throw salesError('invalid_report_day', 'Choose a valid Pacific day within the applied report range.', 400);
  }
  return consistentRead(pool, async db => {
    const bounds = await db.query(`SELECT
      to_char(MIN(${TIMELINE_START}) AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD') AS first,
      to_char(MAX(CASE WHEN ${TIMELINE_VALID} THEN c.ended_at ELSE ${TIMELINE_START} END) AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD') AS last,
      to_char(MAX(${TIMELINE_START}) AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD') AS latest
      ${JOINS} WHERE ${where}`, params);
    const history = bounds.rows[0];
    const from = filters.range === 'all' ? history.first : filters.from;
    const to = filters.range === 'all' ? history.last : filters.to;
    if (requested && (!from || requested < from || requested > to)) {
      throw salesError('invalid_report_day', 'Choose a Pacific day within the matching call history.', 400);
    }
    const day = requested || (history.latest && history.latest >= from && history.latest <= to ? history.latest : to);
    if (!day) return { filters, from, to, day: null, calls: [], prior: [], limit: TIMELINE_LIMIT };
    // Resolve each local midnight independently: DST days contain 23 or 25 hours.
    const dayBounds = await db.query(`SELECT
      $1::date::timestamp AT TIME ZONE 'America/Los_Angeles' AS "dayStart",
      ($1::date + 1)::timestamp AT TIME ZONE 'America/Los_Angeles' AS "dayEnd"`, [day]);
    const { dayStart, dayEnd } = dayBounds.rows[0];
    const values = [...params, dayStart, dayEnd], start = `$${values.length - 1}::timestamptz`, end = `$${values.length}::timestamptz`;
    const records = await db.query(`SELECT c.sales_call_id AS id, c.admin_user_id AS "operatorId", ${REP_NAME} AS "operatorName",
      p.business_name AS "businessName", c.state, c.created_at AS "createdAt", c.started_at AS "startedAt",
      c.connected_at AS "connectedAt", c.ended_at AS "endedAt"
      ${JOINS} WHERE ${where} AND ${TIMELINE_START} < ${end}
      AND (${TIMELINE_START} >= ${start} OR (${TIMELINE_VALID} AND c.ended_at > ${start}))
      ORDER BY ${TIMELINE_START}, c.sales_call_id LIMIT ${TIMELINE_LIMIT + 1}`, values);
    if (records.rows.length > TIMELINE_LIMIT) throw salesError('report_day_too_large',
      `The timeline supports up to ${TIMELINE_LIMIT.toLocaleString('en-US')} sessions per day. Narrow the rep or other filters; no partial timeline is shown.`, 400);
    // Earlier unresolved sessions prevent false idle claims. Keep only per-rep
    // timing aggregates, never load the entire matching call history.
    const prior = await db.query(`SELECT c.admin_user_id AS "operatorId",
      BOOL_OR(NOT ${TIMELINE_VALID} AND NOT (c.state IN ('closed', 'failed', 'ended', 'completed', 'canceled', 'cancelled')
        AND c.updated_at >= ${TIMELINE_START} AND c.updated_at <= ${start})) AS uncertain,
      MAX(c.ended_at) FILTER (WHERE ${TIMELINE_VALID} AND c.ended_at <= ${start}) AS "endedAt"
      ${JOINS} WHERE ${where} AND ${TIMELINE_START} < ${start} GROUP BY c.admin_user_id`, values.slice(0, -1));
    return { filters, from, to, day, dayStart, dayEnd, timeZone: 'America/Los_Angeles', calls: records.rows, prior: prior.rows, limit: TIMELINE_LIMIT };
  });
}

// Read full transcript text only on demand; never return provider event payloads or recording URLs.
export async function getSalesReportTranscript(pool, callId) {
  if (typeof callId !== 'string' || !callId || callId.length > 300) {
    throw salesError('invalid_report_call', 'Choose a valid call.', 400);
  }
  const result = await pool.query(`SELECT c.sales_call_id AS id,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('text', item->>'text',
      'role', CASE WHEN item->>'role' IN ('caller', 'assistant', 'operator') THEN item->>'role' END,
      'at', item->>'at') ORDER BY ordinal), '[]'::jsonb)
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.transcript_json) = 'array' THEN c.transcript_json ELSE '[]'::jsonb END)
        WITH ORDINALITY AS entries(item, ordinal) WHERE jsonb_typeof(item->'text') = 'string') AS transcript
    FROM sales_call_sessions c WHERE c.sales_call_id = $1`, [callId]);
  if (!result.rows.length) throw salesError('sales_call_not_found', 'Call not found.', 404);
  return result.rows[0];
}
