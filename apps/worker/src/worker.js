import pg from "pg";
import { logError, logInfo } from "@everycall/observability";
import { ensureTables } from "../../../pages/api/_lib/db.js";
import { analyzeAndPersistCallTranscriptQuestions } from "../../../pages/api/_lib/callTranscriptAnalysis.js";
import { deliverIntegrationConnection } from "../../../pages/api/_lib/integrationConnectors.js";
import { sendLeadNotifications } from "../../../pages/api/_lib/leadNotifications.js";
import {
  loadIntegrationConnection,
  recordIntegrationDelivery,
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

  if (job.job_type === ASYNC_JOB_TYPES.integrationWebhookSend || job.job_type === ASYNC_JOB_TYPES.integrationConnectionSend) {
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
    let delivery;
    try {
      delivery = await deliverIntegrationConnection(pool, {
        connection,
        tenantKey,
        callSid,
        eventId,
        attemptNumber
      });
    } catch (error) {
      const failedDeliveryId = String(error?.deliveryId || "").trim() || undefined;
      const failedEventId = String(error?.eventId || "").trim() || eventId;
      await recordIntegrationDelivery(pool, {
        tenantKey,
        connectionId,
        callSid,
        eventType: "call.completed",
        eventVersion: 1,
        eventId: failedEventId,
        deliveryId: failedDeliveryId || failedEventId || `failed_${Date.now()}`,
        attemptNumber,
        status: "failed",
        requestUrl: error?.requestUrl || connection.endpoint_url,
        responseStatus: error?.responseStatus,
        responseBodyExcerpt: error?.responseBodyExcerpt,
        errorMessage: error?.message || "integration_delivery_failed"
      });
      await updateConnectionDeliveryHealth(pool, {
        connectionId,
        status: "failed",
        errorMessage: error?.message || "integration_delivery_failed"
      });
      throw error;
    }
    await recordIntegrationDelivery(pool, {
      tenantKey,
      connectionId,
      callSid,
      eventType: delivery.payload.event_type,
      eventVersion: delivery.payload.event_version,
      eventId: delivery.payload.event_id,
      deliveryId: delivery.payload.delivery_id,
      attemptNumber,
      status: delivery.status,
      requestUrl: delivery.requestUrl,
      responseStatus: delivery.responseStatus,
      responseBodyExcerpt: delivery.responseBodyExcerpt,
      errorMessage: delivery.errorMessage
    });

    if (delivery.status === "delivered") {
      await updateConnectionDeliveryHealth(pool, {
        connectionId,
        status: "delivered"
      });
      return;
    }

    if (delivery.status === "skipped") {
      return;
    }

    return;
  }

  if (job.job_type === ASYNC_JOB_TYPES.callTranscriptAnalysis) {
    const payload = typeof job.payload_json === "object" && job.payload_json ? job.payload_json : {};
    const tenantKey = String(payload.tenantKey || job.tenant_key || "").trim();
    const callSid = String(payload.callSid || "").trim();
    if (!tenantKey || !callSid) {
      throw new Error("call_transcript_analysis_job_missing_fields");
    }
    await analyzeAndPersistCallTranscriptQuestions(pool, { tenantKey, callSid });
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
        jobTypes: [
          ASYNC_JOB_TYPES.leadNotificationSend,
          ASYNC_JOB_TYPES.integrationWebhookSend,
          ASYNC_JOB_TYPES.integrationConnectionSend,
          ASYNC_JOB_TYPES.callTranscriptAnalysis
        ],
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
