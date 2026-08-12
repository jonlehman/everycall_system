import type { ToolResponseMetadata } from "./toolResponseTiming.js";

export type AssistantResponseRequest = {
  reason: string;
  response: Record<string, unknown>;
  dedupeKey?: string | null | undefined;
  toolResponse?: ToolResponseMetadata | null | undefined;
};

type ToolResponseAwareSession = {
  currentResponseId?: string | null;
  responseCreatePending?: boolean;
  activeAssistantResponseDedupeKey?: string | null;
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

export function markAssistantResponseRequested(
  session: ToolResponseAwareSession,
  request?: AssistantResponseRequest | null
) {
  session.responseCreatePending = true;
  session.activeAssistantResponseDedupeKey = normalizeText(request?.dedupeKey) || null;
}

export function markAssistantResponseCreated(session: ToolResponseAwareSession, responseId?: string | null) {
  session.responseCreatePending = false;
  session.currentResponseId = normalizeText(responseId) || "__active_response__";
}

export function markAssistantResponseFinished(session: ToolResponseAwareSession) {
  session.responseCreatePending = false;
  session.currentResponseId = null;
  session.activeAssistantResponseDedupeKey = null;
}

export function enqueueAssistantResponseRequest(
  session: ToolResponseAwareSession,
  request: AssistantResponseRequest
) {
  const queue = ensureQueue(session);
  const dedupeKey = normalizeText(request.dedupeKey);
  if (dedupeKey) {
    if (normalizeText(session.activeAssistantResponseDedupeKey) === dedupeKey) {
      return { action: "duplicate_active" as const, queueDepth: queue.length };
    }
    const duplicateQueued = queue.some((entry) => normalizeText(entry.dedupeKey) === dedupeKey);
    if (duplicateQueued) {
      return { action: "duplicate_queued" as const, queueDepth: queue.length };
    }
  }

  if (hasActiveAssistantResponse(session)) {
    queue.push({
      reason: normalizeText(request.reason) || "queued_response",
      response: request.response || {},
      dedupeKey: dedupeKey || null,
      toolResponse: request.toolResponse || null
    });
    return { action: "queued" as const, queueDepth: queue.length };
  }

  const normalizedRequest = {
    reason: normalizeText(request.reason) || "response",
    response: request.response || {},
    dedupeKey: dedupeKey || null,
    toolResponse: request.toolResponse || null
  };
  markAssistantResponseRequested(session, normalizedRequest);
  return {
    action: "send_now" as const,
    queueDepth: queue.length,
    request: normalizedRequest
  };
}

export function dequeueAssistantResponseRequest(session: ToolResponseAwareSession) {
  if (hasActiveAssistantResponse(session)) {
    return null;
  }
  const queue = ensureQueue(session);
  const next = queue.shift();
  if (!next) return null;
  markAssistantResponseRequested(session, next);
  return next;
}

export function discardQueuedAssistantResponses(session: ToolResponseAwareSession) {
  const queue = ensureQueue(session);
  const discarded = queue.splice(0, queue.length);
  return discarded;
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
