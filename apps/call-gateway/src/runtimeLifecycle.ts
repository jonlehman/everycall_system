import type { CallState } from "@everycall/contracts";
import type { GatewayPromptPayload } from "./knowledgeRuntime.js";

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rowCount?: number; rows?: any[] }>;
};

type PoolLike = Queryable | null;

type PromptPayloadFetcher = (
  tenantKey: string,
  callSid: string,
  to: string,
  from: string
) => Promise<GatewayPromptPayload>;

type BuildPrewarmer = (
  pool: PoolLike,
  tenantKey: string,
  buildId: string
) => Promise<{ cacheHit: boolean; fetchMs: number }>;

type CallStateInitializer = (payload: GatewayPromptPayload) => CallState;

export type ActiveBuildPreloadSummary = {
  attempted: number;
  succeeded: number;
  failed: number;
  totalFetchMs: number;
  maxFetchMs: number;
  results: Array<{
    tenantKey: string;
    buildId: string;
    status: "ready" | "failed";
    fetchMs: number;
    cacheHit: boolean;
    message?: string;
  }>;
};

export type RecoveredSessionBootstrap = {
  callSid: string;
  callControlId: string;
  tenantKey: string;
  to: string;
  from: string;
  promptPayload: GatewayPromptPayload;
  knowledgeCallState: CallState;
  prewarm: {
    status: "ready" | "failed";
    fetchMs: number;
    cacheHit: boolean;
    message?: string;
  };
  source: string;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

export async function prewarmActiveKnowledgeBuildAssets(
  pool: PoolLike,
  prewarmBuildAssets: BuildPrewarmer
): Promise<ActiveBuildPreloadSummary> {
  if (!pool) {
    return { attempted: 0, succeeded: 0, failed: 0, totalFetchMs: 0, maxFetchMs: 0, results: [] };
  }

  const res = await pool.query(
    `SELECT tenant_key, active_build_id
     FROM tenant_active_knowledge_builds
     ORDER BY tenant_key ASC`
  );

  const results: ActiveBuildPreloadSummary["results"] = [];
  for (const row of res.rows || []) {
    const tenantKey = normalizeText(row.tenant_key);
    const buildId = normalizeText(row.active_build_id);
    if (!tenantKey || !buildId) continue;
    try {
      const warmed = await prewarmBuildAssets(pool, tenantKey, buildId);
      results.push({
        tenantKey,
        buildId,
        status: "ready",
        fetchMs: warmed.fetchMs,
        cacheHit: warmed.cacheHit
      });
    } catch (err) {
      results.push({
        tenantKey,
        buildId,
        status: "failed",
        fetchMs: 0,
        cacheHit: false,
        message: err instanceof Error ? err.message : "unknown"
      });
    }
  }

  const succeeded = results.filter((item) => item.status === "ready").length;
  const totalFetchMs = results.reduce((sum, item) => sum + (item.fetchMs || 0), 0);
  const maxFetchMs = results.reduce((max, item) => Math.max(max, item.fetchMs || 0), 0);
  return {
    attempted: results.length,
    succeeded,
    failed: results.length - succeeded,
    totalFetchMs,
    maxFetchMs,
    results
  };
}

export async function recoverStreamSessionBootstrap(
  pool: PoolLike,
  callControlId: string,
  fetchPromptPayload: PromptPayloadFetcher,
  prewarmBuildAssets: BuildPrewarmer,
  initializeCallState: CallStateInitializer,
  source = "stream_start_recovery"
): Promise<RecoveredSessionBootstrap | null> {
  if (!pool || !callControlId) return null;
  const callRes = await pool.query(
    `SELECT tenant_key, from_number, to_number
     FROM calls
     WHERE call_sid = $1
     LIMIT 1`,
    [callControlId]
  );
  if (!callRes.rowCount) return null;

  const row = callRes.rows?.[0] || {};
  const tenantKey = normalizeText(row.tenant_key);
  const to = normalizeText(row.to_number);
  const from = normalizeText(row.from_number);
  if (!tenantKey) return null;

  const promptPayload = await fetchPromptPayload(tenantKey, callControlId, to, from);
  const knowledgeCallState = initializeCallState(promptPayload);

  try {
    const warmed = await prewarmBuildAssets(pool, tenantKey, promptPayload.knowledge_runtime.active_build_id);
    return {
      callSid: callControlId,
      callControlId,
      tenantKey,
      to,
      from,
      promptPayload,
      knowledgeCallState,
      prewarm: {
        status: "ready",
        fetchMs: warmed.fetchMs,
        cacheHit: warmed.cacheHit
      },
      source
    };
  } catch (err) {
    return {
      callSid: callControlId,
      callControlId,
      tenantKey,
      to,
      from,
      promptPayload,
      knowledgeCallState,
      prewarm: {
        status: "failed",
        fetchMs: 0,
        cacheHit: false,
        message: err instanceof Error ? err.message : "unknown"
      },
      source
    };
  }
}
