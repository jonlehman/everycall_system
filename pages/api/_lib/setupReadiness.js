export async function getSetupReadiness(pool, tenantKey) {
  const [tenantRes, settingsRes, routingRes, faqRes] = await Promise.all([
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
    pool.query(
      `SELECT COUNT(*)::int AS unresolved_blank_count
       FROM faqs
       WHERE tenant_key = $1
         AND is_industry_default = true
         AND LENGTH(TRIM(COALESCE(answer, ''))) = 0`,
      [tenantKey]
    )
  ]);

  const forwardingStatus = tenantRes.rows[0]?.forwarding_setup_status || "not_started";
  const settings = settingsRes.rows[0] || null;
  const routing = routingRes.rows[0] || null;
  const unresolvedBlankFaqCount = faqRes.rows[0]?.unresolved_blank_count || 0;

  const forwardingReady = forwardingStatus === "acknowledged" || forwardingStatus === "configured";
  const settingsReady = Boolean(String(settings?.timezone || "").trim());
  const routingReady = Boolean(
    String(routing?.primary_queue || "").trim() &&
    String(routing?.emergency_behavior || "").trim() &&
    String(routing?.after_hours_behavior || "").trim() &&
    String(routing?.business_hours || "").trim()
  );
  const faqReady = unresolvedBlankFaqCount === 0;

  const reasons = [];
  if (!forwardingReady) reasons.push("Confirm forwarding setup in onboarding activation.");
  if (!settingsReady) reasons.push("Save required Account Settings fields.");
  if (!routingReady) reasons.push("Save required Call Routing fields.");
  if (!faqReady) reasons.push("Resolve blank industry FAQs by answering or deleting them.");

  const ready = forwardingReady && settingsReady && routingReady && faqReady;
  const requestedEnabled = Boolean(settings?.assistant_enabled);
  return {
    ready,
    reasons,
    checks: {
      forwardingReady,
      settingsReady,
      routingReady,
      faqReady
    },
    unresolvedBlankFaqCount,
    requestedEnabled,
    enabled: ready && requestedEnabled
  };
}
