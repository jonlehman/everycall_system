import { getOwnedPhoneNumber } from "./telnyx.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeStoredVoiceStatus(value) {
  return normalizeText(value).toLowerCase();
}

function mapProviderStatusToStoredStatus(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "active") return "active_confirmed";
  if (["failed", "unavailable", "released"].includes(normalized)) return normalized;
  return normalized ? "provisioning" : "";
}

async function persistTenantVoiceStatus(pool, tenantKey, { telnyxVoiceStatus, phoneNumberId } = {}) {
  const nextStatus = normalizeText(telnyxVoiceStatus) || null;
  const nextPhoneNumberId = normalizeText(phoneNumberId) || null;
  await pool.query(
    `UPDATE tenants
     SET telnyx_voice_status = COALESCE($2, telnyx_voice_status),
         telnyx_voice_number_id = COALESCE($3, telnyx_voice_number_id),
         updated_at = NOW()
     WHERE tenant_key = $1`,
    [tenantKey, nextStatus, nextPhoneNumberId]
  );
}

async function resolveCarrierActivationState(pool, tenant) {
  const tenantKey = normalizeText(tenant?.tenant_key);
  const phoneNumber = normalizeText(tenant?.telnyx_voice_number);
  const storedStatus = normalizeStoredVoiceStatus(tenant?.telnyx_voice_status);
  const phoneNumberId = normalizeText(tenant?.telnyx_voice_number_id);

  if (!phoneNumber) {
    return {
      carrierReady: false,
      phoneNumber: "",
      phoneNumberId,
      telnyxVoiceStatus: storedStatus || "",
      providerStatus: "",
      providerVerified: false
    };
  }

  if (storedStatus === "active_confirmed") {
    return {
      carrierReady: true,
      phoneNumber,
      phoneNumberId,
      telnyxVoiceStatus: storedStatus,
      providerStatus: "active",
      providerVerified: true
    };
  }

  const shouldCheckProvider = ["", "active", "provisioning"].includes(storedStatus);
  if (!shouldCheckProvider) {
    return {
      carrierReady: false,
      phoneNumber,
      phoneNumberId,
      telnyxVoiceStatus: storedStatus,
      providerStatus: "",
      providerVerified: false
    };
  }

  try {
    const ownedRecord = await getOwnedPhoneNumber({ phoneNumber });
    const providerStatus = normalizeText(ownedRecord?.status).toLowerCase();
    const nextPhoneNumberId = normalizeText(ownedRecord?.phoneNumberId) || phoneNumberId;
    const nextStatus = mapProviderStatusToStoredStatus(providerStatus) || "provisioning";
    if (nextStatus !== storedStatus || nextPhoneNumberId !== phoneNumberId) {
      await persistTenantVoiceStatus(pool, tenantKey, {
        telnyxVoiceStatus: nextStatus,
        phoneNumberId: nextPhoneNumberId
      });
    }
    return {
      carrierReady: nextStatus === "active_confirmed",
      phoneNumber,
      phoneNumberId: nextPhoneNumberId,
      telnyxVoiceStatus: nextStatus,
      providerStatus,
      providerVerified: true
    };
  } catch (error) {
    if (storedStatus === "active") {
      return {
        carrierReady: true,
        phoneNumber,
        phoneNumberId,
        telnyxVoiceStatus: storedStatus,
        providerStatus: "",
        providerVerified: false,
        providerSyncError: error?.message || "unknown"
      };
    }
    return {
      carrierReady: false,
      phoneNumber,
      phoneNumberId,
      telnyxVoiceStatus: storedStatus || "provisioning",
      providerStatus: "",
      providerVerified: false,
      providerSyncError: error?.message || "unknown"
    };
  }
}

async function resolveKnowledgeBaseState(pool, tenantKey) {
  const result = await pool.query(
    `SELECT kb.build_id, kb.status
     FROM tenant_active_knowledge_builds active
     JOIN knowledge_builds kb
       ON kb.tenant_key = active.tenant_key
      AND kb.build_id = active.active_build_id
     WHERE active.tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  const row = result.rows?.[0] || null;
  const activeBuildId = normalizeText(row?.build_id);
  const activeBuildStatus = normalizeText(row?.status).toLowerCase();
  return {
    knowledgeBaseReady: Boolean(activeBuildId) && activeBuildStatus === "published",
    activeBuildId: activeBuildId || null,
    activeBuildStatus: activeBuildStatus || null
  };
}

export async function resolveSalesReceptionistReadiness(pool, tenant) {
  const tenantKey = normalizeText(tenant?.tenant_key);
  if (!pool || !tenantKey) {
    return {
      showSalesReceptionistNumber: false,
      readinessStatus: "setting_up",
      blockingReasons: ["missing_tenant"],
      label: "Setting things up",
      phoneNumber: null,
      telnyxVoiceStatus: null,
      carrierActivationReady: false,
      knowledgeBaseReady: false,
      activeKnowledgeBuildId: null,
      activeKnowledgeBuildStatus: null
    };
  }

  const [carrierState, knowledgeState] = await Promise.all([
    resolveCarrierActivationState(pool, tenant),
    resolveKnowledgeBaseState(pool, tenantKey)
  ]);

  const blockingReasons = [];
  if (!carrierState.phoneNumber) {
    blockingReasons.push("phone_not_assigned");
  } else if (!carrierState.carrierReady) {
    blockingReasons.push("carrier_activation_pending");
  }
  if (!knowledgeState.knowledgeBaseReady) {
    blockingReasons.push("knowledge_base_not_live");
  }

  const showSalesReceptionistNumber = blockingReasons.length === 0;

  return {
    showSalesReceptionistNumber,
    readinessStatus: showSalesReceptionistNumber ? "ready" : "setting_up",
    blockingReasons,
    label: showSalesReceptionistNumber ? carrierState.phoneNumber : "Setting things up",
    phoneNumber: showSalesReceptionistNumber ? carrierState.phoneNumber : null,
    telnyxVoiceStatus: carrierState.telnyxVoiceStatus || null,
    carrierActivationReady: carrierState.carrierReady,
    providerVerified: carrierState.providerVerified,
    knowledgeBaseReady: knowledgeState.knowledgeBaseReady,
    activeKnowledgeBuildId: knowledgeState.activeBuildId,
    activeKnowledgeBuildStatus: knowledgeState.activeBuildStatus
  };
}
