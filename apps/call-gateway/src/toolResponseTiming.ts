export type ToolResponseMetadata = {
  tool: string;
  callId: string;
  toolResultPayloadBytes?: number;
  responseCreatePayloadBytes?: number;
};

export type ToolResponseWait = ToolResponseMetadata & {
  requestedAtMs: number;
  responseCreatedAtMs: number | null;
  responseId: string | null;
  firstAudioLogged: boolean;
};

type PendingResponseDispatch = {
  toolWait: ToolResponseWait | null;
};

export type ToolResponseTimingState = {
  pendingResponseDispatches: PendingResponseDispatch[];
  toolWaitsByResponseId: Map<string, ToolResponseWait>;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

export function createToolResponseTimingState(): ToolResponseTimingState {
  return {
    pendingResponseDispatches: [],
    toolWaitsByResponseId: new Map<string, ToolResponseWait>()
  };
}

export function trackAssistantResponseDispatch(
  state: ToolResponseTimingState,
  metadata: ToolResponseMetadata | null | undefined,
  nowMs: number
) {
  const tool = normalizeText(metadata?.tool);
  const callId = normalizeText(metadata?.callId);
  const toolWait = tool && callId
    ? {
        tool,
        callId,
        requestedAtMs: nowMs,
        responseCreatedAtMs: null,
        responseId: null,
        firstAudioLogged: false,
        ...(typeof metadata?.toolResultPayloadBytes === "number"
          ? { toolResultPayloadBytes: metadata.toolResultPayloadBytes }
          : {}),
        ...(typeof metadata?.responseCreatePayloadBytes === "number"
          ? { responseCreatePayloadBytes: metadata.responseCreatePayloadBytes }
          : {})
      }
    : null;
  state.pendingResponseDispatches.push({ toolWait });
  return toolWait;
}

export function matchAssistantResponseCreated(
  state: ToolResponseTimingState,
  responseIdInput: unknown,
  nowMs: number
) {
  const pending = state.pendingResponseDispatches.shift();
  if (!pending?.toolWait) return null;
  const responseId = normalizeText(responseIdInput);
  pending.toolWait.responseCreatedAtMs = nowMs;
  pending.toolWait.responseId = responseId || null;
  if (responseId) {
    state.toolWaitsByResponseId.set(responseId, pending.toolWait);
  }
  return pending.toolWait;
}

export function matchToolResponseFirstAudio(
  state: ToolResponseTimingState,
  responseIdInput: unknown,
  nowMs: number
) {
  const responseId = normalizeText(responseIdInput);
  if (!responseId) return null;
  const wait = state.toolWaitsByResponseId.get(responseId);
  if (!wait || wait.firstAudioLogged) return null;
  wait.firstAudioLogged = true;
  return {
    wait,
    waitMs: nowMs - wait.requestedAtMs,
    responseCreatedToFirstAudioMs: wait.responseCreatedAtMs === null
      ? null
      : nowMs - wait.responseCreatedAtMs
  };
}

export function finishToolResponse(
  state: ToolResponseTimingState,
  responseIdInput: unknown
) {
  const responseId = normalizeText(responseIdInput);
  if (!responseId) return null;
  const wait = state.toolWaitsByResponseId.get(responseId) || null;
  state.toolWaitsByResponseId.delete(responseId);
  return wait;
}
