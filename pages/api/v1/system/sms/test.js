import { ensureTables, getPool } from "../../../_lib/db.js";
import { requireSession } from "../../../_lib/auth.js";
import { getSharedSmsNumber } from "../../../_lib/alerts.js";
import { normalizePhoneNumber } from "../../../_lib/phone.js";
import { sendTelnyxSms } from "../../../_lib/telnyx.js";

const DEFAULT_TEST_TEXT = "EveryCall by Creative Dynamic test: SMS routing is working. If you receive this, outbound Telnyx delivery from the shared SMS number is at least reaching Telnyx successfully.";
const DEFAULT_OPT_IN_TEXT = "Creative Dynamic: You are opted in to customer care text messages. Message frequency may vary. Msg&data rates may apply. Consent is not a condition of purchase. Reply HELP for help. Reply STOP to opt out.";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const to = normalizePhoneNumber(body.to);
    const mode = String(body.mode || "test").trim().toLowerCase();
    const customText = String(body.text || "").trim();
    if (!to) {
      return res.status(400).json({ error: "missing_to", message: "A destination phone number is required." });
    }

    const from = await getSharedSmsNumber(pool);
    if (!from) {
      return res.status(500).json({ error: "sms_number_missing", message: "Shared SMS number is not configured." });
    }

    const text = customText || (mode === "opt_in" ? DEFAULT_OPT_IN_TEXT : DEFAULT_TEST_TEXT);
    const result = await sendTelnyxSms({ from, to, text });
    return res.status(200).json({
      ok: true,
      from,
      to,
      mode,
      text,
      providerMessageId: String(result?.data?.id || result?.id || "").trim() || null,
      providerResponse: result?.data || result || null
    });
  } catch (err) {
    return res.status(502).json({ error: "system_sms_test_error", message: err?.message || "unknown" });
  }
}
