const TERMINAL_CALL_STATES = new Set([
  'closed',
  'completed',
  'ended',
  'failed',
  'no_answer',
  'voicemail',
  'wrong_number',
  'not_interested',
  'do_not_call',
  'canceled',
  'cancelled'
]);

const CONNECTED_CALL_STATES = new Set([
  'prospect_connected',
  'ai_standby_ready',
  'ai_live',
  'ai_paused',
  'demo_ended',
  'signup_pending',
  'signup_completed'
]);

const AI_READY_STATES = new Set(['ready', 'standby_ready', 'ai_standby_ready', 'live', 'paused']);
const AI_LIVE_STATES = new Set(['live', 'ai_live', 'paused', 'ai_paused']);

function firstValue(source, keys, fallback = null) {
  if (!source || typeof source !== 'object') return fallback;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) return value;
  }
  return fallback;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeStatus(value) {
  return normalizeText(value).toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = normalizeStatus(value);
  if (['true', 'yes', 'y', '1', 'allowed', 'granted'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0', 'blocked', 'denied'].includes(normalized)) return false;
  return null;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean);
  }
  const text = normalizeText(value);
  return text ? [text] : [];
}

function errorMessageFromPayload(payload, fallback) {
  const value = firstValue(payload, ['message', 'error', 'detail'], fallback);
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return normalizeText(firstValue(value, ['message', 'detail', 'code'], fallback));
  }
  return fallback;
}

export async function fetchSalesJson(url, options = {}) {
  const {
    idempotencyKey,
    ...requestOptions
  } = options;
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const existingHeaders = requestOptions.headers || {};
  const hasIdempotencyKey = Object.keys(existingHeaders)
    .some((key) => key.toLowerCase() === 'idempotency-key');
  const generatedIdempotencyKey = isMutation && !hasIdempotencyKey
    ? (idempotencyKey || globalThis.crypto?.randomUUID?.() || `sales-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    : '';
  const response = await fetch(url, {
    cache: 'no-store',
    ...requestOptions,
    headers: {
      Accept: 'application/json',
      ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
      ...(generatedIdempotencyKey ? { 'Idempotency-Key': generatedIdempotencyKey } : {}),
      ...existingHeaders
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(errorMessageFromPayload(payload, `Request failed (${response.status}).`));
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload || {};
}

export function normalizeProspect(source = {}) {
  const permission = normalizeBoolean(firstValue(source, [
    'permission',
    'permissionGranted',
    'permission_granted',
    'hasPermission',
    'has_permission'
  ]));
  const suppressed = normalizeBoolean(firstValue(source, [
    'suppressed',
    'isSuppressed',
    'is_suppressed',
    'doNotCall',
    'do_not_call'
  ]));
  const eligibilityValue = firstValue(source, ['eligible', 'isEligible', 'is_eligible']);
  const explicitEligible = normalizeBoolean(eligibilityValue);
  const demo = firstValue(source, ['demo', 'demoProfile', 'demo_profile'], {}) || {};
  const demoStatus = normalizeStatus(firstValue(source, [
    'demoStatus',
    'demo_status',
    'preparationStatus',
    'preparation_status'
  ], firstValue(demo, ['status'], 'queued')));
  const suppressionReason = normalizeText(firstValue(source, [
    'suppressionReason',
    'suppression_reason',
    'eligibilityReason',
    'eligibility_reason'
  ]));
  const callBlockedReason = normalizeText(firstValue(source, [
    'callBlockedReason',
    'call_blocked_reason'
  ]));
  const callingWindow = firstValue(source, ['callingWindow', 'calling_window'], {}) || {};
  const latestFollowupSource = firstValue(source, ['latestFollowup', 'latest_followup'], null);

  return {
    raw: source,
    id: normalizeText(firstValue(source, ['id', 'prospectId', 'prospect_id'])),
    businessName: normalizeText(firstValue(source, ['businessName', 'business_name', 'companyName', 'company_name', 'name'])),
    contactName: normalizeText(firstValue(source, ['contactName', 'contact_name', 'ownerName', 'owner_name'])),
    phone: normalizeText(firstValue(source, ['phone', 'phoneNumber', 'phone_number', 'phoneE164', 'phone_e164', 'telephone'])),
    website: normalizeText(firstValue(source, ['website', 'websiteUrl', 'website_url', 'url'])),
    email: normalizeText(firstValue(source, ['email', 'contactEmail', 'contact_email'])),
    leadDeliveryEmail: normalizeText(firstValue(source, ['leadDeliveryEmail', 'lead_delivery_email'])),
    businessCategory: normalizeText(firstValue(source, ['businessCategory', 'business_category', 'category', 'industry'])),
    localTime: normalizeText(firstValue(source, ['localTime', 'local_time', 'formattedLocalTime', 'formatted_local_time'])),
    timezone: normalizeText(firstValue(source, ['timezone', 'timeZone', 'time_zone'])),
    permission,
    emailPermission: normalizeBoolean(firstValue(source, ['emailPermission', 'email_permission'])) === true,
    suppressed: suppressed === true,
    doNotCall: normalizeBoolean(firstValue(source, ['doNotCall', 'do_not_call'])) === true,
    suppressionReason,
    callBlockedReason,
    callBlockedCode: normalizeStatus(firstValue(source, ['callBlockedCode', 'call_blocked_code'])),
    preparationEligible: normalizeBoolean(firstValue(source, [
      'preparationEligible',
      'preparation_eligible'
    ])) ?? (permission === true && suppressed !== true),
    callingWindow,
    eligible: explicitEligible ?? (permission === true && suppressed !== true),
    demoStatus: demoStatus || 'queued',
    demoFailure: normalizeText(firstValue(source, [
      'demoFailure',
      'demo_failure',
      'failureMessage',
      'failure_message',
      'providerError',
      'provider_error'
    ], firstValue(demo, ['failureMessage', 'failure_message', 'error']))),
    talkingPoints: normalizeStringList(firstValue(source, [
      'talkingPoints',
      'talking_points',
      'websiteFacts',
      'website_facts'
    ], firstValue(demo, ['talkingPoints', 'talking_points', 'facts', 'previewSummary', 'preview_summary'], []))),
    outcome: normalizeStatus(firstValue(source, ['outcome', 'callOutcome', 'call_outcome', 'lastOutcome', 'last_outcome'])),
    lastOutcomeAt: firstValue(source, ['lastOutcomeAt', 'last_outcome_at']),
    status: normalizeStatus(firstValue(source, ['status'])) || 'queued',
    latestFollowup: latestFollowupSource && typeof latestFollowupSource === 'object'
      ? normalizeFollowup(latestFollowupSource)
      : null,
    note: normalizeText(firstValue(source, ['note', 'notes'])),
    position: Number(firstValue(source, ['position', 'queuePosition', 'queue_position'], 0)) || 0,
    rowVersion: Number(firstValue(source, ['rowVersion', 'row_version'], 1)) || 1,
    createdAt: firstValue(source, ['createdAt', 'created_at']),
    updatedAt: firstValue(source, ['updatedAt', 'updated_at']),
    demoExpiresAt: firstValue(source, ['demoExpiresAt', 'demo_expires_at'], firstValue(demo, ['expiresAt', 'expires_at']))
  };
}

export function normalizeQueue(payload = {}) {
  const queueEnvelope = firstValue(payload, ['queue'], {}) || {};
  const prospectsSource = firstValue(
    payload,
    ['prospects'],
    Array.isArray(queueEnvelope) ? queueEnvelope : firstValue(queueEnvelope, ['prospects', 'items'], [])
  );
  const prospects = Array.isArray(prospectsSource) ? prospectsSource.map(normalizeProspect) : [];
  const currentProspectId = normalizeText(firstValue(payload, [
    'currentProspectId',
    'current_prospect_id'
  ], firstValue(queueEnvelope, ['currentProspectId', 'current_prospect_id'])));
  const explicitCurrent = firstValue(payload, ['currentProspect'], firstValue(queueEnvelope, ['currentProspect', 'current']));
  const normalizedExplicitCurrent = explicitCurrent && typeof explicitCurrent === 'object'
    ? normalizeProspect(explicitCurrent)
    : null;
  const current = normalizedExplicitCurrent?.id
    ? normalizedExplicitCurrent
    : prospects.find((item) => item.id === currentProspectId) || prospects[0] || null;
  const upcoming = prospects
    .filter((item) => item.id && item.id !== current?.id)
    .slice(0, 10);

  return {
    current,
    prospects,
    upcoming,
    currentProspectId: current?.id || currentProspectId,
    warmQueueSize: Number(firstValue(payload, [
      'warmQueueSize',
      'warm_queue_size'
    ], firstValue(queueEnvelope, ['warmQueueSize', 'warm_queue_size'], 11))) || 11,
    missingTimezonePolicy: normalizeStatus(firstValue(payload, [
      'missingTimezonePolicy',
      'missing_timezone_policy'
    ], firstValue(queueEnvelope, [
      'missingTimezonePolicy',
      'missing_timezone_policy'
    ], 'block'))) === 'allow' ? 'allow' : 'block'
  };
}

export function normalizeCall(payload = {}) {
  const source = firstValue(payload, ['call', 'salesCall', 'sales_call'], payload) || {};
  const state = normalizeStatus(firstValue(source, ['state', 'status', 'callState', 'call_state']));
  const aiState = normalizeStatus(firstValue(source, ['aiState', 'ai_state', 'standbyState', 'standby_state']));
  const operator = firstValue(source, ['operator', 'operatorLeg', 'operator_leg'], {}) || {};
  const prospectConnectedValue = normalizeBoolean(firstValue(source, [
    'prospectConnected',
    'prospect_connected'
  ]));
  const aiReadyValue = normalizeBoolean(firstValue(source, ['aiReady', 'ai_ready']));
  const providerError = firstValue(source, [
    'providerError',
    'provider_error',
    'providerErrorMessage',
    'provider_error_message',
    'lastProviderError',
    'last_provider_error'
  ]);
  const webrtc = normalizeWebrtc(firstValue(source, ['webrtc'], firstValue(operator, ['webrtc'], {})));

  return {
    raw: source,
    id: normalizeText(firstValue(source, ['id', 'callId', 'call_id', 'salesCallId', 'sales_call_id'])),
    prospectId: normalizeText(firstValue(source, ['prospectId', 'prospect_id'])),
    state: state || 'unknown',
    aiState: aiState || 'not_started',
    prospectConnected: prospectConnectedValue ?? CONNECTED_CALL_STATES.has(state),
    aiReady: aiReadyValue ?? (AI_READY_STATES.has(aiState) || state === 'ai_standby_ready'),
    aiLive: AI_LIVE_STATES.has(aiState) || ['ai_live', 'ai_paused'].includes(state),
    aiPaused: aiState === 'paused' || aiState === 'ai_paused' || state === 'ai_paused',
    terminal: TERMINAL_CALL_STATES.has(state),
    providerError: typeof providerError === 'string'
      ? providerError
      : normalizeText(firstValue(providerError, ['message', 'detail', 'code'])),
    operator: {
      state: normalizeStatus(firstValue(operator, ['state', 'status'])) || 'unknown',
      connected: normalizeBoolean(firstValue(operator, ['connected', 'isConnected', 'is_connected'])),
      webrtcToken: normalizeText(firstValue(operator, ['webrtcToken', 'webrtc_token', 'token'])),
      remoteAudioUrl: normalizeText(firstValue(operator, ['remoteAudioUrl', 'remote_audio_url']))
    },
    webrtc,
    outcome: normalizeStatus(firstValue(source, ['outcome', 'callOutcome', 'call_outcome'])),
    outcomeNotes: normalizeText(firstValue(source, ['outcomeNotes', 'outcome_notes'])),
    outcomeRecordedAt: firstValue(source, ['outcomeRecordedAt', 'outcome_recorded_at']),
    startedAt: firstValue(source, ['startedAt', 'started_at']),
    connectedAt: firstValue(source, ['connectedAt', 'connected_at']),
    endedAt: firstValue(source, ['endedAt', 'ended_at']),
    createdAt: firstValue(source, ['createdAt', 'created_at']),
    updatedAt: firstValue(source, ['updatedAt', 'updated_at']),
    signup: firstValue(source, ['signup', 'invitation', 'signupInvitation', 'signup_invitation'], null)
  };
}

export function normalizeFollowup(source = {}) {
  return {
    raw: source,
    id: normalizeText(firstValue(source, ['id', 'jobId', 'job_id', 'salesFollowupJobId', 'sales_followup_job_id'])),
    salesCallId: normalizeText(firstValue(source, ['salesCallId', 'sales_call_id'])),
    outcome: normalizeStatus(firstValue(source, ['outcome'])),
    status: normalizeStatus(firstValue(source, ['status'])) || 'queued',
    attempts: Number(firstValue(source, ['attempts'], 0)) || 0,
    maxAttempts: Number(firstValue(source, ['maxAttempts', 'max_attempts'], 0)) || 0,
    availableAt: firstValue(source, ['availableAt', 'available_at']),
    completedAt: firstValue(source, ['completedAt', 'completed_at']),
    lastErrorCode: normalizeText(firstValue(source, ['lastErrorCode', 'last_error_code'])),
    lastErrorMessage: normalizeText(firstValue(source, ['lastErrorMessage', 'last_error_message'])),
    createdAt: firstValue(source, ['createdAt', 'created_at']),
    updatedAt: firstValue(source, ['updatedAt', 'updated_at'])
  };
}

export function normalizeWebrtc(payload = {}) {
  const source = firstValue(payload, ['webrtc', 'operatorWebrtc', 'operator_webrtc'], payload) || {};
  const callOptions = firstValue(source, ['callOptions', 'call_options'], {});
  return {
    token: normalizeText(firstValue(source, ['token', 'jwt', 'webrtcToken', 'webrtc_token', 'loginToken', 'login_token'])),
    expiresAt: firstValue(source, ['expiresAt', 'expires_at']),
    callOptions: callOptions && typeof callOptions === 'object' && !Array.isArray(callOptions) ? callOptions : {}
  };
}

export function normalizeInvitation(payload = {}) {
  const source = firstValue(payload, ['invitation', 'signupInvitation', 'signup_invitation'], payload) || {};
  const sentAt = firstValue(source, ['sentAt', 'sent_at']);
  return {
    raw: source,
    id: normalizeText(firstValue(source, ['id', 'invitationId', 'invitation_id'])),
    status: normalizeStatus(firstValue(source, ['status', 'progressStatus', 'progress_status'])) || 'pending',
    deliveryStatus: normalizeStatus(firstValue(source, ['deliveryStatus', 'delivery_status'])) || (sentAt ? 'sent' : 'pending'),
    expiresAt: firstValue(source, ['expiresAt', 'expires_at']),
    sentAt,
    openedAt: firstValue(source, ['openedAt', 'opened_at']),
    submittedAt: firstValue(source, ['submittedAt', 'submitted_at']),
    provisioningStatus: normalizeStatus(firstValue(source, ['provisioningStatus', 'provisioning_status'])),
    provisioningStatusDetail: normalizeText(firstValue(source, ['provisioningStatusDetail', 'provisioning_status_detail'])),
    provisioningErrorCode: normalizeText(firstValue(source, ['provisioningErrorCode', 'provisioning_error_code'])),
    provisioningErrorMessage: normalizeText(firstValue(source, ['provisioningErrorMessage', 'provisioning_error_message'])),
    accountStatus: normalizeStatus(firstValue(source, ['accountStatus', 'account_status'])),
    attentionRequired: normalizeBoolean(firstValue(source, ['attentionRequired', 'attention_required'])),
    provisionedNumber: normalizeText(firstValue(source, ['provisionedNumber', 'provisioned_number'])),
    convertedTenantKey: normalizeText(firstValue(source, ['convertedTenantKey', 'converted_tenant_key']))
  };
}

export function normalizeImportResult(payload = {}) {
  const source = firstValue(payload, ['import'], payload) || {};
  const importedDetails = Array.isArray(source.imported) ? source.imported : [];
  const legacyImportedCount = typeof source.imported === 'number'
    ? source.imported
    : importedDetails.length;
  return {
    imported: Number(firstValue(source, ['importedCount', 'imported_count'], legacyImportedCount)) || 0,
    inserted: Number(firstValue(source, ['insertedCount', 'inserted_count'], 0)) || 0,
    updated: Number(firstValue(source, ['updatedCount', 'updated_count'], 0)) || 0,
    skipped: Number(firstValue(source, [
      'skipped',
      'skippedCount',
      'skipped_count',
      'rejectedCount',
      'rejected_count'
    ], 0)) || 0,
    errors: Array.isArray(source.errors) ? source.errors : [],
    importedDetails,
    prospects: Array.isArray(source.prospects) ? source.prospects.map(normalizeProspect) : []
  };
}

export function isDemoReady(prospect) {
  return ['ready', 'demo_ready', 'ready_to_call'].includes(normalizeStatus(prospect?.demoStatus));
}

export function displayStatus(value) {
  const normalized = normalizeStatus(value);
  if (!normalized) return 'Unknown';
  return normalized
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export { normalizeBoolean, normalizeStatus };
