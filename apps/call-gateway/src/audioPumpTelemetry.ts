export type AudioPumpTrace = {
  responseId: string | null;
  startedAtMs: number;
  chunksQueued: number;
  chunkBytes: number;
  firstChunkAtMs: number | null;
  lastChunkAtMs: number | null;
  interChunkGapCount: number;
  maxInterChunkGapMs: number;
  interChunkGapOverBufferTargetCount: number;
  framesSent: number;
  queueDrainCount: number;
  underrunCount: number;
  underrunStartAtMs: number | null;
  totalUnderrunMs: number;
  maxUnderrunMs: number;
  reprimeCount: number;
  terminalGapCount: number;
  totalTerminalGapMs: number;
  maxTerminalGapMs: number;
  timerLateCount: number;
  totalTimerLateMs: number;
  maxTimerLateMs: number;
  catchupBurstCount: number;
  maxBurstFrames: number;
  responseDoneAtMs: number | null;
  playbackDrainedAtMs: number | null;
  interruptedAtMs: number | null;
  gapLogsEmitted: number;
};

function normalizeResponseId(value: unknown) {
  return String(value || "").trim() || null;
}

export function createAudioPumpTrace(responseId?: string | null, nowMs = 0): AudioPumpTrace {
  return {
    responseId: normalizeResponseId(responseId),
    startedAtMs: nowMs,
    chunksQueued: 0,
    chunkBytes: 0,
    firstChunkAtMs: null,
    lastChunkAtMs: null,
    interChunkGapCount: 0,
    maxInterChunkGapMs: 0,
    interChunkGapOverBufferTargetCount: 0,
    framesSent: 0,
    queueDrainCount: 0,
    underrunCount: 0,
    underrunStartAtMs: null,
    totalUnderrunMs: 0,
    maxUnderrunMs: 0,
    reprimeCount: 0,
    terminalGapCount: 0,
    totalTerminalGapMs: 0,
    maxTerminalGapMs: 0,
    timerLateCount: 0,
    totalTimerLateMs: 0,
    maxTimerLateMs: 0,
    catchupBurstCount: 0,
    maxBurstFrames: 0,
    responseDoneAtMs: null,
    playbackDrainedAtMs: null,
    interruptedAtMs: null,
    gapLogsEmitted: 0
  };
}

export function ensureAudioPumpTraceForResponse(
  current: AudioPumpTrace | null | undefined,
  responseId?: string | null,
  nowMs = 0
) {
  const normalizedResponseId = normalizeResponseId(responseId);
  if (!current || (normalizedResponseId && current.responseId !== normalizedResponseId)) {
    return createAudioPumpTrace(normalizedResponseId, nowMs);
  }
  return current;
}

export function noteAudioChunkQueued(
  trace: AudioPumpTrace,
  chunkBytes: number,
  nowMs: number,
  bufferTargetMs: number
) {
  trace.chunksQueued += 1;
  trace.chunkBytes += Math.max(0, chunkBytes);
  if (trace.firstChunkAtMs === null) {
    trace.firstChunkAtMs = nowMs;
  }
  if (trace.lastChunkAtMs !== null) {
    const gapMs = Math.max(0, nowMs - trace.lastChunkAtMs);
    trace.interChunkGapCount += 1;
    trace.maxInterChunkGapMs = Math.max(trace.maxInterChunkGapMs, gapMs);
    if (gapMs >= bufferTargetMs) {
      trace.interChunkGapOverBufferTargetCount += 1;
    }
  }
  trace.lastChunkAtMs = nowMs;
}

export function beginAudioQueueGap(trace: AudioPumpTrace, nextFrameDueAtMs: number) {
  if (trace.underrunStartAtMs !== null) return false;
  trace.queueDrainCount += 1;
  trace.underrunStartAtMs = nextFrameDueAtMs;
  return true;
}

export function closeAudioQueueGap(trace: AudioPumpTrace | null | undefined, nowMs: number) {
  if (!trace || trace.underrunStartAtMs === null) return null;
  const durationMs = Math.max(0, nowMs - trace.underrunStartAtMs);
  trace.underrunStartAtMs = null;
  if (durationMs > 0) {
    trace.underrunCount += 1;
    trace.totalUnderrunMs += durationMs;
    trace.maxUnderrunMs = Math.max(trace.maxUnderrunMs, durationMs);
  }
  return durationMs;
}

export function finishAudioQueueGapWithoutReprime(
  trace: AudioPumpTrace | null | undefined,
  nowMs: number
) {
  if (!trace || trace.underrunStartAtMs === null) return null;
  const durationMs = Math.max(0, nowMs - trace.underrunStartAtMs);
  trace.underrunStartAtMs = null;
  if (durationMs > 0) {
    trace.terminalGapCount += 1;
    trace.totalTerminalGapMs += durationMs;
    trace.maxTerminalGapMs = Math.max(trace.maxTerminalGapMs, durationMs);
  }
  return durationMs;
}

export function noteAudioPumpReprimed(trace: AudioPumpTrace) {
  trace.reprimeCount += 1;
}

export function shouldLogAudioGap(
  trace: AudioPumpTrace,
  gapMs: number | null,
  bufferTargetMs: number,
  maximumLogs = 8
) {
  if (gapMs === null || gapMs < bufferTargetMs || trace.gapLogsEmitted >= maximumLogs) {
    return false;
  }
  trace.gapLogsEmitted += 1;
  return true;
}

export function shouldClearAudioPumpTraceAfterSummary(
  trace: AudioPumpTrace,
  stage: "response_done" | "playback_drained" | "interrupted" | "session_end"
) {
  if (stage === "session_end") return true;
  if (stage === "playback_drained") return trace.responseDoneAtMs !== null;
  return false;
}

export function calculatePendingPlaybackMs(
  queuedFrames: number,
  bufferedBytes: number,
  frameBytes = 160,
  frameMs = 20
) {
  const completeFrameMs = Math.max(0, queuedFrames) * frameMs;
  const partialFrameMs = frameBytes > 0
    ? (Math.max(0, bufferedBytes) / frameBytes) * frameMs
    : 0;
  return Number((completeFrameMs + partialFrameMs).toFixed(3));
}
