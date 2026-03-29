import pg from "pg";
import { logError, logInfo } from "@everycall/observability";
import { ensureTables } from "../../../pages/api/_lib/db.js";
import { sendLeadNotifications } from "../../../pages/api/_lib/leadNotifications.js";
import {
  buildCallCompletedEvent,
  buildSignedWebhookRequest,
  getWebhookConnectionSecret,
  loadIntegrationConnection,
  parseConnectionConfig,
  recordIntegrationDelivery,
  shouldDeliverConnection,
  updateConnectionDeliveryHealth
} from "../../../pages/api/_lib/outboundIntegrations.js";
import {
  ASYNC_JOB_TYPES,
  claimAsyncJobs,
  completeAsyncJob,
  failAsyncJob
} from "../../../lib/asyncJobs.js";

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const workerId = String(process.env.WORKER_ID || `worker-${process.pid}`).trim();
const pollIntervalMs = Math.max(1000, Number(process.env.WORKER_POLL_INTERVAL_MS || 3000));
const claimLimit = Math.max(1, Number(process.env.WORKER_CLAIM_LIMIT || 10));

if (!databaseUrl) {
  throw new Error("DATABASE_URL missing. Configure the worker service with a database connection string or inherit it from the gateway service in render.yaml.");
}

const pool = new pg.Pool({ connectionString: databaseUrl });
let shuttingDown = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processJob(job) {
  if (job.job_type === ASYNC_JOB_TYPES.leadNotificationSend) {
    const payload = typeof job.payload_json === "object" && job.payload_json ? job.payload_json : {};
    const tenantKey = String(payload.tenantKey || job.tenant_key || "").trim();
    const callSid = String(payload.callSid || "").trim();
    if (!tenantKey || !callSid) {
      throw new Error("lead_notification_job_missing_fields");
    }
    await sendLeadNotifications(pool, { tenantKey, callSid });
    return;
  }

  if (job.job_type === ASYNC_JOB_TYPES.integrationWebhookSend) {
    const payload = typeof job.payload_json === "object" && job.payload_json ? job.payload_json : {};
    const tenantKey = String(payload.tenantKey || job.tenant_key || "").trim();
    const callSid = String(payload.callSid || "").trim();
    const connectionId = Number(payload.connectionId || 0);
    const eventId = String(payload.eventId || "").trim();
    if (!tenantKey || !callSid || !Number.isFinite(connectionId) || connectionId <= 0 || !eventId) {
      throw new Error("integration_job_missing_fields");
    }

    const connection = await loadIntegrationConnection(pool, { tenantKey, connectionId });
    if (!connection) {
      throw new Error("integration_connection_not_found");
    }

    const attemptNumber = Number(job.attempts || 1);
    const deliveryEvent = await buildCallCompletedEvent(pool, {
      tenantKey,
      callSid,
      includeTranscript: parseConnectionConfig(connection.config_json).includeTranscript,
      eventId
    });

    const decision = shouldDeliverConnection({
      payload: deliveryEvent,
      config: connection.config_json
    });

    if (connection.status !== "enabled") {
      await recordIntegrationDelivery(pool, {
        tenantKey,
        connectionId,
        callSid,
        eventType: deliveryEvent.event_type,
        eventVersion: deliveryEvent.event_version,
        eventId: deliveryEvent.event_id,
        deliveryId: deliveryEvent.delivery_id,
        attemptNumber,
        status: "skipped",
        requestUrl: connection.endpoint_url,
        errorMessage: "connection_disabled"
      });
      return;
    }

    if (!decision.deliver) {
      await recordIntegrationDelivery(pool, {
        tenantKey,
        connectionId,
        callSid,
        eventType: deliveryEvent.event_type,
        eventVersion: deliveryEvent.event_version,
        eventId: deliveryEvent.event_id,
        deliveryId: deliveryEvent.delivery_id,
        attemptNumber,
        status: "skipped",
        requestUrl: connection.endpoint_url,
        errorMessage: decision.reason || "filtered_out"
      });
      return;
    }

    const signingSecret = getWebhookConnectionSecret(connection);
    const request = buildSignedWebhookRequest({
      endpointUrl: connection.endpoint_url,
      signingSecret,
      payload: deliveryEvent,
      attemptNumber
    });
    const response = await fetch(request.endpointUrl, {
      method: "POST",
      headers: request.headers,
      body: request.body
    });
    const responseText = await response.text().catch(() => "");
    if (!response.ok) {
      await recordIntegrationDelivery(pool, {
        tenantKey,
        connectionId,
        callSid,
        eventType: deliveryEvent.event_type,
        eventVersion: deliveryEvent.event_version,
        eventId: deliveryEvent.event_id,
        deliveryId: deliveryEvent.delivery_id,
        attemptNumber,
        status: "failed",
        requestUrl: connection.endpoint_url,
        responseStatus: response.status,
        responseBodyExcerpt: responseText,
        errorMessage: `http_${response.status}`
      });
      await updateConnectionDeliveryHealth(pool, {
        connectionId,
        status: "failed",
        errorMessage: `HTTP ${response.status}: ${responseText || "unknown"}`
      });
      throw new Error(`integration_http_${response.status}`);
    }

    await recordIntegrationDelivery(pool, {
      tenantKey,
      connectionId,
      callSid,
      eventType: deliveryEvent.event_type,
      eventVersion: deliveryEvent.event_version,
      eventId: deliveryEvent.event_id,
      deliveryId: deliveryEvent.delivery_id,
      attemptNumber,
      status: "delivered",
      requestUrl: connection.endpoint_url,
      responseStatus: response.status,
      responseBodyExcerpt: responseText
    });
    await updateConnectionDeliveryHealth(pool, {
      connectionId,
      status: "delivered"
    });
    return;
  }

  throw new Error(`unknown_job_type:${job.job_type}`);
}

async function runLoop() {
  await ensureTables(pool);
  logInfo("worker_started", { workerId, pollIntervalMs, claimLimit });
  while (!shuttingDown) {
    let jobs = [];
    try {
      jobs = await claimAsyncJobs(pool, {
        workerId,
        jobTypes: [ASYNC_JOB_TYPES.leadNotificationSend, ASYNC_JOB_TYPES.integrationWebhookSend],
        limit: claimLimit
      });
    } catch (err) {
      logError("worker_claim_failed", {
        workerId,
        message: err instanceof Error ? err.message : "unknown"
      });
      await sleep(pollIntervalMs);
      continue;
    }

    if (!jobs.length) {
      await sleep(pollIntervalMs);
      continue;
    }

    for (const job of jobs) {
      try {
        await processJob(job);
        await completeAsyncJob(pool, job.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown";
        logError("worker_job_failed", {
          workerId,
          jobId: job.id,
          jobType: job.job_type,
          attempts: job.attempts,
          maxAttempts: job.max_attempts,
          message
        });
        await failAsyncJob(pool, job.id, {
          attempts: job.attempts,
          maxAttempts: job.max_attempts,
          errorMessage: message
        });
      }
    }
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logInfo("worker_shutdown_requested", { workerId, signal });
  try {
    await pool.end();
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

runLoop().catch(async (err) => {
  logError("worker_fatal", {
    workerId,
    message: err instanceof Error ? err.message : "unknown"
  });
  try {
    await pool.end();
  } finally {
    process.exit(1);
  }
});
