type AssistantResponseRequest = {
  reason: string;
  response: Record<string, unknown>;
  dedupeKey?: string | null | undefined;
};

type ToolResponseAwareSession = {
  currentResponseId?: string | null;
  responseCreatePending?: boolean;
  queuedAssistantResponses?: AssistantResponseRequest[];
  executingToolCallKeys?: Set<string>;
  completedToolCallKeys?: Set<string>;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function ensureQueue(session: ToolResponseAwareSession) {
  if (!Array.isArray(session.queuedAssistantResponses)) {
    session.queuedAssistantResponses = [];
  }
  return session.queuedAssistantResponses;
}

function ensureExecutingSet(session: ToolResponseAwareSession) {
  if (!(session.executingToolCallKeys instanceof Set)) {
    session.executingToolCallKeys = new Set<string>();
  }
  return session.executingToolCallKeys;
}

function ensureCompletedSet(session: ToolResponseAwareSession) {
  if (!(session.completedToolCallKeys instanceof Set)) {
    session.completedToolCallKeys = new Set<string>();
  }
  return session.completedToolCallKeys;
}

export function normalizeToolExecutionKey(name: string, callId: string) {
  return `${normalizeText(name)}:${normalizeText(callId)}`;
}

export function hasActiveAssistantResponse(session: ToolResponseAwareSession) {
  return Boolean(session.responseCreatePending || normalizeText(session.currentResponseId));
}

export function markAssistantResponseRequested(session: ToolResponseAwareSession) {
  session.responseCreatePending = true;
}

export function markAssistantResponseCreated(session: ToolResponseAwareSession, responseId?: string | null) {
  session.responseCreatePending = false;
  session.currentResponseId = normalizeText(responseId) || "__active_response__";
}

export function markAssistantResponseFinished(session: ToolResponseAwareSession) {
  session.responseCreatePending = false;
  session.currentResponseId = null;
}

export function enqueueAssistantResponseRequest(
  session: ToolResponseAwareSession,
  request: AssistantResponseRequest
) {
  const queue = ensureQueue(session);
  const dedupeKey = normalizeText(request.dedupeKey);
  if (dedupeKey) {
    const duplicateQueued = queue.some((entry) => normalizeText(entry.dedupeKey) === dedupeKey);
    if (duplicateQueued) {
      return { action: "duplicate_queued" as const, queueDepth: queue.length };
    }
  }

  if (hasActiveAssistantResponse(session)) {
    queue.push({
      reason: normalizeText(request.reason) || "queued_response",
      response: request.response || {},
      dedupeKey: dedupeKey || null
    });
    return { action: "queued" as const, queueDepth: queue.length };
  }

  markAssistantResponseRequested(session);
  return {
    action: "send_now" as const,
    queueDepth: queue.length,
    request: {
      reason: normalizeText(request.reason) || "response",
      response: request.response || {},
      dedupeKey: dedupeKey || null
    }
  };
}

export function dequeueAssistantResponseRequest(session: ToolResponseAwareSession) {
  if (hasActiveAssistantResponse(session)) {
    return null;
  }
  const queue = ensureQueue(session);
  const next = queue.shift();
  if (!next) return null;
  markAssistantResponseRequested(session);
  return next;
}

export function beginToolExecution(session: ToolResponseAwareSession, name: string, callId: string) {
  const key = normalizeToolExecutionKey(name, callId);
  const executing = ensureExecutingSet(session);
  const completed = ensureCompletedSet(session);
  if (completed.has(key)) {
    return { key, shouldExecute: false as const, reason: "already_completed" as const };
  }
  if (executing.has(key)) {
    return { key, shouldExecute: false as const, reason: "already_running" as const };
  }
  executing.add(key);
  return { key, shouldExecute: true as const, reason: "started" as const };
}

export function completeToolExecution(session: ToolResponseAwareSession, key: string) {
  ensureExecutingSet(session).delete(key);
  ensureCompletedSet(session).add(key);
}

export function failToolExecution(session: ToolResponseAwareSession, key: string) {
  ensureExecutingSet(session).delete(key);
}
