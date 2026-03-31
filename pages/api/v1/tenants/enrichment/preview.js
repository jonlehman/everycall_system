import { getPool } from "../../../_lib/db.js";
import { requireSession } from "../../../_lib/auth.js";
import {
  DEFAULT_RUNTIME_BEHAVIOR_DEFAULTS,
  DEFAULT_RUNTIME_TOOL_POLICY,
  DEFAULT_RUNTIME_WORDING_DEFAULTS
} from "../../../_lib/knowledgeReceptionistConfig.js";
import { inferKnowledgeAssignmentsForIndustry, syncCanonicalKnowledgePacks } from "../../../_lib/knowledgeReceptionistPacks.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  const text = normalizeText(value);
  return text ? [text] : [];
}

function normalizeAssignments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      domainId: normalizeText(item?.domainId || item?.domain_id),
      subdomainId: normalizeText(item?.subdomainId || item?.subdomain_id)
    }))
    .filter((item) => item.domainId && item.subdomainId);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const session = await requireSession(req, res, { role: "admin" });
    if (!session) return;

    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ ok: false, error: "database_unavailable" });
    }

    await syncCanonicalKnowledgePacks(pool);

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const website = normalizeText(body.website);
    const uploadedDocumentIds = normalizeStringArray(body.uploadedDocumentIds || body.uploaded_document_ids);
    const setupInterviewSessionIds = normalizeStringArray(body.setupInterviewSessionIds || body.setup_interview_session_ids);
    const requestedAssignments = normalizeAssignments(body.assignments);
    const inferredAssignments = inferKnowledgeAssignmentsForIndustry(body.industry);
    const assignments = requestedAssignments.length ? requestedAssignments : inferredAssignments;
    const bootstrapMode = normalizeText(body.bootstrapMode || body.bootstrap_mode)
      || (website || uploadedDocumentIds.length ? "website_first" : "setup_interview");

    return res.status(200).json({
      ok: true,
      preview: {
        canonical_spec_path: "docs/architecture/knowledge-receptionist-subsystem/v1.0/",
        bootstrap_mode: bootstrapMode,
        assignments,
        approved_source_channels: [
          ...(website ? ["website_page", "website_file"] : []),
          ...(uploadedDocumentIds.length ? ["uploaded_document"] : []),
          ...(setupInterviewSessionIds.length ? ["owner_interview"] : [])
        ],
        defaults: {
          runtime_profile: {
            tool_policy: DEFAULT_RUNTIME_TOOL_POLICY,
            wording_defaults: DEFAULT_RUNTIME_WORDING_DEFAULTS,
            runtime_defaults: DEFAULT_RUNTIME_BEHAVIOR_DEFAULTS
          },
          business_call_intent: {
            preferred_outcomes: ["callback_request", "message_taken", "transfer"]
          }
        },
        blockers: assignments.length ? [] : ["domain_assignment_required"]
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "preview_error",
      message: String(err?.message || "unknown")
    });
  }
}
