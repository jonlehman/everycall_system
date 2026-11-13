import { createHash } from 'node:crypto';

// Read-only CDR search. No call-control commands or internal-clock fallback.
// Contract: https://developers.telnyx.com/api-reference/detail-records/search-detail-records
// Field names confirmed against call-control records on 2026-11-13.
const PAGE_SIZE = 50, MAX_PAGES = 40, MAX_BYTES = 2 * 1024 * 1024;
const cache = new Map();
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 300 ? value : null;
// Preserve provider sub-millisecond precision, including when normalizing offsets.
const instant = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString().slice(0, 19) + '.' + (value.match(/\.(\d+)/)?.[1] || '').padEnd(9, '0') + 'Z';
};
const flag = value => value === 1 || value === true ? true : value === 0 || value === false ? false : null;
const seconds = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
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
    scope: 'Configured Sales application call-control records starting in the selected Pacific date window, plus completed records overlapping its start.',
    limits: 'Telnyx retention and finalization delay are not guaranteed by this endpoint. Recent or in-progress calls may be absent. This does not establish all work or all calls.' };
  if (!env.SALES_TELNYX_API_KEY) return { ...base, status: 'unavailable', reason: 'credential_unavailable' };
  if (!connectionId) return { ...base, status: 'unavailable', reason: 'sales_connection_unconfigured' };
  if (!Number.isFinite(Date.parse(dayStart)) || !Number.isFinite(Date.parse(dayEnd)) || !(new Date(dayEnd) > new Date(dayStart))) return { ...base, status: 'unavailable', reason: 'invalid_bounds' };
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
        if (expectedPages + pagesRead - page > maxPages) throw failed('page_limit');
        let added = 0;
        for (const row of json.data) {
          if (!identifier(row.id) || !identifier(row.connection_id)) throw failed('invalid_record');
          if (!seenRaw.has(row.id)) { seenRaw.add(row.id); added++; }
          if (row.connection_id !== connectionId) { base.excludedConnectionRecords++; continue; }
          const record = { id: identifier(row.id), legId: identifier(row.telnyx_leg_id), sessionId: identifier(row.telnyx_session_id),
            connectionId: identifier(row.connection_id), startedAt: instant(row.started_at), endedAt: instant(row.finished_at),
            direction: ['inbound', 'outbound'].includes(row.direction) ? row.direction : null,
            attempted: flag(row.attempted), connected: flag(row.connected), completed: flag(row.completed),
            callSeconds: seconds(row.call_sec), billedSeconds: seconds(row.billed_sec),
            callerNumber: identifier(row.caller_number), destinationNumber: identifier(row.dest_number),
            callerName: identifier(row.caller_name), connectionName: identifier(row.connection_name),
            countryCode: identifier(row.country_code), sourceCountryCode: identifier(row.source_country_code) };
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
