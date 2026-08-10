export type RealtimeTurnTiming = {
  speechStoppedAtMs: number;
  responseCreatedAtMs: number | null;
  responseId: string | null;
};

export function startRealtimeTurnTiming(nowMs: number): RealtimeTurnTiming {
  return {
    speechStoppedAtMs: nowMs,
    responseCreatedAtMs: null,
    responseId: null
  };
}

export function noteRealtimeTurnResponseCreated(
  timing: RealtimeTurnTiming | null | undefined,
  responseId: string | null | undefined,
  nowMs: number
) {
  if (!timing) return null;
  if (timing.responseCreatedAtMs === null) {
    timing.responseCreatedAtMs = nowMs;
    timing.responseId = String(responseId || "").trim() || null;
  }
  return {
    endpoint_to_response_created_ms: Math.max(
      0,
      Number(timing.responseCreatedAtMs) - timing.speechStoppedAtMs
    )
  };
}

export function finishRealtimeTurnTiming(
  timing: RealtimeTurnTiming | null | undefined,
  nowMs: number
) {
  if (!timing) return null;
  return {
    response_id: timing.responseId,
    endpoint_to_response_created_ms: timing.responseCreatedAtMs === null
      ? null
      : Math.max(0, timing.responseCreatedAtMs - timing.speechStoppedAtMs),
    response_created_to_first_audio_ms: timing.responseCreatedAtMs === null
      ? null
      : Math.max(0, nowMs - timing.responseCreatedAtMs),
    endpoint_to_first_audio_ms: Math.max(0, nowMs - timing.speechStoppedAtMs)
  };
}
