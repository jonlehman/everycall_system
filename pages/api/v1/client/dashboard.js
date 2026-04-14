import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import {
  buildPlanDisplay,
  ensureTenantBillingAccount,
  getSystemBillingConfig,
  requireActiveTenantUser,
  requireTenantBillingAccess,
  resolveEffectiveCallPricing,
  tenantUserHasAnyRole
} from "../../_lib/billing.js";
import { syncCurrentBillingPeriod } from "../../_lib/callBilling.js";
import { listKnowledgeReceptionistBuilds } from "../../_lib/knowledgeReceptionistBuilds.js";
import { loadTenantBusinessHours } from "../../_lib/tenantBusinessHours.js";
import { CALL_TRANSCRIPT_ANALYSIS_VERSION } from "../../_lib/callTranscriptAnalysis.js";
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

const REPORTING_WINDOWS = {
  "7d": { key: "7d", days: 7, label: "Last 7 Days" },
  "30d": { key: "30d", days: 30, label: "Last 30 Days" },
  "90d": { key: "90d", days: 90, label: "Last 90 Days" }
};

function resolveReportingWindow(value) {
  const normalized = normalizeText(value).toLowerCase();
  return REPORTING_WINDOWS[normalized] || REPORTING_WINDOWS["30d"];
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

function formatTrendLabel(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatTrendRangeLabel(startKey, endKey) {
  if (!startKey) return "";
  if (!endKey || startKey === endKey) return formatTrendLabel(startKey);
  const startDate = new Date(`${startKey}T12:00:00`);
  const endDate = new Date(`${endKey}T12:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return `${startKey} - ${endKey}`;
  }

  const startMonth = startDate.toLocaleDateString([], { month: "short" });
  const endMonth = endDate.toLocaleDateString([], { month: "short" });
  const startDay = startDate.getDate();
  const endDay = endDate.getDate();
  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}`;
  }
  return `${startMonth} ${startDay}-${endMonth} ${endDay}`;
}

function buildCallVolumeTrend(trendMap, timezone, reportingWindow) {
  const dayKeys = Array.from({ length: reportingWindow.days }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - ((reportingWindow.days - 1) - index));
    return formatDateKeyInTimezone(date, timezone);
  }).filter(Boolean);

  const bucketCount = Math.min(7, dayKeys.length);
  return Array.from({ length: bucketCount }, (_, index) => {
    const start = Math.floor((index * dayKeys.length) / bucketCount);
    const end = Math.floor(((index + 1) * dayKeys.length) / bucketCount);
    const bucketDayKeys = dayKeys.slice(start, end);
    const firstKey = bucketDayKeys[0] || "";
    const lastKey = bucketDayKeys[bucketDayKeys.length - 1] || firstKey;
    const counts = bucketDayKeys.reduce((sum, dayKey) => {
      const entry = trendMap.get(dayKey) || {};
      sum.totalCount += Number(entry.totalCount || 0);
      sum.businessHoursCount += Number(entry.businessHoursCount || 0);
      sum.afterHoursCount += Number(entry.afterHoursCount || 0);
      return sum;
    }, { totalCount: 0, businessHoursCount: 0, afterHoursCount: 0 });

    return {
      key: `${firstKey}:${lastKey}`,
      start: firstKey,
      end: lastKey,
      label: formatTrendRangeLabel(firstKey, lastKey),
      count: counts.totalCount,
      totalCount: counts.totalCount,
      businessHoursCount: counts.businessHoursCount,
      afterHoursCount: counts.afterHoursCount
    };
  });
}

async function loadKnowledgeGapQuestions(pool, tenantKey, { limit = 25, days = 30 } = {}) {
  try {
    const result = await pool.query(
      `SELECT
         q.id AS unanswered_question_id,
         q.call_sid,
         c.created_at,
         q.question_text,
         q.assistant_response_text,
         q.reason,
         c.summary,
         c.status,
         d.caller_first_name,
         d.caller_last_name,
         d.callback_number
       FROM call_unanswered_questions q
       LEFT JOIN calls c ON c.call_sid = q.call_sid
       LEFT JOIN call_details d ON d.call_sid = c.call_sid
       WHERE q.tenant_key = $1
         AND c.created_at >= (CURRENT_DATE - ($2::int - 1))
       ORDER BY q.created_at DESC
       LIMIT $3`,
      [tenantKey, Math.max(1, Number(days || 30)), Math.max(1, Number(limit || 25))]
    );
    return result.rows || [];
  } catch (error) {
    if (error?.code === "42P01") return [];
    throw error;
  }
}

async function loadAnsweredKnowledgeQuestions(pool, tenantKey, { limit = 25, days = 30 } = {}) {
  try {
    const result = await pool.query(
      `SELECT
         q.id AS answered_question_id,
         q.call_sid,
         c.created_at,
         q.question_text,
         q.assistant_response_text,
         c.summary,
         c.status,
         d.caller_first_name,
         d.caller_last_name,
         d.callback_number
       FROM call_answered_questions q
       LEFT JOIN calls c ON c.call_sid = q.call_sid
       LEFT JOIN call_details d ON d.call_sid = c.call_sid
       WHERE q.tenant_key = $1
         AND c.created_at >= (CURRENT_DATE - ($2::int - 1))
       ORDER BY q.created_at DESC
       LIMIT $3`,
      [tenantKey, Math.max(1, Number(days || 30)), Math.max(1, Number(limit || 25))]
    );
    return result.rows || [];
  } catch (error) {
    if (error?.code === "42P01") return [];
    throw error;
  }
}

async function loadKnowledgeSignals(pool, tenantKey, days) {
  try {
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(a.total_business_questions), 0)::int AS kb_question_count_30d,
         COUNT(DISTINCT a.call_sid) FILTER (WHERE a.total_business_questions > 0)::int AS kb_call_count_30d,
         COALESCE(SUM(a.unanswered_question_count), 0)::int AS unanswered_question_count_30d,
         COUNT(DISTINCT a.call_sid) FILTER (WHERE a.unanswered_question_count > 0)::int AS unanswered_call_count_30d
       FROM call_transcript_analyses a
       JOIN calls c ON c.call_sid = a.call_sid
       WHERE a.tenant_key = $1
         AND c.created_at >= (CURRENT_DATE - ($2::int - 1))`,
      [tenantKey, Math.max(1, Number(days || 30))]
    );
    return result.rows?.[0] || {
      kb_question_count_30d: 0,
      kb_call_count_30d: 0,
      unanswered_question_count_30d: 0,
      unanswered_call_count_30d: 0
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

async function countPendingTranscriptAnalysisCalls(pool, tenantKey, days) {
  try {
    const result = await pool.query(
      `SELECT COUNT(DISTINCT c.call_sid)::int AS pending_call_count_30d
       FROM calls c
       LEFT JOIN call_transcript_analyses a ON a.call_sid = c.call_sid
       JOIN async_jobs j
         ON j.tenant_key = c.tenant_key
        AND j.job_type = 'call_transcript.analysis'
        AND (j.payload_json->>'callSid') = c.call_sid
        AND j.status IN ('pending', 'running')
       WHERE c.tenant_key = $1
         AND c.created_at >= (CURRENT_DATE - ($2::int - 1))
         AND (a.call_sid IS NULL OR a.analysis_version IS DISTINCT FROM $3)`,
      [tenantKey, Math.max(1, Number(days || 30)), CALL_TRANSCRIPT_ANALYSIS_VERSION]
    );
    return Number(result.rows?.[0]?.pending_call_count_30d || 0);
  } catch (error) {
    if (error?.code === "42P01") return 0;
    throw error;
  }
}

async function countFailedTranscriptAnalysisCalls(pool, tenantKey, days) {
  try {
    const result = await pool.query(
      `SELECT COUNT(DISTINCT c.call_sid)::int AS failed_call_count_30d
       FROM calls c
       LEFT JOIN call_transcript_analyses a ON a.call_sid = c.call_sid
       JOIN async_jobs j
         ON j.tenant_key = c.tenant_key
        AND j.job_type = 'call_transcript.analysis'
        AND (j.payload_json->>'callSid') = c.call_sid
        AND j.status = 'dead_letter'
       WHERE c.tenant_key = $1
         AND c.created_at >= (CURRENT_DATE - ($2::int - 1))
         AND (a.call_sid IS NULL OR a.analysis_version IS DISTINCT FROM $3)`,
      [tenantKey, Math.max(1, Number(days || 30)), CALL_TRANSCRIPT_ANALYSIS_VERSION]
    );
    return Number(result.rows?.[0]?.failed_call_count_30d || 0);
  } catch (error) {
    if (error?.code === "42P01") return 0;
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
    const reportingWindow = resolveReportingWindow(req.query?.range);
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return;

    const billingState = await ensureTenantBillingAccount(pool, tenantKey);
    if (!billingState) {
      return res.status(404).json({ error: "tenant_not_found" });
    }
    const billingConfig = await getSystemBillingConfig(pool);
    const activeTenantUser = session.role === "tenant" ? await requireActiveTenantUser(session) : null;
    let callBilling = null;
    try {
      callBilling = await syncCurrentBillingPeriod(pool, tenantKey);
    } catch {
      callBilling = null;
    }

    const [
      callsSummaryResult,
      recentLeadsResult,
      recentCallsResult,
      classificationResult,
      volumeRowsResult,
      knowledgeSignals,
      answeredKnowledgeQuestions,
      knowledgeGapQuestions,
      pendingTranscriptAnalysisCallCount30d,
      failedTranscriptAnalysisCallCount30d,
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
           AND created_at >= (CURRENT_DATE - ($2::int - 1))`,
        [tenantKey, reportingWindow.days]
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
           AND c.created_at >= (CURRENT_DATE - ($2::int - 1))
           AND c.lead_is_valid = TRUE
         ORDER BY c.created_at DESC
         LIMIT 5`,
        [tenantKey, reportingWindow.days]
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
           AND c.created_at >= (CURRENT_DATE - ($2::int - 1))
         ORDER BY c.created_at DESC
         LIMIT 5`,
        [tenantKey, reportingWindow.days]
      ),
      pool.query(
        `SELECT
           lead_outcome_type,
           lead_is_valid,
           COUNT(*)::int AS count
         FROM calls
         WHERE tenant_key = $1
           AND created_at >= (CURRENT_DATE - ($2::int - 1))
         GROUP BY lead_outcome_type, lead_is_valid`,
        [tenantKey, reportingWindow.days]
      ),
      pool.query(
        `SELECT
           created_at
         FROM calls
         WHERE tenant_key = $1
           AND created_at >= (CURRENT_DATE - ($2::int - 1))
         ORDER BY created_at ASC`,
        [tenantKey, reportingWindow.days]
      ),
      loadKnowledgeSignals(pool, tenantKey, reportingWindow.days),
      loadAnsweredKnowledgeQuestions(pool, tenantKey, { days: reportingWindow.days }),
      loadKnowledgeGapQuestions(pool, tenantKey, { days: reportingWindow.days }),
      countPendingTranscriptAnalysisCalls(pool, tenantKey, reportingWindow.days),
      countFailedTranscriptAnalysisCalls(pool, tenantKey, reportingWindow.days),
      loadTenantBusinessHours(pool, tenantKey),
      listKnowledgeReceptionistBuilds(pool, tenantKey)
    ]);

    const callsSummary = callsSummaryResult.rows[0] || {};
    const validLeadCount30d = Number(callsSummary.valid_lead_count_30d || 0);
    const calls30d = Number(callsSummary.calls_30d || 0);
    const kbQuestionCount30d = Number(knowledgeSignals.kb_question_count_30d || 0);
    const kbCallCount30d = Number(knowledgeSignals.kb_call_count_30d || 0);
    const unansweredQuestionCount30d = Number(knowledgeSignals.unanswered_question_count_30d || 0);
    const unansweredCallCount30d = Number(knowledgeSignals.unanswered_call_count_30d || 0);
    const timezone = normalizeText(businessHoursConfig?.timezone) || "America/Los_Angeles";
    const builds = Array.isArray(buildsData?.builds) ? buildsData.builds : [];
    const publishedBuilds = builds.filter((build) => normalizeText(build?.status).toLowerCase() === "published");
    const latestBuild = builds[0] || null;
    const activeBuildId = normalizeText(buildsData?.activeBuild?.active_build_id);
    const latestBuildId = normalizeText(latestBuild?.build_id);
    const activeBuild = builds.find((build) => normalizeText(build?.build_id) === activeBuildId) || null;
    const activeBuildStatus = normalizeText(activeBuild?.status).toLowerCase();
    const runtimeReady = Boolean(activeBuildId) && activeBuildStatus === "published";
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
    const callVolumeTrend = buildCallVolumeTrend(trendMap, timezone, reportingWindow);

    const nextSteps = [];
    if (!publishedBuilds.length) {
      nextSteps.push({
        href: "/client/receptionist/knowledge",
        title: "Publish a Knowledge build",
        body: "The receptionist can sound specific only after a build is published."
      });
    }
    if (publishedBuilds.length && !runtimeReady) {
      nextSteps.push({
        href: "/client/receptionist/knowledge",
        title: "Make a published build live",
        body: "The Sales Receptionist needs an active published knowledge build to answer with business-specific details."
      });
    }
    nextSteps.push({
      href: "/client/team",
      title: "Confirm where leads go",
      body: "Use Send Leads To to decide which email addresses or mobile numbers should receive new lead alerts."
    });
    nextSteps.push({
      href: "/client/calls",
      title: "Review the latest calls",
      body: "Check recent summaries, lead decisions, and callback details."
    });

    return res.status(200).json({
      ok: true,
      reportingWindow,
      summary: {
        calls30d,
        validLeadCount30d,
        leadCaptureRate30d: calls30d ? Math.round((validLeadCount30d / calls30d) * 1000) / 10 : 0,
        openFollowUpCount: Number(callsSummary.open_follow_up_count || 0)
      },
      billing: {
        status: billingState.billing_status,
        appAccessStatus: billingState.app_access_status,
        plan: buildPlanDisplay(billingState, billingConfig),
        currentPeriod: {
          label: callBilling?.currentPeriod?.label || null,
          start: callBilling?.currentPeriod?.start || billingState.current_period_start || null,
          end: callBilling?.currentPeriod?.end || billingState.current_period_end || null
        },
        callPricing: callBilling?.callPricing || resolveEffectiveCallPricing(billingState, billingConfig),
        callUsage: callBilling?.callUsage || null,
        callInvoiceEstimate: callBilling?.invoiceEstimate || null
      },
      setup: {
        publishedBuildCount: publishedBuilds.length,
        latestBuildStatus: latestBuild?.status || null,
        activeBuildStatus: activeBuild?.status || null,
        activeBuildId,
        latestBuildId,
        runtimeReady
      },
      recentLeads: recentLeadsResult.rows || [],
      recentCalls: recentCallsResult.rows || [],
      classificationBreakdown,
      callVolumeTrend,
      knowledgeSignals: {
        kbQuestionCount30d,
        kbCallCount30d,
        answeredQuestionCount30d: Math.max(0, kbQuestionCount30d - unansweredQuestionCount30d),
        unansweredQuestionCount30d,
        unansweredCallCount30d,
        unansweredQuestionCalls30d: unansweredQuestionCount30d,
        unansweredKbCallCount30d: unansweredCallCount30d,
        pendingTranscriptAnalysisCallCount30d,
        failedTranscriptAnalysisCallCount30d,
        answeredQuestionRate30d: kbQuestionCount30d
          ? Math.max(0, Math.round(((kbQuestionCount30d - unansweredQuestionCount30d) / kbQuestionCount30d) * 1000) / 10)
          : 100
      },
      viewer: {
        canManageKnowledgeAnalysis: session.role === "admin"
          || tenantUserHasAnyRole(activeTenantUser, ["owner", "admin"]),
        userRole: session.role === "admin" ? "admin" : (activeTenantUser?.role || null)
      },
      answeredKnowledgeQuestions,
      knowledgeGapQuestions,
      nextSteps
    });
  } catch (err) {
    return res.status(500).json({ error: "client_dashboard_error", message: err?.message || "unknown" });
  }
}
