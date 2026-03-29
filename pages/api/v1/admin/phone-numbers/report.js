import { ensureTables, getPool } from "../../../_lib/db.js";
import { getAdminActor, requireSession } from "../../../_lib/auth.js";
import { listOwnedPhoneNumbers } from "../../../_lib/telnyx.js";

function centsToDollars(cents) {
  return Number.isFinite(Number(cents)) ? Number(cents) / 100 : null;
}

function estimate30DayCostCents({ monthlyCostCents, purchasedAt }) {
  const monthly = Number(monthlyCostCents || 0);
  if (!monthly) return null;
  const now = Date.now();
  const periodStart = now - (30 * 24 * 60 * 60 * 1000);
  const purchased = purchasedAt ? new Date(purchasedAt).getTime() : NaN;
  const effectiveStart = Number.isFinite(purchased) ? Math.max(periodStart, purchased) : periodStart;
  const activeMs = Math.max(0, now - effectiveStart);
  const ratio = Math.min(1, activeMs / (30 * 24 * 60 * 60 * 1000));
  return Math.round(monthly * ratio);
}

function normalizeOwnedNumber(record) {
  return {
    phoneNumber: record?.phone_number || "",
    status: record?.status || "",
    phoneNumberId: record?.id || "",
    purchasedAt: record?.created_at || null,
    monthlyCostCents: Number.isFinite(Number(record?.cost_information?.monthly_cost))
      ? Math.round(Number(record.cost_information.monthly_cost) * 100)
      : null,
    upfrontCostCents: Number.isFinite(Number(record?.cost_information?.upfront_cost))
      ? Math.round(Number(record.cost_information.upfront_cost) * 100)
      : null
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

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

    const tenantsResult = await pool.query(
      `SELECT
         t.tenant_key,
         t.name,
         t.telnyx_voice_number,
         t.telnyx_voice_number_id,
         t.telnyx_voice_status,
         t.telnyx_voice_monthly_cost_cents,
         t.telnyx_voice_upfront_cost_cents,
         t.telnyx_voice_purchased_at,
         tu.owner_name,
         tu.owner_email
       FROM tenants t
       LEFT JOIN LATERAL (
         SELECT name AS owner_name, email AS owner_email
         FROM tenant_users
         WHERE tenant_key = t.tenant_key
           AND role = 'owner'
         ORDER BY id ASC
         LIMIT 1
       ) tu ON TRUE
       WHERE t.telnyx_voice_number IS NOT NULL
          OR t.telnyx_voice_status IS NOT NULL
       ORDER BY t.name ASC`
    );

    const tenantRows = tenantsResult.rows || [];
    const byNumber = new Map();
    for (const row of tenantRows) {
      const phoneNumber = String(row.telnyx_voice_number || "").trim();
      if (!phoneNumber) continue;
      byNumber.set(phoneNumber, row);
    }

    let ownedNumbers = [];
    let sourceStatus = "live";
    try {
      ownedNumbers = (await listOwnedPhoneNumbers()).map(normalizeOwnedNumber);
    } catch (err) {
      sourceStatus = `telnyx_unavailable:${err?.message || "unknown"}`;
    }

    const rows = [];
    const seen = new Set();

    for (const record of ownedNumbers) {
      const tenant = byNumber.get(record.phoneNumber) || null;
      const monthlyCostCents = tenant?.telnyx_voice_monthly_cost_cents ?? record.monthlyCostCents ?? null;
      const estimated30DayCostCents = estimate30DayCostCents({
        monthlyCostCents,
        purchasedAt: tenant?.telnyx_voice_purchased_at || record.purchasedAt
      });
      rows.push({
        phoneNumber: record.phoneNumber,
        assignmentStatus: tenant ? "assigned" : "unassigned",
        telnyxStatus: record.status || tenant?.telnyx_voice_status || "",
        tenantKey: tenant?.tenant_key || "",
        tenantName: tenant?.name || "",
        ownerName: tenant?.owner_name || "",
        ownerEmail: tenant?.owner_email || "",
        purchasedAt: tenant?.telnyx_voice_purchased_at || record.purchasedAt || null,
        monthlyCostCents,
        monthlyCost: centsToDollars(monthlyCostCents),
        estimated30DayCostCents,
        estimated30DayCost: centsToDollars(estimated30DayCostCents),
        costStatus: monthlyCostCents ? "tracked" : "unknown"
      });
      seen.add(record.phoneNumber);
    }

    for (const tenant of tenantRows) {
      const phoneNumber = String(tenant.telnyx_voice_number || "").trim();
      if (!phoneNumber || seen.has(phoneNumber)) continue;
      const estimated30DayCostCents = estimate30DayCostCents({
        monthlyCostCents: tenant.telnyx_voice_monthly_cost_cents,
        purchasedAt: tenant.telnyx_voice_purchased_at
      });
      rows.push({
        phoneNumber,
        assignmentStatus: "assigned_db_only",
        telnyxStatus: tenant.telnyx_voice_status || "",
        tenantKey: tenant.tenant_key || "",
        tenantName: tenant.name || "",
        ownerName: tenant.owner_name || "",
        ownerEmail: tenant.owner_email || "",
        purchasedAt: tenant.telnyx_voice_purchased_at || null,
        monthlyCostCents: tenant.telnyx_voice_monthly_cost_cents ?? null,
        monthlyCost: centsToDollars(tenant.telnyx_voice_monthly_cost_cents),
        estimated30DayCostCents,
        estimated30DayCost: centsToDollars(estimated30DayCostCents),
        costStatus: tenant.telnyx_voice_monthly_cost_cents ? "tracked" : "unknown"
      });
    }

    rows.sort((a, b) => String(a.phoneNumber).localeCompare(String(b.phoneNumber)));

    return res.status(200).json({
      ok: true,
      sourceStatus,
      rows,
      summary: {
        totalNumbers: rows.length,
        assignedNumbers: rows.filter((row) => row.assignmentStatus === "assigned" || row.assignmentStatus === "assigned_db_only").length,
        unassignedNumbers: rows.filter((row) => row.assignmentStatus === "unassigned").length,
        trackedMonthlyCostCents: rows.reduce((sum, row) => sum + (Number(row.monthlyCostCents || 0) || 0), 0),
        trackedEstimated30DayCostCents: rows.reduce((sum, row) => sum + (Number(row.estimated30DayCostCents || 0) || 0), 0)
      }
    });
  } catch (err) {
    return res.status(500).json({ error: "admin_phone_number_report_error", message: err?.message || "unknown" });
  }
}
