const DAY_MS = 86400000;
const timestamp = value => value == null ? NaN : new Date(value).getTime();

// Only completed, valid sessions establish an end frontier. An unresolved
// session can overlap every later session, so do not infer idle after it.
export function salesReportTimeline(calls, day, prior = []) {
  const dayStart = Date.parse(`${day}T00:00:00Z`), dayEnd = dayStart + DAY_MS;
  const previous = new Map(prior.map(row => [String(row.operatorId ?? 'unassigned'), row]));
  const lanes = new Map();
  for (const call of calls) {
    const key = String(call.operatorId ?? 'unassigned');
    if (!lanes.has(key)) lanes.set(key, { key, name: call.operatorName, calls: [], gaps: [], uncertain: !!previous.get(key)?.uncertain });
    const lane = lanes.get(key), start = timestamp(call.startedAt), created = timestamp(call.createdAt), end = timestamp(call.endedAt);
    const at = Number.isFinite(start) ? start : created;
    const valid = Number.isFinite(start) && Number.isFinite(end) && end >= start;
    if (!Number.isFinite(at)) { lane.uncertain = true; continue; }
    lane.calls.push({ ...call, at, end: valid ? end : null, valid, startSource: Number.isFinite(start) ? 'Session start' : 'Created (start not recorded)',
      clippedStart: Math.max(dayStart, at), clippedEnd: valid ? Math.min(dayEnd, end) : null });
  }
  let windowStart = dayEnd, windowEnd = dayStart;
  for (const lane of lanes.values()) {
    lane.calls.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const previousEnd = timestamp(previous.get(lane.key)?.endedAt);
    let frontier = Number.isFinite(previousEnd) ? previousEnd : null, blocked = lane.uncertain;
    for (const call of lane.calls) {
      windowStart = Math.min(windowStart, call.clippedStart);
      windowEnd = Math.max(windowEnd, call.clippedEnd ?? call.clippedStart);
      // A missing start cannot bound the beginning of a known idle interval.
      if (call.valid && frontier !== null && call.at > frontier && !blocked && lane.key !== 'unassigned') {
        const start = Math.max(dayStart, frontier), end = Math.min(dayEnd, call.at);
        if (end > start) {
          lane.gaps.push({ start, end, seconds: (end - start) / 1000, long: end - start >= 300000 });
          windowStart = Math.min(windowStart, start);
        }
      }
      if (!call.valid) { blocked = true; lane.uncertain = true; }
      else frontier = Math.max(frontier ?? call.end, call.end);
    }
  }
  const padding = Math.max(60000, (windowEnd - windowStart) * 0.03);
  return { lanes: [...lanes.values()].sort((a, b) => a.name.localeCompare(b.name)),
    windowStart: Math.max(dayStart, windowStart - padding), windowEnd: Math.min(dayEnd, windowEnd + padding) };
}
