import { computeTrialDaysRemaining, getTenantBillingState } from "./billing.js";
import { listKnowledgeReceptionistBuilds } from "./knowledgeReceptionistBuilds.js";
import { listUploadedDocuments } from "./knowledgeReceptionistConfig.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeStatus(value) {
  return normalizeText(value).toLowerCase();
}

function formatPhoneDisplay(value) {
  const digits = normalizeText(value).replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return normalizeText(value);
}

function statusTone(status) {
  if (status === "ready") return "ok";
  if (status === "blocked" || status === "needs_attention") return "bad";
  return "processing";
}

function makeTask({
  status = "pending",
  label = "",
  message = "",
  actionHref = "",
  canAct = true,
  details = {},
  warnings = []
} = {}) {
  return {
    status,
    tone: statusTone(status),
    done: status === "ready",
    label,
    message,
    actionHref,
    canAct: Boolean(canAct),
    warnings: Array.isArray(warnings) ? warnings.filter(Boolean) : [],
    details
  };
}

function isWebsiteBuildKind(buildKind) {
  const normalized = normalizeStatus(buildKind);
  return normalized === "website_base" || normalized === "legacy_combined";
}

function isBuildActive(build) {
  const status = normalizeStatus(build?.status);
  return status === "queued" || status === "running";
}

function resolveWebsiteAncestorBuildId(builds, activeBuild) {
  const rows = Array.isArray(builds) ? builds : [];
  const startBuildId = normalizeText(activeBuild?.build_id);
  if (!startBuildId) return "";
  const byBuildId = new Map(
    rows
      .map((build) => [normalizeText(build?.build_id), build])
      .filter(([buildId]) => Boolean(buildId))
  );
  let currentBuildId = startBuildId;
  const visited = new Set();
  while (currentBuildId && !visited.has(currentBuildId)) {
    visited.add(currentBuildId);
    const build = byBuildId.get(currentBuildId);
    if (!build) break;
    if (isWebsiteBuildKind(build.build_kind)) return currentBuildId;
    const nextBuildId = normalizeText(build?.base_build_id);
    if (!nextBuildId) break;
    currentBuildId = nextBuildId;
  }
  return "";
}

function resolveDocumentPendingState({ uploadedDocuments = [], activeBuild = null } = {}) {
  const approvedDocuments = (Array.isArray(uploadedDocuments) ? uploadedDocuments : [])
    .filter((document) => normalizeStatus(document?.status) === "approved");
  const appliedDocumentIds = new Set(
    (Array.isArray(activeBuild?.intake_metadata_json?.uploaded_document_ids)
      ? activeBuild.intake_metadata_json.uploaded_document_ids
      : [])
      .map((value) => normalizeText(value))
      .filter(Boolean)
  );
  const approvedDocumentIds = new Set(
    approvedDocuments
      .map((document) => normalizeText(document?.uploaded_document_id))
      .filter(Boolean)
  );
  const pendingApprovedDocuments = approvedDocuments.filter((document) => {
    const id = normalizeText(document?.uploaded_document_id);
    return id && !appliedDocumentIds.has(id);
  });
  const removedLiveDocumentIds = Array.from(appliedDocumentIds).filter((id) => !approvedDocumentIds.has(id));
  return {
    pendingCount: pendingApprovedDocuments.length + removedLiveDocumentIds.length,
    hasPendingChanges: pendingApprovedDocuments.length > 0 || removedLiveDocumentIds.length > 0
  };
}

function defaultGreetingText(tenant) {
  const businessName = normalizeText(tenant?.name || tenant?.tenant_key).replace(/[_-]+/g, " ");
  return businessName
    ? `Thanks for calling ${businessName}. How can I help?`
    : "Thanks for calling. How can I help?";
}

function resolvePermissions({ session = null, activeUser = null } = {}) {
  if (session?.role === "admin") {
    return {
      canManageSetup: true,
      canManageBilling: true,
      canUpdateForwarding: true,
      role: "admin"
    };
  }
  const role = normalizeStatus(activeUser?.role || session?.role);
  const canManageSetup = role === "owner" || role === "admin";
  return {
    canManageSetup,
    canManageBilling: canManageSetup,
    canUpdateForwarding: Boolean(activeUser),
    role: role || null
  };
}

function buildPhoneNumberTask({ tenant }) {
  const phoneNumber = normalizeText(tenant?.telnyx_voice_number);
  const formattedPhoneNumber = formatPhoneDisplay(phoneNumber);
  const voiceStatus = normalizeStatus(tenant?.telnyx_voice_status);
  if (["failed", "unavailable", "released"].includes(voiceStatus)) {
    return makeTask({
      status: "needs_attention",
      label: "Receptionist number needs attention",
      message: "A problem occurred while setting up the EveryCall number.",
      actionHref: "/client/account/general",
      details: { phoneNumber, formattedPhoneNumber, telnyxVoiceStatus: voiceStatus || null }
    });
  }
  if (phoneNumber && ["active_confirmed", "active"].includes(voiceStatus)) {
    return makeTask({
      status: "ready",
      label: formattedPhoneNumber || "Receptionist number ready",
      message: "Your EveryCall number is ready for live calls.",
      actionHref: "/client/account/general",
      details: { phoneNumber, formattedPhoneNumber, telnyxVoiceStatus: voiceStatus || null }
    });
  }
  if (phoneNumber) {
    return makeTask({
      status: "pending",
      label: formattedPhoneNumber || "Receptionist number assigned",
      message: "Your EveryCall number is assigned and carrier activation is still being confirmed.",
      actionHref: "/client/account/general",
      details: { phoneNumber, formattedPhoneNumber, telnyxVoiceStatus: voiceStatus || null }
    });
  }
  return makeTask({
    status: "pending",
    label: "Setting things up",
    message: "Your EveryCall number is still being assigned.",
    actionHref: "/client/account/general",
    details: { phoneNumber: "", formattedPhoneNumber: "", telnyxVoiceStatus: voiceStatus || null }
  });
}

function buildKnowledgeTask({ buildsData = {}, uploadedDocuments = [] }) {
  if (buildsData?.error) {
    return makeTask({
      status: "needs_attention",
      label: "Knowledge status unavailable",
      message: "EveryCall could not load the current knowledge status.",
      actionHref: "/client/receptionist/knowledge",
      details: {
        error: normalizeText(buildsData.error)
      }
    });
  }
  const builds = Array.isArray(buildsData?.builds) ? buildsData.builds : [];
  const activeBuildId = normalizeText(buildsData?.activeBuild?.active_build_id);
  const activeBuild = builds.find((build) => normalizeText(build?.build_id) === activeBuildId) || null;
  const latestBuild = builds[0] || null;
  const activeBuildStatus = normalizeStatus(activeBuild?.status);
  const latestBuildStatus = normalizeStatus(latestBuild?.status);
  const activeBuildPublished = Boolean(activeBuildId) && activeBuildStatus === "published";
  const activeWork = builds.find(isBuildActive) || null;
  const latestFailed = ["failed", "qa_blocked"].includes(latestBuildStatus);
  const documentPendingState = resolveDocumentPendingState({ uploadedDocuments, activeBuild });
  const warnings = [];
  if (documentPendingState.hasPendingChanges) {
    warnings.push(`${documentPendingState.pendingCount} document change${documentPendingState.pendingCount === 1 ? "" : "s"} pending apply.`);
  }

  if (activeBuildPublished) {
    return makeTask({
      status: "ready",
      label: "Knowledge published",
      message: "The receptionist has a live knowledge build.",
      actionHref: "/client/receptionist/knowledge",
      warnings,
      details: {
        activeBuildId,
        activeBuildStatus,
        latestBuildId: normalizeText(latestBuild?.build_id) || null,
        latestBuildStatus: latestBuildStatus || null,
        websiteAncestorBuildId: resolveWebsiteAncestorBuildId(builds, activeBuild) || null,
        pendingDocumentChangeCount: documentPendingState.pendingCount
      }
    });
  }
  if (activeWork) {
    const progress = activeWork?.progress || null;
    return makeTask({
      status: "pending",
      label: "Knowledge build running",
      message: "EveryCall is training on your business information.",
      actionHref: "/client/receptionist/knowledge",
      details: {
        activeBuildId,
        activeBuildStatus: activeBuildStatus || null,
        activeWorkBuildId: normalizeText(activeWork?.build_id) || null,
        latestBuildStatus: latestBuildStatus || null,
        progress
      }
    });
  }
  if (latestFailed) {
    return makeTask({
      status: "needs_attention",
      label: "Knowledge needs attention",
      message: "The latest knowledge build could not be published.",
      actionHref: "/client/receptionist/knowledge",
      details: {
        activeBuildId,
        activeBuildStatus: activeBuildStatus || null,
        latestBuildId: normalizeText(latestBuild?.build_id) || null,
        latestBuildStatus: latestBuildStatus || null
      }
    });
  }
  return makeTask({
    status: "pending",
    label: latestBuild ? "Knowledge not live yet" : "Create knowledge base",
    message: latestBuild
      ? "A knowledge build exists, but it is not live yet."
      : "Create a knowledge build so the receptionist can answer business-specific questions.",
    actionHref: "/client/receptionist/knowledge",
    details: {
      activeBuildId,
      activeBuildStatus: activeBuildStatus || null,
      latestBuildId: normalizeText(latestBuild?.build_id) || null,
      latestBuildStatus: latestBuildStatus || null
    }
  });
}

function buildBasicsTask({ tenant, promptProfile = {}, runtimeProfile = {}, permissions }) {
  const businessName = normalizeText(promptProfile?.business_name || promptProfile?.businessName || tenant?.name);
  const greeting = normalizeText(runtimeProfile?.greeting_text || promptProfile?.opening_line || promptProfile?.openingLine)
    || defaultGreetingText(tenant);
  const voice = normalizeText(
    runtimeProfile?.session_config_json?.voice
    || runtimeProfile?.session_config?.voice
    || runtimeProfile?.sessionConfig?.voice
  ) || "ara";
  const reviewed = Boolean(tenant?.receptionist_basics_reviewed_at);
  const missing = [];
  if (!businessName) missing.push("business_name");
  if (!greeting) missing.push("greeting");
  if (!voice) missing.push("voice");
  const warnings = [];
  if (!normalizeText(tenant?.primary_number)) {
    warnings.push("Public business phone is blank.");
  }
  if (missing.length) {
    return makeTask({
      status: "needs_attention",
      label: "Basics need attention",
      message: "Add the missing receptionist basics before relying on live calls.",
      actionHref: "/client/receptionist/basics",
      canAct: permissions.canManageSetup,
      warnings,
      details: { reviewed, missing, businessName, greeting, voice }
    });
  }
  if (!reviewed) {
    return makeTask({
      status: "pending",
      label: "Ready to review",
      message: "Review and confirm the receptionist basics.",
      actionHref: "/client/receptionist/basics",
      canAct: permissions.canManageSetup,
      warnings,
      details: { reviewed, missing, businessName, greeting, voice }
    });
  }
  return makeTask({
    status: "ready",
    label: "Basics reviewed",
    message: "The receptionist basics have been reviewed.",
    actionHref: "/client/receptionist/basics",
    canAct: permissions.canManageSetup,
    warnings,
    details: { reviewed, missing, businessName, greeting, voice }
  });
}

function buildLeadDestinationsTask({ users = [], permissions }) {
  const activeUsers = (Array.isArray(users) ? users : [])
    .filter((user) => normalizeStatus(user?.status) === "active");
  const emailRecipients = activeUsers
    .filter((user) => Boolean(user?.lead_alert_email_enabled) && normalizeText(user?.email))
    .map((user) => normalizeText(user.email));
  const smsRecipients = activeUsers
    .filter((user) => Boolean(user?.lead_alert_sms_enabled) && normalizeText(user?.phone_number))
    .map((user) => ({
      phoneNumber: normalizeText(user.phone_number),
      formattedPhoneNumber: formatPhoneDisplay(user.phone_number),
      smsOptInStatus: normalizeStatus(user.sms_opt_in_status) || "not_requested",
      optedIn: normalizeStatus(user.sms_opt_in_status) === "opted_in"
    }));
  const optedInSmsRecipients = smsRecipients.filter((user) => user.optedIn);
  const warnings = [];
  const pendingSmsCount = smsRecipients.length - optedInSmsRecipients.length;
  if (pendingSmsCount > 0) {
    warnings.push(`${pendingSmsCount} SMS recipient${pendingSmsCount === 1 ? "" : "s"} pending opt-in.`);
  }
  const hasWorkingDestination = emailRecipients.length > 0 || optedInSmsRecipients.length > 0;
  if (hasWorkingDestination) {
    return makeTask({
      status: "ready",
      label: "Lead destinations configured",
      message: "EveryCall has at least one working lead alert destination.",
      actionHref: "/client/team",
      canAct: permissions.canManageSetup,
      warnings,
      details: {
        emailRecipients,
        smsRecipients,
        workingDestinationCount: emailRecipients.length + optedInSmsRecipients.length
      }
    });
  }
  if (smsRecipients.length > 0) {
    return makeTask({
      status: "pending",
      label: "SMS opt-in pending",
      message: "Text alerts are configured, but no SMS recipient has opted in yet.",
      actionHref: "/client/team",
      canAct: permissions.canManageSetup,
      warnings,
      details: { emailRecipients, smsRecipients, workingDestinationCount: 0 }
    });
  }
  return makeTask({
    status: "needs_attention",
    label: "No lead destinations",
    message: "Choose where new lead alerts should go.",
    actionHref: "/client/team",
    canAct: permissions.canManageSetup,
    details: { emailRecipients, smsRecipients, workingDestinationCount: 0 }
  });
}

function buildForwardingTask({ tenant, permissions }) {
  const forwardingStatus = normalizeStatus(tenant?.forwarding_setup_status) || "not_started";
  if (forwardingStatus === "configured") {
    return makeTask({
      status: "ready",
      label: "Calls forwarded",
      message: "Forwarding is marked as configured.",
      actionHref: "/client/get-started",
      canAct: permissions.canUpdateForwarding,
      details: {
        forwardingStatus,
        configuredAt: tenant?.forwarding_configured_at || null,
        acknowledgedAt: tenant?.forwarding_acknowledged_at || null
      }
    });
  }
  return makeTask({
    status: "pending",
    label: forwardingStatus === "acknowledged" ? "Forwarding acknowledged" : "Forward calls",
    message: "Forward desired calls from your business phone system to your EveryCall number.",
    actionHref: "/client/get-started",
    canAct: permissions.canUpdateForwarding,
    details: {
      forwardingStatus,
      configuredAt: tenant?.forwarding_configured_at || null,
      acknowledgedAt: tenant?.forwarding_acknowledged_at || null
    }
  });
}

function buildBillingTask({ billingState = {}, permissions }) {
  const billingStatus = normalizeStatus(billingState?.billing_status);
  const appAccessStatus = normalizeStatus(billingState?.app_access_status);
  const serviceAccessStatus = normalizeStatus(billingState?.service_access_status);
  const hasStripeSubscription = Boolean(normalizeText(billingState?.stripe_subscription_id));
  const trialDaysRemaining = computeTrialDaysRemaining(billingState?.trial_end);
  const details = {
    billingStatus: billingStatus || null,
    appAccessStatus: appAccessStatus || null,
    serviceAccessStatus: serviceAccessStatus || null,
    hasStripeSubscription,
    trialEnd: billingState?.trial_end || null,
    trialDaysRemaining
  };

  if (billingStatus === "deactivated" || appAccessStatus === "billing_locked" || serviceAccessStatus === "disabled") {
    return makeTask({
      status: "blocked",
      label: "Billing required",
      message: "Billing is required to keep EveryCall active.",
      actionHref: "/client/account/billing",
      canAct: permissions.canManageBilling,
      details
    });
  }
  if (hasStripeSubscription) {
    return makeTask({
      status: "ready",
      label: "Billing activated",
      message: "Billing is active.",
      actionHref: "/client/account/billing",
      canAct: permissions.canManageBilling,
      details
    });
  }
  if (["past_due", "unpaid", "incomplete", "trial_expired"].includes(billingStatus)) {
    return makeTask({
      status: "needs_attention",
      label: "Billing needs attention",
      message: "Add or update billing to avoid service interruption.",
      actionHref: "/client/account/billing",
      canAct: permissions.canManageBilling,
      details
    });
  }
  return makeTask({
    status: "pending",
    label: "Trial active",
    message: trialDaysRemaining === null
      ? "Billing is not activated yet."
      : `${trialDaysRemaining} day${trialDaysRemaining === 1 ? "" : "s"} left in trial.`,
    actionHref: "/client/account/billing",
    canAct: permissions.canManageBilling,
    details
  });
}

function buildLiveReadiness({ tasks, billingState = {} }) {
  const blockers = [];
  const warnings = [];
  if (tasks.phoneNumber.status !== "ready") blockers.push("phone_number");
  if (tasks.knowledge.status !== "ready") blockers.push("knowledge");
  if (normalizeStatus(billingState?.service_access_status) === "disabled") blockers.push("service_access_disabled");
  if (tasks.basics.status !== "ready") warnings.push("basics_not_reviewed");
  if (tasks.leadDestinations.status !== "ready") warnings.push("lead_destinations_not_ready");

  const ready = blockers.length === 0;
  return {
    status: ready ? "ready" : "pending",
    tone: ready ? "ok" : "processing",
    ready,
    label: ready ? "Ready for live calls" : "Not ready for live calls yet",
    message: ready
      ? "The receptionist has a usable number, live knowledge, and service access."
      : "Finish the blocking setup items before forwarding live calls.",
    blockers,
    warnings
  };
}

function buildSetupProgress(tasks) {
  const orderedKeys = ["phoneNumber", "knowledge", "basics", "leadDestinations", "forwarding", "billing"];
  const totalCount = orderedKeys.length;
  const completedKeys = orderedKeys.filter((key) => tasks[key]?.status === "ready");
  const blockedKeys = orderedKeys.filter((key) => tasks[key]?.status === "blocked");
  const needsAttentionKeys = orderedKeys.filter((key) => tasks[key]?.status === "needs_attention");
  const percent = Math.round((completedKeys.length / totalCount) * 100);
  const complete = completedKeys.length === totalCount;
  return {
    status: blockedKeys.length ? "blocked" : complete ? "ready" : needsAttentionKeys.length ? "needs_attention" : "pending",
    tone: blockedKeys.length || needsAttentionKeys.length ? "bad" : complete ? "ok" : "processing",
    complete,
    percent,
    completedCount: completedKeys.length,
    totalCount,
    completedKeys,
    blockedKeys,
    needsAttentionKeys,
    label: complete ? "Setup complete" : "Setup in progress",
    message: complete
      ? "EveryCall setup is complete."
      : "Finish the remaining setup items before relying on EveryCall fully."
  };
}

export function buildClientSetupStatus({
  tenant = {},
  buildsData = {},
  users = [],
  billingState = {},
  promptProfile = {},
  runtimeProfile = {},
  uploadedDocuments = [],
  session = null,
  activeUser = null
} = {}) {
  const permissions = resolvePermissions({ session, activeUser });
  const tasks = {
    phoneNumber: buildPhoneNumberTask({ tenant }),
    knowledge: buildKnowledgeTask({ buildsData, uploadedDocuments }),
    basics: buildBasicsTask({ tenant, promptProfile, runtimeProfile, permissions }),
    leadDestinations: buildLeadDestinationsTask({ users, permissions }),
    forwarding: buildForwardingTask({ tenant, permissions }),
    billing: buildBillingTask({ billingState, permissions })
  };
  const liveReadiness = buildLiveReadiness({ tasks, billingState });
  const setupProgress = buildSetupProgress(tasks);
  const warnings = Object.entries(tasks)
    .flatMap(([key, task]) => task.warnings.map((warning) => ({ task: key, message: warning })));
  return {
    tenantKey: normalizeText(tenant?.tenant_key || billingState?.tenant_key) || null,
    generatedAt: new Date().toISOString(),
    liveReadiness,
    setupProgress,
    tasks,
    warnings,
    permissions
  };
}

async function loadTenantRow(db, tenantKey) {
  const res = await db.query(
    `SELECT tenant_key, name, status, primary_number, telnyx_voice_number, telnyx_voice_number_id,
            telnyx_voice_status, forwarding_setup_status, forwarding_acknowledged_at,
            forwarding_configured_at, receptionist_basics_reviewed_at,
            service_access_status, app_access_status, billing_status
     FROM tenants
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  return res.rows[0] || null;
}

async function loadTenantUsers(db, tenantKey) {
  const res = await db.query(
    `SELECT id, name, email, phone_number, status, role, sms_opt_in_status,
            lead_alert_sms_enabled, lead_alert_email_enabled
     FROM tenant_users
     WHERE tenant_key = $1
     ORDER BY id ASC`,
    [tenantKey]
  );
  return res.rows || [];
}

async function loadPromptProfileRow(db, tenantKey) {
  const res = await db.query(
    `SELECT tenant_key, assistant_name, business_name, company_description, opening_line
     FROM tenant_prompt_profiles
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  return res.rows[0] || null;
}

async function loadRuntimeProfileRow(db, tenantKey) {
  const res = await db.query(
    `SELECT tenant_key, greeting_text, session_config_json
     FROM knowledge_runtime_profiles
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  return res.rows[0] || null;
}

async function loadActiveUserForSession(db, session) {
  if (!session?.user_id || session.role !== "tenant") return null;
  const res = await db.query(
    `SELECT id, tenant_key, role, email, name, status
     FROM tenant_users
     WHERE id = $1
     LIMIT 1`,
    [session.user_id]
  );
  const user = res.rows[0] || null;
  return user && normalizeStatus(user.status) === "active" ? user : null;
}

export async function loadClientSetupStatus(db, tenantKey, { session = null } = {}) {
  const [
    tenant,
    users,
    billingState,
    promptProfile,
    runtimeProfile,
    buildsData,
    uploadedDocuments,
    activeUser
  ] = await Promise.all([
    loadTenantRow(db, tenantKey),
    loadTenantUsers(db, tenantKey),
    getTenantBillingState(db, tenantKey),
    loadPromptProfileRow(db, tenantKey).catch(() => null),
    loadRuntimeProfileRow(db, tenantKey).catch(() => null),
    listKnowledgeReceptionistBuilds(db, tenantKey).catch((error) => ({
      activeBuild: null,
      builds: [],
      assignments: [],
      error: normalizeText(error?.message) || "knowledge_builds_unavailable"
    })),
    listUploadedDocuments(db, tenantKey).catch(() => []),
    loadActiveUserForSession(db, session)
  ]);

  if (!tenant) {
    return null;
  }

  return buildClientSetupStatus({
    tenant,
    buildsData,
    users,
    billingState: billingState || tenant,
    promptProfile: promptProfile || {},
    runtimeProfile: runtimeProfile || {},
    uploadedDocuments,
    session,
    activeUser
  });
}
