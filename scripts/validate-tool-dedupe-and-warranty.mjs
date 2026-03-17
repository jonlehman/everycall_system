import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  createKnowledgeBuild,
  publishKnowledgeBuild,
  retrieveBuildRuntimeBundle
} from "../pages/api/_lib/knowledgeReceptionistBuilds.js";

const { Pool } = pg;

const TENANT_KEY = "creative_dynamic";
const WEBSITE_URL = "https://hartsservices.com/";
const WARRANTY_LOCATOR_PATTERN = "%forever-warranty%";
const WARRANTY_QUERIES = [
  "How does your warranty work?",
  "What is the Harts Forever Warranty?",
  "Does the Harts Forever Warranty apply to all services?",
  "What services qualify for the Harts Forever Warranty?"
];

function mustDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL missing");
  }
  return databaseUrl;
}

async function fetchCurrentActiveBuild(pool) {
  const res = await pool.query(
    `SELECT active_build_id
     FROM tenant_active_knowledge_builds
     WHERE tenant_key = $1
     LIMIT 1`,
    [TENANT_KEY]
  );
  return String(res.rows[0]?.active_build_id || "");
}

async function fetchWarrantyArtifacts(pool, buildId) {
  const [sourceRefs, sourceSegments, facts, cards] = await Promise.all([
    pool.query(
      `SELECT source_ref_id, source_channel, source_kind, source_locator, title, page_type
       FROM source_refs
       WHERE tenant_key = $1
         AND build_id = $2
         AND source_locator ILIKE $3
       ORDER BY captured_at ASC`,
      [TENANT_KEY, buildId, WARRANTY_LOCATOR_PATTERN]
    ),
    pool.query(
      `SELECT ss.segment_index, ss.text_span
       FROM source_segments ss
       JOIN source_refs sr ON sr.source_ref_id = ss.source_ref_id
       WHERE sr.tenant_key = $1
         AND sr.build_id = $2
         AND sr.source_locator ILIKE $3
       ORDER BY ss.segment_index ASC`,
      [TENANT_KEY, buildId, WARRANTY_LOCATOR_PATTERN]
    ),
    pool.query(
      `SELECT knowledge_fact_id, fact_type, object_type, predicate, claim_text, normalized_value_json
       FROM knowledge_build_facts kf
       JOIN source_refs sr ON sr.build_id = kf.build_id
        AND sr.tenant_key = kf.tenant_key
       WHERE kf.tenant_key = $1
         AND kf.build_id = $2
         AND kf.source_ref_ids_json ? sr.source_ref_id
         AND sr.source_locator ILIKE $3
       ORDER BY kf.created_at ASC`,
      [TENANT_KEY, buildId, WARRANTY_LOCATOR_PATTERN]
    ),
    pool.query(
      `SELECT knowledge_card_id, card_type, object_type, canonical_name, topic_path, speakable_summary,
              search_text, aliases_json, caller_phrases_json
       FROM knowledge_build_cards kc
       JOIN source_refs sr ON sr.build_id = kc.build_id
        AND sr.tenant_key = kc.tenant_key
       WHERE kc.tenant_key = $1
         AND kc.build_id = $2
         AND kc.source_ref_ids_json ? sr.source_ref_id
         AND sr.source_locator ILIKE $3
       ORDER BY kc.created_at ASC`,
      [TENANT_KEY, buildId, WARRANTY_LOCATOR_PATTERN]
    )
  ]);

  return {
    source_refs: sourceRefs.rows,
    source_segments: sourceSegments.rows,
    knowledge_build_facts: facts.rows,
    knowledge_build_cards: cards.rows
  };
}

function summarizeRuntimeBundle(query, result) {
  const bundle = result.runtimeBundle;
  return {
    query,
    selected_card_count: Array.isArray(bundle.selected_cards) ? bundle.selected_cards.length : 0,
    selected_fact_count: Array.isArray(bundle.selected_answer_facts) ? bundle.selected_answer_facts.length : 0,
    runtime_mode: bundle.runtime_mode,
    selected_cards: (bundle.selected_cards || []).map((card) => ({
      canonical_name: card.canonical_name,
      speakable_summary: card.speakable_summary,
      aliases: card.aliases,
      caller_phrases: card.caller_phrases
    })),
    selected_facts: (bundle.selected_answer_facts || []).map((fact) => ({
      fact_id: fact.fact_id,
      claim: fact.claim,
      risk_level: fact.risk_level
    })),
    retrieval_telemetry: result.retrievalTelemetry
  };
}

async function validateWarrantyQueries(pool, buildId) {
  const results = [];
  for (const query of WARRANTY_QUERIES) {
    const result = await retrieveBuildRuntimeBundle(pool, TENANT_KEY, buildId, query, {
      runtimeEntryMode: "customer_call"
    });
    results.push(summarizeRuntimeBundle(query, result));
  }
  return results;
}

async function validateToolDedupeSimulation() {
  const toolModulePath = pathToFileURL(
    path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/toolResponseControl.js")
  ).href;
  const toolModule = await import(toolModulePath);
  const {
    beginToolExecution,
    completeToolExecution,
    dequeueAssistantResponseRequest,
    enqueueAssistantResponseRequest,
    markAssistantResponseCreated,
    markAssistantResponseFinished,
    normalizeToolExecutionKey
  } = toolModule;

  const freshSession = () => ({
    currentResponseId: null,
    responseCreatePending: false,
    queuedAssistantResponses: [],
    executingToolCallKeys: new Set(),
    completedToolCallKeys: new Set()
  });

  const caseOne = freshSession();
  let executionsCaseOne = 0;
  let responseCreatesCaseOne = 0;
  for (const source of ["response.function_call_arguments.done", "response.output_item.done"]) {
    const attempt = beginToolExecution(caseOne, "knowledge_lookup", "call_case_one");
    if (!attempt.shouldExecute) continue;
    executionsCaseOne += 1;
    const queued = enqueueAssistantResponseRequest(caseOne, {
      reason: `tool_result:${source}`,
      response: {},
      dedupeKey: normalizeToolExecutionKey("knowledge_lookup", "call_case_one")
    });
    if (queued.action === "send_now") {
      responseCreatesCaseOne += 1;
    }
    completeToolExecution(caseOne, attempt.key);
  }

  const caseTwo = freshSession();
  let executionsCaseTwo = 0;
  let queuedCountCaseTwo = 0;
  let flushedCreatesCaseTwo = 0;
  markAssistantResponseCreated(caseTwo, "resp_tool_backed_answer");
  for (const source of ["response.function_call_arguments.done", "response.output_item.done"]) {
    const attempt = beginToolExecution(caseTwo, "knowledge_lookup", "call_case_two");
    if (!attempt.shouldExecute) continue;
    executionsCaseTwo += 1;
    const queued = enqueueAssistantResponseRequest(caseTwo, {
      reason: `tool_result:${source}`,
      response: {},
      dedupeKey: normalizeToolExecutionKey("knowledge_lookup", "call_case_two")
    });
    if (queued.action === "queued") {
      queuedCountCaseTwo += 1;
    }
    completeToolExecution(caseTwo, attempt.key);
  }
  markAssistantResponseFinished(caseTwo);
  const flushed = dequeueAssistantResponseRequest(caseTwo);
  if (flushed) {
    flushedCreatesCaseTwo += 1;
  }

  return {
    one_tool_call_one_execution: {
      executions: executionsCaseOne,
      response_creates: responseCreatesCaseOne,
      duplicate_event_suppressed: executionsCaseOne === 1 && responseCreatesCaseOne === 1
    },
    active_response_queueing: {
      executions: executionsCaseTwo,
      queued_responses: queuedCountCaseTwo,
      flushed_response_creates: flushedCreatesCaseTwo,
      duplicate_event_suppressed: executionsCaseTwo === 1 && queuedCountCaseTwo === 1 && flushedCreatesCaseTwo === 1
    }
  };
}

async function main() {
  process.env.KNOWLEDGE_RECEPTIONIST_DISABLE_BUILD_RATE_LIMIT = "true";
  const pool = new Pool({ connectionString: mustDatabaseUrl() });
  try {
    const beforeBuildId = await fetchCurrentActiveBuild(pool);
    const beforeArtifacts = beforeBuildId ? await fetchWarrantyArtifacts(pool, beforeBuildId) : null;

    const created = await createKnowledgeBuild(pool, TENANT_KEY, {
      websiteUrl: WEBSITE_URL
    });
    const buildId = String(created?.build?.build_id || "");
    if (!buildId) {
      throw new Error("build_id_missing_after_create");
    }
    if (String(created?.status || "") !== "ready_to_publish") {
      throw new Error(`build_not_ready_to_publish:${created?.status || "unknown"}`);
    }

    await publishKnowledgeBuild(pool, TENANT_KEY, buildId);
    const afterArtifacts = await fetchWarrantyArtifacts(pool, buildId);
    const runtimePreviewResults = await validateWarrantyQueries(pool, buildId);
    const toolDedupeResults = await validateToolDedupeSimulation();

    const output = {
      tenant_key: TENANT_KEY,
      before: {
        active_build_id: beforeBuildId || null,
        warranty_artifacts: beforeArtifacts
      },
      after: {
        rebuilt_build_id: buildId,
        warranty_artifacts: afterArtifacts,
        runtime_preview_results: runtimePreviewResults,
        tool_dedupe_results: toolDedupeResults
      }
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
