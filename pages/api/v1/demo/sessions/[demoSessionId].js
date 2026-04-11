import { ensureTables, getPool } from "../../../_lib/db.js";
import { loadDemoSession } from "../../../_lib/demoSessions.js";
import { handleDemoCorsPreflight, applyDemoCors } from "../../../_lib/demoCors.js";
import { enforceRateLimit, getClientIp } from "../../../_lib/rateLimit.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function fail(res, status, error, message) {
  return res.status(status).json({
    ok: false,
    error,
    message
  });
}

export default async function handler(req, res) {
  if (handleDemoCorsPreflight(req, res)) return;
  applyDemoCors(req, res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return fail(res, 405, "method_not_allowed", "Method not allowed.");
  }

  try {
    const pool = getPool();
    if (!pool) {
      return fail(res, 500, "database_unavailable", "Database is unavailable.");
    }

    await ensureTables(pool);

    const limit = await enforceRateLimit(res, pool, {
      scope: "demo.sessions.read.ip",
      key: getClientIp(req),
      maxHits: 60,
      windowMs: 10 * 60 * 1000,
      blockDurationMs: 10 * 60 * 1000,
      message: "Too many demo status checks. Please try again shortly."
    });
    if (limit?.limited) return;

    const demoSessionId = normalizeText(req.query?.demoSessionId);
    if (!demoSessionId) {
      return fail(res, 400, "demo_session_id_required", "A demo session id is required.");
    }

    const session = await loadDemoSession(pool, demoSessionId);
    if (!session) {
      return fail(res, 404, "demo_session_not_found", "Demo session not found.");
    }

    return res.status(200).json({
      ok: true,
      ...session
    });
  } catch (err) {
    return fail(
      res,
      500,
      "demo_session_read_failed",
      normalizeText(err?.message) || "Unable to load the demo session."
    );
  }
}
