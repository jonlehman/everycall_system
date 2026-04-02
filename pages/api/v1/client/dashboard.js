import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { buildPlanDisplay, ensureTenantBillingAccount, requireTenantBillingAccess } from "../../_lib/billing.js";
import { listKnowledgeReceptionistBuilds } from "../../_lib/knowledgeReceptionistBuilds.js";
import { computeLeadInvoiceEstimate, getLeadPricingConfig, resolveBillingWindow } from "../../../../lib/leadBilling.js";

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
      volumeTrendResult,
      knowledgeSignalsResult,
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
           to_char(date_trunc('day', created_at AT TIME ZONE 'America/Los_Angeles'), 'YYYY-MM-DD') AS day_key,
           COUNT(*)::int AS call_count
         FROM calls
         WHERE tenant_key = $1
           AND created_at >= NOW() - interval '6 days'
         GROUP BY 1
         ORDER BY 1 ASC`,
        [tenantKey]
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS unanswered_question_calls_30d
         FROM calls c
         LEFT JOIN call_details d ON d.call_sid = c.call_sid
         WHERE c.tenant_key = $1
           AND c.created_at >= NOW() - interval '30 days'
           AND (
             COALESCE(d.transcript_combined, d.transcript, '') ILIKE ANY (ARRAY[
               '%don''t know%',
               '%do not know%',
               '%have someone call%',
               '%call you back%',
               '%call them back%',
               '%someone call%'
             ])
             OR COALESCE(c.summary, '') ILIKE ANY (ARRAY[
               '%don''t know%',
               '%do not know%',
               '%have someone call%',
               '%call you back%',
               '%call them back%',
               '%someone call%'
             ])
           )`,
        [tenantKey]
      ),
      listKnowledgeReceptionistBuilds(pool, tenantKey)
    ]);

    const callsSummary = callsSummaryResult.rows[0] || {};
    const leadSummary = leadSummaryResult.rows[0] || {};
    const validLeadCount30d = Number(callsSummary.valid_lead_count_30d || 0);
    const calls30d = Number(callsSummary.calls_30d || 0);
    const unansweredQuestionCalls30d = Number(knowledgeSignalsResult.rows?.[0]?.unanswered_question_calls_30d || 0);
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
    const trendMap = new Map(
      (volumeTrendResult.rows || []).map((row) => [normalizeText(row.day_key), Number(row.call_count || 0)])
    );
    const callVolumeLast7Days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));
      const dayKey = date.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      return {
        day: dayKey,
        count: Number(trendMap.get(dayKey) || 0)
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
        unansweredQuestionCalls30d,
        answeredQuestionRate30d: calls30d
          ? Math.max(0, Math.round(((calls30d - unansweredQuestionCalls30d) / calls30d) * 1000) / 10)
          : 100
      },
      nextSteps
    });
  } catch (err) {
    return res.status(500).json({ error: "client_dashboard_error", message: err?.message || "unknown" });
  }
}
