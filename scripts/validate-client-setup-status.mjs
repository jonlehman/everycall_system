import assert from "node:assert/strict";
import { buildClientSetupStatus } from "../pages/api/_lib/clientSetupStatus.js";

const baseTenant = {
  tenant_key: "demo",
  name: "Demo Plumbing",
  primary_number: "+15551234567",
  telnyx_voice_number: "+15557654321",
  telnyx_voice_status: "active_confirmed",
  forwarding_setup_status: "configured",
  forwarding_configured_at: "2026-05-01T12:00:00.000Z",
  receptionist_basics_reviewed_at: "2026-05-01T12:00:00.000Z",
  service_access_status: "enabled",
  app_access_status: "enabled",
  billing_status: "trialing"
};

const publishedBuild = {
  build_id: "build_live",
  build_kind: "website_base",
  status: "published",
  created_at: "2026-05-01T12:00:00.000Z"
};

const baseBuildsData = {
  activeBuild: { active_build_id: "build_live" },
  builds: [publishedBuild]
};

const baseUsers = [
  {
    id: 1,
    status: "active",
    email: "lead@example.com",
    phone_number: "+15550101010",
    lead_alert_email_enabled: true,
    lead_alert_sms_enabled: true,
    sms_opt_in_status: "pending"
  }
];

const baseBillingState = {
  tenant_key: "demo",
  billing_status: "trialing",
  service_access_status: "enabled",
  app_access_status: "enabled",
  stripe_subscription_id: null,
  trial_end: "2026-06-01T12:00:00.000Z"
};

const ownerSession = { role: "tenant", user_id: 1 };
const ownerUser = { id: 1, role: "owner", status: "active" };

function status(overrides = {}) {
  return buildClientSetupStatus({
    tenant: { ...baseTenant, ...(overrides.tenant || {}) },
    buildsData: overrides.buildsData || baseBuildsData,
    users: overrides.users || baseUsers,
    billingState: { ...baseBillingState, ...(overrides.billingState || {}) },
    promptProfile: overrides.promptProfile || {},
    runtimeProfile: overrides.runtimeProfile || { greeting_text: "Thanks for calling Demo Plumbing.", session_config_json: { voice: "eve" } },
    uploadedDocuments: overrides.uploadedDocuments || [],
    session: ownerSession,
    activeUser: ownerUser
  });
}

{
  const result = status();
  assert.equal(result.tasks.phoneNumber.status, "ready");
  assert.equal(result.tasks.knowledge.status, "ready");
  assert.equal(result.tasks.basics.status, "ready");
  assert.equal(result.tasks.leadDestinations.status, "ready");
  assert.equal(result.tasks.leadDestinations.warnings.length, 1);
  assert.equal(result.tasks.forwarding.status, "ready");
  assert.equal(result.tasks.billing.status, "pending");
  assert.equal(result.liveReadiness.status, "ready");
  assert.equal(result.setupProgress.percent, 83);
}

{
  const result = status({
    tenant: {
      primary_number: "",
      receptionist_basics_reviewed_at: "2026-05-01T12:00:00.000Z"
    },
    promptProfile: {
      business_name: "",
      opening_line: ""
    }
  });
  assert.equal(result.tasks.basics.status, "ready");
  assert.equal(result.tasks.basics.warnings.includes("Public business phone is blank."), true);
  assert.equal(result.liveReadiness.status, "ready");
}

{
  const result = status({
    buildsData: {
      activeBuild: null,
      builds: [{ build_id: "build_running", build_kind: "website_base", status: "running", progress: { percent: 45 } }]
    }
  });
  assert.equal(result.tasks.knowledge.status, "pending");
  assert.equal(result.liveReadiness.status, "pending");
  assert.deepEqual(result.liveReadiness.blockers, ["knowledge"]);
}

{
  const result = status({
    buildsData: {
      activeBuild: null,
      builds: [{ build_id: "build_failed", build_kind: "website_base", status: "failed" }]
    }
  });
  assert.equal(result.tasks.knowledge.status, "needs_attention");
  assert.equal(result.setupProgress.status, "needs_attention");
}

{
  const result = status({
    buildsData: {
      activeBuild: null,
      builds: [],
      error: "relation_missing"
    }
  });
  assert.equal(result.tasks.knowledge.status, "needs_attention");
  assert.equal(result.tasks.knowledge.details.error, "relation_missing");
}

{
  const result = status({
    users: [{
      id: 1,
      status: "active",
      email: "lead@example.com",
      phone_number: "+15550101010",
      lead_alert_email_enabled: false,
      lead_alert_sms_enabled: true,
      sms_opt_in_status: "pending"
    }]
  });
  assert.equal(result.tasks.leadDestinations.status, "pending");
  assert.equal(result.tasks.leadDestinations.label, "SMS opt-in pending");
}

{
  const result = status({
    tenant: { service_access_status: "disabled", app_access_status: "billing_locked", billing_status: "deactivated" },
    billingState: { service_access_status: "disabled", app_access_status: "billing_locked", billing_status: "deactivated" }
  });
  assert.equal(result.tasks.billing.status, "blocked");
  assert.equal(result.liveReadiness.status, "pending");
  assert.equal(result.liveReadiness.blockers.includes("service_access_disabled"), true);
}

console.log("client setup status validation passed");
