import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { ensureTables, getPool } from "../../_lib/db.js";
import { buildPlanDisplay, ensureTenantBillingAccount, requireTenantBillingAccess } from "../../_lib/billing.js";
import { listKnowledgeReceptionistBuilds } from "../../_lib/knowledgeReceptionistBuilds.js";
import { computeLeadInvoiceEstimate, getLeadPricingConfig, resolveBillingWindow } from "../../../../lib/leadBilling.js";

function normalizeText(value) {
  return String(value || "").trim();
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
      buildsData
    ] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS calls_30d,
           COUNT(*) FILTER (WHERE status IN ('new', 'contacted', 'in_progress'))::int AS open_follow_up_count
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
           c.lead_decision_reason
         FROM calls c
         WHERE c.tenant_key = $1
         ORDER BY c.created_at DESC
         LIMIT 5`,
        [tenantKey]
      ),
      listKnowledgeReceptionistBuilds(pool, tenantKey)
    ]);

    const callsSummary = callsSummaryResult.rows[0] || {};
    const leadSummary = leadSummaryResult.rows[0] || {};
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
        calls30d: Number(callsSummary.calls_30d || 0),
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
      nextSteps
    });
  } catch (err) {
    return res.status(500).json({ error: "client_dashboard_error", message: err?.message || "unknown" });
  }
}
