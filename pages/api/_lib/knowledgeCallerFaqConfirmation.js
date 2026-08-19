import crypto from "node:crypto";
import { CALLER_FAQ_CATEGORIES, normalizeCallerFaqCategories } from "./knowledgeCoreFacts.js";

export const CALLER_FAQ_CONFIRMATION_FIELDS = [
  "repairs_service",
  "estimates",
  "service_area",
  "hours",
  "emergency"
];

const FIELD_TITLES = {
  repairs_service: "Repairs and service",
  estimates: "Estimates and quotes",
  service_area: "Service area",
  hours: "Business hours",
  emergency: "Emergency and after-hours availability"
};

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function ensureSentence(value) {
  const text = normalizeText(value);
  return text && !/[.!?]$/.test(text) ? `${text}.` : text;
}

function stableId(prefix, tenantKey) {
  return `${prefix}_${crypto.createHash("sha256").update(String(tenantKey || "")).digest("hex").slice(0, 24)}`;
}

export function normalizeCallerFaqAnswers(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const answers = {};
  for (const field of CALLER_FAQ_CONFIRMATION_FIELDS) {
    const answer = normalizeText(source[field]);
    if (!answer) throw new Error(`caller_faq_answer_required:${field}`);
    if (answer.length > 500) throw new Error(`caller_faq_answer_too_long:${field}`);
    answers[field] = answer;
  }
  return answers;
}

export function callerFaqSummaryBlocks(answers) {
  return CALLER_FAQ_CONFIRMATION_FIELDS
    .filter((field) => !/^(?:not sure|unknown|i don't know|i do not know)[.!]?$/i.test(normalizeText(answers[field])))
    .map((field) => ({
      blockKey: `caller_faq_${field}`,
      title: FIELD_TITLES[field],
      summaryText: ensureSentence(answers[field]),
      confirmationStatus: "confirmed",
      metadata: { source: "caller_faq_confirmation_v1", category: field }
    }));
}

export function callerFaqConfirmationIds(tenantKey) {
  return {
    intentId: stableId("faq_intent", tenantKey),
    sessionId: stableId("faq_session", tenantKey)
  };
}

export async function loadCallerFaqConfirmation(db, tenantKey) {
  const result = await db.query(
    `SELECT tenant_key, trigger_build_id, status, missing_categories_json, answers_json,
            setup_interview_session_id, followup_build_id, created_at, updated_at, completed_at
     FROM tenant_caller_faq_confirmations
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  const row = result.rows?.[0];
  return row ? {
    ...row,
    missing_categories_json: normalizeCallerFaqCategories(row.missing_categories_json),
    answers_json: row.answers_json && typeof row.answers_json === "object" ? row.answers_json : {}
  } : null;
}

export async function syncCallerFaqConfirmationState(db, { tenantKey, buildId, facts }) {
  const websiteAnswersBroadRepairQuestion = (Array.isArray(facts) ? facts : []).some((fact) =>
    normalizeCallerFaqCategories(fact?.core_fact_caller_question_categories_json).includes("repairs_service")
    && fact?.core_fact_is_safe_to_speak === true
  );
  const status = websiteAnswersBroadRepairQuestion ? "not_required" : "pending";
  const missingCategories = websiteAnswersBroadRepairQuestion ? [] : CALLER_FAQ_CONFIRMATION_FIELDS;
  await db.query(
    `INSERT INTO tenant_caller_faq_confirmations (
       tenant_key, trigger_build_id, status, missing_categories_json, updated_at
     )
     VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (tenant_key)
     DO UPDATE SET trigger_build_id = EXCLUDED.trigger_build_id,
                   status = EXCLUDED.status,
                   missing_categories_json = EXCLUDED.missing_categories_json,
                   updated_at = NOW()
     WHERE tenant_caller_faq_confirmations.status <> 'completed'`,
    [tenantKey, buildId, status, JSON.stringify(missingCategories)]
  );
  return { status, missingCategories, websiteAnswersBroadRepairQuestion };
}

export async function completeCallerFaqConfirmation(db, {
  tenantKey,
  answers,
  setupInterviewSessionId,
  followupBuildId
}) {
  await db.query(
    `UPDATE tenant_caller_faq_confirmations
     SET status = 'completed',
         answers_json = $2::jsonb,
         setup_interview_session_id = $3,
         followup_build_id = $4,
         missing_categories_json = '[]'::jsonb,
         completed_at = NOW(),
         updated_at = NOW()
     WHERE tenant_key = $1`,
    [tenantKey, JSON.stringify(answers), setupInterviewSessionId, followupBuildId]
  );
}

export function isCallerFaqCategory(value) {
  return CALLER_FAQ_CATEGORIES.includes(normalizeText(value));
}
