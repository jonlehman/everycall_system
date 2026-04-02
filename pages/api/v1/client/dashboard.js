import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { buildPlanDisplay, ensureTenantBillingAccount, requireTenantBillingAccess } from "../../_lib/billing.js";
import { listKnowledgeReceptionistBuilds } from "../../_lib/knowledgeReceptionistBuilds.js";
import { loadTenantBusinessHours } from "../../_lib/tenantBusinessHours.js";
import { computeLeadInvoiceEstimate, getLeadPricingConfig, resolveBillingWindow } from "../../../../lib/leadBilling.js";
import { isBusinessOpenAt } from "../../../../lib/businessHours.js";

function normalizeText(value) {
  return String(value || "").trim();
}

const DASHBOARD_CATEGORY_ORDER = [
  "project_inquiry",
  "general_inquiry",
  "existing_customer_support",
  "vendor_or_sales",
  "spam",
  "wrong_number",
  "hangup_or_incomplete",
  "other_non_billable"
];

const DASHBOARD_CATEGORY_LABELS = {
  project_inquiry: "Project Inquiry",
  general_inquiry: "General Inquiry",
  existing_customer_support: "Customer Support",
  vendor_or_sales: "Vendor / Sales",
  spam: "Spam",
  wrong_number: "Wrong Number",
  hangup_or_incomplete: "Hangup / Incomplete",
  other_non_billable: "Other Non-Billable"
};

const KNOWLEDGE_CARD_SUPPORT_THRESHOLD = 0.38;
const KNOWLEDGE_FACT_SUPPORT_THRESHOLD = 0.42;

function coerceNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function classifyKnowledgeCoverageEvent(row) {
  const maxCardSimilarity = coerceNumber(
    row?.max_card_similarity
    ?? row?.maxCardSimilarity
    ?? row?.top_card_similarity
  );
  const maxFactSimilarity = coerceNumber(
    row?.max_fact_similarity
    ?? row?.maxFactSimilarity
    ?? row?.top_fact_similarity
  );
  const kbAnswerability = normalizeText(row?.kb_answerability || row?.kbAnswerability).toLowerCase();
  const observedSupportStrength = normalizeText(row?.observed_support_strength || row?.observedSupportStrength).toLowerCase();
  const answeredFromKbValue = row?.answered_from_kb ?? row?.answeredFromKb;
  const unansweredFromKbValue = row?.unanswered_from_kb ?? row?.unansweredFromKb;

  let unansweredFromKb = unansweredFromKbValue === true;
  if (answeredFromKbValue === true) unansweredFromKb = false;
  if (!unansweredFromKb && kbAnswerability === "unanswered") unansweredFromKb = true;
  if (!unansweredFromKb && !kbAnswerability && observedSupportStrength === "none") unansweredFromKb = true;
  if (!unansweredFromKb && !kbAnswerability && !observedSupportStrength) {
    unansweredFromKb = maxCardSimilarity < KNOWLEDGE_CARD_SUPPORT_THRESHOLD
      && maxFactSimilarity < KNOWLEDGE_FACT_SUPPORT_THRESHOLD;
  }

  return {
    kbAnswerability: kbAnswerability || (unansweredFromKb ? "unanswered" : "answered"),
    unansweredFromKb,
    answeredFromKb: !unansweredFromKb,
    maxCardSimilarity,
    maxFactSimilarity
  };
}

function normalizeCallCategory(outcomeType, isValidLead) {
  const normalized = normalizeText(outcomeType).toLowerCase();
  if (
    isValidLead
    || [
      "callback_request",
      "estimate_request",
      "quote_request",
      "consultation_request",
      "appointment_request",
      "project_request",
      "project_inquiry",
      "service_request",
      "lead",
      "new_customer_lead",
      "message_taken",
      "transfer"
    ].includes(normalized)
  ) {
    return "project_inquiry";
  }
  if (["general_inquiry", "general_question", "question_only"].includes(normalized)) {
    return "general_inquiry";
  }
  if (normalized === "existing_customer_support" || normalized === "existing_customer") {
    return "existing_customer_support";
  }
  if (["vendor_or_sales", "vendor", "sales_call"].includes(normalized)) {
    return "vendor_or_sales";
  }
  if (normalized === "spam") {
    return "spam";
  }
  if (normalized === "wrong_number") {
    return "wrong_number";
  }
  if (["hangup", "hangup_incomplete", "canceled"].includes(normalized)) {
    return "hangup_or_incomplete";
  }
  return "other_non_billable";
}

function formatDateKeyInTimezone(value, timezone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function loadKnowledgeGapQuestions(pool, tenantKey) {
  try {
    const result = await pool.query(
      `SELECT
         k.knowledge_coverage_event_id,
         k.call_id,
         k.created_at,
         k.query_text,
         k.requested_coverage_item_text,
         k.kb_answerability,
         k.answered_from_kb,
         k.unanswered_from_kb,
         k.observed_support_strength,
         k.max_card_similarity,
         k.max_fact_similarity,
         c.summary,
         c.status,
         d.caller_first_name,
         d.caller_last_name,
         d.callback_number
       FROM knowledge_coverage_events k
       LEFT JOIN calls c ON c.call_sid = k.call_id
       LEFT JOIN call_details d ON d.call_sid = c.call_sid
       WHERE k.tenant_key = $1
         AND k.created_at >= NOW() - interval '30 days'
       ORDER BY k.created_at DESC
       LIMIT 80`,
      [tenantKey]
    );
    return (result.rows || [])
      .map((row) => ({ ...row, ...classifyKnowledgeCoverageEvent(row) }))
      .filter((row) => row.unansweredFromKb)
      .slice(0, 20);
  } catch (error) {
    if (error?.code === "42P01") return [];
    throw error;
  }
}

async function loadKnowledgeSignals(pool, tenantKey) {
  try {
    const result = await pool.query(
      `SELECT
         call_id,
         kb_answerability,
         answered_from_kb,
         unanswered_from_kb,
         observed_support_strength,
         max_card_similarity,
         max_fact_similarity
       FROM knowledge_coverage_events
       WHERE tenant_key = $1
         AND created_at >= NOW() - interval '30 days'`,
      [tenantKey]
    );
    const rows = (result.rows || []).map((row) => ({ ...row, ...classifyKnowledgeCoverageEvent(row) }));
    const unansweredRows = rows.filter((row) => row.unansweredFromKb);
    const unansweredCallIds = new Set(
      unansweredRows.map((row) => normalizeText(row.call_id)).filter(Boolean)
    );
    const callIds = new Set(
      rows.map((row) => normalizeText(row.call_id)).filter(Boolean)
    );
    return {
      kb_question_count_30d: rows.length,
      kb_call_count_30d: callIds.size,
      unanswered_question_count_30d: unansweredRows.length,
      unanswered_call_count_30d: unansweredCallIds.size
    };
  } catch (error) {
    if (error?.code === "42P01") {
      return {
        kb_question_count_30d: 0,
        kb_call_count_30d: 0,
        unanswered_question_count_30d: 0,
        unanswered_call_count_30d: 0
      };
    }
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await ensureTables(pool);

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, String(req.query?.tenantKey || "default"));
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return;

    const billingState = await ensureTenantBillingAccount(pool, tenantKey);
    if (!billingState) {
      return res.status(404).json({ error: "tenant_not_found" });
    }

    const billingWindow = resolveBillingWindow({
      currentPeriodStart: billingState.current_period_start,
      currentPeriodEnd: billingState.current_period_end
    });
    const leadPricing = getLeadPricingConfig(process.env);

    const [
      callsSummaryResult,
      leadSummaryResult,
      recentLeadsResult,
      recentCallsResult,
      classificationResult,
      volumeRowsResult,
      knowledgeSignals,
      knowledgeGapQuestions,
      businessHoursConfig,
      buildsData
    ] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS calls_30d,
           COUNT(*) FILTER (WHERE status IN ('new', 'contacted', 'in_progress'))::int AS open_follow_up_count,
           COUNT(*) FILTER (WHERE lead_is_valid = TRUE)::int AS valid_lead_count_30d
         FROM calls
         WHERE tenant_key = $1
           AND created_at >= NOW() - interval '30 days'`,
        [tenantKey]
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE lead_is_valid = TRUE)::int AS valid_lead_count,
           COUNT(*) FILTER (WHERE lead_is_billable = TRUE)::int AS billable_lead_count
         FROM calls
         WHERE tenant_key = $1
           AND created_at >= $2
           AND created_at < $3`,
        [tenantKey, billingWindow.start.toISOString(), billingWindow.end.toISOString()]
      ),
      pool.query(
        `SELECT
           c.call_sid,
           c.created_at,
           c.summary,
           c.status,
           c.lead_outcome_type,
           c.lead_is_valid,
           c.lead_is_billable,
           c.lead_decision_reason,
           d.caller_first_name,
           d.caller_last_name,
           d.callback_number,
           d.service_required
         FROM calls c
         LEFT JOIN call_details d ON d.call_sid = c.call_sid
         WHERE c.tenant_key = $1
           AND c.lead_is_valid = TRUE
         ORDER BY c.created_at DESC
         LIMIT 5`,
        [tenantKey]
      ),
      pool.query(
        `SELECT
           c.call_sid,
           c.created_at,
           c.summary,
           c.status,
           c.lead_outcome_type,
           c.lead_is_valid,
           c.lead_is_billable,
           c.lead_decision_reason,
           d.caller_first_name,
           d.caller_last_name,
           d.callback_number,
           d.service_required
         FROM calls c
         LEFT JOIN call_details d ON d.call_sid = c.call_sid
         WHERE c.tenant_key = $1
         ORDER BY c.created_at DESC
         LIMIT 5`,
        [tenantKey]
      ),
      pool.query(
        `SELECT
           lead_outcome_type,
           lead_is_valid,
           COUNT(*)::int AS count
         FROM calls
         WHERE tenant_key = $1
           AND created_at >= NOW() - interval '30 days'
         GROUP BY lead_outcome_type, lead_is_valid`,
        [tenantKey]
      ),
      pool.query(
        `SELECT
           created_at
         FROM calls
         WHERE tenant_key = $1
           AND created_at >= NOW() - interval '6 days'
         ORDER BY created_at ASC`,
        [tenantKey]
      ),
      loadKnowledgeSignals(pool, tenantKey),
      loadKnowledgeGapQuestions(pool, tenantKey),
      loadTenantBusinessHours(pool, tenantKey),
      listKnowledgeReceptionistBuilds(pool, tenantKey)
    ]);

    const callsSummary = callsSummaryResult.rows[0] || {};
    const leadSummary = leadSummaryResult.rows[0] || {};
    const validLeadCount30d = Number(callsSummary.valid_lead_count_30d || 0);
    const calls30d = Number(callsSummary.calls_30d || 0);
    const kbQuestionCount30d = Number(knowledgeSignals.kb_question_count_30d || 0);
    const kbCallCount30d = Number(knowledgeSignals.kb_call_count_30d || 0);
    const unansweredQuestionCalls30d = Number(knowledgeSignals.unanswered_question_count_30d || 0);
    const unansweredKbCallCount30d = Number(knowledgeSignals.unanswered_call_count_30d || 0);
    const timezone = normalizeText(businessHoursConfig?.timezone) || "America/Los_Angeles";
    const builds = Array.isArray(buildsData?.builds) ? buildsData.builds : [];
    const publishedBuilds = builds.filter((build) => normalizeText(build?.status).toLowerCase() === "published");
    const latestBuild = builds[0] || null;
    const activeBuildId = normalizeText(buildsData?.activeBuild?.active_build_id);
    const latestBuildId = normalizeText(latestBuild?.build_id);
    const runtimeReady = normalizeText(latestBuild?.status).toLowerCase() === "published"
      && activeBuildId
      && latestBuildId
      && activeBuildId === latestBuildId;
    const invoiceEstimate = computeLeadInvoiceEstimate({
      baseAmountCents: buildPlanDisplay(billingState).monthlyAmountCents,
      billableLeadCount: Number(leadSummary.billable_lead_count || 0)
    }, leadPricing);
    const categoryCounts = Object.fromEntries(
      DASHBOARD_CATEGORY_ORDER.map((key) => [key, 0])
    );
    for (const row of classificationResult.rows || []) {
      const key = normalizeCallCategory(row.lead_outcome_type, row.lead_is_valid);
      categoryCounts[key] = Number(categoryCounts[key] || 0) + Number(row.count || 0);
    }
    const classifiedTotal = Object.values(categoryCounts).reduce((sum, value) => sum + Number(value || 0), 0);
    const classificationBreakdown = DASHBOARD_CATEGORY_ORDER.map((key) => {
      const count = Number(categoryCounts[key] || 0);
      return {
        key,
        label: DASHBOARD_CATEGORY_LABELS[key] || key,
        count,
        percent: classifiedTotal ? Math.round((count / classifiedTotal) * 1000) / 10 : 0
      };
    });
    const trendMap = new Map();
    for (const row of volumeRowsResult.rows || []) {
      const createdAt = row.created_at ? new Date(row.created_at) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) continue;
      const dayKey = formatDateKeyInTimezone(createdAt, timezone);
      if (!dayKey) continue;
      const current = trendMap.get(dayKey) || { totalCount: 0, businessHoursCount: 0, afterHoursCount: 0 };
      current.totalCount += 1;
      if (isBusinessOpenAt(businessHoursConfig, createdAt)) {
        current.businessHoursCount += 1;
      } else {
        current.afterHoursCount += 1;
      }
      trendMap.set(dayKey, current);
    }
    const callVolumeLast7Days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.now() - ((6 - index) * 24 * 60 * 60 * 1000));
      const dayKey = formatDateKeyInTimezone(date, timezone);
      const counts = trendMap.get(dayKey) || {};
      return {
        day: dayKey,
        count: Number(counts.totalCount || 0),
        totalCount: Number(counts.totalCount || 0),
        businessHoursCount: Number(counts.businessHoursCount || 0),
        afterHoursCount: Number(counts.afterHoursCount || 0)
      };
    });

    const nextSteps = [];
    if (!publishedBuilds.length) {
      nextSteps.push({
        href: "/client/receptionist/knowledge",
        title: "Publish a Knowledge build",
        body: "The receptionist can sound specific only after a build is published."
      });
    }
    if (!runtimeReady) {
      nextSteps.push({
        href: "/client/receptionist/knowledge",
        title: "Make the latest build active",
        body: "Publish a build so the Sales Receptionist uses your latest business-specific knowledge."
      });
    }
    nextSteps.push({
      href: "/client/team",
      title: "Confirm alert recipients",
      body: "Use Team to decide which users should receive email or SMS call alerts."
    });
    nextSteps.push({
      href: "/client/calls",
      title: "Review the latest calls",
      body: "Check recent summaries, lead decisions, and callback details."
    });

    return res.status(200).json({
      ok: true,
      summary: {
        calls30d,
        validLeadCount30d,
        leadCaptureRate30d: calls30d ? Math.round((validLeadCount30d / calls30d) * 1000) / 10 : 0,
        openFollowUpCount: Number(callsSummary.open_follow_up_count || 0),
        validLeadCount: Number(leadSummary.valid_lead_count || 0),
        billableLeadCount: Number(leadSummary.billable_lead_count || 0)
      },
      billing: {
        status: billingState.billing_status,
        appAccessStatus: billingState.app_access_status,
        plan: buildPlanDisplay(billingState),
        currentPeriod: {
          label: billingWindow.label,
          start: billingWindow.start.toISOString(),
          end: billingWindow.end.toISOString()
        },
        invoiceEstimate,
        leadPricing
      },
      setup: {
        publishedBuildCount: publishedBuilds.length,
        latestBuildStatus: latestBuild?.status || null,
        activeBuildId,
        latestBuildId,
        runtimeReady
      },
      recentLeads: recentLeadsResult.rows || [],
      recentCalls: recentCallsResult.rows || [],
      classificationBreakdown,
      callVolumeLast7Days,
      knowledgeSignals: {
        kbQuestionCount30d,
        kbCallCount30d,
        unansweredQuestionCalls30d,
        unansweredKbCallCount30d,
        answeredQuestionRate30d: kbQuestionCount30d
          ? Math.max(0, Math.round(((kbQuestionCount30d - unansweredQuestionCalls30d) / kbQuestionCount30d) * 1000) / 10)
          : 100
      },
      knowledgeGapQuestions,
      nextSteps
    });
  } catch (err) {
    return res.status(500).json({ error: "client_dashboard_error", message: err?.message || "unknown" });
  }
}
