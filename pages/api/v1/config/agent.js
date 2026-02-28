import {
  composePromptForTenant,
  getAgentConfig,
  listAgentConfigVersions,
  restoreAgentConfigVersion,
  setAgentConfig
} from "../../_lib/agentConfig.js";
import { requireSession } from "../../_lib/auth.js";

function isAuthorized(req) {
  const configuredKey = process.env.CONFIG_API_KEY;
  if (!configuredKey) {
    return true;
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return token && token === configuredKey;
}

export default async function handler(req, res) {
  try {
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;

    if (req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      const tenantKey = req.query?.tenantKey || "default";
      if (req.query?.mode === "versions") {
        const versions = await listAgentConfigVersions(String(tenantKey), req.query?.limit);
        return res.status(200).json({ tenantKey, versions });
      }
      if (req.query?.mode === "preview") {
        const composed = await composePromptForTenant(String(tenantKey));
        const cfg = await getAgentConfig(String(tenantKey));
        return res.status(200).json({
          tenantKey,
          tenantPromptOverride: cfg.tenantPromptOverride || "",
          greetingText: cfg.greetingText || "",
          composedPrompt: composed
        });
      }
      const cfg = await getAgentConfig(String(tenantKey));
      return res.status(200).json(cfg);
    }

    if (req.method === "POST") {
      if (!isAuthorized(req)) {
        return res.status(401).json({ error: "unauthorized" });
      }

      const body = typeof req.body === "object" && req.body ? req.body : {};
      if (body.restoreVersionId) {
        const restored = await restoreAgentConfigVersion(
          body.tenantKey || "default",
          body.restoreVersionId
        );
        return res.status(200).json({ ok: true, restored: true, config: restored });
      }

      const updated = await setAgentConfig({
        tenantKey: body.tenantKey || "default",
        agentName: body.agentName,
        companyName: body.companyName,
        greetingText: body.greetingText,
        voiceType: body.voiceType,
        systemPrompt: body.systemPrompt
      });

      return res.status(200).json({ ok: true, config: updated });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "config_error", message: err?.message || "unknown" });
  }
}
