import { ensureTables, getPool } from "../../_lib/db.js";
import { INTERNAL_AUTH_PURPOSES, isValidInternalServiceToken } from "@everycall/contracts/internalAuth";
import { assembleKnowledgeGatewayPrompt, buildFieldSchemaFromOutcomeSchema } from "../../_lib/knowledgeReceptionistPrompt.js";
import { buildGatewayPromptResponse } from "../../_lib/gatewayPromptResponse.js";
import { isConfirmedLivePromptSettings, loadTenantLivePromptSettings } from "../../_lib/tenantLivePromptSettings.js";
import { loadLiveBriefBlock } from "../../_lib/liveBriefCuration.js";

function fail(res, status, error, extra = {}) {
  return res.status(status).json({ error, ...extra });
}

function liveV201Enabled(tenantKey) {
  if (process.env.EVERYCALL_LIVE_V201_ENABLED === '1') return true;
  return String(process.env.EVERYCALL_LIVE_V201_CANARY_TENANTS || '')
    .split(',').map(value => value.trim()).includes(tenantKey);
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
    await ensureTables(pool);

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const tenantKey = String(body.tenantKey || "").trim();
    const callSid = String(body.callSid || "").trim();
    if (!tenantKey || !callSid) {
      return fail(res, 400, "missing_tenant_or_call");
    }

    const tenantResult = await pool.query('SELECT name, live_prompt_mode FROM tenants WHERE tenant_key = $1 LIMIT 1', [tenantKey]);
    const tenant = tenantResult.rows?.[0];
    if (!tenant) return fail(res, 404, 'tenant_not_found');
    if (tenant.live_prompt_mode === 'pending_v20') return fail(res, 409, 'live_prompt_confirmation_required');
    const v20Target = tenant.live_prompt_mode === 'v20_1' && liveV201Enabled(tenantKey);
    const liveSettings = v20Target
      ? await loadTenantLivePromptSettings(pool, tenantKey) : null;
    if (v20Target && !isConfirmedLivePromptSettings(liveSettings)) {
      return fail(res, 409, 'live_prompt_confirmation_required');
    }

    const gatewayPrompt = await assembleKnowledgeGatewayPrompt(pool, tenantKey, {
      callSid,
      runtimeEntryMode: String(body.runtimeEntryMode || "").trim() || "customer_call",
      promptRenderMode: liveSettings ? 'layered' : (String(body.promptRenderMode || body.prompt_render_mode || "").trim() || null)
    });
    const liveBriefBlock = liveSettings
      ? await loadLiveBriefBlock(pool, tenantKey, gatewayPrompt.build.build_id) : null;
    if (liveSettings && !liveBriefBlock?.slots) {
      return fail(res, 409, 'live_brief_not_ready');
    }

    const transferDirectoryResult = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM tenant_users
       WHERE tenant_key = $1
         AND status = 'active'
         AND transfer_enabled = TRUE
         AND forward_to_number IS NOT NULL
         AND TRIM(forward_to_number) <> ''`,
      [tenantKey]
    );
    const includeTransferTools = Number(transferDirectoryResult.rows[0]?.count || 0) > 0;

    return res.status(200).json(
      buildGatewayPromptResponse(gatewayPrompt, buildFieldSchemaFromOutcomeSchema, {
        tenantKey,
        callSid,
        includeTransferTools,
        liveBrief: liveSettings ? {
          prompt_version: 'v20.1',
          build_version: gatewayPrompt.build.build_id,
          assistant_name: gatewayPrompt.tenantPromptProfile?.assistant_name || 'Sarah',
          business_name: tenant.name,
          required_contact_fields: gatewayPrompt.tenantPromptProfile?.required_contact_fields || ['name', 'best phone number'],
          callback_role: liveSettings.callback_role,
          callback_role_does: liveSettings.callback_role_does,
          by_heart_block: liveBriefBlock.blockText,
          ai_disclosure_line: gatewayPrompt.tenantPromptProfile?.ai_disclosure_line || ''
        } : null
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
    return fail(res, 500, "prompt_fetch_error", { message });
  }
}
