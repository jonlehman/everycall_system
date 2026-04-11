import { createAndBuildDemoSession } from "../../../_lib/demoSessions.js";
import { handleDemoCorsPreflight, applyDemoCors } from "../../../_lib/demoCors.js";
import { ensureTables, getPool } from "../../../_lib/db.js";
import { enforceRateLimit, getClientIp } from "../../../_lib/rateLimit.js";
import { validateDemoWebsiteUrl } from "../../../_lib/demoWebsiteScraper.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function fail(res, status, error, message, extra = {}) {
  return res.status(status).json({
    ok: false,
    error,
    message,
    ...extra
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

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const websiteInput = normalizeText(body.websiteUrl || body.website_url);
    if (!websiteInput) {
      return fail(res, 400, "website_url_invalid", "A public website URL is required.");
    }

    const ipLimit = await enforceRateLimit(res, pool, {
      scope: "demo.sessions.create.ip",
      key: getClientIp(req),
      maxHits: 10,
      windowMs: 10 * 60 * 1000,
      blockDurationMs: 30 * 60 * 1000,
      message: "Too many demo requests from this network. Please try again shortly."
    });
    if (ipLimit?.limited) return;

    let validatedWebsiteUrl = "";
    try {
      validatedWebsiteUrl = await validateDemoWebsiteUrl(websiteInput);
    } catch (err) {
      return fail(
        res,
        Number(err?.statusCode || 400) || 400,
        normalizeText(err?.code) || "website_url_invalid",
        normalizeText(err?.message) || "Enter a public website URL that EveryCall can scan."
      );
    }

    const domainLimit = await enforceRateLimit(res, pool, {
      scope: "demo.sessions.create.domain",
      key: new URL(validatedWebsiteUrl).hostname.toLowerCase(),
      maxHits: 4,
      windowMs: 10 * 60 * 1000,
      blockDurationMs: 20 * 60 * 1000,
      message: "This website has reached the demo request limit for now. Please try again later."
    });
    if (domainLimit?.limited) return;

    const session = await createAndBuildDemoSession(pool, {
      websiteUrl: validatedWebsiteUrl,
      requestIp: getClientIp(req),
      userAgent: req.headers?.["user-agent"] || ""
    });

    if (!session) {
      return fail(res, 500, "demo_session_create_failed", "Unable to create the demo session.");
    }

    return res.status(200).json({
      ok: true,
      ...session
    });
  } catch (err) {
    return fail(
      res,
      500,
      "demo_session_create_failed",
      normalizeText(err?.message) || "Unable to create the demo session."
    );
  }
}
