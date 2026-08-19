import { getPool } from "../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { requireTenantBillingAccess, requireTenantRoles } from "../../_lib/billing.js";
import {
  callerFaqConfirmationIds,
  callerFaqSummaryBlocks,
  completeCallerFaqConfirmation,
  loadCallerFaqConfirmation,
  normalizeCallerFaqAnswers
} from "../../_lib/knowledgeCallerFaqConfirmation.js";
import { saveSetupInterviewSubmission } from "../../_lib/knowledgeReceptionistSetupInterview.js";
import { enqueueKnowledgeBuild } from "../../_lib/knowledgeReceptionistBuilds.js";

function fail(res, status, error, message) {
  return res.status(status).json({ ok: false, error, message });
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) return fail(res, 500, "database_unavailable", "Database is unavailable.");
    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, String(req.query?.tenantKey || req.body?.tenantKey || ""));
    const access = await requireTenantBillingAccess(res, pool, session, tenantKey);
    if (!access) return;

    if (req.method === "GET") {
      const confirmation = await loadCallerFaqConfirmation(pool, tenantKey);
      return res.status(200).json({ ok: true, confirmation });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return fail(res, 405, "method_not_allowed", "Method not allowed.");
    }
    const manager = await requireTenantRoles(res, session, ["owner", "admin"], {
      message: "Only account admins and owners can confirm receptionist facts."
    });
    if (!manager) return;

    const current = await loadCallerFaqConfirmation(pool, tenantKey);
    if (!current || current.status !== "pending") {
      return fail(res, 409, "caller_faq_confirmation_not_pending", "This confirmation is no longer pending.");
    }
    const answers = normalizeCallerFaqAnswers(req.body?.answers);
    const summaryBlocks = callerFaqSummaryBlocks(answers);
    if (!summaryBlocks.length) {
      return fail(res, 400, "caller_faq_confirmed_fact_required", "Confirm at least one fact before submitting.");
    }
    const ids = callerFaqConfirmationIds(tenantKey);
    const submission = await saveSetupInterviewSubmission(pool, tenantKey, {
      intent: {
        setupInterviewIntentId: ids.intentId,
        version: "caller_faq_v1",
        status: "active",
        primaryGoal: "Confirm the five universal caller questions omitted by the website.",
        requiredCaptureCategories: Object.keys(answers),
        completionCriteria: { all_questions_answered: true }
      },
      session: {
        setupInterviewSessionId: ids.sessionId,
        setupInterviewIntentId: ids.intentId,
        status: "completed",
        completionStatus: "complete",
        rawTranscriptText: Object.entries(answers).map(([key, value]) => `${key}: ${value}`).join("\n"),
        confirmedSummaryBlocks: summaryBlocks,
        metadata: { source: "caller_faq_confirmation_v1", trigger_build_id: current.trigger_build_id }
      }
    });
    const activeResult = await pool.query(
      `SELECT active.active_build_id
       FROM tenant_active_knowledge_builds active
       INNER JOIN knowledge_builds build
         ON build.build_id = active.active_build_id
        AND build.tenant_key = active.tenant_key
       WHERE active.tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    );
    const baseBuildId = String(activeResult.rows?.[0]?.active_build_id || "").trim();
    if (!baseBuildId) throw new Error("overlay_base_build_required");
    const queued = await enqueueKnowledgeBuild(pool, tenantKey, {
      buildKind: "document_overlay",
      baseBuildId,
      setupInterviewSessionIds: [ids.sessionId]
    });
    const followupBuildId = String(queued?.build?.build_id || "").trim();
    await completeCallerFaqConfirmation(pool, {
      tenantKey,
      answers,
      setupInterviewSessionId: ids.sessionId,
      followupBuildId
    });
    return res.status(202).json({
      ok: true,
      confirmation: await loadCallerFaqConfirmation(pool, tenantKey),
      setupInterviewSession: submission.session,
      build: queued.build,
      status: queued.status
    });
  } catch (error) {
    const message = String(error?.message || "unknown");
    if (message.startsWith("caller_faq_answer_required:")) {
      return fail(res, 400, "caller_faq_answer_required", "Please answer all five questions. Use “Not sure” when the answer is unknown.");
    }
    if (message.startsWith("caller_faq_answer_too_long:")) {
      return fail(res, 400, "caller_faq_answer_too_long", "Keep each answer under 500 characters.");
    }
    if (message === "overlay_base_build_required") {
      return fail(res, 409, "overlay_base_build_required", "Publish a website knowledge build before confirming these facts.");
    }
    return fail(res, 500, "caller_faq_confirmation_error", message);
  }
}
