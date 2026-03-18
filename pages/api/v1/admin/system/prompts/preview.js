import { ensureTables, getPool } from "../../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../../_lib/auth.js";
import { buildGatewayPromptResponse } from "../../../../_lib/gatewayPromptResponse.js";
import { assembleKnowledgeGatewayPrompt, buildFieldSchemaFromOutcomeSchema } from "../../../../_lib/knowledgeReceptionistPrompt.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function buildPreviewVariant({ gatewayPrompt, tenantKey, runtimeEntryMode }) {
  const gatewayPromptOutput = buildGatewayPromptResponse(
    gatewayPrompt,
    buildFieldSchemaFromOutcomeSchema,
    {
      tenantKey,
      callSid: `admin_preview_${runtimeEntryMode}`
    }
  );

  return {
    blueprint: gatewayPrompt.promptBlueprint,
    tenantProfile: gatewayPrompt.tenantPromptProfile,
    sectionOverrides: gatewayPrompt.sectionOverrides || {},
    renderedSections: gatewayPrompt.renderedPromptSections || [],
    renderedStartupPrompt: gatewayPrompt.systemPrompt,
    runtimeToolDefinitions: gatewayPromptOutput.tool_definitions,
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
    if (!tenantKey) {
      return res.status(400).json({ error: "missing_tenant_key" });
    }

    const liveGatewayPrompt = await assembleKnowledgeGatewayPrompt(pool, tenantKey, {
      callSid: `admin_preview_${runtimeEntryMode}`,
      runtimeEntryMode
    });
    const draftGatewayPrompt = await assembleKnowledgeGatewayPrompt(pool, tenantKey, {
      callSid: `admin_preview_${runtimeEntryMode}`,
      runtimeEntryMode,
      promptBlueprintOverride: body.blueprint || body.promptBlueprint || null,
      tenantPromptProfileOverride: body.tenantProfile || null,
      sectionOverridesOverride: body.sectionOverrides || null
    });

    return res.status(200).json({
      ok: true,
      tenant_key: tenantKey,
      runtime_entry_mode: runtimeEntryMode,
      live: buildPreviewVariant({
        gatewayPrompt: liveGatewayPrompt,
        tenantKey,
        runtimeEntryMode
      }),
      draft: buildPreviewVariant({
        gatewayPrompt: draftGatewayPrompt,
        tenantKey,
        runtimeEntryMode
      })
    });
  } catch (err) {
    return res.status(500).json({
      error: "admin_prompt_preview_error",
      message: err?.message || "unknown"
    });
  }
}
