import { ensureTables, getPool } from "../../_lib/db.js";
import { getAdminActor, requireSession } from "../../_lib/auth.js";
import { runKnowledgeBuildJobs } from "../../_lib/knowledgeReceptionistBuilds.js";
import { ASYNC_JOB_TYPES, enqueueAsyncJob } from "../../../../lib/asyncJobs.js";
import { buildStableEventId, INTEGRATION_EVENT_TYPES } from "../../_lib/outboundIntegrations.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function actorId(actor, session) {
  if (actor?.id) return `admin:${actor.id}`;
  if (session?.user_id) return `admin:${session.user_id}`;
  return "admin:unknown";
}

async function writeAuditLog(pool, { tenantKey = null, actor, session, action, details }) {
  await pool.query(
    `INSERT INTO audit_log (tenant_key, actor, action, details)
     VALUES ($1, $2, $3, $4)`,
    [tenantKey, actorId(actor, session), action, JSON.stringify(details || {})]
  );
}

async function loadMonitoringData(pool) {
  const [
    summaryResult,
    releaseHealthResult,
    failedNotificationsResult,
    failedIntegrationsResult,
    deadLetterJobsResult,
    failedProvisioningResult,
    buildIssuesResult
  ] = await Promise.all([
    pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM lead_notification_deliveries WHERE status = 'failed' AND updated_at >= NOW() - interval '24 hours') AS failed_notifications_24h,
         (SELECT COUNT(*)::int FROM integration_deliveries WHERE status = 'failed' AND created_at >= NOW() - interval '24 hours') AS failed_integrations_24h,
         (SELECT COUNT(*)::int FROM async_jobs WHERE status = 'dead_letter') AS dead_letter_jobs,
         (SELECT COUNT(*)::int FROM provisioning_jobs WHERE status = 'failed' AND updated_at >= NOW() - interval '7 days') AS failed_provisioning_7d,
         (SELECT COUNT(*)::int FROM knowledge_builds WHERE status IN ('queued', 'running') AND updated_at < NOW() - interval '20 minutes') AS stuck_builds,
         (SELECT COUNT(*)::int FROM calls WHERE status = 'error' AND created_at >= NOW() - interval '24 hours') AS call_errors_24h`
    ),
    pool.query(
      `WITH recent_tenants AS (
         SELECT tenant_key
         FROM tenants
         WHERE created_at >= NOW() - interval '30 days'
       ),
       latest_builds AS (
         SELECT DISTINCT ON (tenant_key) tenant_key, build_id, status
         FROM knowledge_builds
         WHERE tenant_key IN (SELECT tenant_key FROM recent_tenants)
         ORDER BY tenant_key, created_at DESC
       ),
       notifications_ready AS (
         SELECT tenant_key
         FROM tenant_settings
         WHERE tenant_key IN (SELECT tenant_key FROM recent_tenants)
           AND lead_alerts_enabled = TRUE
           AND lead_alert_sms_enabled = TRUE
           AND lead_alert_email_enabled = TRUE
       ),
       call_ready AS (
         SELECT kr.tenant_key
         FROM knowledge_readiness_states kr
         JOIN recent_tenants rt ON rt.tenant_key = kr.tenant_key
         LEFT JOIN latest_builds lb ON lb.tenant_key = kr.tenant_key
         LEFT JOIN tenant_active_knowledge_builds ak ON ak.tenant_key = kr.tenant_key
         WHERE COALESCE((kr.checklist_json->>'hours_confirmed')::boolean, FALSE) = TRUE
           AND COALESCE((kr.checklist_json->>'address_confirmed')::boolean, FALSE) = TRUE
           AND COALESCE((kr.checklist_json->>'service_area_confirmed')::boolean, FALSE) = TRUE
           AND COALESCE((kr.checklist_json->>'calls_forwarded_to_receptionist')::boolean, FALSE) = TRUE
           AND COALESCE((kr.checklist_json->>'sample_calls_passed')::boolean, FALSE) = TRUE
           AND COALESCE((kr.checklist_json->>'handoff_path_tested')::boolean, FALSE) = TRUE
           AND COALESCE((kr.checklist_json->>'outcome_capture_tested')::boolean, FALSE) = TRUE
           AND LOWER(COALESCE(lb.status, '')) = 'published'
           AND COALESCE(ak.active_build_id, '') <> ''
           AND ak.active_build_id = lb.build_id
       )
       SELECT
         (SELECT COUNT(*)::int FROM recent_tenants) AS new_tenants_30d,
         (SELECT COUNT(DISTINCT tenant_key)::int FROM knowledge_builds WHERE tenant_key IN (SELECT tenant_key FROM recent_tenants) AND status = 'published') AS tenants_with_published_builds_30d,
         (SELECT COUNT(*)::int FROM notifications_ready) AS tenants_with_notifications_ready_30d,
         (SELECT COUNT(*)::int FROM call_ready) AS tenants_ready_for_calls_30d,
         (SELECT COUNT(*)::int FROM billing_events WHERE event_type = 'billing.checkout.created' AND processed_at >= NOW() - interval '30 days') AS checkout_created_30d,
         (SELECT COUNT(*)::int FROM billing_events WHERE event_type = 'checkout.session.completed' AND processed_at >= NOW() - interval '30 days') AS checkout_completed_30d`
    ),
    pool.query(
      `SELECT
         d.id,
         d.tenant_key,
         t.name AS tenant_name,
         d.call_sid,
         d.channel,
         d.destination,
         d.last_error_code,
         d.last_error_message,
         d.updated_at
       FROM lead_notification_deliveries d
       LEFT JOIN tenants t ON t.tenant_key = d.tenant_key
       WHERE d.status = 'failed'
       ORDER BY d.updated_at DESC
       LIMIT 10`
    ),
    pool.query(
      `SELECT
         d.id,
         d.tenant_key,
         t.name AS tenant_name,
         d.connection_id,
         c.name AS connection_name,
         c.connector_type,
         d.call_sid,
         d.event_id,
         d.attempt_number,
         d.response_status,
         d.error_message,
         d.created_at
       FROM integration_deliveries d
       LEFT JOIN tenants t ON t.tenant_key = d.tenant_key
       LEFT JOIN integration_connections c ON c.id = d.connection_id
       WHERE d.status = 'failed'
       ORDER BY d.created_at DESC
       LIMIT 10`
    ),
    pool.query(
      `SELECT id, tenant_key, job_type, attempts, max_attempts, last_error, created_at, updated_at
       FROM async_jobs
       WHERE status = 'dead_letter'
       ORDER BY updated_at DESC
       LIMIT 10`
    ),
    pool.query(
      `SELECT
         pj.id,
         pj.tenant_key,
         t.name AS tenant_name,
         pj.stage,
         pj.status_detail,
         pj.error_code,
         pj.error_message,
         pj.updated_at
       FROM provisioning_jobs pj
       LEFT JOIN tenants t ON t.tenant_key = pj.tenant_key
       WHERE pj.status = 'failed'
       ORDER BY pj.updated_at DESC
       LIMIT 10`
    ),
    pool.query(
      `SELECT
         kb.build_id,
         kb.tenant_key,
         t.name AS tenant_name,
         kb.status,
         kb.created_at,
         kb.updated_at,
         kb.warnings_json,
         CASE
           WHEN kb.status IN ('queued', 'running') AND kb.updated_at < NOW() - interval '20 minutes' THEN TRUE
           ELSE FALSE
         END AS is_stuck
       FROM knowledge_builds kb
       LEFT JOIN tenants t ON t.tenant_key = kb.tenant_key
       WHERE kb.status IN ('failed', 'qa_blocked')
          OR (kb.status IN ('queued', 'running') AND kb.updated_at < NOW() - interval '20 minutes')
       ORDER BY kb.updated_at DESC
       LIMIT 10`
    )
  ]);

  return {
    summary: summaryResult.rows[0] || {},
    releaseHealth: releaseHealthResult.rows[0] || {},
    failedNotifications: failedNotificationsResult.rows || [],
    failedIntegrations: failedIntegrationsResult.rows || [],
    deadLetterJobs: deadLetterJobsResult.rows || [],
    failedProvisioning: failedProvisioningResult.rows || [],
    buildIssues: buildIssuesResult.rows || []
  };
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;
    const admin = await getAdminActor(session);
    if (!admin) {
      return res.status(403).json({ error: "forbidden" });
    }

    if (req.method === "GET") {
      const data = await loadMonitoringData(pool);
      return res.status(200).json({ ok: true, ...data });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const action = normalizeText(body.action).toLowerCase();

    if (action === "replay_notification") {
      const tenantKey = normalizeText(body.tenantKey);
      const callSid = normalizeText(body.callSid);
      if (!tenantKey || !callSid) {
        return res.status(400).json({ error: "missing_replay_fields" });
      }
      const job = await enqueueAsyncJob(pool, {
        jobType: ASYNC_JOB_TYPES.leadNotificationSend,
        tenantKey,
        dedupeKey: `lead_notification_replay:${callSid}:${Date.now()}`,
        payload: { tenantKey, callSid },
        maxAttempts: 6
      });
      await writeAuditLog(pool, {
        tenantKey,
        actor: admin,
        session,
        action: "admin.monitoring.notification_replay_queued",
        details: { callSid, jobId: job?.id || null }
      });
      return res.status(200).json({ ok: true, message: "Notification replay queued.", jobId: job?.id || null });
    }

    if (action === "replay_integration") {
      const tenantKey = normalizeText(body.tenantKey);
      const callSid = normalizeText(body.callSid);
      const connectionId = Number(body.connectionId || 0);
      const eventId = normalizeText(body.eventId) || buildStableEventId({
        tenantKey,
        callSid,
        eventType: INTEGRATION_EVENT_TYPES.callCompleted,
        eventVersion: 1
      });
      if (!tenantKey || !callSid || !Number.isFinite(connectionId) || connectionId <= 0) {
        return res.status(400).json({ error: "missing_replay_fields" });
      }
      const job = await enqueueAsyncJob(pool, {
        jobType: ASYNC_JOB_TYPES.integrationConnectionSend,
        tenantKey,
        dedupeKey: `integration_replay:${callSid}:${connectionId}:${Date.now()}`,
        payload: {
          tenantKey,
          callSid,
          connectionId,
          eventId
        },
        maxAttempts: 8
      });
      await writeAuditLog(pool, {
        tenantKey,
        actor: admin,
        session,
        action: "admin.monitoring.integration_replay_queued",
        details: { callSid, connectionId, eventId, jobId: job?.id || null }
      });
      return res.status(200).json({ ok: true, message: "Integration replay queued.", jobId: job?.id || null });
    }

    if (action === "retry_async_job") {
      const jobId = Number(body.jobId || 0);
      if (!Number.isFinite(jobId) || jobId <= 0) {
        return res.status(400).json({ error: "invalid_job_id" });
      }
      const result = await pool.query(
        `UPDATE async_jobs
         SET status = 'pending',
             attempts = 0,
             available_at = NOW(),
             locked_at = NULL,
             locked_by = NULL,
             completed_at = NULL,
             last_error = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, tenant_key, job_type`,
        [jobId]
      );
      const job = result.rows[0] || null;
      if (!job) {
        return res.status(404).json({ error: "job_not_found" });
      }
      await writeAuditLog(pool, {
        tenantKey: job.tenant_key || null,
        actor: admin,
        session,
        action: "admin.monitoring.async_job_retried",
        details: { jobId: job.id, jobType: job.job_type }
      });
      return res.status(200).json({ ok: true, message: "Async job requeued.", jobId: job.id });
    }

    if (action === "rerun_build") {
      const tenantKey = normalizeText(body.tenantKey);
      const buildId = normalizeText(body.buildId);
      if (!tenantKey || !buildId) {
        return res.status(400).json({ error: "missing_build_fields" });
      }
      const result = await runKnowledgeBuildJobs(pool, {
        tenantKey,
        buildId,
        maxBuilds: 1
      });
      await writeAuditLog(pool, {
        tenantKey,
        actor: admin,
        session,
        action: "admin.monitoring.build_rerun_requested",
        details: { buildId, result }
      });
      return res.status(200).json({ ok: true, message: "Build rerun requested.", result });
    }

    return res.status(400).json({ error: "unsupported_action" });
  } catch (err) {
    return res.status(500).json({ error: "admin_monitoring_error", message: err?.message || "unknown" });
  }
}
