import { getAgentConfig, setAgentConfig } from "../../_lib/agentConfig.js";

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
  if (req.method === "GET") {
    return res.status(200).json(getAgentConfig());
  }

  if (req.method === "POST") {
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const updated = setAgentConfig({
      agentName: body.agentName,
      companyName: body.companyName,
      systemPrompt: body.systemPrompt
    });

    return res.status(200).json({ ok: true, config: updated });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method_not_allowed" });
}
