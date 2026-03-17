import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

import { buildFallbackSourceSummary } from "../pages/api/_lib/knowledgeReceptionistCompiler.js";

const { Pool } = pg;

const TENANT_KEY = "creative_dynamic";

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function mustDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL missing");
  }
  return databaseUrl;
}

async function main() {
  const pool = new Pool({ connectionString: mustDatabaseUrl() });
  const buildId = createId("build_fallback_test");
  const batchId = createId("kbatch");
  const sourceRefId = createId("sr");
  const sourceChunkId = createId("schunk");

  try {
    await pool.query(
      `INSERT INTO knowledge_builds (
         build_id,
         tenant_key,
         status,
         version,
         domain_assignments_json,
         source_channels_json,
         created_by_type
       ) VALUES ($1, $2, 'running', 'fallback_test', '[]'::jsonb, '["website_file"]'::jsonb, 'tenant')`,
      [buildId, TENANT_KEY]
    );

    await pool.query(
      `INSERT INTO source_refs (
         source_ref_id,
         tenant_key,
         build_id,
         source_channel,
         source_kind,
         source_authority,
         source_locator,
         title,
         page_type,
         content_hash,
         metadata_json
       ) VALUES (
         $1, $2, $3,
         'website_file',
         'pdf',
         'owner_site',
         'https://example.test/financing-guide.pdf',
         'Financing Guide PDF',
         'policy',
         $4,
         '{"document_class":"policy","content_class":"policy_boundary"}'::jsonb
       )`,
      [sourceRefId, TENANT_KEY, buildId, createId("hash")]
    );

    await pool.query(
      `INSERT INTO source_chunks (
         source_chunk_id,
         tenant_key,
         build_id,
         source_ref_id,
         chunk_index,
         chunk_kind,
         section_title,
         heading_path,
         text_span,
         token_estimate,
         content_hash,
         metadata_json
       ) VALUES (
         $1, $2, $3, $4,
         0,
         'content_block',
         'Applicability',
         'Applicability',
         'Financing is available for qualifying projects only. Terms and approval limits may apply.',
         24,
         $5,
         '{}'::jsonb
       )`,
      [sourceChunkId, TENANT_KEY, buildId, sourceRefId, createId("chunkhash")]
    );

    await pool.query(
      `INSERT INTO knowledge_build_analysis_batches (
         knowledge_build_analysis_batch_id,
         tenant_key,
         build_id,
         stage,
         batch_key,
         status,
         model,
         prompt_cache_key,
         item_ids_json,
         request_token_estimate,
         response_token_budget,
         attempt_count
       ) VALUES (
         $1, $2, $3,
         'source_summary',
         $4,
         'running',
         'test-model',
         'test-cache-key',
         $5::jsonb,
         100,
         200,
         1
       )`,
      [batchId, TENANT_KEY, buildId, createId("batchkey"), JSON.stringify([sourceRefId])]
    );

    const fallbackRow = buildFallbackSourceSummary({
      sourceRefId,
      sourceItem: {
        title: "Financing Guide PDF",
        lines: [
          "Financing is available for qualifying projects only.",
          "Terms and approval limits may apply."
        ],
        text: "Financing is available for qualifying projects only. Terms and approval limits may apply.",
        pageType: "policy"
      },
      sourceChunks: [
        {
          source_chunk_id: sourceChunkId,
          text_span: "Financing is available for qualifying projects only. Terms and approval limits may apply."
        }
      ]
    }, "missing_summary_output");

    await pool.query(
      `INSERT INTO knowledge_build_source_summaries (
         source_summary_id,
         tenant_key,
         build_id,
         source_ref_id,
         knowledge_build_analysis_batch_id,
         status,
         summary_text,
         candidate_topics_json,
         answerable_units_json,
         question_forms_json,
         notable_boundaries_json,
         source_chunk_ids_json,
         token_estimate,
         error_text
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
         $13, $14
       )`,
      [
        fallbackRow.source_summary_id,
        TENANT_KEY,
        buildId,
        sourceRefId,
        batchId,
        fallbackRow.status,
        fallbackRow.summary_text,
        JSON.stringify(fallbackRow.candidate_topics_json),
        JSON.stringify(fallbackRow.answerable_units_json),
        JSON.stringify(fallbackRow.question_forms_json),
        JSON.stringify(fallbackRow.notable_boundaries_json),
        JSON.stringify(fallbackRow.source_chunk_ids_json),
        fallbackRow.token_estimate,
        fallbackRow.error_text
      ]
    );

    await pool.query(
      `UPDATE knowledge_build_analysis_batches
       SET status = 'fallback',
           result_json = '{"fallback_source_ref_ids":[]}'::jsonb,
           error_text = 'missing_summary_output',
           completed_at = now(),
           updated_at = now()
       WHERE knowledge_build_analysis_batch_id = $1`,
      [batchId]
    );

    const summaryRes = await pool.query(
      `SELECT status, summary_text, answerable_units_json, question_forms_json, error_text
       FROM knowledge_build_source_summaries
       WHERE build_id = $1
         AND source_ref_id = $2`,
      [buildId, sourceRefId]
    );
    const missingRes = await pool.query(
      `SELECT count(*)::int AS missing_count
       FROM source_refs sr
       LEFT JOIN knowledge_build_source_summaries ss
         ON ss.build_id = sr.build_id
        AND ss.source_ref_id = sr.source_ref_id
       WHERE sr.build_id = $1
         AND sr.source_ref_id = $2
         AND ss.source_ref_id IS NULL`,
      [buildId, sourceRefId]
    );
    const batchRes = await pool.query(
      `SELECT status
       FROM knowledge_build_analysis_batches
       WHERE knowledge_build_analysis_batch_id = $1`,
      [batchId]
    );

    assert.equal(summaryRes.rowCount, 1);
    assert.equal(summaryRes.rows[0].status, "fallback");
    assert.equal(missingRes.rows[0].missing_count, 0);
    assert.equal(batchRes.rows[0].status, "fallback");
    assert.ok(Array.isArray(summaryRes.rows[0].answerable_units_json));
    assert.ok(Array.isArray(summaryRes.rows[0].question_forms_json));

    console.log(JSON.stringify({
      ok: true,
      build_id: buildId,
      source_ref_id: sourceRefId,
      batch_id: batchId,
      summary_status: summaryRes.rows[0].status,
      missing_summary_count: missingRes.rows[0].missing_count,
      batch_status: batchRes.rows[0].status
    }, null, 2));
  } finally {
    await pool.query(`DELETE FROM knowledge_builds WHERE build_id = $1`, [buildId]).catch(() => {});
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
