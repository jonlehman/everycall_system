type RetrievalTimingTelemetry = {
  asset_cache_hit?: boolean;
  asset_fetch_ms?: number;
  recent_conversation_summary_ms?: number;
  planner_ms?: number;
  embedding_ms?: number;
  retrieval_ms?: number;
  packet_ms?: number;
  runtime_core_ms?: number;
  runtime_bundle_persist_ms?: number;
  coverage_gap_persist_ms?: number;
  total_gateway_turn_ms?: number;
};

type KnowledgeLookupTimingInput = {
  sourceType: string;
  speechStoppedAtMs?: number | null;
  toolCallReadyAtMs: number;
  executionStartedAtMs: number;
  runtimeCompletedAtMs: number;
  callStatePersistStartedAtMs: number;
  callStatePersistCompletedAtMs: number;
  appToolResultForwardStartedAtMs: number;
  appToolResultForwardCompletedAtMs: number;
  appToolResultForwardOutcome: "not_configured" | "succeeded" | "failed";
  resultDispatchAtMs: number;
  xaiSocketOpenAtResultDispatch: boolean;
  retrieval: RetrievalTimingTelemetry;
};

function elapsedMs(startMs: number | null | undefined, endMs: number) {
  if (typeof startMs !== "number" || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return undefined;
  }
  return Number(Math.max(0, endMs - startMs).toFixed(3));
}

function optionalFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function buildKnowledgeLookupTimingDetails(input: KnowledgeLookupTimingInput) {
  return {
    sourceType: input.sourceType,
    endpointToToolCallReadyMs: elapsedMs(input.speechStoppedAtMs, input.toolCallReadyAtMs),
    toolCallReadyToExecutionStartMs: elapsedMs(input.toolCallReadyAtMs, input.executionStartedAtMs),
    knowledgeRuntimeWallClockMs: elapsedMs(input.executionStartedAtMs, input.runtimeCompletedAtMs),
    knowledgeCallStatePersistMs: elapsedMs(
      input.callStatePersistStartedAtMs,
      input.callStatePersistCompletedAtMs
    ),
    runtimeToCallStatePersistStartMs: elapsedMs(
      input.runtimeCompletedAtMs,
      input.callStatePersistStartedAtMs
    ),
    callStatePersistCompletedToAppForwardStartMs: elapsedMs(
      input.callStatePersistCompletedAtMs,
      input.appToolResultForwardStartedAtMs
    ),
    appToolResultForwardMs: elapsedMs(
      input.appToolResultForwardStartedAtMs,
      input.appToolResultForwardCompletedAtMs
    ),
    appForwardCompletedToXAiResultDispatchMs: elapsedMs(
      input.appToolResultForwardCompletedAtMs,
      input.resultDispatchAtMs
    ),
    appToolResultForwardOutcome: input.appToolResultForwardOutcome,
    toolCallReadyToXAiResultDispatchMs: elapsedMs(input.toolCallReadyAtMs, input.resultDispatchAtMs),
    endpointToXAiResultDispatchMs: elapsedMs(input.speechStoppedAtMs, input.resultDispatchAtMs),
    xaiSocketOpenAtResultDispatch: input.xaiSocketOpenAtResultDispatch,
    assetCacheHit: typeof input.retrieval.asset_cache_hit === "boolean"
      ? input.retrieval.asset_cache_hit
      : undefined,
    assetFetchMs: optionalFiniteNumber(input.retrieval.asset_fetch_ms),
    recentConversationSummaryMs: optionalFiniteNumber(input.retrieval.recent_conversation_summary_ms),
    plannerMs: optionalFiniteNumber(input.retrieval.planner_ms),
    embeddingMs: optionalFiniteNumber(input.retrieval.embedding_ms),
    retrievalMs: optionalFiniteNumber(input.retrieval.retrieval_ms),
    packetMs: optionalFiniteNumber(input.retrieval.packet_ms),
    runtimeCoreMs: optionalFiniteNumber(input.retrieval.runtime_core_ms),
    runtimeBundlePersistMs: optionalFiniteNumber(input.retrieval.runtime_bundle_persist_ms),
    coverageGapPersistMs: optionalFiniteNumber(input.retrieval.coverage_gap_persist_ms),
    totalGatewayTurnMs: optionalFiniteNumber(input.retrieval.total_gateway_turn_ms)
  };
}
