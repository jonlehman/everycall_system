import { createHash } from 'node:crypto';
import { getSalesTelnyxRecords } from './salesTelnyxRecords.js';
import { salesError } from './salesRepository.js';
import { SALES_REPORT_FIELDS, SALES_REPORT_EXPORT_LIMIT, salesReportCsv } from '../../../lib/salesReportFields.js';

const ZONE = 'America/Los_Angeles';
const dateLabel = value => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const REP_NAME = "COALESCE(NULLIF(s.display_name, ''), NULLIF(u.username, ''), u.email, 'Unassigned / deleted user')";
const STATUS = ['completed', 'connected_not_completed', 'attempted_not_connected', 'not_attempted', 'unknown'];
const stale = () => salesError('report_snapshot_changed', 'The Telnyx dataset or matched labels changed. Update the report before paging, exporting, or selecting a day.', 409);

export function salesReportFilters(query = {}, now = new Date()) {
  const to = query.to ?? dateLabel(now);
  const from = query.from ?? new Date(Date.parse(dateLabel(now)) - 29 * 86400000).toISOString().slice(0, 10);
  if ((query.range !== undefined && query.range !== 'dates') || !validDate(from) || !validDate(to) || from > to || Date.parse(to) - Date.parse(from) > 30 * 86400000) {
    throw salesError('invalid_report_dates', 'Choose a Pacific date window of at most 31 days. All time is unavailable because provider retention is not guaranteed.', 400);
  }
  // Fail old clients explicitly: these filters describe EveryCall workflow, not CDR facts.
  if ((query.mode !== undefined && query.mode !== 'all') || query.outcome || query.state) {
    throw salesError('unsupported_report_filter', 'This report now uses Telnyx records. Refresh to use provider status filters; app mode, outcome and state filters are unavailable.', 400);
  }
  const operator = query.operator ?? '', direction = query.direction ?? 'all', status = query.status ?? '', search = query.search ?? '';
  if (typeof operator !== 'string' || (operator && operator !== 'unassigned' && (!/^[1-9]\d*$/.test(operator) || !Number.isSafeInteger(Number(operator))))) throw salesError('invalid_report_operator', 'Choose a valid sales rep.', 400);
  if (!['all', 'inbound', 'outbound', 'unknown'].includes(direction)) throw salesError('invalid_report_direction', 'Choose a valid provider direction.', 400);
  if ((status && !STATUS.includes(status)) || typeof status !== 'string' || typeof search !== 'string' || search.length > 120) throw salesError('invalid_report_filter', 'Choose a valid provider status and search of at most 120 characters.', 400);
  return { from, to, operator, direction, status, search: search.trim(), range: 'dates' };
}

function pageOptions(query) {
  const limit = query.limit ?? '100';
  if (!['string', 'number'].includes(typeof limit) || !/^(?:[1-9]\d?|100)$/.test(String(limit))) throw salesError('invalid_report_page', 'Choose a page size from 1 to 100.', 400);
  let cursor = null;
  if (query.cursor) {
    try {
      if (typeof query.cursor !== 'string' || query.cursor.length > 2000) throw Error();
      cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
      if (typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 300 || !/^[a-f0-9]{64}$/.test(cursor.snapshot)) throw Error();
    } catch { throw salesError('invalid_report_cursor', 'Update the report before changing pages.', 400); }
  }
  if (query.snapshot !== undefined && (typeof query.snapshot !== 'string' || !/^[a-f0-9]{64}$/.test(query.snapshot))) throw stale();
  return { limit: Number(limit), cursor };
}

function providerStatus(record) {
  if (record.completed === true) return 'completed';
  if (record.connected === true && record.completed === false) return 'connected_not_completed';
  if (record.attempted === true && record.connected === false) return 'attempted_not_connected';
  if (record.attempted === false && record.connected === false && record.completed === false) return 'not_attempted';
  return 'unknown';
}

// All matching is by saved provider identities. Phone/time proximity and current
// prospect ownership never establish rep attribution. Query across local history.
async function enrichProviderRecords(pool, provider) {
  const ids = provider.records.map(row => row.legId), sessions = provider.records.map(row => row.sessionId);
  const joined = await pool.query(`SELECT c.sales_call_id AS id, c.admin_user_id AS "operatorId", ${REP_NAME} AS "operatorName",
    p.business_name AS "businessName", c.prospect_leg_id AS "prospectLegId", c.prospect_session_id AS "prospectSessionId",
    c.operator_leg_id AS "operatorLegId", c.operator_session_id AS "operatorSessionId",
    c.ai_telnyx_leg_id AS "aiLegId", c.ai_telnyx_session_id AS "aiSessionId"
    FROM sales_call_sessions c LEFT JOIN sales_prospects p ON p.prospect_id = c.prospect_id
    LEFT JOIN admin_users u ON u.id = c.admin_user_id LEFT JOIN sales_operator_settings s ON s.admin_user_id = c.admin_user_id
    WHERE c.prospect_leg_id = ANY($1::text[]) OR c.operator_leg_id = ANY($1::text[]) OR c.ai_telnyx_leg_id = ANY($1::text[])
      OR c.prospect_session_id = ANY($2::text[]) OR c.operator_session_id = ANY($2::text[]) OR c.ai_telnyx_session_id = ANY($2::text[])
    LIMIT 10001`, [ids, sessions]);
  if (joined.rows.length > 10000) throw salesError('report_identity_limit', 'Too many identity matches. Narrow the dates; no partial report is shown.', 400);
  const legs = new Map(), sessionRows = new Map(), excludedLegs = new Set(), excludedSessions = new Set();
  const add = (map, id, row) => { if (id) map.set(id, [...(map.get(id) || []), row]); };
  for (const row of joined.rows) {
    add(legs, row.prospectLegId, row); add(sessionRows, row.prospectSessionId, row);
    [row.operatorLegId, row.aiLegId].filter(Boolean).forEach(id => excludedLegs.add(id));
    [row.operatorSessionId, row.aiSessionId].filter(Boolean).forEach(id => excludedSessions.add(id));
  }
  let excludedOperatorAiRecords = 0, excludedConnectionRecords = provider.excludedConnectionRecords || 0;
  const scoped = provider.records.filter(record => {
    if (!provider.connectionId || record.connectionId !== provider.connectionId) { excludedConnectionRecords++; return false; }
    if (excludedLegs.has(record.legId) || excludedSessions.has(record.sessionId)) { excludedOperatorAiRecords++; return false; }
    return true;
  });
  const counts = new Map(); scoped.forEach(record => counts.set(record.sessionId, (counts.get(record.sessionId) || 0) + 1));
  const rows = scoped.map(record => {
    const exactLeg = legs.get(record.legId) || [], exactSession = sessionRows.get(record.sessionId) || [];
    const candidates = [...new Map([...exactLeg, ...exactSession].map(row => [row.id, row])).values()];
    const matched = candidates.length === 1 && !(exactLeg.length && candidates[0].prospectSessionId && candidates[0].prospectSessionId !== record.sessionId);
    const local = matched ? candidates[0] : null;
    const elapsed = record.endedAt && record.endedAt >= record.startedAt ? (Date.parse(record.endedAt) - Date.parse(record.startedAt)) / 1000 : null;
    return { id: record.id, providerLegId: record.legId, providerSessionId: record.sessionId, providerConnectionId: record.connectionId,
      connectionName: record.connectionName, direction: record.direction, status: providerStatus(record),
      attempted: record.attempted, connected: record.connected, completed: record.completed,
      startedAt: record.startedAt, endedAt: record.endedAt, elapsedSeconds: elapsed,
      callSeconds: record.callSeconds, billedSeconds: record.billedSeconds,
      callerNumber: record.callerNumber, destinationNumber: record.destinationNumber, callerName: record.callerName,
      countryCode: record.countryCode, sourceCountryCode: record.sourceCountryCode,
      operatorId: local?.operatorId == null ? null : Number(local.operatorId), operatorName: local?.operatorName || 'Unassigned / unclassified',
      businessName: local?.businessName || null, salesCallId: local?.id || null,
      matchMethod: matched ? exactLeg.length ? 'exact_prospect_leg' : 'exact_prospect_session' : null,
      classification: matched ? 'matched_prospect' : candidates.length ? 'ambiguous_identity' : 'unmatched_identity',
      relatedLeg: counts.get(record.sessionId) > 1, source: 'telnyx', retrievedAt: provider.retrievedAt,
      coverageNotice: provider.limits };
  });
  return { rows, excludedOperatorAiRecords, excludedConnectionRecords };
}

async function cohort(pool, query, options = {}) {
  const { loadProvider = getSalesTelnyxRecords, actorId } = options;
  const self = Object.prototype.hasOwnProperty.call(options, 'actorId');
  // actorId is an authenticated server option, never a client filter.
  if (self && (!Number.isSafeInteger(actorId) || actorId <= 0)) throw salesError('forbidden', 'Report access unavailable.', 403);
  const filters = salesReportFilters(query), paging = pageOptions(query);
  if (self) filters.operator = String(actorId);
  const bounds = (await pool.query(`SELECT $1::date::timestamp AT TIME ZONE 'America/Los_Angeles' AS "dayStart",
    ($2::date + 1)::timestamp AT TIME ZONE 'America/Los_Angeles' AS "dayEnd"`, [filters.from, filters.to])).rows[0];
  const provider = await loadProvider(bounds);
  if (provider.status !== 'available' || !provider.paginationComplete) throw salesError('telnyx_records_unavailable',
    self ? 'Telnyx records unavailable or incomplete. Narrow the dates or retry. No partial totals are shown.' : `Telnyx records unavailable or incomplete (${provider.reason || 'incomplete_retrieval'}). Narrow the dates or retry. No partial totals or internal records are substituted.`, 503);
  const enriched = await enrichProviderRecords(pool, provider);
  const matches = row => (!filters.operator || (filters.operator === 'unassigned' ? row.operatorId === null : String(row.operatorId) === filters.operator))
    && (filters.direction === 'all' || (row.direction || 'unknown') === filters.direction)
    && (!filters.status || row.status === filters.status)
    && (!filters.search || [row.id, row.providerLegId, row.providerSessionId, row.businessName, row.callerNumber, row.destinationNumber, row.callerName].some(value => String(value || '').toLowerCase().includes(filters.search.toLowerCase())));
  const authorized = self ? enriched.rows.filter(row => row.classification === 'matched_prospect' && row.operatorId === actorId) : enriched.rows;
  if (self) {
    const counts = new Map();
    authorized.forEach(row => counts.set(row.providerSessionId, (counts.get(row.providerSessionId) || 0) + 1));
    authorized.forEach(row => { row.relatedLeg = counts.get(row.providerSessionId) > 1; });
  }
  const all = authorized.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
  // Exclude retrieval time from identity: identical re-reads can safely continue.
  // Include the entire provider and enrichment dataset, even records hidden by filters.
  const snapshot = self ? digest({ audience: 'sales-self', actorId, filters, rows: all.map(({ retrievedAt, ...row }) => row) }) : digest({ filters, connectionId: provider.connectionId, excluded: [enriched.excludedOperatorAiRecords, enriched.excludedConnectionRecords],
    records: provider.records, rows: all.map(({ retrievedAt, ...row }) => row) });
  if ((paging.cursor && paging.cursor.snapshot !== snapshot) || (query.snapshot && query.snapshot !== snapshot)) throw stale();
  all.forEach(row => { row.snapshot = snapshot; });
  const filtered = all.filter(matches);
  const rows = filtered.filter(row => Date.parse(row.startedAt) >= Date.parse(bounds.dayStart));
  const reps = [...new Map(all.filter(row => row.operatorId !== null).map(row => [row.operatorId, { id: row.operatorId, name: row.operatorName }])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const coverage = self ? { source: 'telnyx', status: 'available', paginationComplete: true, retrievedAt: provider.retrievedAt,
    matchedRecords: all.length, relatedRecords: all.filter(row => row.relatedLeg).length, filteredRecords: rows.length,
    overlapRecords: filtered.length - rows.length, gapsAvailable: false, audience: 'self',
    scope: 'Only records matched to your original Sales call identity.', limits: provider.limits, snapshot, timeZone: ZONE
  } : { source: 'telnyx', status: 'available', paginationComplete: true, retrievedAt: provider.retrievedAt,
    connectionId: provider.connectionId, pagesRead: provider.pagesRead, providerRecords: provider.records.length,
    excludedOperatorAiRecords: enriched.excludedOperatorAiRecords, excludedConnectionRecords: enriched.excludedConnectionRecords,
    matchedRecords: all.filter(row => row.classification === 'matched_prospect').length,
    unmatchedRecords: all.filter(row => row.classification === 'unmatched_identity').length,
    ambiguousRecords: all.filter(row => row.classification === 'ambiguous_identity').length,
    relatedRecords: all.filter(row => row.relatedLeg).length, filteredRecords: rows.length,
    overlapRecords: filtered.length - rows.length, gapsAvailable: false, scope: provider.scope, limits: provider.limits,
    snapshot, timeZone: ZONE };
  return { filters, paging, bounds, rows, filtered, reps, coverage, snapshot };
}

function aggregate(rows) {
  const result = { records: rows.length, uniqueSessions: new Set(rows.map(row => row.providerSessionId)).size };
  for (const flag of ['attempted', 'connected', 'completed']) {
    result[flag] = rows.filter(row => row[flag] === true).length;
    result[`${flag}Unknown`] = rows.filter(row => row[flag] == null).length;
  }
  return result;
}
function group(rows, key) {
  const groups = new Map();
  for (const row of rows) { const value = key(row); groups.set(value, [...(groups.get(value) || []), row]); }
  return [...groups.entries()];
}
function publicRow(row) { return Object.fromEntries(SALES_REPORT_FIELDS.flatMap(([, fields]) => fields).map(([key]) => [key, row[key] ?? null])); }

export async function getSalesReport(pool, query = {}, options) {
  const data = await cohort(pool, query, options), { rows, filters, paging, snapshot } = data;
  let offset = 0;
  if (paging.cursor) { const index = rows.findIndex(row => row.id === paging.cursor.id); if (index < 0) throw stale(); offset = index + 1; }
  const recent = rows.slice(offset, offset + paging.limit), last = recent.at(-1);
  const nextCursor = offset + paging.limit < rows.length ? Buffer.from(JSON.stringify({ id: last.id, snapshot })).toString('base64url') : null;
  const durations = {};
  for (const key of ['elapsedSeconds', 'callSeconds', 'billedSeconds']) {
    const values = rows.map(row => row[key]).filter(value => value !== null && value !== undefined);
    durations[`${key}Count`] = values.length;
    durations[`${key}Average`] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    durations[`${key}Total`] = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  const values = rows.map(row => row.callSeconds).filter(value => value != null);
  Object.assign(durations, { underMinute: values.filter(v => v < 60).length, oneToThree: values.filter(v => v >= 60 && v < 180).length,
    threeToTen: values.filter(v => v >= 180 && v < 600).length, tenPlus: values.filter(v => v >= 600).length, unknown: rows.length - values.length });
  return { filters, reps: data.reps, coverage: data.coverage, snapshot, totals: aggregate(rows),
    summary: group(rows, row => row.operatorId).map(([operatorId, records]) => ({ operatorId, operatorName: records[0].operatorName, ...aggregate(records) })),
    statuses: group(rows, row => row.status).map(([status, records]) => ({ status, count: records.length })),
    activity: group(rows, row => dateLabel(row.startedAt)).map(([date, records]) => ({ date, ...aggregate(records) })).sort((a, b) => a.date.localeCompare(b.date)),
    activityInterval: 'day', durations, recent: recent.map(publicRow), nextCursor, pageSize: paging.limit, offset, exportLimit: SALES_REPORT_EXPORT_LIMIT };
}

export async function exportSalesReport(pool, query = {}, options) {
  const data = await cohort(pool, query, options);
  if (data.rows.length > SALES_REPORT_EXPORT_LIMIT) throw salesError('report_export_too_large', `Export supports up to ${SALES_REPORT_EXPORT_LIMIT} provider records. Narrow the dates; no rows were exported.`, 400);
  return salesReportCsv(data.rows.map(publicRow));
}

export async function getSalesReportDay(pool, query = {}, options) {
  const filters = salesReportFilters(query), day = query.day ?? filters.to;
  if (!validDate(day) || day < filters.from || day > filters.to) throw salesError('invalid_report_day', 'Choose a valid Pacific day within the applied report range.', 400);
  const data = await cohort(pool, query, options);
  const bounds = (await pool.query(`SELECT $1::date::timestamp AT TIME ZONE 'America/Los_Angeles' AS "dayStart",
    ($1::date + 1)::timestamp AT TIME ZONE 'America/Los_Angeles' AS "dayEnd"`, [day])).rows[0];
  const calls = data.filtered.filter(row => Date.parse(row.startedAt) < Date.parse(bounds.dayEnd)
    && (Date.parse(row.startedAt) >= Date.parse(bounds.dayStart) || Date.parse(row.endedAt) > Date.parse(bounds.dayStart))).map(publicRow);
  return { filters: data.filters, from: filters.from, to: filters.to, day, ...bounds, timeZone: ZONE, calls,
    prior: [...new Set(calls.map(row => row.operatorId))].map(operatorId => ({ operatorId, uncertain: true })),
    coverage: { ...data.coverage, matchedRecords: calls.length, currentDay: Date.parse(bounds.dayEnd) > Date.parse(data.coverage.retrievedAt),
      missingSessions: null }, snapshot: data.snapshot, missing: [], unresolved: [], unmatched: [] };
}

export async function getSalesReportTranscript() {
  throw salesError('unsupported_report_detail', 'Telnyx detail records do not supply a transcript. EveryCall session transcripts are not part of this provider report.', 400);
}
