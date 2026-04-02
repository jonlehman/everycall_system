import crypto from "node:crypto";
import { z } from "zod";
import {
  buildTranscriptFromEvents,
  callOpenAiJsonModel,
  sanitizeTranscriptText
} from "@everycall/contracts";
import { ASYNC_JOB_TYPES, enqueueAsyncJob } from "../../../lib/asyncJobs.js";

const ANALYSIS_VERSION = "unanswered_questions_v1";
const OPENAI_TRANSCRIPT_ANALYSIS_MODEL = process.env.OPENAI_TRANSCRIPT_ANALYSIS_MODEL
  || "gpt-5.4-nano";
const MAX_TRANSCRIPT_ANALYSIS_CHARS = 20_000;
const MAX_UNANSWERED_QUESTIONS = 12;

function normalizeText(value) {
  return String(value || "").trim();
}

function clipText(value, maxLength) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}…` : normalized;
}

function buildTranscriptHash(transcript) {
  return crypto.createHash("sha256").update(String(transcript || ""), "utf8").digest("hex");
}

function trimTranscriptForAnalysis(transcript) {
  const cleaned = sanitizeTranscriptText(String(transcript || ""));
  if (!cleaned) return "";
  if (cleaned.length <= MAX_TRANSCRIPT_ANALYSIS_CHARS) return cleaned;
  const half = Math.floor((MAX_TRANSCRIPT_ANALYSIS_CHARS - 64) / 2);
  return [
    cleaned.slice(0, half).trim(),
    "[... transcript truncated for analysis ...]",
    cleaned.slice(-half).trim()
  ].filter(Boolean).join("\n\n");
}

const unansweredQuestionSchema = z.object({
  question_text: z.string().min(1).max(500),
  assistant_response_text: z.string().min(1).max(1000),
  reason: z.enum([
    "explicit_unknown",
    "cannot_confirm",
    "follow_up_needed",
    "generic_deflection",
    "partial_but_unanswered"
  ]).optional()
});

const callTranscriptAnalysisSchema = z.object({
  total_business_questions: z.number().int().min(0).max(50),
  unanswered_questions: z.array(unansweredQuestionSchema).max(MAX_UNANSWERED_QUESTIONS).default([])
});

export async function loadCombinedTranscriptForAnalysis(db, callSid) {
  const detail = await db.query(
    `SELECT transcript_combined, transcript
     FROM call_details
     WHERE call_sid = $1
     LIMIT 1`,
    [callSid]
  );
  const combined = sanitizeTranscriptText(detail.rows?.[0]?.transcript_combined || detail.rows?.[0]?.transcript || "");
  if (combined) return combined;

  const events = await db.query(
    `SELECT role, text, created_at
     FROM call_events
     WHERE call_sid = $1
     ORDER BY created_at ASC, id ASC`,
    [callSid]
  );
  return sanitizeTranscriptText(buildTranscriptFromEvents(events.rows || []));
}

export async function analyzeTranscriptForUnansweredQuestions(transcript) {
  const preparedTranscript = trimTranscriptForAnalysis(transcript);
  if (!preparedTranscript) {
    return {
      totalBusinessQuestions: 0,
      unansweredQuestions: [],
      model: null,
      responseId: null,
      rawResponse: null
    };
  }

  const system = [
    "You analyze finalized phone call transcripts between a caller and an AI receptionist.",
    "Count only direct business-information questions asked by the caller.",
    "A business-information question asks for factual information about the business, services, pricing, warranty, policies, availability, service area, process, timing, or capabilities.",
    "Do not count basic lead-capture prompts like asking for a name, callback number, address, or appointment time unless the caller is asking for factual business information.",
    "Mark a question as unanswered only when the assistant clearly failed to answer it from business-specific knowledge.",
    "Examples of unanswered: the assistant says it does not know, cannot confirm, needs someone to follow up, or gives a generic deflection instead of answering the question.",
    "Do not mark a question unanswered if the assistant gave a reasonable direct answer, even if brief.",
    "Use only the transcript. Do not invent missing facts.",
    "For each unanswered question, preserve the caller's question and the assistant response that showed the gap as closely as possible."
  ].join(" ");

  const user = [
    "Return JSON with:",
    "- total_business_questions: integer",
    "- unanswered_questions: array of objects with question_text, assistant_response_text, and optional reason",
    "",
    "Transcript:",
    preparedTranscript
  ].join("\n");

  const result = await callOpenAiJsonModel({
    model: OPENAI_TRANSCRIPT_ANALYSIS_MODEL,
    system,
    user,
    schema: callTranscriptAnalysisSchema,
    maxOutputTokens: 1200,
    jsonSchemaName: "call_transcript_unanswered_questions"
  });

  const unansweredQuestions = (result.parsed.unanswered_questions || []).map((item, index) => ({
    ordinal: index,
    questionText: clipText(item.question_text, 500),
    assistantResponseText: clipText(item.assistant_response_text, 1000),
    reason: normalizeText(item.reason)
  })).filter((item) => item.questionText && item.assistantResponseText);

  return {
    totalBusinessQuestions: Number(result.parsed.total_business_questions || 0),
    unansweredQuestions,
    model: result.model,
    responseId: result.responseId,
    rawResponse: result.rawResponse
  };
}

export async function persistTranscriptQuestionAnalysis(db, {
  tenantKey,
  callSid,
  transcript,
  analysis
}) {
  const transcriptSha256 = buildTranscriptHash(transcript);
  const unansweredQuestionCount = Array.isArray(analysis?.unansweredQuestions) ? analysis.unansweredQuestions.length : 0;
  const totalBusinessQuestions = Number(analysis?.totalBusinessQuestions || 0);
  const analysisJson = {
    total_business_questions: totalBusinessQuestions,
    unanswered_questions: (analysis?.unansweredQuestions || []).map((item) => ({
      ordinal: item.ordinal,
      question_text: item.questionText,
      assistant_response_text: item.assistantResponseText,
      reason: item.reason || null
    }))
  };

  const client = typeof db?.connect === "function" ? await db.connect() : db;
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO call_transcript_analyses (
         call_sid,
         tenant_key,
         transcript_sha256,
         analysis_version,
         model,
         response_id,
         total_business_questions,
         unanswered_question_count,
         analysis_json,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW(), NOW())
       ON CONFLICT (call_sid)
       DO UPDATE SET
         tenant_key = EXCLUDED.tenant_key,
         transcript_sha256 = EXCLUDED.transcript_sha256,
         analysis_version = EXCLUDED.analysis_version,
         model = EXCLUDED.model,
         response_id = EXCLUDED.response_id,
         total_business_questions = EXCLUDED.total_business_questions,
         unanswered_question_count = EXCLUDED.unanswered_question_count,
         analysis_json = EXCLUDED.analysis_json,
         updated_at = NOW()`,
      [
        callSid,
        tenantKey,
        transcriptSha256,
        ANALYSIS_VERSION,
        normalizeText(analysis?.model) || null,
        normalizeText(analysis?.responseId) || null,
        totalBusinessQuestions,
        unansweredQuestionCount,
        JSON.stringify(analysisJson)
      ]
    );

    await client.query(
      `DELETE FROM call_unanswered_questions
       WHERE call_sid = $1`,
      [callSid]
    );

    for (const item of analysis?.unansweredQuestions || []) {
      await client.query(
        `INSERT INTO call_unanswered_questions (
           tenant_key,
           call_sid,
           analysis_version,
           ordinal,
           question_text,
           assistant_response_text,
           reason,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [
          tenantKey,
          callSid,
          ANALYSIS_VERSION,
          Number(item.ordinal || 0),
          item.questionText,
          item.assistantResponseText,
          item.reason || null
        ]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    if (client !== db && typeof client?.release === "function") {
      client.release();
    }
  }

  return {
    transcriptSha256,
    totalBusinessQuestions,
    unansweredQuestionCount
  };
}

export async function analyzeAndPersistCallTranscriptQuestions(db, {
  tenantKey,
  callSid
}) {
  const transcript = await loadCombinedTranscriptForAnalysis(db, callSid);
  if (!transcript) {
    return {
      skipped: true,
      reason: "missing_transcript"
    };
  }

  const transcriptSha256 = buildTranscriptHash(transcript);
  const existing = await db.query(
    `SELECT transcript_sha256, analysis_version
     FROM call_transcript_analyses
     WHERE call_sid = $1
     LIMIT 1`,
    [callSid]
  );
  const currentHash = normalizeText(existing.rows?.[0]?.transcript_sha256);
  const currentVersion = normalizeText(existing.rows?.[0]?.analysis_version);
  if (currentHash && currentHash === transcriptSha256 && currentVersion === ANALYSIS_VERSION) {
    return {
      skipped: true,
      reason: "up_to_date",
      transcriptSha256
    };
  }

  const analysis = await analyzeTranscriptForUnansweredQuestions(transcript);
  const persisted = await persistTranscriptQuestionAnalysis(db, {
    tenantKey,
    callSid,
    transcript,
    analysis
  });
  return {
    skipped: false,
    ...persisted,
    model: analysis.model
  };
}

export async function enqueueMissingCallTranscriptAnalyses(db, {
  tenantKey,
  days = 30,
  limit = 50
}) {
  const result = await db.query(
    `SELECT c.call_sid
     FROM calls c
     LEFT JOIN call_transcript_analyses a ON a.call_sid = c.call_sid
     WHERE c.tenant_key = $1
       AND c.created_at >= NOW() - ($2::text || ' days')::interval
       AND a.call_sid IS NULL
     ORDER BY c.created_at DESC
     LIMIT $3`,
    [tenantKey, String(Math.max(1, Number(days || 30))), Math.max(1, Number(limit || 50))]
  );

  let enqueued = 0;
  for (const row of result.rows || []) {
    const callSid = normalizeText(row.call_sid);
    if (!callSid) continue;
    await enqueueAsyncJob(db, {
      jobType: ASYNC_JOB_TYPES.callTranscriptAnalysis,
      tenantKey,
      dedupeKey: `call_transcript_analysis_backfill:${callSid}`,
      payload: {
        tenantKey,
        callSid
      },
      maxAttempts: 4
    });
    enqueued += 1;
  }
  return {
    enqueued
  };
}

export async function reviveDeadLetterCallTranscriptAnalyses(db, {
  tenantKey,
  days = 30,
  limit = 50
}) {
  const result = await db.query(
    `WITH ranked AS (
       SELECT
         j.id,
         ROW_NUMBER() OVER (
           PARTITION BY (j.payload_json->>'callSid')
           ORDER BY j.updated_at DESC, j.id DESC
         ) AS rn
       FROM async_jobs j
       JOIN calls c
         ON c.call_sid = (j.payload_json->>'callSid')
       LEFT JOIN call_transcript_analyses a
         ON a.call_sid = c.call_sid
       WHERE j.job_type = $1
         AND j.tenant_key = $2
         AND j.status = 'dead_letter'
         AND c.tenant_key = $2
         AND c.created_at >= NOW() - ($3::text || ' days')::interval
         AND a.call_sid IS NULL
     ),
     candidate AS (
       SELECT id
       FROM ranked
       WHERE rn = 1
       ORDER BY id ASC
       LIMIT $4
     )
     UPDATE async_jobs jobs
     SET status = 'pending',
         attempts = 0,
         completed_at = NULL,
         available_at = NOW(),
         locked_at = NULL,
         locked_by = NULL,
         last_error = NULL,
         updated_at = NOW()
     FROM candidate
     WHERE jobs.id = candidate.id
     RETURNING jobs.id`,
    [
      ASYNC_JOB_TYPES.callTranscriptAnalysis,
      tenantKey,
      String(Math.max(1, Number(days || 30))),
      Math.max(1, Number(limit || 50))
    ]
  );

  return {
    revived: result.rowCount || 0
  };
}

export { ANALYSIS_VERSION as CALL_TRANSCRIPT_ANALYSIS_VERSION };
