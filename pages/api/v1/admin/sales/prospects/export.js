import { listSalesProspects } from "../../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  sendSalesApiError,
  writeSalesAdminAudit
} from "../../../../_lib/salesApi.js";

const CSV_HEADERS = Object.freeze([
  "business_name",
  "contact_name",
  "phone",
  "website",
  "email",
  "lead_delivery_email",
  "business_category",
  "timezone",
  "permission",
  "email_permission",
  "suppressed",
  "do_not_call",
  "status",
  "last_outcome",
  "last_outcome_at",
  "followup_status",
  "followup_outcome",
  "updated_at"
]);

function csvCell(value) {
  const raw = String(value ?? "");
  const text = /^[\t\r\n ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function csvDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function exportPhone(value) {
  const normalized = String(value || "").trim();
  const us = normalized.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return us ? `${us[1]}-${us[2]}-${us[3]}` : normalized;
}

function prospectRow(prospect) {
  return [
    prospect.businessName,
    prospect.contactName,
    exportPhone(prospect.phoneE164),
    prospect.websiteUrl,
    prospect.contactEmail,
    prospect.leadDeliveryEmail,
    prospect.businessCategory,
    prospect.timezone,
    yesNo(prospect.permissionGranted),
    yesNo(prospect.emailPermission),
    yesNo(prospect.suppressed),
    yesNo(prospect.doNotCall),
    prospect.status,
    prospect.lastOutcome,
    csvDate(prospect.lastOutcomeAt),
    prospect.latestFollowup?.status,
    prospect.latestFollowup?.outcome,
    csvDate(prospect.updatedAt)
  ].map(csvCell).join(",");
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    const prospects = [];
    let afterQueuePosition = 0;
    do {
      const page = await listSalesProspects(context.pool, {
        limit: 250,
        afterQueuePosition,
        status: req.query?.status,
        includeDeleted: String(req.query?.includeDeleted || "").toLowerCase() === "true",
        search: req.query?.search
      });
      prospects.push(...page.prospects);
      afterQueuePosition = page.nextQueuePosition || 0;
    } while (afterQueuePosition && prospects.length < 5000);

    await writeSalesAdminAudit(context, "sales.prospects.exported", {
      exportedCount: prospects.length,
      searchApplied: Boolean(String(req.query?.search || "").trim()),
      status: String(req.query?.status || "").trim() || null,
      includeDeleted: String(req.query?.includeDeleted || "").toLowerCase() === "true"
    });

    const csv = [CSV_HEADERS.join(","), ...prospects.map(prospectRow)].join("\r\n");
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="everycall-sales-prospects-${date}.csv"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(`\uFEFF${csv}\r\n`);
  } catch (error) {
    return sendSalesApiError(res, error, "sales_prospect_export_failed");
  }
}
