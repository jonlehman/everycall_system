import { getPool } from "../../_lib/db.js";
import { INTERNAL_AUTH_PURPOSES, isValidInternalServiceToken } from "@everycall/contracts/internalAuth";
import { assertTenantReadyForInboundCalls } from "../../_lib/knowledgeReceptionistConfig.js";
import { assembleKnowledgeGatewayPrompt, buildFieldSchemaFromOutcomeSchema } from "../../_lib/knowledgeReceptionistPrompt.js";
import { buildGatewayPromptResponse } from "../../_lib/gatewayPromptResponse.js";

function fail(res, status, error, extra = {}) {
  return res.status(status).json({ error, ...extra });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return fail(res, 405, "method_not_allowed");
  }

  const token = String(req.headers["x-everycall-internal"] || "");
  if (!isValidInternalServiceToken(token, process.env, INTERNAL_AUTH_PURPOSES.gatewayPrompt)) {
    return fail(res, 401, "unauthorized");
  }

  try {
    const pool = getPool();
    if (!pool) {
      return fail(res, 500, "database_unavailable");
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const tenantKey = String(body.tenantKey || "").trim();
    const callSid = String(body.callSid || "").trim();
    if (!tenantKey || !callSid) {
      return fail(res, 400, "missing_tenant_or_call");
    }

    const launchReadiness = await assertTenantReadyForInboundCalls(pool, tenantKey);
    const gatewayPrompt = await assembleKnowledgeGatewayPrompt(pool, tenantKey, {
      callSid,
      runtimeEntryMode: String(body.runtimeEntryMode || "").trim() || "customer_call"
    });

    return res.status(200).json(
      buildGatewayPromptResponse(gatewayPrompt, buildFieldSchemaFromOutcomeSchema, {
        tenantKey,
        callSid,
        launchReadiness
      })
    );
  } catch (err) {
    const message = String(err?.message || "unknown");
    if (message === "knowledge_receptionist_migrations_not_applied") {
      return fail(res, 503, "migrations_required");
    }
    if (message === "no_active_build") {
      return fail(res, 409, "no_active_build");
    }
    if (message === "build_not_found") {
      return fail(res, 404, "build_not_found");
    }
    if (message === "tenant_not_ready_for_calls") {
      return fail(res, 409, "tenant_not_ready_for_calls", {
        readiness: err?.readiness || null
      });
    }
    return fail(res, 500, "prompt_fetch_error", { message });
  }
}
