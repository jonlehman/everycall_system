export const SALES_TIMELINE_ZONE = 'America/Los_Angeles';
const pacificFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SALES_TIMELINE_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
  hourCycle: 'h23', timeZoneName: 'short',
});
export function salesTimelineTime(value, exact = true) {
  if (value == null || !Number.isFinite(new Date(value).getTime())) return 'Not recorded';
  const parts = Object.fromEntries(pacificFormatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  const clock = `${parts.hour}:${parts.minute}:${parts.second}`;
  return exact ? `${parts.year}-${parts.month}-${parts.day} ${clock}.${parts.fractionalSecond} ${parts.timeZoneName}` : `${clock} ${parts.timeZoneName}`;
}
const timestamp = value => value == null ? NaN : new Date(value).getTime();

// Only completed, valid sessions establish an end frontier. An unresolved
// session can overlap every later session, so do not infer idle after it.
export function salesReportTimeline(calls, bounds, prior = []) {
  const dayStart = timestamp(bounds.dayStart), dayEnd = timestamp(bounds.dayEnd);
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
    // Only sessions observed in this day can bound a gap. Earlier endings do
    // not establish that the rep was working from midnight to the first call.
    let frontier = null, blocked = lane.uncertain;
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
