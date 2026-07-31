import { applyDemoCors, handleDemoCorsPreflight } from "../../../_lib/demoCors.js";
import { ensureTables, getPool } from "../../../_lib/db.js";
import { loadDemoSessionRecord, recordDemoSessionEvent } from "../../../_lib/demoSessions.js";
import { buildDemoRealtimeSessionPayload } from "../../../_lib/demoRealtimeSession.js";
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

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return fail(res, 405, "method_not_allowed", "Method not allowed.");
  }

  try {
    const pool = getPool();
    if (!pool) {
      return fail(res, 500, "database_unavailable", "Database is unavailable.");
    }

    await ensureTables(pool);

    const rateLimit = await enforceRateLimit(res, pool, {
      scope: "demo.realtime.token.ip",
      key: getClientIp(req),
      maxHits: 30,
      windowMs: 10 * 60 * 1000,
      blockDurationMs: 10 * 60 * 1000,
      message: "Too many demo connection attempts. Please try again shortly."
    });
    if (rateLimit?.limited) return;

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const demoSessionId = normalizeText(body.demoSessionId || body.demo_session_id);
    if (!demoSessionId) {
      return fail(res, 400, "demo_session_id_required", "A demo session id is required.");
    }

    const sessionRecord = await loadDemoSessionRecord(pool, demoSessionId);
    if (!sessionRecord) {
      return fail(res, 404, "demo_session_not_found", "Demo session not found.");
    }
    if (String(sessionRecord.status || "") === "expired") {
      return fail(res, 410, "demo_session_expired", "Demo session has expired.");
    }
    if (String(sessionRecord.status || "") !== "ready") {
      return fail(res, 409, "demo_session_not_ready", "Demo session is not ready yet.");
    }

    const apiKey = normalizeText(process.env.XAI_API_KEY);
    if (!apiKey) {
      return fail(res, 500, "missing_xai_key", "xAI API key is not configured.");
    }

    const { session, model, voice } = buildDemoRealtimeSessionPayload(
      sessionRecord.demo_bundle_json && typeof sessionRecord.demo_bundle_json === "object"
        ? sessionRecord.demo_bundle_json
        : {}
    );

    const upstream = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ expires_after: { seconds: 300 } })
    });

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok || !data || !normalizeText(data.value)) {
      const upstreamMessage = normalizeText(data?.error?.message || data?.message || upstream.statusText || "Unable to create demo token.");
      return fail(res, 502, "demo_realtime_token_failed", upstreamMessage);
    }

    await recordDemoSessionEvent(pool, demoSessionId, "realtime_token_created", {
      model,
      voice
    });

    return res.status(200).json({
      ok: true,
      demoSessionId,
      session: {
        clientSecret: data.value,
        expiresAt: data.expires_at || null,
        websocketUrl: `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(model)}`,
        websocketProtocol: `xai-client-secret.${data.value}`,
        update: {
          type: "session.update",
          session
        }
      },
      realtime: {
        model,
        voice
      }
    });
  } catch (err) {
    return fail(
      res,
      500,
      "demo_realtime_token_failed",
      normalizeText(err?.message) || "Unable to create the demo token."
    );
  }
}
