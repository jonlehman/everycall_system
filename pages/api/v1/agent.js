import { getAgentConfig, setAgentConfig } from "../_lib/agentConfig.js";
import { requireSession, resolveTenantKey } from "../_lib/auth.js";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

export default async function handler(req, res) {
  try {
    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, getTenantKey(req));

    if (req.method === "GET") {
      const cfg = await getAgentConfig(tenantKey);
      return res.status(200).json({
        tenantKey,
        agentName: cfg.agentName || "",
        companyName: cfg.companyName || "",
        greetingText: cfg.greetingText || "",
        voiceType: cfg.voiceType || ""
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const greetingText = String(body.greetingText || "").trim();
      const voiceType = String(body.voiceType || "").trim();
      const updated = await setAgentConfig({
        tenantKey,
        greetingText,
        voiceType
      });
      return res.status(200).json({ ok: true, config: updated });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "agent_error", message: err?.message || "unknown" });
  }
}
