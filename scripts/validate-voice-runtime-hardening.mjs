import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

import promptHandler from "../pages/api/v1/gateway/prompt.js";
import { requireSchemaResetApproval } from "./_safety.mjs";

const { Pool } = pg;
const REPO_ROOT = process.cwd();

function createMockRes() {
  const headers = {};
  let statusCode = 200;
  let body = undefined;
  return {
    headers,
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
      return this;
    },
    get result() {
      return { statusCode, body, headers };
    }
  };
}

async function invokeHandler(handler, { method = "GET", query = {}, body = undefined, headers = {} } = {}) {
  const req = { method, query, body, headers };
  const res = createMockRes();
  await handler(req, res);
  return res.result;
}

async function importDistModule(relativePath) {
  return import(pathToFileURL(path.join(REPO_ROOT, relativePath)).href);
}

function runBaseCutoverValidation() {
  const child = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts/validate-knowledge-receptionist-cutover.mjs")],
    {
      cwd: REPO_ROOT,
      env: process.env,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    }
  );
  if (child.status !== 0) {
    throw new Error(child.stderr || child.stdout || `cutover_validation_failed:${child.status}`);
  }
  return JSON.parse(child.stdout || "{}");
}

function primaryCardName(turn) {
  return String(turn.runtime_bundle?.selected_cards?.[0]?.canonical_name || "");
}

async function fetchPromptPayload(tenantKey, callSid, to = "", from = "") {
  const res = await invokeHandler(promptHandler, {
    method: "POST",
    headers: { "x-everycall-internal": process.env.CALL_SUMMARY_TOKEN || "" },
    body: { tenantKey, callSid, to, from }
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

function createSpeakingSession(voiceControl, callSid, responseId, itemId) {
  const timer = setInterval(() => {}, 1000);
  const session = {
    callSid,
    outputQueue: [Buffer.alloc(160), Buffer.alloc(160), Buffer.alloc(160)],
    outputBuffer: Buffer.alloc(80),
    outputTimer: timer,
    outputPrimed: true,
    currentResponseId: null,
    currentAssistantItemId: null,
    assistantAudioActive: false,
    assistantAudioMsSent: 0,
    lastInterruptionAtMs: null,
    lastInterruptionReason: null
  };
  voiceControl.noteAssistantResponseCreated(session, responseId);
  voiceControl.noteAssistantOutputItem(session, itemId);
  voiceControl.noteAssistantAudioChunkQueued(session);
  for (let index = 0; index < 6; index += 1) {
    voiceControl.noteAssistantAudioFrameSent(session);
  }
  return session;
}

function validateInterruptionScenario(voiceControl, label, turnResult, reason) {
  const session = createSpeakingSession(
    voiceControl,
    `${label}_call`,
    `${label}_response`,
    `${label}_item`
  );
  const priorState = JSON.stringify(turnResult.call_state);
  const plan = voiceControl.buildAssistantInterruptionPlan(session, reason, 1_000);
  assert.equal(plan.shouldInterrupt, true, `${label}: interruption should trigger`);
  assert.deepEqual(plan.events, [], `${label}: xAI VAD should own provider-side interruption`);
  assert.equal(plan.truncatedAudioMs, 120, `${label}: unexpected truncate ms`);
  voiceControl.applyAssistantInterruption(session, plan);
  assert.equal(session.outputQueue.length, 0, `${label}: output queue not cleared`);
  assert.equal(session.outputBuffer.length, 0, `${label}: output buffer not cleared`);
  assert.equal(session.outputTimer, null, `${label}: output timer not cleared`);
  assert.equal(voiceControl.hasPendingAssistantAudio(session), false, `${label}: assistant audio still pending`);
  assert.equal(JSON.stringify(turnResult.call_state), priorState, `${label}: call state mutated during interruption`);
  return {
    reason,
    truncatedAudioMs: plan.truncatedAudioMs,
    queuedFramesDropped: plan.queuedFramesDropped,
    bufferedBytesDropped: plan.bufferedBytesDropped,
    events: plan.events.map((event) => event.type),
    runtimeMode: turnResult.runtime_bundle.runtime_mode,
    stage: turnResult.call_state.current_stage
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  assert(databaseUrl, "DATABASE_URL is required");
  requireSchemaResetApproval("scripts/validate-voice-runtime-hardening.mjs", databaseUrl);
  process.env.CALL_SUMMARY_TOKEN ||= "knowledge-cutover-validation-token";

  const baseSummary = runBaseCutoverValidation();
  const tenantKey = String(baseSummary?.onboarding?.tenantKey || "");
  const activeBuildId = String(baseSummary?.builds?.published?.active_build_id || baseSummary?.prompt?.buildId || "");
  assert(tenantKey, "tenantKey missing from base validation");
  assert(activeBuildId, "active build missing from base validation");

  const gatewayRuntime = await importDistModule("apps/call-gateway/dist/apps/call-gateway/src/knowledgeRuntime.js");
  const voiceControl = await importDistModule("apps/call-gateway/dist/apps/call-gateway/src/voiceRuntimeControl.js");
  const runtimeLifecycle = await importDistModule("apps/call-gateway/dist/apps/call-gateway/src/runtimeLifecycle.js");

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const promptPayloadBody = await fetchPromptPayload(tenantKey, "VOICE_RUNTIME_VALIDATION_CALL", "+12065550100", "+12065550999");
    const promptPayload = gatewayRuntime.validateGatewayPromptPayload(promptPayloadBody);

    gatewayRuntime.clearKnowledgeBuildAssetCache();
    const startupPreload = await runtimeLifecycle.prewarmActiveKnowledgeBuildAssets(pool, gatewayRuntime.prewarmKnowledgeBuildAssets);
    assert(startupPreload.succeeded >= 1, "startup preload should warm at least one active build");

    const warmTurn = await gatewayRuntime.fetchKnowledgeRuntimeTurn(pool, promptPayload, {
      tenantKey,
      callId: "voice_runtime_warm_turn",
      query: "Do you replace water heaters?",
      callState: gatewayRuntime.initializeKnowledgeCallState(promptPayload)
    });
    assert.equal(warmTurn.retrieval_telemetry.asset_cache_hit, true, "warm turn should hit cache");

    gatewayRuntime.clearKnowledgeBuildAssetCache();
    const coldFallbackTurn = await gatewayRuntime.fetchKnowledgeRuntimeTurn(pool, promptPayload, {
      tenantKey,
      callId: "voice_runtime_cold_turn",
      query: "Do you replace water heaters?",
      callState: gatewayRuntime.initializeKnowledgeCallState(promptPayload)
    });
    assert.equal(coldFallbackTurn.retrieval_telemetry.asset_cache_hit, false, "cold fallback should miss cache");
    assert.equal(coldFallbackTurn.retrieval_telemetry.asset_load_strategy, "cold_fallback");
    assert.equal(coldFallbackTurn.runtime_bundle.runtime_mode, "answer");

    await pool.query(
      `INSERT INTO calls (call_sid, tenant_key, from_number, to_number, status)
       VALUES ($1, $2, $3, $4, 'in_progress')
       ON CONFLICT (call_sid)
       DO UPDATE SET tenant_key = EXCLUDED.tenant_key,
                     from_number = EXCLUDED.from_number,
                     to_number = EXCLUDED.to_number,
                     status = EXCLUDED.status`,
      ["voice_runtime_recovery_call", tenantKey, "+12065550999", "+12065550100"]
    );

    const recoveredSession = await runtimeLifecycle.recoverStreamSessionBootstrap(
      pool,
      "voice_runtime_recovery_call",
      fetchPromptPayload,
      gatewayRuntime.prewarmKnowledgeBuildAssets,
      gatewayRuntime.initializeKnowledgeCallState,
      "validation_stream_recovery"
    );
    assert(recoveredSession, "expected recovered session bootstrap");
    assert.equal(recoveredSession.promptPayload.knowledge_runtime.active_build_id, activeBuildId);

    await pool.query(
      `INSERT INTO calls (call_sid, tenant_key, from_number, to_number, status)
       VALUES ($1, $2, $3, $4, 'in_progress')
       ON CONFLICT (call_sid)
       DO UPDATE SET tenant_key = EXCLUDED.tenant_key,
                     from_number = EXCLUDED.from_number,
                     to_number = EXCLUDED.to_number,
                     status = EXCLUDED.status`,
      ["voice_runtime_recovery_failure_call", tenantKey, "+12065550998", "+12065550100"]
    );

    const recoveredWithPrewarmFailure = await runtimeLifecycle.recoverStreamSessionBootstrap(
      pool,
      "voice_runtime_recovery_failure_call",
      fetchPromptPayload,
      async () => {
        throw new Error("simulated_prewarm_failure");
      },
      gatewayRuntime.initializeKnowledgeCallState,
      "validation_stream_recovery_failure"
    );
    assert(recoveredWithPrewarmFailure, "expected recovery payload even when prewarm fails");
    assert.equal(recoveredWithPrewarmFailure.prewarm.status, "failed");

    const baseState = gatewayRuntime.initializeKnowledgeCallState(promptPayload);
    const normalTurn = await gatewayRuntime.fetchKnowledgeRuntimeTurn(pool, promptPayload, {
      tenantKey,
      callId: "voice_runtime_interrupt_normal",
      query: "Do you replace water heaters?",
      callState: baseState
    });
    const followUpState = gatewayRuntime.mergeRuntimeTurnState(baseState, normalTurn);
    const followUpTurn = await gatewayRuntime.fetchKnowledgeRuntimeTurn(pool, promptPayload, {
      tenantKey,
      callId: "voice_runtime_interrupt_follow_up",
      query: "What about tankless ones?",
      callState: followUpState
    });
    const overrideTurn = await gatewayRuntime.fetchKnowledgeRuntimeTurn(pool, promptPayload, {
      tenantKey,
      callId: "voice_runtime_interrupt_override",
      query: "Who handles calls after hours?",
      callState: gatewayRuntime.initializeKnowledgeCallState(promptPayload)
    });
    const guardrailTurn = await gatewayRuntime.fetchKnowledgeRuntimeTurn(pool, promptPayload, {
      tenantKey,
      callId: "voice_runtime_interrupt_guardrail",
      query: "Should I pour Drano into the drain myself?",
      callState: gatewayRuntime.initializeKnowledgeCallState(promptPayload)
    });

    const specificityChecks = [];
    for (const [query, expectedPrimary] of [
      ["Do you do sewer inspections?", "Services"],
      ["Can you replace a tankless water heater?", "Services"],
      ["Do you offer financing?", "Warranty And Financing"],
      ["Do you serve Redmond?", "Service Area"]
    ]) {
      const turn = await gatewayRuntime.fetchKnowledgeRuntimeTurn(pool, promptPayload, {
        tenantKey,
        callId: `voice_runtime_specificity_${query.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        query,
        callState: gatewayRuntime.initializeKnowledgeCallState(promptPayload)
      });
      specificityChecks.push({
        query,
        expectedPrimary,
        primaryCard: primaryCardName(turn),
        assetCacheHit: turn.retrieval_telemetry.asset_cache_hit,
        passed: primaryCardName(turn) === expectedPrimary
      });
    }
    const specificityMisses = specificityChecks.filter((item) => !item.passed);

    const summary = {
      base: {
        knowledgeCorrectness: {
          normalService: baseSummary.runtimeQuality?.gateway?.normalService || null,
          serviceArea: baseSummary.runtimeQuality?.gateway?.serviceArea || null
        },
        followUpContinuity: {
          tankless: baseSummary.runtimeQuality?.gateway?.followUpTankless || null,
          bellevue: baseSummary.runtimeQuality?.gateway?.followUpBellevue || null
        },
        overrideGuardrailCorrectness: {
          afterHours: baseSummary.runtime?.afterHours || null,
          dangerousQuestion: baseSummary.runtime?.dangerousQuestion || null
        }
      },
      interruption: {
        normalAnswer: validateInterruptionScenario(voiceControl, "normal_answer", normalTurn, "caller_barge_in_normal_answer"),
        followUp: validateInterruptionScenario(voiceControl, "follow_up", followUpTurn, "caller_barge_in_follow_up"),
        overrideTurn: validateInterruptionScenario(voiceControl, "override_turn", overrideTurn, "caller_barge_in_override"),
        guardrailTurn: validateInterruptionScenario(voiceControl, "guardrail_turn", guardrailTurn, "caller_barge_in_guardrail")
      },
      preload: {
        startupPreload,
        warmTurn: {
          assetCacheHit: warmTurn.retrieval_telemetry.asset_cache_hit,
          assetFetchMs: warmTurn.retrieval_telemetry.asset_fetch_ms,
          assetLoadStrategy: warmTurn.retrieval_telemetry.asset_load_strategy,
          runtimeMode: warmTurn.runtime_bundle.runtime_mode
        },
        coldFallbackTurn: {
          assetCacheHit: coldFallbackTurn.retrieval_telemetry.asset_cache_hit,
          assetFetchMs: coldFallbackTurn.retrieval_telemetry.asset_fetch_ms,
          assetLoadStrategy: coldFallbackTurn.retrieval_telemetry.asset_load_strategy,
          runtimeMode: coldFallbackTurn.runtime_bundle.runtime_mode
        }
      },
      recovery: {
        recoveredSession: recoveredSession
          ? {
              source: recoveredSession.source,
              prewarm: recoveredSession.prewarm,
              activeBuildId: recoveredSession.promptPayload.knowledge_runtime.active_build_id,
              runtimeEntryMode: recoveredSession.knowledgeCallState.runtime_entry_mode
            }
          : null,
        recoveredWithPrewarmFailure: recoveredWithPrewarmFailure
          ? {
              source: recoveredWithPrewarmFailure.source,
              prewarm: recoveredWithPrewarmFailure.prewarm,
              activeBuildId: recoveredWithPrewarmFailure.promptPayload.knowledge_runtime.active_build_id,
              runtimeEntryMode: recoveredWithPrewarmFailure.knowledgeCallState.runtime_entry_mode
            }
          : null
      },
      specificity: {
        checks: specificityChecks,
        misses: specificityMisses
      }
    };

    assert.equal(summary.base.overrideGuardrailCorrectness.afterHours?.matchedOverrides?.length > 0, true, "after-hours override should remain correct");
    assert.equal(summary.base.overrideGuardrailCorrectness.dangerousQuestion?.matchedGuardrails?.length > 0, true, "dangerous-question guardrail should remain correct");
    assert.deepEqual(
      summary.interruption.normalAnswer.events,
      [],
      "Grok-native interruption should not emit OpenAI response cancellation events"
    );
    assert.equal(summary.recovery.recoveredWithPrewarmFailure?.prewarm?.status, "failed", "expected explicit failed prewarm status");
    assert.equal(summary.specificity.misses.length, 0, `specificity misses: ${JSON.stringify(summary.specificity.misses)}`);

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
