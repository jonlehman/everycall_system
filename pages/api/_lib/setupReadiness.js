import { loadTenantKnowledge } from "./knowledge.js";

export async function getSetupReadiness(pool, tenantKey) {
  const [tenantRes, settingsRes, routingRes, knowledge] = await Promise.all([
    pool.query(
      `SELECT forwarding_setup_status
       FROM tenants
       WHERE tenant_key = $1`,
      [tenantKey]
    ),
    pool.query(
      `SELECT timezone, assistant_enabled
       FROM tenant_settings
       WHERE tenant_key = $1`,
      [tenantKey]
    ),
    pool.query(
      `SELECT primary_queue, emergency_behavior, after_hours_behavior, business_hours
       FROM routing_rules
       WHERE tenant_key = $1`,
      [tenantKey]
    ),
    loadTenantKnowledge(pool, tenantKey, { includeEmptyTemplates: true })
  ]);

  const forwardingStatus = tenantRes.rows[0]?.forwarding_setup_status || "not_started";
  const settings = settingsRes.rows[0] || null;
  const routing = routingRes.rows[0] || null;
  const knowledgeEntryCount = knowledge?.counts?.knowledgeEntryCount || 0;
  const unresolvedBlankGuardrailCount = knowledge?.counts?.unresolvedBlankGuardrailCount || 0;

  const forwardingReady = forwardingStatus === "acknowledged" || forwardingStatus === "configured";
  const settingsReady = Boolean(String(settings?.timezone || "").trim());
  const routingReady = Boolean(
    String(routing?.primary_queue || "").trim() &&
    String(routing?.emergency_behavior || "").trim() &&
    String(routing?.after_hours_behavior || "").trim() &&
    String(routing?.business_hours || "").trim()
  );
  const knowledgeReady = knowledgeEntryCount > 0;
  const guardrailReady = unresolvedBlankGuardrailCount === 0;

  const reasons = [];
  if (!forwardingReady) reasons.push("Confirm forwarding setup in onboarding activation.");
  if (!settingsReady) reasons.push("Save required Account Settings fields.");
  if (!routingReady) reasons.push("Save required Call Routing fields.");
  if (!knowledgeReady) reasons.push("Add business details in Knowledge.");
  if (!guardrailReady) reasons.push("Resolve blank Guardrail Questions by approving answers.");

  const ready = forwardingReady && settingsReady && routingReady && knowledgeReady && guardrailReady;
  const requestedEnabled = Boolean(settings?.assistant_enabled);
  return {
    ready,
    reasons,
    checks: {
      forwardingReady,
      settingsReady,
      routingReady,
      knowledgeReady,
      guardrailReady
    },
    knowledgeEntryCount,
    unresolvedBlankGuardrailCount,
    requestedEnabled,
    enabled: ready && requestedEnabled
  };
}
