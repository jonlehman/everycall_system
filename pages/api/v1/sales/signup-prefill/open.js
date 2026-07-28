import { ensureTables, getPool } from "../../../_lib/db.js";
import { openSalesSignupPrefill } from "../../../_lib/salesRepository.js";
import {
  salesRequestBody,
  sendSalesApiError
} from "../../../_lib/salesApi.js";
import { enforceRateLimit, getClientIp } from "../../../_lib/rateLimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ ok: false, error: "database_unavailable" });
    }
    await ensureTables(pool);
    const limit = await enforceRateLimit(res, pool, {
      scope: "sales.signup_prefill.open.ip",
      key: getClientIp(req),
      maxHits: 30,
      windowMs: 15 * 60 * 1000,
      blockDurationMs: 30 * 60 * 1000,
      message: "Too many signup-link attempts. Please try again later."
    });
    if (limit?.limited) return;
    const result = await openSalesSignupPrefill(
      pool,
      salesRequestBody(req).token
    );
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return sendSalesApiError(res, error, "sales_signup_prefill_failed");
  }
}
