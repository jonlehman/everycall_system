import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import {
  INTERNAL_AUTH_PURPOSES,
  getInternalServiceToken
} from "@everycall/contracts/internalAuth";
import {
  createSalesCallGateway,
  gatewaySalesCallingWindowAllows
} from "../apps/sales-call-gateway/dist/apps/sales-call-gateway/src/gateway.js";
import {
  buildSalesDemoGreeting
} from "../apps/sales-call-gateway/dist/apps/sales-call-gateway/src/salesXAIRealtime.js";
import {
  decodeSalesClientState,
  encodeSalesClientState
} from "../apps/sales-call-gateway/dist/apps/sales-call-gateway/src/salesCallProviderUtils.js";

function baseCall(id, overrides = {}) {
  const call = {
    salesCallId: id,
    prospectId: `prospect-${id}`,
    adminUserId: 7,
    state: "connecting_browser",
    aiState: "not_started",
    conferenceId: null,
    conferenceName: null,
    operatorCallControlId: null,
    operatorLegId: null,
    operatorSessionId: null,
    prospectCallControlId: null,
    prospectLegId: null,
    prospectSessionId: null,
    aiTelnyxCallControlId: null,
    aiTelnyxLegId: null,
    aiTelnyxSessionId: null,
    xaiCallId: null,
    providerErrorCode: null,
    providerErrorMessage: null,
    outcome: null,
    startedAt: null,
    connectedAt: null,
    demoStartedAt: null,
    demoEndedAt: null,
    endedAt: null,
    metadata: {
      correlation_id: id,
      business_name: "Acme Appliance Repair",
      prospect_number: "+15551234567",
      realtime_instructions: "STORED DEMO INSTRUCTIONS"
    },
    businessName: "Acme Appliance Repair",
    prospectNumber: "+15551234567",
    permissionGranted: true,
    suppressed: false,
    doNotCall: false,
    prospectStatus: "queued",
    prospectTimezone: "UTC",
    demoProfileId: `demo-${id}`,
    demoStatus: "ready",
    demoExpiresAt: "2099-01-01T00:00:00.000Z",
    demoBusinessName: "Acme Appliance Repair",
    demoBundle: { summary: "Repairs household appliances." },
    ...overrides
  };
  call.metadata = {
    correlation_id: id,
    business_name: "Acme Appliance Repair",
    prospect_number: "+15551234567",
    realtime_instructions: "STORED DEMO INSTRUCTIONS",
    ...(overrides.metadata || {})
  };
  return call;
}

assert.equal(gatewaySalesCallingWindowAllows({
  timezone: "America/Los_Angeles",
  now: new Date("2026-07-28T18:00:00.000Z"),
  env: {
    SALES_CALL_WINDOW_START_LOCAL: "08:00",
    SALES_CALL_WINDOW_END_LOCAL: "20:00"
  }
}), true);
assert.equal(gatewaySalesCallingWindowAllows({
  timezone: "America/Los_Angeles",
  now: new Date("2026-07-28T06:00:00.000Z"),
  env: {
    SALES_CALL_WINDOW_START_LOCAL: "08:00",
    SALES_CALL_WINDOW_END_LOCAL: "20:00"
  }
}), false);

const PATCH_MAP = {
  ai_state: "aiState",
  conference_id: "conferenceId",
  conference_name: "conferenceName",
  operator_call_control_id: "operatorCallControlId",
  operator_leg_id: "operatorLegId",
  operator_session_id: "operatorSessionId",
  prospect_call_control_id: "prospectCallControlId",
  prospect_leg_id: "prospectLegId",
  prospect_session_id: "prospectSessionId",
  ai_telnyx_call_control_id: "aiTelnyxCallControlId",
  ai_telnyx_leg_id: "aiTelnyxLegId",
  ai_telnyx_session_id: "aiTelnyxSessionId",
  xai_call_id: "xaiCallId",
  provider_error_code: "providerErrorCode",
  provider_error_message: "providerErrorMessage",
  started_at: "startedAt",
  connected_at: "connectedAt",
  demo_started_at: "demoStartedAt",
  demo_ended_at: "demoEndedAt",
  ended_at: "endedAt",
  metadata_json: "metadata"
};

function createMemoryRepository(initialCalls) {
  const calls = new Map(initialCalls.map((call) => [call.salesCallId, structuredClone(call)]));
  const events = new Map();
  function applyPatch(call, patch) {
    for (const [key, value] of Object.entries(patch || {})) {
      const target = PATCH_MAP[key] || key;
      if (target === "metadata") {
        call.metadata = { ...call.metadata, ...(value || {}) };
      } else {
        call[target] = value;
      }
    }
    return call;
  }
  return {
    calls,
    events,
    async getCallContext(id) {
      return calls.get(String(id)) || null;
    },
    async patchCall(id, patch) {
      const call = calls.get(String(id));
      if (!call) throw new Error("sales_call_not_found");
      return applyPatch(call, patch);
    },
    async claimTransition(id, { allowedStates, allowedAiStates, patch }) {
      const call = calls.get(String(id));
      if (!call) return { claimed: false, call: null };
      if (allowedStates?.length && !allowedStates.includes(call.state)) {
        return { claimed: false, call };
      }
      if (allowedAiStates?.length && !allowedAiStates.includes(call.aiState)) {
        return { claimed: false, call };
      }
      return { claimed: true, call: applyPatch(call, patch) };
    },
    async claimEvent({
      salesCallId,
      provider,
      eventId,
      type,
      payload,
      occurredAt,
      claimToken,
      staleAfterSeconds = 120
    }) {
      const key = `${provider}:${eventId}`;
      const current = events.get(key);
      if (!current) {
        events.set(key, {
          salesCallId,
          provider,
          eventId,
          type,
          payload,
          occurredAt,
          status: "processing",
          processingAttempts: 1,
          claimToken,
          processingStartedAt: Date.now()
        });
        return { claimed: true, status: "processing", processingAttempts: 1 };
      }
      if (current.status === "processed") {
        return {
          claimed: false,
          status: "processed",
          processingAttempts: current.processingAttempts
        };
      }
      const stale = current.status !== "processing"
        || Date.now() - current.processingStartedAt >= staleAfterSeconds * 1000;
      if (!stale) {
        return {
          claimed: false,
          status: current.status,
          processingAttempts: current.processingAttempts
        };
      }
      current.status = "processing";
      current.processingAttempts += 1;
      current.claimToken = claimToken;
      current.processingStartedAt = Date.now();
      return {
        claimed: true,
        status: "processing",
        processingAttempts: current.processingAttempts
      };
    },
    async completeEvent(provider, eventId, claimToken) {
      const current = events.get(`${provider}:${eventId}`);
      if (!current || current.claimToken !== claimToken) return false;
      current.status = "processed";
      current.claimToken = null;
      return true;
    },
    async failEvent(provider, eventId, claimToken, errorCode, errorMessage) {
      const current = events.get(`${provider}:${eventId}`);
      if (!current || current.claimToken !== claimToken) return false;
      current.status = "failed";
      current.claimToken = null;
      current.errorCode = errorCode;
      current.errorMessage = errorMessage;
      return true;
    },
    async findCallIdByProviderRefs(payload) {
      const values = [
        payload.call_control_id,
        payload.call_leg_id,
        payload.call_session_id,
        payload.conference_id,
        payload.call_id,
        payload.xai_call_id
      ].filter(Boolean);
      for (const call of calls.values()) {
        const refs = [
          call.operatorCallControlId,
          call.operatorLegId,
          call.operatorSessionId,
          call.prospectCallControlId,
          call.prospectLegId,
          call.prospectSessionId,
          call.aiTelnyxCallControlId,
          call.aiTelnyxLegId,
          call.aiTelnyxSessionId,
          call.conferenceId,
          call.xaiCallId
        ];
        if (values.some((value) => refs.includes(value))) return call.salesCallId;
      }
      return null;
    },
    async listRecoverableCalls() {
      return [...calls.values()].filter((call) => (
        call.state === "preparing_call"
        || (
          call.aiState === "dialing_standby"
          && (
            !call.conferenceId
            || !call.prospectCallControlId
            || !call.aiTelnyxCallControlId
          )
        )
        || (
          call.xaiCallId
          && [
            "sip_connected",
            "accepting",
            "accepting_sip_connected",
            "realtime_ready_waiting_sip",
            "ready",
            "joining",
            "live",
            "pausing",
            "paused"
          ].includes(call.aiState)
        )
        || ["ending_demo", "ending"].includes(call.state)
      ) && !["closed", "ended", "completed", "failed"].includes(call.state));
    },
    async listRecoverableEvents() {
      return [...events.values()]
        .filter((event) => event.status !== "processed")
        .map((event) => ({
          salesCallId: event.salesCallId,
          provider: event.provider,
          eventId: event.eventId,
          type: event.type,
          payload: event.payload,
          occurredAt: event.occurredAt,
          processingAttempts: event.processingAttempts
        }));
    }
  };
}

function createController(callId, events, callbacks = {}) {
  return {
    callId,
    isOpen: true,
    startDemo({ businessName }) {
      const greeting = buildSalesDemoGreeting(businessName);
      events.push(`xai:greeting:${greeting}`);
      return { greeting };
    },
    pause() {
      events.push("xai:response.cancel");
      events.push("xai:output_audio_buffer.clear");
      return { type: "paused" };
    },
    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      callbacks.onClose?.();
    }
  };
}

const providerEvents = [];
const dialWaiters = new Map();
const providerFailureCounts = new Map();
function failProviderTimes(key, count) {
  providerFailureCounts.set(key, count);
}
function consumeProviderFailure(key) {
  const remaining = providerFailureCounts.get(key) || 0;
  if (remaining <= 0) return false;
  providerFailureCounts.set(key, remaining - 1);
  return true;
}
const telnyx = {
  async createConference({ anchorCallControlId, name }) {
    providerEvents.push(`telnyx:create_conference:${anchorCallControlId}`);
    return { conference_id: `conf-${name}`, conference_name: name };
  },
  async dialProspect({ clientState }) {
    const state = decodeSalesClientState(clientState);
    providerEvents.push(`telnyx:dial_prospect:${state.sales_call_id}`);
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    dialWaiters.set(state.sales_call_id, release);
    await waiting;
    return {
      call: {
        call_control_id: `prospect-control-${state.sales_call_id}`,
        call_leg_id: `prospect-leg-${state.sales_call_id}`,
        call_session_id: `prospect-session-${state.sales_call_id}`
      }
    };
  },
  async dialXAISipStandby({ clientState }) {
    const state = decodeSalesClientState(clientState);
    providerEvents.push(`telnyx:dial_ai:${state.sales_call_id}`);
    assert.ok(
      dialWaiters.has(state.sales_call_id),
      "Prospect and AI dials must be launched concurrently."
    );
    dialWaiters.get(state.sales_call_id)();
    dialWaiters.delete(state.sales_call_id);
    return {
      call: {
        call_control_id: `ai-control-${state.sales_call_id}`,
        call_leg_id: `ai-leg-${state.sales_call_id}`,
        call_session_id: `ai-session-${state.sales_call_id}`
      }
    };
  },
  async joinConference({ callControlId }) {
    providerEvents.push(`telnyx:join_ai:${callControlId}`);
    if (callControlId === "ai-fail") throw new Error("join failed");
    return { data: { result: "ok" } };
  },
  async waitForConferenceParticipant({ callControlId }) {
    providerEvents.push(`telnyx:join_confirmed:${callControlId}`);
    return { call_control_id: callControlId, status: "joined" };
  },
  async leaveConference({ callControlId }) {
    providerEvents.push(`telnyx:leave_ai:${callControlId}`);
    return { data: { result: "ok" } };
  },
  async hangupCall({ callControlId }) {
    providerEvents.push(`telnyx:hangup:${callControlId}`);
    if (consumeProviderFailure(`hangup:${callControlId}`)) {
      throw new Error(`hangup failed for ${callControlId}`);
    }
    return { data: { result: "ok" } };
  },
  async endConference({ conferenceId }) {
    providerEvents.push(`telnyx:end_conference:${conferenceId}`);
    if (consumeProviderFailure(`end_conference:${conferenceId}`)) {
      throw new Error(`conference end failed for ${conferenceId}`);
    }
    return { data: { result: "ok" } };
  }
};

const xai = {
  controllers: new Map(),
  buildSipUri() {
    return "sip:proj_sales@sip.api.xai.com;transport=tls";
  },
  async acceptIncomingCall({ callId, session }) {
    providerEvents.push(`xai:accept:${callId}`);
    assert.equal(session.instructions, "STORED DEMO INSTRUCTIONS");
    return { ai_state: "accepted" };
  },
  async connectMonitor({ callId, ...callbacks }) {
    providerEvents.push(`xai:monitor:${callId}`);
    if (consumeProviderFailure(`monitor:${callId}`)) {
      throw new Error(`monitor connect failed for ${callId}`);
    }
    assert.notEqual(
      repository.calls.get(callbacks.correlationId)?.aiState,
      "ready",
      "The durable AI state must not become ready before the monitor is open."
    );
    const controller = createController(callId, providerEvents, callbacks);
    this.controllers.set(callId, controller);
    return controller;
  },
  async hangupCall({ callId }) {
    providerEvents.push(`xai:hangup:${callId}`);
    return { ai_state: "ended" };
  }
};

const callOne = baseCall("sales-call-1");
const callTwo = baseCall("sales-call-2");
const unparkedCall = baseCall("sales-call-unparked");
const runtimeFailureCall = baseCall("sales-call-runtime-failure", {
  state: "prospect_connected",
  aiState: "sip_connected",
  conferenceId: "conf-runtime-failure",
  operatorCallControlId: "operator-runtime-failure",
  prospectCallControlId: "prospect-runtime-failure",
  aiTelnyxCallControlId: "ai-runtime-failure",
  metadata: { sip_correlation_nonce: "runtime-failure-nonce" },
  connectedAt: "2026-07-28T12:00:00.000Z"
});
const failedStart = baseCall("sales-call-failed-start", {
  state: "prospect_connected",
  aiState: "ready",
  conferenceId: "conf-failed-start",
  operatorCallControlId: "operator-fail",
  prospectCallControlId: "prospect-fail",
  aiTelnyxCallControlId: "ai-fail",
  xaiCallId: "rtc-fail",
  connectedAt: "2026-07-28T12:00:00.000Z"
});
const eventRecoveryCall = baseCall("sales-call-event-recovery", {
  state: "dialing_prospect",
  aiState: "dialing_standby",
  conferenceId: "conf-event-recovery",
  operatorCallControlId: "operator-event-recovery",
  prospectCallControlId: "prospect-event-recovery",
  aiTelnyxCallControlId: "ai-event-recovery"
});
const realtimeRecoveryCall = baseCall("sales-call-realtime-recovery", {
  state: "prospect_connected",
  aiState: "realtime_ready_waiting_sip",
  conferenceId: "conf-realtime-recovery",
  operatorCallControlId: "operator-realtime-recovery",
  prospectCallControlId: "prospect-realtime-recovery",
  aiTelnyxCallControlId: "ai-realtime-recovery",
  xaiCallId: "rtc-realtime-recovery",
  connectedAt: "2026-07-28T12:00:00.000Z",
  metadata: { sip_correlation_nonce: "realtime-recovery-nonce" }
});
const durationCall = baseCall("sales-call-duration", {
  state: "prospect_connected",
  aiState: "ready",
  conferenceId: "conf-duration",
  operatorCallControlId: "operator-duration",
  prospectCallControlId: "prospect-duration",
  aiTelnyxCallControlId: "ai-duration",
  xaiCallId: "rtc-duration",
  connectedAt: "2026-07-28T12:00:00.000Z"
});
const partialTeardownCall = baseCall("sales-call-partial-teardown", {
  state: "prospect_connected",
  aiState: "ended",
  conferenceId: "conf-partial-teardown",
  operatorCallControlId: "operator-partial-teardown",
  prospectCallControlId: "prospect-partial-teardown",
  connectedAt: "2026-07-28T12:00:00.000Z"
});
const lateAiTeardownCall = baseCall("sales-call-late-ai-teardown", {
  state: "prospect_connected",
  aiState: "ended",
  conferenceId: "conf-late-ai-teardown",
  operatorCallControlId: "operator-late-ai-teardown",
  prospectCallControlId: "prospect-late-ai-teardown",
  connectedAt: "2026-07-28T12:00:00.000Z"
});
const preOperatorEndCall = baseCall("sales-call-pre-operator-end");
const repository = createMemoryRepository([
  callOne,
  callTwo,
  unparkedCall,
  runtimeFailureCall,
  failedStart,
  eventRecoveryCall,
  realtimeRecoveryCall,
  durationCall,
  partialTeardownCall,
  lateAiTeardownCall,
  preOperatorEndCall
]);
const internalSecret = "gateway-validation-secret";
const internalEnv = { INTERNAL_SERVICE_SECRET: internalSecret };
const internalToken = getInternalServiceToken(
  internalEnv,
  INTERNAL_AUTH_PURPOSES.salesCallControl
);
const { publicKey: telnyxPublicKey, privateKey: telnyxPrivateKey } =
  crypto.generateKeyPairSync("ed25519");
const xaiSecretBytes = Buffer.from("xai-sales-webhook-secret", "utf8");
const xaiWebhookSecret = `whsec_${xaiSecretBytes.toString("base64")}`;

const demoTimeouts = [];
const gateway = createSalesCallGateway({
  repository,
  telnyx,
  xai,
  internalAuthEnv: internalEnv,
  telnyxPublicKey: telnyxPublicKey.export({ type: "spki", format: "pem" }),
  telnyxOperatorConnectionId: "sales-operator-credential-connection",
  xaiWebhookSecret,
  now: () => new Date("2026-07-28T12:00:00.000Z"),
  aiDemoMaxSeconds: 120,
  setTimeoutImpl(callback, delayMs) {
    const timer = { callback, delayMs, canceled: false };
    demoTimeouts.push(timer);
    return timer;
  },
  clearTimeoutImpl(timer) {
    timer.canceled = true;
  }
});
gateway.realtimeRegistry.set(
  failedStart.salesCallId,
  createController("rtc-fail", providerEvents)
);
gateway.realtimeRegistry.set(
  durationCall.salesCallId,
  createController("rtc-duration", providerEvents)
);

const server = http.createServer(gateway.app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

function telnyxHeaders(body, valid = true) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.sign(
    null,
    Buffer.from(`${timestamp}|${body}`, "utf8"),
    telnyxPrivateKey
  ).toString("base64");
  return {
    "Content-Type": "application/json",
    "telnyx-timestamp": timestamp,
    "telnyx-signature-ed25519": valid ? signature : "invalid"
  };
}

function xaiHeaders(body, valid = true) {
  const webhookId = `wh_${crypto.randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac("sha256", xaiSecretBytes)
    .update(`${webhookId}.${timestamp}.${body}`, "utf8")
    .digest("base64");
  return {
    "Content-Type": "application/json",
    "webhook-id": webhookId,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${valid ? signature : "invalid"}`
  };
}

async function postTelnyx(event, valid = true) {
  const body = JSON.stringify(event);
  return fetch(`${baseUrl}/webhooks/telnyx`, {
    method: "POST",
    headers: telnyxHeaders(body, valid),
    body
  });
}

async function postXAI(event, valid = true) {
  const body = JSON.stringify(event);
  return fetch(`${baseUrl}/webhooks/xai`, {
    method: "POST",
    headers: xaiHeaders(body, valid),
    body
  });
}

async function action(callId, name) {
  return fetch(`${baseUrl}/internal/calls/${encodeURIComponent(callId)}/actions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${internalToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action: name })
  });
}

try {
  const unauthorizedHealth = await fetch(`${baseUrl}/internal/health`);
  assert.equal(unauthorizedHealth.status, 401);
  const health = await fetch(`${baseUrl}/internal/health`, {
    headers: { Authorization: `Bearer ${internalToken}` }
  });
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.runtime.mode, "single_instance");
  assert.match(healthBody.runtime.limitation, /process-local/);
  assert.equal(healthBody.runtime.ai_demo_max_seconds, 120);

  const abandonedProspectEvent = {
    data: {
      id: "telnyx-abandoned-prospect-event",
      event_type: "call.answered",
      payload: {
        client_state: encodeSalesClientState({
          salesCallId: "sales-call-event-recovery",
          correlationId: "sales-call-event-recovery",
          role: "prospect"
        }),
        call_control_id: "prospect-event-recovery"
      }
    }
  };
  repository.events.set("telnyx:telnyx-abandoned-prospect-event", {
    salesCallId: "sales-call-event-recovery",
    provider: "telnyx",
    eventId: "telnyx-abandoned-prospect-event",
    type: "call.answered",
    payload: abandonedProspectEvent,
    occurredAt: "2026-07-28T12:00:00.000Z",
    status: "processing",
    processingAttempts: 1,
    claimToken: "abandoned-token",
    processingStartedAt: Date.now() - 130_000
  });
  const recoveredEvents = await gateway.recoverProviderEvents();
  assert.equal(recoveredEvents.recovered, 1);
  assert.equal(
    repository.calls.get("sales-call-event-recovery").state,
    "prospect_connected"
  );
  assert.equal(
    repository.events.get("telnyx:telnyx-abandoned-prospect-event").status,
    "processed"
  );

  const abandonedAiAnsweredEvent = {
    data: {
      id: "telnyx-abandoned-ai-answered",
      event_type: "call.answered",
      payload: {
        client_state: encodeSalesClientState({
          salesCallId: "sales-call-realtime-recovery",
          correlationId: "sales-call-realtime-recovery",
          role: "ai",
          nonce: "realtime-recovery-nonce"
        }),
        call_control_id: "ai-realtime-recovery"
      }
    }
  };
  repository.events.set("telnyx:telnyx-abandoned-ai-answered", {
    salesCallId: "sales-call-realtime-recovery",
    provider: "telnyx",
    eventId: "telnyx-abandoned-ai-answered",
    type: "call.answered",
    payload: abandonedAiAnsweredEvent,
    occurredAt: "2026-07-28T12:00:00.000Z",
    status: "processing",
    processingAttempts: 1,
    claimToken: "abandoned-ai-token",
    processingStartedAt: Date.now() - 130_000
  });
  assert.equal((await gateway.recoverProviderEvents()).recovered, 1);
  assert.equal(
    repository.calls.get("sales-call-realtime-recovery").aiState,
    "sip_connected"
  );
  const realtimeRecovery = await gateway.recoverRealtimeSessions();
  assert.ok(realtimeRecovery.recovered >= 1);
  assert.equal(
    repository.calls.get("sales-call-realtime-recovery").aiState,
    "ready"
  );
  assert.equal(
    gateway.realtimeRegistry.get("sales-call-realtime-recovery").isOpen,
    true
  );

  const invalidOperator = {
    data: {
      id: "telnyx-invalid-signature",
      event_type: "call.initiated",
      payload: {
        call_control_id: "operator-invalid",
        custom_headers: [{
          name: "X-EveryCall-Sales-Call-Id",
          value: "sales-call-1"
        }]
      }
    }
  };
  assert.equal((await postTelnyx(invalidOperator, false)).status, 401);
  assert.equal(
    repository.events.has("telnyx:telnyx-invalid-signature"),
    false
  );

  function operatorEvent(callId, eventId) {
    return {
      data: {
        id: eventId,
        event_type: "call.initiated",
        occurred_at: "2026-07-28T12:00:00.000Z",
        payload: {
          call_control_id: `operator-control-${callId}`,
          connection_id: "sales-operator-credential-connection",
          call_leg_id: `operator-leg-${callId}`,
          call_session_id: `operator-session-${callId}`,
          state: "parked",
          custom_headers: [
            { name: "X-EveryCall-Sales-Call-Id", value: callId },
            { name: "X-EveryCall-Call-Role", value: "operator" }
          ]
        }
      }
    };
  }

  assert.equal(
    (await action("sales-call-pre-operator-end", "end_call")).status,
    200
  );
  assert.equal(
    repository.calls.get("sales-call-pre-operator-end").state,
    "closed"
  );
  const lateParkedOperator = operatorEvent(
    "sales-call-pre-operator-end",
    "telnyx-late-parked-operator"
  );
  assert.equal((await postTelnyx(lateParkedOperator)).status, 200);
  assert.ok(providerEvents.includes(
    "telnyx:hangup:operator-control-sales-call-pre-operator-end"
  ));

  const lateProspectEvent = {
    data: {
      id: "telnyx-late-terminal-prospect",
      event_type: "call.answered",
      payload: {
        client_state: encodeSalesClientState({
          salesCallId: "sales-call-pre-operator-end",
          correlationId: "sales-call-pre-operator-end",
          role: "prospect"
        }),
        call_control_id: "prospect-late-terminal"
      }
    }
  };
  assert.equal((await postTelnyx(lateProspectEvent)).status, 200);
  assert.ok(providerEvents.includes(
    "telnyx:hangup:prospect-late-terminal"
  ));
  assert.equal(
    repository.calls.get("sales-call-pre-operator-end").state,
    "closed"
  );

  const lateConferenceEvent = {
    data: {
      id: "telnyx-late-terminal-conference",
      event_type: "conference.created",
      payload: {
        client_state: encodeSalesClientState({
          salesCallId: "sales-call-pre-operator-end",
          correlationId: "sales-call-pre-operator-end",
          role: "operator"
        }),
        conference_id: "conference-late-terminal"
      }
    }
  };
  assert.equal((await postTelnyx(lateConferenceEvent)).status, 200);
  assert.ok(providerEvents.includes(
    "telnyx:end_conference:conference-late-terminal"
  ));

  const lateAiEvent = {
    data: {
      id: "telnyx-late-intentional-ai-teardown",
      event_type: "call.answered",
      payload: {
        client_state: encodeSalesClientState({
          salesCallId: "sales-call-late-ai-teardown",
          correlationId: "sales-call-late-ai-teardown",
          role: "ai"
        }),
        call_control_id: "ai-late-intentional-teardown"
      }
    }
  };
  assert.equal((await postTelnyx(lateAiEvent)).status, 200);
  assert.ok(providerEvents.includes(
    "telnyx:hangup:ai-late-intentional-teardown"
  ));
  assert.equal(
    repository.calls.get("sales-call-late-ai-teardown").state,
    "prospect_connected"
  );

  const unparkedEvent = operatorEvent(
    "sales-call-unparked",
    "telnyx-operator-unparked"
  );
  unparkedEvent.data.payload.state = "ringing";
  const conferenceCountBeforeUnparked = providerEvents.filter((event) =>
    event.startsWith("telnyx:create_conference:")
  ).length;
  assert.equal((await postTelnyx(unparkedEvent)).status, 200);
  assert.equal(repository.calls.get("sales-call-unparked").state, "failed");
  assert.equal(
    repository.calls.get("sales-call-unparked").providerErrorCode,
    "operator_leg_not_parked"
  );
  assert.equal(
    providerEvents.filter((event) =>
      event.startsWith("telnyx:create_conference:")
    ).length,
    conferenceCountBeforeUnparked
  );
  assert.ok(providerEvents.includes(
    "telnyx:hangup:operator-control-sales-call-unparked"
  ));

  const uncorrelatedOperator = operatorEvent(
    "sales-call-does-not-exist",
    "telnyx-operator-uncorrelated"
  );
  uncorrelatedOperator.data.payload.call_control_id = "operator-uncorrelated";
  const uncorrelatedOperatorResponse = await postTelnyx(uncorrelatedOperator);
  assert.equal(uncorrelatedOperatorResponse.status, 202);
  assert.ok(providerEvents.includes("telnyx:hangup:operator-uncorrelated"));

  const firstOperatorEvent = operatorEvent("sales-call-1", "telnyx-operator-1");
  assert.equal((await postTelnyx(firstOperatorEvent)).status, 200);
  assert.equal(repository.calls.get("sales-call-1").state, "dialing_prospect");
  assert.equal(
    repository.calls.get("sales-call-1").operatorCallControlId,
    "operator-control-sales-call-1"
  );
  assert.equal(
    repository.calls.get("sales-call-1").aiTelnyxCallControlId,
    "ai-control-sales-call-1"
  );
  const conferenceCreates = providerEvents.filter((event) =>
    event.startsWith("telnyx:create_conference:")
  ).length;
  const duplicate = await postTelnyx(firstOperatorEvent);
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(
    providerEvents.filter((event) => event.startsWith("telnyx:create_conference:")).length,
    conferenceCreates
  );
  const extraOperatorEvent = operatorEvent(
    "sales-call-1",
    "telnyx-extra-operator-1"
  );
  extraOperatorEvent.data.payload.call_control_id = "operator-control-extra";
  assert.equal((await postTelnyx(extraOperatorEvent)).status, 200);
  assert.ok(providerEvents.includes("telnyx:hangup:operator-control-extra"));
  assert.equal(
    repository.calls.get("sales-call-1").operatorCallControlId,
    "operator-control-sales-call-1"
  );
  assert.equal(
    providerEvents.filter((event) => event.startsWith("telnyx:create_conference:")).length,
    conferenceCreates
  );

  const prospectState = encodeSalesClientState({
    salesCallId: "sales-call-1",
    correlationId: "sales-call-1",
    role: "prospect"
  });
  assert.equal((await postTelnyx({
    data: {
      id: "telnyx-prospect-answered-1",
      event_type: "call.answered",
      payload: {
        client_state: prospectState,
        call_control_id: "prospect-control-sales-call-1"
      }
    }
  })).status, 200);
  assert.equal(repository.calls.get("sales-call-1").state, "prospect_connected");

  const aiCorrelation = encodeSalesClientState({
    salesCallId: "sales-call-1",
    correlationId: "sales-call-1",
    role: "ai",
    nonce: repository.calls.get("sales-call-1").metadata.sip_correlation_nonce
  });
  const conferenceOwnerState = encodeSalesClientState({
    salesCallId: "sales-call-1",
    correlationId: "sales-call-1",
    role: "operator"
  });
  assert.equal((await postTelnyx({
    data: {
      id: "telnyx-ai-conference-joined-1",
      event_type: "conference.participant.joined",
      payload: {
        client_state: conferenceOwnerState,
        conference_id: "conf-sales-sales-call-1",
        call_control_id: "ai-control-sales-call-1",
        call_leg_id: "ai-leg-sales-call-1",
        call_session_id: "ai-session-sales-call-1"
      }
    }
  })).status, 200);
  assert.equal(
    repository.calls.get("sales-call-1").operatorCallControlId,
    "operator-control-sales-call-1"
  );
  assert.equal(
    repository.calls.get("sales-call-1").aiTelnyxCallControlId,
    "ai-control-sales-call-1"
  );

  const incomingEvent = {
    object: "event",
    id: "xai-incoming-1",
    type: "realtime.call.incoming",
    created_at: Math.floor(Date.now() / 1000),
    data: {
      call_id: "rtc-sales-call-1",
      sip_headers: [{ name: "User-to-User", value: aiCorrelation }]
    }
  };
  const invalidNonceCorrelation = encodeSalesClientState({
    salesCallId: "sales-call-1",
    correlationId: "sales-call-1",
    role: "ai",
    nonce: "not-the-expected-nonce"
  });
  assert.equal((await postXAI({
    ...incomingEvent,
    id: "xai-invalid-correlation-1",
    data: {
      ...incomingEvent.data,
      call_id: "rtc-invalid-correlation",
      sip_headers: [{
        name: "User-to-User",
        value: invalidNonceCorrelation
      }]
    }
  })).status, 200);
  assert.ok(providerEvents.includes("xai:hangup:rtc-invalid-correlation"));
  assert.equal(repository.calls.get("sales-call-1").xaiCallId, null);

  const uncorrelatedXAI = {
    ...incomingEvent,
    id: "xai-uncorrelated",
    data: {
      ...incomingEvent.data,
      call_id: "rtc-uncorrelated",
      sip_headers: []
    }
  };
  assert.equal((await postXAI(uncorrelatedXAI)).status, 202);
  assert.ok(providerEvents.includes("xai:hangup:rtc-uncorrelated"));

  assert.equal((await postXAI(incomingEvent)).status, 200);
  assert.equal(
    repository.calls.get("sales-call-1").aiState,
    "realtime_ready_waiting_sip"
  );
  assert.equal(repository.calls.get("sales-call-1").xaiCallId, "rtc-sales-call-1");
  assert.deepEqual(
    providerEvents.filter((event) =>
      event === "xai:accept:rtc-sales-call-1"
      || event === "xai:monitor:rtc-sales-call-1"
    ),
    ["xai:accept:rtc-sales-call-1", "xai:monitor:rtc-sales-call-1"]
  );
  assert.equal((await postTelnyx({
    data: {
      id: "telnyx-ai-answered-1",
      event_type: "call.answered",
      payload: {
        client_state: aiCorrelation,
        call_control_id: "ai-control-sales-call-1"
      }
    }
  })).status, 200);
  assert.equal(repository.calls.get("sales-call-1").aiState, "ready");

  const started = await action("sales-call-1", "start_demo");
  assert.equal(started.status, 200);
  assert.equal(repository.calls.get("sales-call-1").state, "ai_live");
  assert.equal(repository.calls.get("sales-call-1").aiState, "live");
  const expectedGreeting =
    "xai:greeting:Thanks for calling Acme Appliance Repair. How can I help you?";
  const joinIndex = providerEvents.indexOf("telnyx:join_ai:ai-control-sales-call-1");
  const confirmationIndex = providerEvents.indexOf(
    "telnyx:join_confirmed:ai-control-sales-call-1"
  );
  const greetingIndex = providerEvents.indexOf(expectedGreeting);
  assert.ok(joinIndex >= 0 && joinIndex < confirmationIndex && confirmationIndex < greetingIndex);

  const replayedStart = await action("sales-call-1", "start_demo");
  assert.equal(replayedStart.status, 200);
  assert.equal((await replayedStart.json()).replayed, true);
  assert.equal(
    providerEvents.filter((event) =>
      event === "telnyx:join_ai:ai-control-sales-call-1"
    ).length,
    1
  );

  assert.equal((await action("sales-call-1", "pause_ai")).status, 200);
  assert.equal(repository.calls.get("sales-call-1").state, "ai_paused");
  assert.equal(repository.calls.get("sales-call-1").aiState, "paused");
  assert.ok(providerEvents.includes("xai:response.cancel"));
  assert.ok(providerEvents.includes("xai:output_audio_buffer.clear"));

  const beforeEndDemo = providerEvents.length;
  assert.equal((await action("sales-call-1", "end_demo")).status, 200);
  const endDemoEvents = providerEvents.slice(beforeEndDemo);
  assert.equal(repository.calls.get("sales-call-1").state, "demo_ended");
  assert.equal(repository.calls.get("sales-call-1").aiState, "ended");
  assert.ok(endDemoEvents.includes("telnyx:leave_ai:ai-control-sales-call-1"));
  assert.ok(endDemoEvents.includes("telnyx:hangup:ai-control-sales-call-1"));
  assert.equal(endDemoEvents.some((event) => event.startsWith("telnyx:end_conference:")), false);
  assert.equal(
    endDemoEvents.includes("telnyx:hangup:operator-control-sales-call-1"),
    false
  );
  assert.equal(
    endDemoEvents.includes("telnyx:hangup:prospect-control-sales-call-1"),
    false
  );

  const humanHangupsBeforeDuration = providerEvents.filter((event) => (
    event === "telnyx:hangup:operator-duration"
    || event === "telnyx:hangup:prospect-duration"
  )).length;
  assert.equal((await action("sales-call-duration", "start_demo")).status, 200);
  const durationTimer = demoTimeouts.find((timer) => (
    !timer.canceled && timer.delayMs === 120_000
  ));
  assert.ok(durationTimer, "Starting a demo must schedule its hard duration limit.");
  durationTimer.callback();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (repository.calls.get("sales-call-duration").state === "demo_ended") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(repository.calls.get("sales-call-duration").state, "demo_ended");
  assert.equal(repository.calls.get("sales-call-duration").aiState, "ended");
  assert.equal(
    repository.calls.get("sales-call-duration").metadata.demo_auto_end_reason,
    "duration_limit"
  );
  assert.equal(
    providerEvents.filter((event) => (
      event === "telnyx:hangup:operator-duration"
      || event === "telnyx:hangup:prospect-duration"
    )).length,
    humanHangupsBeforeDuration
  );

  failProviderTimes("end_conference:conf-partial-teardown", 1);
  failProviderTimes("hangup:prospect-partial-teardown", 1);
  const partialEnd = await action("sales-call-partial-teardown", "end_call");
  assert.equal(partialEnd.status, 202);
  assert.equal(
    repository.calls.get("sales-call-partial-teardown").state,
    "ending"
  );
  assert.ok(providerEvents.includes("telnyx:hangup:operator-partial-teardown"));
  assert.ok(providerEvents.includes("telnyx:hangup:prospect-partial-teardown"));
  const teardownRecovery = await gateway.recoverRealtimeSessions();
  assert.ok(teardownRecovery.recovered >= 1);
  assert.equal(
    repository.calls.get("sales-call-partial-teardown").state,
    "closed"
  );

  const recoveryTeardownFailureCall = baseCall(
    "sales-call-recovery-teardown-failure",
    {
      state: "prospect_connected",
      aiState: "ready",
      conferenceId: "conf-recovery-teardown-failure",
      operatorCallControlId: "operator-recovery-teardown-failure",
      prospectCallControlId: "prospect-recovery-teardown-failure",
      aiTelnyxCallControlId: "ai-recovery-teardown-failure",
      xaiCallId: "rtc-recovery-teardown-failure",
      connectedAt: "2026-07-28T12:00:00.000Z"
    }
  );
  repository.calls.set(
    recoveryTeardownFailureCall.salesCallId,
    recoveryTeardownFailureCall
  );
  failProviderTimes("monitor:rtc-recovery-teardown-failure", 1);
  failProviderTimes("hangup:ai-recovery-teardown-failure", 1);
  const failedRecovery = await gateway.recoverRealtimeSessions();
  assert.ok(failedRecovery.failed >= 1);
  assert.equal(
    repository.calls.get("sales-call-recovery-teardown-failure").state,
    "ending_demo"
  );
  assert.equal(
    repository.calls.get("sales-call-recovery-teardown-failure").aiState,
    "tearing_down"
  );
  await gateway.recoverRealtimeSessions();
  assert.equal(
    repository.calls.get("sales-call-recovery-teardown-failure").state,
    "prospect_connected"
  );
  assert.equal(
    repository.calls.get("sales-call-recovery-teardown-failure").aiState,
    "failed"
  );

  assert.equal((await postTelnyx(operatorEvent(
    "sales-call-2",
    "telnyx-operator-2"
  ))).status, 200);
  const prospectTwoState = encodeSalesClientState({
    salesCallId: "sales-call-2",
    correlationId: "sales-call-2",
    role: "prospect"
  });
  assert.equal((await postTelnyx({
    data: {
      id: "telnyx-prospect-no-answer-2",
      event_type: "call.hangup",
      payload: {
        client_state: prospectTwoState,
        call_control_id: "prospect-control-sales-call-2",
        hangup_cause: "no_answer"
      }
    }
  })).status, 200);
  assert.equal(repository.calls.get("sales-call-2").state, "closed");
  assert.equal(repository.calls.get("sales-call-2").outcome, "no_answer");
  assert.ok(providerEvents.includes(
    "telnyx:end_conference:conf-sales-sales-call-2"
  ));
  assert.ok(providerEvents.includes("telnyx:hangup:ai-control-sales-call-2"));

  const runtimeFailureCorrelation = encodeSalesClientState({
    salesCallId: "sales-call-runtime-failure",
    correlationId: "sales-call-runtime-failure",
    role: "ai",
    nonce: "runtime-failure-nonce"
  });
  assert.equal((await postXAI({
    object: "event",
    id: "xai-runtime-failure-incoming",
    type: "realtime.call.incoming",
    created_at: Math.floor(Date.now() / 1000),
    data: {
      call_id: "rtc-runtime-failure",
      sip_headers: [{
        name: "User-to-User",
        value: runtimeFailureCorrelation
      }]
    }
  })).status, 200);
  assert.equal(repository.calls.get("sales-call-runtime-failure").aiState, "ready");
  xai.controllers.get("rtc-runtime-failure").close();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (repository.calls.get("sales-call-runtime-failure").aiState === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(repository.calls.get("sales-call-runtime-failure").aiState, "failed");
  assert.equal(
    repository.calls.get("sales-call-runtime-failure").state,
    "prospect_connected"
  );
  assert.ok(providerEvents.includes("telnyx:hangup:ai-runtime-failure"));
  assert.ok(providerEvents.includes("xai:hangup:rtc-runtime-failure"));

  const failedAction = await action("sales-call-failed-start", "start_demo");
  assert.equal(failedAction.status, 502);
  assert.equal(repository.calls.get("sales-call-failed-start").state, "prospect_connected");
  assert.equal(repository.calls.get("sales-call-failed-start").aiState, "failed");
  assert.ok(repository.calls.get("sales-call-failed-start").providerErrorCode);

  assert.equal((await action("sales-call-1", "end_call")).status, 200);
  assert.equal(repository.calls.get("sales-call-1").state, "closed");
  assert.ok(providerEvents.includes(
    "telnyx:end_conference:conf-sales-sales-call-1"
  ));

  const invalidXAI = {
    ...incomingEvent,
    id: "xai-invalid-signature",
    data: { ...incomingEvent.data, call_id: "rtc-invalid" }
  };
  assert.equal((await postXAI(invalidXAI, false)).status, 401);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("Sales call gateway validation passed.");
