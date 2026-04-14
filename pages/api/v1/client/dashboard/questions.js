import { requireSession, resolveTenantKey } from "../../../_lib/auth.js";
import { ensureTables, getPool } from "../../../_lib/db.js";
import { ensureTenantBillingAccount, requireTenantBillingAccess } from "../../../_lib/billing.js";

const PAGE_SIZE = 25;
const REPORTING_WINDOWS = {
  "7d": { key: "7d", days: 7, label: "Last 7 Days" },
  "30d": { key: "30d", days: 30, label: "Last 30 Days" },
  "90d": { key: "90d", days: 90, label: "Last 90 Days" }
};

function normalizeText(value) {
  return String(value || "").trim();
}

function resolveReportingWindow(value) {
  const normalized = normalizeText(value).toLowerCase();
  return REPORTING_WINDOWS[normalized] || REPORTING_WINDOWS["30d"];
}

function normalizeKind(value) {
  return normalizeText(value).toLowerCase() === "answered" ? "answered" : "unanswered";
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function loadKnowledgeCounts(pool, tenantKey, days) {
  try {
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(a.total_business_questions), 0)::int AS total_question_count,
         COALESCE(SUM(a.answered_question_count), 0)::int AS answered_question_count,
         COALESCE(SUM(a.unanswered_question_count), 0)::int AS unanswered_question_count
       FROM call_transcript_analyses a
       JOIN calls c ON c.call_sid = a.call_sid
       WHERE a.tenant_key = $1
         AND c.created_at >= (CURRENT_DATE - ($2::int - 1))`,
      [tenantKey, Math.max(1, Number(days || 30))]
    );
    return result.rows?.[0] || {
      total_question_count: 0,
      answered_question_count: 0,
      unanswered_question_count: 0
    };
  } catch (error) {
    if (error?.code === "42P01") {
      return {
        total_question_count: 0,
        answered_question_count: 0,
        unanswered_question_count: 0
      };
    }
    throw error;
  }
}

async function loadQuestionPage(pool, tenantKey, { kind, page, pageSize, days }) {
  const offset = (page - 1) * pageSize;
  if (kind === "answered") {
    const [items, total] = await Promise.all([
      pool.query(
        `SELECT
           q.id AS question_id,
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
         LIMIT $3
         OFFSET $4`,
        [tenantKey, Math.max(1, Number(days || 30)), pageSize, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total_count
         FROM call_answered_questions q
         LEFT JOIN calls c ON c.call_sid = q.call_sid
         WHERE q.tenant_key = $1
           AND c.created_at >= (CURRENT_DATE - ($2::int - 1))`,
        [tenantKey, Math.max(1, Number(days || 30))]
      )
    ]);
    return {
      items: items.rows || [],
      totalCount: Number(total.rows?.[0]?.total_count || 0)
    };
  }

  const [items, total] = await Promise.all([
    pool.query(
      `SELECT
         q.id AS question_id,
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
       LIMIT $3
       OFFSET $4`,
      [tenantKey, Math.max(1, Number(days || 30)), pageSize, offset]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total_count
       FROM call_unanswered_questions q
       LEFT JOIN calls c ON c.call_sid = q.call_sid
       WHERE q.tenant_key = $1
         AND c.created_at >= (CURRENT_DATE - ($2::int - 1))`,
      [tenantKey, Math.max(1, Number(days || 30))]
    )
  ]);
  return {
    items: items.rows || [],
    totalCount: Number(total.rows?.[0]?.total_count || 0)
  };
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

    const kind = normalizeKind(req.query?.kind);
    const page = normalizePositiveInt(req.query?.page, 1);
    const reportingWindow = resolveReportingWindow(req.query?.range);
    const pageSize = PAGE_SIZE;

    const [counts, pageData] = await Promise.all([
      loadKnowledgeCounts(pool, tenantKey, reportingWindow.days),
      loadQuestionPage(pool, tenantKey, { kind, page, pageSize, days: reportingWindow.days })
    ]);

    return res.status(200).json({
      ok: true,
      kind,
      reportingWindow,
      page,
      pageSize,
      totalCount: pageData.totalCount,
      totalPages: Math.max(1, Math.ceil(pageData.totalCount / pageSize)),
      counts: {
        totalQuestionCount30d: Number(counts.total_question_count || 0),
        answeredQuestionCount30d: Number(counts.answered_question_count || 0),
        unansweredQuestionCount30d: Number(counts.unanswered_question_count || 0)
      },
      items: pageData.items
    });
  } catch (error) {
    return res.status(500).json({
      error: "dashboard_questions_error",
      message: error?.message || "unknown"
    });
  }
}
