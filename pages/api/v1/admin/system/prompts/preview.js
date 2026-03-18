import {
  buildCompanyContextBlockFromPromptConfig,
  buildCallMissionBlockFromPromptConfig,
  buildGatewaySessionInstructionsFromPromptConfig,
  buildGreetingInstructionFromPromptConfig,
  buildKnowledgeToolPolicyBlockFromPromptConfig,
  buildResponseRestrictionDetailsFromPromptConfig,
  buildRuntimeContextBlockFromPromptConfig,
  selectMatchedGuardrails,
  selectMatchedOverrides
} from "@everycall/contracts";
import { ensureTables, getPool } from "../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../_lib/auth.js";
import { buildGatewayPromptResponse } from "../../../../_lib/gatewayPromptResponse.js";
import { assembleKnowledgeGatewayPrompt, buildFieldSchemaFromOutcomeSchema } from "../../../../_lib/knowledgeReceptionistPrompt.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function buildPreviewVariant({
  gatewayPrompt,
  tenantKey,
  runtimeEntryMode,
  previewQuery
}) {
  const promptLayers = gatewayPrompt.promptLayers;
  const runtimeProfile = gatewayPrompt.approvedConfiguration.runtime_profile || {};
  const toolPolicy = runtimeProfile.tool_policy || {};
  const matchedOverrides = previewQuery
    ? selectMatchedOverrides(
        gatewayPrompt.approvedConfiguration.overrides || [],
        previewQuery,
        {
          active_domain_id: gatewayPrompt.initialCallState.active_domain_id,
          active_subdomain_id: gatewayPrompt.initialCallState.active_subdomain_id
        }
      )
    : [];
  const matchedGuardrails = previewQuery
    ? selectMatchedGuardrails(
        gatewayPrompt.approvedConfiguration.guardrails || [],
        previewQuery,
        {
          active_domain_id: gatewayPrompt.initialCallState.active_domain_id,
          active_subdomain_id: gatewayPrompt.initialCallState.active_subdomain_id
        },
        gatewayPrompt.initialCallState
      )
    : [];

  const responseRestrictionDetails = buildResponseRestrictionDetailsFromPromptConfig({
    promptConfig: promptLayers,
    runtimeEntryMode,
    conciseResponses: runtimeProfile.runtime_defaults?.concise_responses,
    matchedOverrides,
    matchedGuardrails
  });
  const gatewayPromptOutput = buildGatewayPromptResponse(
    gatewayPrompt,
    buildFieldSchemaFromOutcomeSchema,
    {
      tenantKey,
      callSid: `admin_preview_${runtimeEntryMode}`
    }
  );

  return {
    promptLayers,
    tenantRuntimeProfileValues: {
      companyDescription: runtimeProfile.company_description || "",
      greetingText: runtimeProfile.greeting_text || "",
      aiDisclosure: runtimeProfile.wording_defaults?.ai_disclosure || "",
      uncertaintyPhrase: runtimeProfile.wording_defaults?.uncertainty_phrase || "",
      pricingFallback: runtimeProfile.wording_defaults?.pricing_fallback || "",
      closingPhrase: runtimeProfile.wording_defaults?.closing_phrase || "",
      conciseResponses: runtimeProfile.runtime_defaults?.concise_responses !== false,
      requireKnowledgeLookup: runtimeProfile.tool_policy?.require_knowledge_lookup_for_tenant_facts !== false,
      maxClarifyingQuestions: runtimeProfile.tool_policy?.max_clarifying_questions ?? 1,
      allowEndCallOnlyAfterSpokenClose: runtimeProfile.tool_policy?.allow_end_call_only_after_spoken_close !== false
    },
    rendered: {
      baseSystemPrompt: (promptLayers.baseSystemPrompt?.instructionLines || []).join("\n"),
      companyContext: buildCompanyContextBlockFromPromptConfig(
        promptLayers,
        gatewayPrompt.companyContextSummary
      ),
      callMission: buildCallMissionBlockFromPromptConfig(
        promptLayers,
        gatewayPrompt.businessCallIntentSummary
      ),
      tenantPersonaHeader: promptLayers.tenantPersona?.headerLabel || "",
      tenantPersona: gatewayPrompt.tenantPersona,
      knowledgeToolPolicy: buildKnowledgeToolPolicyBlockFromPromptConfig(promptLayers, toolPolicy),
      greetingInstruction: buildGreetingInstructionFromPromptConfig(promptLayers, gatewayPromptOutput.tenant_greeting),
      runtimeContext: buildRuntimeContextBlockFromPromptConfig(promptLayers, {
        currentStage: gatewayPrompt.initialCallState.current_stage,
        activeDomainId: gatewayPrompt.initialCallState.active_domain_id,
        activeSubdomainId: gatewayPrompt.initialCallState.active_subdomain_id
      }),
      responseRestrictions: responseRestrictionDetails,
      finalGatewaySessionInstructions: buildGatewaySessionInstructionsFromPromptConfig({
        promptConfig: promptLayers,
        systemPrompt: gatewayPromptOutput.system_prompt,
        companyContextSummary: gatewayPrompt.companyContextSummary,
        businessCallIntentSummary: gatewayPrompt.businessCallIntentSummary,
        tenantGreeting: gatewayPromptOutput.tenant_greeting,
        toolPolicy,
        currentStage: gatewayPrompt.initialCallState.current_stage,
        activeDomainId: gatewayPrompt.initialCallState.active_domain_id,
        activeSubdomainId: gatewayPrompt.initialCallState.active_subdomain_id
      })
    },
    matched: {
      overrides: matchedOverrides,
      guardrails: matchedGuardrails
    },
    gatewayPromptOutput
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;
    const admin = await getAdminActor(session);
    if (!admin) {
      return res.status(403).json({ error: "forbidden" });
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const tenantKey = normalizeText(body.tenantKey);
    const runtimeEntryMode = normalizeText(body.runtimeEntryMode) || "customer_call";
    const previewQuery = normalizeText(body.previewQuery);
    const draftPromptConfig = body.config || body.promptConfig || null;
    const draftRuntimeProfile = body.runtimeProfile || null;
    if (!tenantKey) {
      return res.status(400).json({ error: "missing_tenant_key" });
    }

    const tenantRow = await pool.query(
      `SELECT tenant_key, name
       FROM tenants
       WHERE tenant_key = $1
       LIMIT 1`,
      [tenantKey]
    );
    if (!tenantRow.rowCount) {
      return res.status(404).json({ error: "tenant_not_found" });
    }

    const liveGatewayPrompt = await assembleKnowledgeGatewayPrompt(pool, tenantKey, {
      callSid: `admin_preview_${runtimeEntryMode}`,
      runtimeEntryMode
    });
    const draftGatewayPrompt = await assembleKnowledgeGatewayPrompt(pool, tenantKey, {
      callSid: `admin_preview_${runtimeEntryMode}`,
      runtimeEntryMode,
      promptConfigOverride: draftPromptConfig || undefined,
      runtimeProfileOverride: draftRuntimeProfile || undefined
    });

    return res.status(200).json({
      ok: true,
      tenant: tenantRow.rows[0],
      runtimeEntryMode,
      previewQuery,
      live: buildPreviewVariant({
        gatewayPrompt: liveGatewayPrompt,
        tenantKey,
        runtimeEntryMode,
        previewQuery
      }),
      draft: buildPreviewVariant({
        gatewayPrompt: draftGatewayPrompt,
        tenantKey,
        runtimeEntryMode,
        previewQuery
      })
    });
  } catch (err) {
    return res.status(500).json({
      error: "admin_system_prompts_preview_error",
      message: err?.message || "unknown"
    });
  }
}
