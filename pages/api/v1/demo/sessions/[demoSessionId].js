import { ensureTables, getPool } from "../../../_lib/db.js";
import { loadDemoSession, loadDemoSessionRecord, saveDemoSessionTranscript } from "../../../_lib/demoSessions.js";
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

  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method_not_allowed", "Method not allowed.");
  }

  try {
    const pool = getPool();
    if (!pool) {
      return fail(res, 500, "database_unavailable", "Database is unavailable.");
    }

    await ensureTables(pool);

    const limit = await enforceRateLimit(res, pool, {
      scope: req.method === "GET" ? "demo.sessions.read.ip" : "demo.sessions.write.ip",
      key: getClientIp(req),
      maxHits: req.method === "GET" ? 60 : 30,
      windowMs: 10 * 60 * 1000,
      blockDurationMs: 10 * 60 * 1000,
      message: req.method === "GET"
        ? "Too many demo status checks. Please try again shortly."
        : "Too many demo transcript updates. Please try again shortly."
    });
    if (limit?.limited) return;

    const demoSessionId = normalizeText(req.query?.demoSessionId);
    if (!demoSessionId) {
      return fail(res, 400, "demo_session_id_required", "A demo session id is required.");
    }

    if (req.method === "POST") {
      const sessionRecord = await loadDemoSessionRecord(pool, demoSessionId);
      if (!sessionRecord) {
        return fail(res, 404, "demo_session_not_found", "Demo session not found.");
      }
      if (String(sessionRecord.status || "") === "expired") {
        return fail(res, 410, "demo_session_expired", "Demo session has expired.");
      }

      const body = typeof req.body === "object" && req.body ? req.body : {};
      const transcriptItems = Array.isArray(body.transcriptItems || body.transcript_items)
        ? (body.transcriptItems || body.transcript_items)
        : [];
      const updated = await saveDemoSessionTranscript(pool, demoSessionId, transcriptItems);
      if (!updated) {
        return fail(res, 404, "demo_session_not_found", "Demo session not found.");
      }

      return res.status(200).json({
        ok: true,
        demoSessionId,
        transcriptItemCount: Array.isArray(updated.transcript_items_json) ? updated.transcript_items_json.length : 0
      });
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
