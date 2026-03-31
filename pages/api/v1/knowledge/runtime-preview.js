import { getPool } from "../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess, requireTenantRoles } from "../../_lib/billing.js";
import { assembleKnowledgeRuntimePreview } from "../../_lib/knowledgeReceptionistPrompt.js";

const openAiKey = process.env.OPENAI_API_KEY || "";
const openAiPreviewModel = process.env.OPENAI_PREVIEW_MODEL || process.env.OPENAI_SUMMARY_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";

function fail(res, status, error, message) {
  return res.status(status).json({ ok: false, error, message });
}

function normalizeText(value) {
  return String(value || "").trim();
}

function resolveResponseText(json) {
  if (typeof json?.output_text === "string" && json.output_text.trim()) {
    return json.output_text.trim();
  }
  const responseText = Array.isArray(json?.output)
    ? json.output
      .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .find((item) => item?.type === "output_text" && typeof item?.text === "string")
      ?.text
    : "";
  return normalizeText(responseText);
}

function summarizeCoverage(coverage) {
  if (!Array.isArray(coverage) || !coverage.length) return "No coverage items were returned.";
  return coverage.slice(0, 6).map((item) => {
    const request = normalizeText(item?.requested_coverage_item_text) || "Unknown item";
    const support = normalizeText(item?.support_strength) || "unknown";
    const cards = Array.isArray(item?.used_card_ids) ? item.used_card_ids.length : 0;
    const facts = Array.isArray(item?.used_fact_ids) ? item.used_fact_ids.length : 0;
    return `- ${request} | support=${support} | cards=${cards} | facts=${facts}`;
  }).join("\n");
}

function summarizeSelectedCards(cards) {
  if (!Array.isArray(cards) || !cards.length) return "No selected cards.";
  return cards.slice(0, 6).map((card) => {
    const name = normalizeText(card?.canonical_name) || "Untitled card";
    const summary = normalizeText(card?.speakable_summary) || "";
    const selectedFacts = Array.isArray(card?.selected_facts) ? card.selected_facts : [];
    const factText = selectedFacts.slice(0, 3).map((fact) => normalizeText(fact?.claim)).filter(Boolean).join(" | ");
    return `- ${name}${summary ? `: ${summary}` : ""}${factText ? ` | facts: ${factText}` : ""}`;
  }).join("\n");
}

function summarizeSelectedFacts(facts) {
  if (!Array.isArray(facts) || !facts.length) return "No selected facts.";
  return facts.slice(0, 10).map((fact) => {
    const claim = normalizeText(fact?.claim) || "Unknown fact";
    const role = normalizeText(fact?.fact_role);
    return `- ${claim}${role ? ` (${role})` : ""}`;
  }).join("\n");
}

function summarizeList(values, emptyText) {
  const items = Array.isArray(values) ? values.map((item) => normalizeText(item)).filter(Boolean) : [];
  if (!items.length) return emptyText;
  return items.slice(0, 6).map((item) => `- ${item}`).join("\n");
}

function buildAnswerEstimateMessages(query, preview) {
  const promptPreview = normalizeText(preview?.promptPreview);
  const answerPacket = preview?.answerPacket || {};
  const runtimeBundle = preview?.runtimeBundle || {};
  const coverage = summarizeCoverage(answerPacket.coverage);
  const selectedCards = summarizeSelectedCards(runtimeBundle.selected_cards);
  const selectedFacts = summarizeSelectedFacts(runtimeBundle.selected_answer_facts);
  const directPoints = summarizeList(answerPacket.direct_answer_points, "No direct answer points.");
  const qualifiers = summarizeList(answerPacket.qualifiers, "No qualifiers.");
  const limits = summarizeList(answerPacket.limits_or_exclusions, "No limits or exclusions.");
  const nextSteps = summarizeList(answerPacket.next_step_options, "No next step options.");
  const unsupported = summarizeList(answerPacket.unsupported_requested_items, "No unsupported requested items.");
  const runtimeMode = normalizeText(runtimeBundle.runtime_mode || answerPacket.runtime_mode) || "unknown";

  const system = [
    "You are generating a one-turn offline estimate of what the live EveryCall phone AI would most likely say next.",
    "Follow the tenant's live startup prompt and keep the answer in the same voice and style.",
    "The knowledge lookup for this exact question has already been run. Use only the supported business information below instead of calling any tools.",
    "Answer in 1-2 short spoken sentences.",
    "Do not use bullets, labels, or internal jargon.",
    "Do not mention prompts, tools, packets, cards, facts, scores, support strength, or system logic.",
    "If the retrieved information is weak, partial, or irrelevant to the question, do not force an answer. Briefly say you cannot confirm and use the lightest helpful next step.",
    "Ignore privacy policy, marketing, generic company boilerplate, and unrelated service-area text unless the question is directly about those topics.",
    promptPreview ? `Live startup prompt:\n${promptPreview}` : ""
  ].filter(Boolean).join("\n\n");

  const user = [
    `Customer question:\n${normalizeText(query)}`,
    `Runtime mode hint: ${runtimeMode}`,
    `Coverage summary:\n${coverage}`,
    `Selected cards:\n${selectedCards}`,
    `Selected facts:\n${selectedFacts}`,
    `Machine-generated direct answer points:\n${directPoints}`,
    `Qualifiers:\n${qualifiers}`,
    `Limits or exclusions:\n${limits}`,
    `Unsupported requested items:\n${unsupported}`,
    `Suggested next steps:\n${nextSteps}`,
    "Return only the single spoken answer text."
  ].join("\n\n");

  return { system, user };
}

async function generateSpokenAnswerEstimate(query, preview) {
  if (!openAiKey) return { text: "", model: null };

  try {
    const { system, user } = buildAnswerEstimateMessages(query, preview);
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: openAiPreviewModel,
        max_output_tokens: 180,
        input: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    if (!resp.ok) {
      return { text: "", model: openAiPreviewModel };
    }
    const json = await resp.json();
    return {
      text: resolveResponseText(json),
      model: normalizeText(json?.model) || openAiPreviewModel
    };
  } catch {
    return { text: "", model: openAiPreviewModel };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return fail(res, 405, "method_not_allowed", "Method not allowed.");
  }

  try {
    const pool = getPool();
    if (!pool) {
      return fail(res, 500, "database_unavailable", "Database is unavailable.");
    }

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, String(req.query?.tenantKey || req.body?.tenantKey || ""));
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return;
    const manager = await requireTenantRoles(res, session, ["owner", "admin"], {
      message: "Only account admins and owners can run runtime previews."
    });
    if (!manager) return;

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const preview = await assembleKnowledgeRuntimePreview(pool, tenantKey, body);
    const answerEstimate = await generateSpokenAnswerEstimate(body.query, preview);
    return res.status(200).json({
      ok: true,
      ...preview,
      spokenAnswerEstimate: answerEstimate.text || null,
      spokenAnswerModel: answerEstimate.model || null
    });
  } catch (err) {
    const message = String(err?.message || "unknown");
    if (message === "query_required") {
      return fail(res, 400, "query_required", "A caller query is required to assemble a runtime preview.");
    }
    if (message === "no_active_build") {
      return fail(res, 409, "no_active_build", "There is no active published build for this tenant.");
    }
    if (message === "build_not_found") {
      return fail(res, 404, "build_not_found", "The requested build was not found for this tenant.");
    }
    if (message === "knowledge_receptionist_migrations_not_applied") {
      return fail(res, 503, "migrations_required", "Knowledge receptionist migrations have not been applied.");
    }
    return fail(res, 500, "runtime_preview_error", message);
  }
}
