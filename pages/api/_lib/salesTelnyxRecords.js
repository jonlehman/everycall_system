import { createHash } from 'node:crypto';

// Read-only CDR search. No call-control commands or internal-clock fallback.
// Contract: https://developers.telnyx.com/api-reference/detail-records/search-detail-records
// Field names confirmed against call-control records on 2026-11-13.
const PAGE_SIZE = 50, MAX_PAGES = 40, MAX_BYTES = 2 * 1024 * 1024;
const cache = new Map();
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 300 ? value : null;
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const failed = reason => Object.assign(new Error(reason), { reason });

async function readJson(response) {
  // Keep the deadline active while consuming the body, and bound payload size.
  const reader = response.body?.getReader();
  if (!reader) throw failed('invalid_response');
  const chunks = []; let bytes = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    bytes += next.value.length;
    if (bytes > MAX_BYTES) { await reader.cancel(); throw failed('response_too_large'); }
    chunks.push(Buffer.from(next.value));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failed('invalid_response'); }
}

export async function fetchSalesTelnyxRecords({ dayStart, dayEnd, env = process.env, fetchImpl = globalThis.fetch, now = Date.now, maxPages = MAX_PAGES }) {
  const retrievedAt = new Date(now()).toISOString();
  const connectionId = identifier(env.SALES_TELNYX_CALL_CONTROL_APP_ID);
  const base = { source: 'telnyx', connectionId, excludedConnectionRecords: 0, retrievedAt, paginationComplete: false, pagesRead: 0, records: [],
    scope: 'Configured Sales application call-control records starting in the Pacific day, plus completed records overlapping its start.',
    limits: 'Telnyx retention and finalization delay are not guaranteed by this endpoint. Recent or in-progress calls may be absent. This does not establish all work or all calls.' };
  if (!env.SALES_TELNYX_API_KEY) return { ...base, status: 'unavailable', reason: 'credential_unavailable' };
  if (!connectionId) return { ...base, status: 'unavailable', reason: 'sales_connection_unconfigured' };
  if (!instant(new Date(dayStart).toISOString()) || !(new Date(dayEnd) > new Date(dayStart))) return { ...base, status: 'unavailable', reason: 'invalid_bounds' };
  const deadline = now() + 20000, seen = new Map(), seenRaw = new Set(); let pagesRead = 0, duplicate = false;
  try {
    for (const overlap of [false, true]) {
      let expectedTotal = null, expectedPages = null, received = 0;
      for (let page = 1; ; page++) {
        if (pagesRead >= maxPages) throw failed('page_limit');
        const remaining = deadline - now(); if (remaining <= 0) throw failed('timeout');
        const params = new URLSearchParams({ 'filter[record_type]': 'call-control', 'filter[connection_id]': connectionId,
          'filter[started_at][lt]': new Date(overlap ? dayStart : dayEnd).toISOString(),
          ...(overlap ? { 'filter[finished_at][gt]': new Date(dayStart).toISOString() } : { 'filter[started_at][gte]': new Date(dayStart).toISOString() }),
          'page[number]': String(page), 'page[size]': String(PAGE_SIZE), sort: 'started_at' });
        const response = await fetchImpl(`https://api.telnyx.com/v2/detail_records?${params}`, {
          method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${env.SALES_TELNYX_API_KEY}` },
          signal: AbortSignal.timeout(Math.min(6000, remaining)), cache: 'no-store',
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw failed(response.status === 429 ? 'rate_limited' : [401, 403].includes(response.status) ? 'access_denied' : 'provider_error');
        }
        const json = await readJson(response); pagesRead++;
        const meta = json?.meta;
        if (!Array.isArray(json?.data) || !meta || meta.page_number !== page || meta.page_size !== PAGE_SIZE
          || !Number.isSafeInteger(meta.total_results) || meta.total_results < 0 || !Number.isSafeInteger(meta.total_pages)
          || meta.total_pages !== Math.ceil(meta.total_results / PAGE_SIZE)
          || json.data.length !== Math.min(PAGE_SIZE, Math.max(0, meta.total_results - (page - 1) * PAGE_SIZE))) throw failed('invalid_pagination');
        if (expectedTotal !== null && (meta.total_results !== expectedTotal || meta.total_pages !== expectedPages)) throw failed('changing_results');
        expectedTotal = meta.total_results; expectedPages = meta.total_pages; received += json.data.length;
        let added = 0;
        for (const row of json.data) {
          if (!identifier(row.id) || !identifier(row.connection_id)) throw failed('invalid_record');
          if (!seenRaw.has(row.id)) { seenRaw.add(row.id); added++; }
          if (row.connection_id !== connectionId) { base.excludedConnectionRecords++; continue; }
          const record = { id: identifier(row.id), legId: identifier(row.telnyx_leg_id), sessionId: identifier(row.telnyx_session_id),
            connectionId: identifier(row.connection_id), startedAt: instant(row.started_at), endedAt: instant(row.finished_at),
            direction: ['inbound', 'outbound'].includes(row.direction) ? row.direction : null };
          if (row.record_type !== 'call-control' || !record.id || !record.legId || !record.sessionId || !record.connectionId || !record.startedAt) throw failed('invalid_record');
          const start = Date.parse(record.startedAt), end = Date.parse(record.endedAt);
          if (start >= Date.parse(dayEnd) || (overlap ? !(start < Date.parse(dayStart) && end > Date.parse(dayStart)) : start < Date.parse(dayStart))) throw failed('filter_mismatch');
          if (seen.has(record.id)) {
            if (JSON.stringify(seen.get(record.id)) !== JSON.stringify(record)) throw failed('conflicting_records');
            duplicate = true;
          } else { seen.set(record.id, record); }
        }
        if (json.data.length && !added) throw failed('repeated_page');
        if (page >= meta.total_pages) { if (received !== expectedTotal) throw failed('invalid_pagination'); break; }
      }
    }
    return { ...base, records: [...seen.values()], pagesRead, paginationComplete: !duplicate,
      status: duplicate ? 'partial' : 'available', reason: duplicate ? 'duplicate_records' : null };
  } catch (error) {
    return { ...base, records: [...seen.values()], pagesRead, status: seen.size ? 'partial' : 'unavailable',
      reason: error.reason || (['AbortError', 'TimeoutError'].includes(error.name) ? 'timeout' : 'network_error') };
  }
}

// Short process-local cache coalesces concurrent admin reads; dates/credentials are
// isolated and original retrieval time is retained. Nothing is persisted.
export async function getSalesTelnyxRecords(bounds) {
  const credential = process.env.SALES_TELNYX_API_KEY;
  if (!credential) return fetchSalesTelnyxRecords(bounds);
  const key = createHash('sha256').update(credential).update(String(bounds.dayStart)).update(String(bounds.dayEnd)).update(String(process.env.SALES_TELNYX_CALL_CONTROL_APP_ID || '')).digest('hex');
  const existing = cache.get(key); if (existing && existing.until > Date.now()) return existing.promise;
  if (cache.size >= 8) cache.delete(cache.keys().next().value);
  const entry = { until: Date.now() + 30000, promise: fetchSalesTelnyxRecords(bounds) }; cache.set(key, entry);
  return entry.promise;
}

export function reconcileSalesTelnyxRecords(provider, rows, expected, bounds) {
  const calls = [], unresolved = [], unmatchedRecords = [], matched = new Set();
  const legRows = new Map(), sessionRows = new Map(), excludedLegs = new Set(), excludedSessions = new Set();
  const add = (map, key, row) => { if (key) map.set(key, [...(map.get(key) || []), row]); };
  for (const row of rows) {
    add(legRows, row.prospectLegId, row); add(sessionRows, row.prospectSessionId, row);
    for (const value of [row.operatorLegId, row.aiLegId]) if (value) excludedLegs.add(value);
    for (const value of [row.operatorSessionId, row.aiSessionId]) if (value) excludedSessions.add(value);
  }
  const scoped = provider.records.filter(r => provider.connectionId && r.connectionId === provider.connectionId);
  const excludedConnections = (provider.excludedConnectionRecords || 0) + provider.records.length - scoped.length;
  const eligible = scoped.filter(r => !excludedLegs.has(r.legId) && !excludedSessions.has(r.sessionId));
  const sessionCounts = new Map(); for (const r of eligible) sessionCounts.set(r.sessionId, (sessionCounts.get(r.sessionId) || 0) + 1);
  let excluded = scoped.length - eligible.length, filtered = 0, unmatched = 0, ambiguous = 0;
  for (const record of eligible) {
    const exactLeg = legRows.get(record.legId) || [], exactSession = sessionRows.get(record.sessionId) || [];
    const candidates = [...new Map([...exactLeg, ...exactSession].map(r => [r.id, r])).values()];
    if (!candidates.length) { unmatched++; unmatchedRecords.push({ providerId: record.id, providerLegId: record.legId, providerSessionId: record.sessionId, startedAt: record.startedAt, endedAt: record.endedAt, direction: record.direction }); continue; }
    const row = candidates[0];
    // A session can own multiple related legs. Preserve their provider intervals
    // under the uniquely linked Sales session, but flag them and suppress gaps.
    if (candidates.length !== 1 || record.direction !== row.direction || (exactLeg.length && row.prospectSessionId && record.sessionId !== row.prospectSessionId)) {
      ambiguous++; if (candidates.some(r => r.included)) unresolved.push({ providerId: record.id, reason: 'ambiguous_identity' }); continue;
    }
    if (!row.included) { filtered++; continue; }
    const relatedLeg = exactLeg.length !== 1 && sessionCounts.get(record.sessionId) !== 1;
    if (relatedLeg) { ambiguous++; unresolved.push({ providerId: record.id, salesCallId: row.id, reason: 'multiple_related_legs' }); }
    matched.add(row.id);
    calls.push({ id: record.id, salesCallId: row.id, operatorId: row.operatorId, operatorName: row.operatorName,
      businessName: row.businessName, startedAt: record.startedAt, endedAt: record.endedAt,
      providerId: record.id, providerLegId: record.legId, providerSessionId: record.sessionId, providerConnectionId: record.connectionId,
      matchMethod: exactLeg.length ? 'exact_prospect_leg' : 'exact_prospect_session', relatedLeg, source: 'telnyx', direction: record.direction });
  }
  const missing = expected.filter(r => !matched.has(r.id)).map(r => ({ salesCallId: r.id, operatorId: r.operatorId, operatorName: r.operatorName,
    reason: provider.status === 'unavailable' ? 'provider_unavailable' : 'no_unique_provider_record' }));
  const currentDay = Date.parse(bounds.dayEnd) > Date.parse(provider.retrievedAt);
  const invalidTiming = calls.some(r => !r.endedAt || Date.parse(r.endedAt) < Date.parse(r.startedAt));
  const gapsAvailable = provider.paginationComplete && !currentDay && !missing.length && !unmatched && !ambiguous && !invalidTiming && !bounds.priorIncompleteSessions;
  const prior = gapsAvailable ? [] : [...new Set(calls.map(row => row.operatorId))].map(operatorId => ({ operatorId, uncertain: true }));
  return { calls, prior, coverage: { source: 'telnyx', status: provider.status, reason: provider.reason, retrievedAt: provider.retrievedAt,
    paginationComplete: provider.paginationComplete, pagesRead: provider.pagesRead, providerRecords: provider.records.length,
    matchedRecords: calls.length, localSessions: expected.length, excludedOperatorAiRecords: excluded, excludedConnectionRecords: excludedConnections, connectionId: provider.connectionId, filteredRecords: filtered,
    unmatchedRecords: unmatched, ambiguousRecords: ambiguous, missingSessions: missing.length, currentDay, gapsAvailable,
    priorIncompleteSessions: bounds.priorIncompleteSessions || 0, scope: provider.scope, limits: provider.limits }, unresolved, missing, unmatched: unmatchedRecords };
}
