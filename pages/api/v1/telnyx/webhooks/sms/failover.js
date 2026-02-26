export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const data = body.data || {};
    const payload = data.payload || {};
    const messageId = data.id || null;
    const reason = payload?.errors?.[0]?.description || payload?.errors?.[0]?.title || null;

    // TODO: persist failures for alerts/monitoring.
    return res.status(200).json({ ok: true, received: true, messageId, reason });
  } catch (err) {
    return res.status(500).json({ error: "telnyx_sms_failover_error", message: err?.message || "unknown" });
  }
}
