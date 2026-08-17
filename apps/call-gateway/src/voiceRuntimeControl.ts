type InterruptionAwareSession = {
  callSid: string;
  outputQueue?: Buffer[];
  outputBuffer?: Buffer;
  outputTimer?: NodeJS.Timeout | null;
  outputPrimed?: boolean;
  currentResponseId?: string | null;
  currentAssistantItemId?: string | null;
  assistantAudioActive?: boolean;
  assistantAudioMsSent?: number;
  lastInterruptionAtMs?: number | null;
  lastInterruptionReason?: string | null;
};

export type AssistantInterruptionPlan = {
  shouldInterrupt: boolean;
  reason: string;
  responseId: string | null;
  assistantItemId: string | null;
  queuedFramesDropped: number;
  bufferedBytesDropped: number;
  truncatedAudioMs: number;
  events: Array<Record<string, unknown>>;
};

const INTERRUPTION_DEBOUNCE_MS = 250;
const AUDIO_FRAME_MS = 20;

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function hasBufferedOutput(session: InterruptionAwareSession) {
  return Boolean((session.outputQueue?.length || 0) > 0 || (session.outputBuffer?.length || 0) > 0 || session.outputTimer);
}

export function hasPendingAssistantAudio(session: InterruptionAwareSession) {
  return Boolean(
    session.assistantAudioActive
      || normalizeText(session.currentResponseId)
      || normalizeText(session.currentAssistantItemId)
      || hasBufferedOutput(session)
  );
}

export function noteAssistantResponseCreated(session: InterruptionAwareSession, responseId?: string | null) {
  const normalizedResponseId = normalizeText(responseId);
  if (normalizedResponseId) {
    session.currentResponseId = normalizedResponseId;
  }
  session.assistantAudioActive = true;
  session.assistantAudioMsSent = Math.max(0, Number(session.assistantAudioMsSent || 0));
}

export function noteAssistantOutputItem(session: InterruptionAwareSession, itemId?: string | null) {
  const normalizedItemId = normalizeText(itemId);
  if (normalizedItemId) {
    session.currentAssistantItemId = normalizedItemId;
  }
  session.assistantAudioActive = true;
  session.assistantAudioMsSent = Math.max(0, Number(session.assistantAudioMsSent || 0));
}

export function noteAssistantAudioChunkQueued(session: InterruptionAwareSession) {
  session.assistantAudioActive = true;
  session.assistantAudioMsSent = Math.max(0, Number(session.assistantAudioMsSent || 0));
}

export function noteAssistantAudioFrameSent(session: InterruptionAwareSession, frameMs = AUDIO_FRAME_MS) {
  session.assistantAudioActive = true;
  session.assistantAudioMsSent = Math.max(0, Number(session.assistantAudioMsSent || 0) + Math.max(0, frameMs));
}

export function noteAssistantResponseCompleted(session: InterruptionAwareSession) {
  session.currentResponseId = null;
  if (!hasBufferedOutput(session)) {
    session.currentAssistantItemId = null;
    session.assistantAudioActive = false;
    session.assistantAudioMsSent = 0;
  }
}

export function noteAssistantPlaybackDrained(session: InterruptionAwareSession) {
  session.currentResponseId = null;
  session.currentAssistantItemId = null;
  session.assistantAudioActive = false;
  session.assistantAudioMsSent = 0;
  session.outputPrimed = false;
}

export function buildAssistantInterruptionPlan(
  session: InterruptionAwareSession,
  reason: string,
  nowMs = Date.now()
): AssistantInterruptionPlan {
  const normalizedReason = normalizeText(reason) || "caller_barge_in";
  if (!hasPendingAssistantAudio(session)) {
    return {
      shouldInterrupt: false,
      reason: normalizedReason,
      responseId: normalizeText(session.currentResponseId) || null,
      assistantItemId: normalizeText(session.currentAssistantItemId) || null,
      queuedFramesDropped: 0,
      bufferedBytesDropped: 0,
      truncatedAudioMs: 0,
      events: []
    };
  }

  if (session.lastInterruptionAtMs && (nowMs - session.lastInterruptionAtMs) < INTERRUPTION_DEBOUNCE_MS) {
    return {
      shouldInterrupt: false,
      reason: normalizedReason,
      responseId: normalizeText(session.currentResponseId) || null,
      assistantItemId: normalizeText(session.currentAssistantItemId) || null,
      queuedFramesDropped: 0,
      bufferedBytesDropped: 0,
      truncatedAudioMs: 0,
      events: []
    };
  }

  const truncatedAudioMs = Math.max(0, Number(session.assistantAudioMsSent || 0));
  const assistantItemId = normalizeText(session.currentAssistantItemId) || null;
  const events: Array<Record<string, unknown>> = [{ type: "response.cancel" }];
  if (assistantItemId && truncatedAudioMs > 0) {
    events.push({
      type: "conversation.item.truncate",
      item_id: assistantItemId,
      content_index: 0,
      audio_end_ms: truncatedAudioMs
    });
  }

  return {
    shouldInterrupt: true,
    reason: normalizedReason,
    responseId: normalizeText(session.currentResponseId) || null,
    assistantItemId,
    queuedFramesDropped: session.outputQueue?.length || 0,
    bufferedBytesDropped: session.outputBuffer?.length || 0,
    truncatedAudioMs,
    events
  };
}

export function applyAssistantInterruption(session: InterruptionAwareSession, plan: AssistantInterruptionPlan) {
  if (!plan.shouldInterrupt) return plan;
  if (session.outputTimer) {
    clearInterval(session.outputTimer);
    session.outputTimer = null;
  }
  session.outputQueue = [];
  session.outputBuffer = Buffer.alloc(0);
  session.outputPrimed = false;
  session.currentResponseId = null;
  session.currentAssistantItemId = null;
  session.assistantAudioActive = false;
  session.assistantAudioMsSent = 0;
  session.lastInterruptionAtMs = Date.now();
  session.lastInterruptionReason = plan.reason;
  return plan;
}

export function summarizeAssistantAudioState(session: InterruptionAwareSession) {
  return {
    has_pending_audio: hasPendingAssistantAudio(session),
    queued_frames: session.outputQueue?.length || 0,
    buffered_bytes: session.outputBuffer?.length || 0,
    current_response_id: normalizeText(session.currentResponseId) || null,
    current_assistant_item_id: normalizeText(session.currentAssistantItemId) || null,
    assistant_audio_ms_sent: Math.max(0, Number(session.assistantAudioMsSent || 0)),
    last_interruption_reason: normalizeText(session.lastInterruptionReason) || null
  };
}
