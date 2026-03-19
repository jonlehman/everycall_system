import { ensureTables, getPool } from "../_lib/db.js";
import { getAdminActor, requireSession } from "../_lib/auth.js";

const EDITABLE_TEXT_FIELDS = [
  "name",
  "status",
  "data_region",
  "plan",
  "primary_number",
  "industry",
  "telnyx_voice_number",
  "telnyx_voice_number_id",
  "telnyx_voice_order_id",
  "telnyx_voice_status",
  "forwarding_setup_status",
  "billing_status",
  "plan_code",
  "service_access_status",
  "app_access_status",
  "billing_lock_reason"
];

const EDITABLE_INTEGER_FIELDS = [
  "telnyx_voice_monthly_cost_cents",
  "telnyx_voice_upfront_cost_cents"
];

const EDITABLE_TIMESTAMP_FIELDS = [
  "telnyx_voice_purchased_at",
  "forwarding_acknowledged_at",
  "forwarding_configured_at",
  "trial_started_at",
  "trial_end",
  "post_trial_access_ends_at",
  "billing_grace_ends_at",
  "deactivated_at",
  "billing_status_updated_at"
];

const TENANT_SELECT_FIELDS = [
  "tenant_key",
  ...EDITABLE_TEXT_FIELDS,
  ...EDITABLE_INTEGER_FIELDS,
  ...EDITABLE_TIMESTAMP_FIELDS,
  "created_at",
  "updated_at"
];

const FIELD_ALIASES = {
  tenant_key: ["tenant_key", "tenantKey"],
  data_region: ["data_region", "dataRegion"],
  primary_number: ["primary_number", "primaryNumber"],
  plan_code: ["plan_code", "planCode"],
  telnyx_voice_number: ["telnyx_voice_number", "telnyxVoiceNumber"],
  telnyx_voice_number_id: ["telnyx_voice_number_id", "telnyxVoiceNumberId"],
  telnyx_voice_order_id: ["telnyx_voice_order_id", "telnyxVoiceOrderId"],
  telnyx_voice_status: ["telnyx_voice_status", "telnyxVoiceStatus"],
  telnyx_voice_monthly_cost_cents: ["telnyx_voice_monthly_cost_cents", "telnyxVoiceMonthlyCostCents"],
  telnyx_voice_upfront_cost_cents: ["telnyx_voice_upfront_cost_cents", "telnyxVoiceUpfrontCostCents"],
  telnyx_voice_purchased_at: ["telnyx_voice_purchased_at", "telnyxVoicePurchasedAt"],
  forwarding_setup_status: ["forwarding_setup_status", "forwardingSetupStatus"],
  forwarding_acknowledged_at: ["forwarding_acknowledged_at", "forwardingAcknowledgedAt"],
  forwarding_configured_at: ["forwarding_configured_at", "forwardingConfiguredAt"],
  billing_status: ["billing_status", "billingStatus"],
  trial_started_at: ["trial_started_at", "trialStartedAt"],
  trial_end: ["trial_end", "trialEnd"],
  post_trial_access_ends_at: ["post_trial_access_ends_at", "postTrialAccessEndsAt"],
  billing_grace_ends_at: ["billing_grace_ends_at", "billingGraceEndsAt"],
  service_access_status: ["service_access_status", "serviceAccessStatus"],
  app_access_status: ["app_access_status", "appAccessStatus"],
  deactivated_at: ["deactivated_at", "deactivatedAt"],
  billing_status_updated_at: ["billing_status_updated_at", "billingStatusUpdatedAt"],
  billing_lock_reason: ["billing_lock_reason", "billingLockReason"]
};

const REQUIRED_DEFAULTS = {
  status: "active",
  data_region: "US",
  plan: "Growth",
  forwarding_setup_status: "not_started",
  billing_status: "trialing",
  service_access_status: "enabled",
  app_access_status: "enabled"
};

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function readBodyValue(body, field) {
  const aliases = FIELD_ALIASES[field] || [field];
  for (const key of aliases) {
    if (hasOwn(body, key)) {
      return body[key];
    }
  }
  return undefined;
}

function normalizeOptionalText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeRequiredText(value, fallback = null) {
  const normalized = normalizeOptionalText(value);
  return normalized || fallback;
}

function normalizeOptionalInteger(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`invalid_integer:${field}`);
  }
  return Math.round(numeric);
}

function normalizeOptionalTimestamp(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid_timestamp:${field}`);
  }
  return date.toISOString();
}

function normalizeComparableValue(field, value) {
  if (EDITABLE_TIMESTAMP_FIELDS.includes(field)) {
    return value ? new Date(value).toISOString() : null;
  }
  if (EDITABLE_INTEGER_FIELDS.includes(field)) {
    if (value === null || value === undefined || value === "") return null;
    return Number(value);
  }
  return value === null || value === undefined || value === "" ? null : String(value);
}

function actorId(actor, session) {
  if (actor?.id) {
    return `admin:${actor.id}`;
  }
  if (session?.user_id) {
    return `admin:${session.user_id}`;
  }
  return "admin:unknown";
}

async function writeAuditLog(pool, { tenantKey, actor, action, details }) {
  await pool.query(
    `INSERT INTO audit_log (tenant_key, actor, action, details)
     VALUES ($1, $2, $3, $4)`,
    [tenantKey, actor, action, JSON.stringify(details || {})]
  );
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

    if (req.method === "GET") {
      const tenantKey = req.query?.tenantKey;
      if (tenantKey) {
        const row = await pool.query(
          `SELECT ${TENANT_SELECT_FIELDS.join(", ")}
           FROM tenants
           WHERE tenant_key = $1
           LIMIT 1`,
          [String(tenantKey)]
        );
        return res.status(200).json({ tenant: row.rows[0] || null });
      }

      const rows = await pool.query(
        `SELECT t.tenant_key, t.name, t.status, t.data_region, t.plan, t.primary_number, t.industry,
                (SELECT COUNT(*)::int FROM tenant_users u WHERE u.tenant_key = t.tenant_key) AS user_count
         FROM tenants t
         ORDER BY t.name ASC`
      );
      return res.status(200).json({ tenants: rows.rows });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const tenantKey = normalizeOptionalText(readBodyValue(body, "tenant_key"));
      if (!tenantKey) {
        return res.status(400).json({ error: "missing_tenant_key" });
      }

      const existingRes = await pool.query(
        `SELECT ${TENANT_SELECT_FIELDS.join(", ")}
         FROM tenants
         WHERE tenant_key = $1
         LIMIT 1`,
        [tenantKey]
      );
      const existing = existingRes.rows[0] || null;

      const nextRecord = {
        tenant_key: tenantKey
      };

      for (const field of EDITABLE_TEXT_FIELDS) {
        const raw = readBodyValue(body, field);
        const currentValue = existing ? existing[field] : null;
        if (field === "name") {
          nextRecord[field] = normalizeRequiredText(raw !== undefined ? raw : currentValue, null);
        } else {
          nextRecord[field] = normalizeRequiredText(
            raw !== undefined ? raw : currentValue,
            REQUIRED_DEFAULTS[field] ?? null
          );
        }
      }

      if (!nextRecord.name) {
        return res.status(400).json({ error: "missing_name" });
      }

      for (const field of EDITABLE_INTEGER_FIELDS) {
        const raw = readBodyValue(body, field);
        const currentValue = existing ? existing[field] : null;
        nextRecord[field] = normalizeOptionalInteger(raw !== undefined ? raw : currentValue, field);
      }

      for (const field of EDITABLE_TIMESTAMP_FIELDS) {
        const raw = readBodyValue(body, field);
        const currentValue = existing ? existing[field] : null;
        nextRecord[field] = normalizeOptionalTimestamp(raw !== undefined ? raw : currentValue, field);
      }

      const changedFields = TENANT_SELECT_FIELDS
        .filter((field) => field !== "tenant_key" && field !== "created_at" && field !== "updated_at")
        .filter((field) => {
          const before = normalizeComparableValue(field, existing ? existing[field] : null);
          const after = normalizeComparableValue(field, nextRecord[field]);
          return JSON.stringify(before) !== JSON.stringify(after);
        })
        .map((field) => ({
          field,
          before: normalizeComparableValue(field, existing ? existing[field] : null),
          after: normalizeComparableValue(field, nextRecord[field])
        }));

      if (existing && changedFields.length === 0) {
        return res.status(200).json({ ok: true, tenant: existing, changedFields: [] });
      }

      const params = [
        nextRecord.tenant_key,
        nextRecord.name,
        nextRecord.status,
        nextRecord.data_region,
        nextRecord.plan,
        nextRecord.primary_number,
        nextRecord.industry,
        nextRecord.telnyx_voice_number,
        nextRecord.telnyx_voice_number_id,
        nextRecord.telnyx_voice_order_id,
        nextRecord.telnyx_voice_status,
        nextRecord.telnyx_voice_monthly_cost_cents,
        nextRecord.telnyx_voice_upfront_cost_cents,
        nextRecord.telnyx_voice_purchased_at,
        nextRecord.forwarding_setup_status,
        nextRecord.forwarding_acknowledged_at,
        nextRecord.forwarding_configured_at,
        nextRecord.billing_status,
        nextRecord.plan_code,
        nextRecord.trial_started_at,
        nextRecord.trial_end,
        nextRecord.post_trial_access_ends_at,
        nextRecord.billing_grace_ends_at,
        nextRecord.service_access_status,
        nextRecord.app_access_status,
        nextRecord.deactivated_at,
        nextRecord.billing_status_updated_at,
        nextRecord.billing_lock_reason
      ];

      const saved = await pool.query(
        `INSERT INTO tenants (
           tenant_key,
           name,
           status,
           data_region,
           plan,
           primary_number,
           industry,
           telnyx_voice_number,
           telnyx_voice_number_id,
           telnyx_voice_order_id,
           telnyx_voice_status,
           telnyx_voice_monthly_cost_cents,
           telnyx_voice_upfront_cost_cents,
           telnyx_voice_purchased_at,
           forwarding_setup_status,
           forwarding_acknowledged_at,
           forwarding_configured_at,
           billing_status,
           plan_code,
           trial_started_at,
           trial_end,
           post_trial_access_ends_at,
           billing_grace_ends_at,
           service_access_status,
           app_access_status,
           deactivated_at,
           billing_status_updated_at,
           billing_lock_reason
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
           $21, $22, $23, $24, $25, $26, $27, $28
         )
         ON CONFLICT (tenant_key)
         DO UPDATE SET
           name = EXCLUDED.name,
           status = EXCLUDED.status,
           data_region = EXCLUDED.data_region,
           plan = EXCLUDED.plan,
           primary_number = EXCLUDED.primary_number,
           industry = EXCLUDED.industry,
           telnyx_voice_number = EXCLUDED.telnyx_voice_number,
           telnyx_voice_number_id = EXCLUDED.telnyx_voice_number_id,
           telnyx_voice_order_id = EXCLUDED.telnyx_voice_order_id,
           telnyx_voice_status = EXCLUDED.telnyx_voice_status,
           telnyx_voice_monthly_cost_cents = EXCLUDED.telnyx_voice_monthly_cost_cents,
           telnyx_voice_upfront_cost_cents = EXCLUDED.telnyx_voice_upfront_cost_cents,
           telnyx_voice_purchased_at = EXCLUDED.telnyx_voice_purchased_at,
           forwarding_setup_status = EXCLUDED.forwarding_setup_status,
           forwarding_acknowledged_at = EXCLUDED.forwarding_acknowledged_at,
           forwarding_configured_at = EXCLUDED.forwarding_configured_at,
           billing_status = EXCLUDED.billing_status,
           plan_code = EXCLUDED.plan_code,
           trial_started_at = EXCLUDED.trial_started_at,
           trial_end = EXCLUDED.trial_end,
           post_trial_access_ends_at = EXCLUDED.post_trial_access_ends_at,
           billing_grace_ends_at = EXCLUDED.billing_grace_ends_at,
           service_access_status = EXCLUDED.service_access_status,
           app_access_status = EXCLUDED.app_access_status,
           deactivated_at = EXCLUDED.deactivated_at,
           billing_status_updated_at = EXCLUDED.billing_status_updated_at,
           billing_lock_reason = EXCLUDED.billing_lock_reason,
           updated_at = NOW()
         RETURNING ${TENANT_SELECT_FIELDS.join(", ")}`,
        params
      );

      const admin = await getAdminActor(session);
      await writeAuditLog(pool, {
        tenantKey,
        actor: actorId(admin, session),
        action: existing ? "admin.tenant.updated" : "admin.tenant.created",
        details: {
          changedFields,
          tenantName: nextRecord.name,
          actorEmail: admin?.email || null
        }
      });

      return res.status(200).json({
        ok: true,
        tenant: saved.rows[0] || null,
        changedFields
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    const message = err?.message || "unknown";
    if (message.startsWith("invalid_integer:") || message.startsWith("invalid_timestamp:")) {
      return res.status(400).json({ error: "invalid_field", message });
    }
    return res.status(500).json({ error: "tenants_error", message });
  }
}
