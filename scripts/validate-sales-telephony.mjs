import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  SalesCallOrchestrationError,
  SalesProviderError,
  decodeSalesClientState,
  deriveSalesCommandId,
  encodeSalesClientState
} from "../apps/sales-call-gateway/src/salesCallProviderUtils.js";
import {
  createSalesTelnyxClient,
  normalizeSalesTelnyxWebhookEvent,
  verifySalesTelnyxWebhook
} from "../apps/sales-call-gateway/src/salesTelnyxClient.js";
import {
  buildSalesDemoGreeting,
  buildSalesOpenAISipUri,
  buildSalesRealtimeAcceptPayload,
  createSalesOpenAIRealtimeClient,
  normalizeSalesOpenAIIncomingCallEvent,
  verifySalesOpenAIWebhook
} from "../apps/sales-call-gateway/src/salesOpenAIRealtime.js";
import {
  createInMemorySalesRealtimeRegistry,
  createSalesCallOrchestrator
} from "../apps/sales-call-gateway/src/salesCallOrchestrator.js";

function jsonResponse(status, value) {
  return new Response(value === null ? "" : JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function createQueuedFetch(steps) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const step = steps.shift();
    assert.ok(step, `Unexpected fetch call: ${url}`);
    const parsedBody = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: String(url), options, body: parsedBody });
    if (step.assert) step.assert({ url: String(url), options, body: parsedBody });
    if (step.error) throw step.error;
    return jsonResponse(step.status ?? 200, step.body ?? { data: { result: "ok" } });
  };
  return { fetchImpl, calls, remaining: () => steps.length };
}

async function validateProviderUtilities() {
  const first = deriveSalesCommandId({
    correlationId: "trace-1",
    operation: "dial",
    target: "+15551234567"
  });
  const second = deriveSalesCommandId({
    correlationId: "trace-1",
    operation: "dial",
    target: "+15551234567"
  });
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const state = encodeSalesClientState({
    salesCallId: "sales-call-1",
    correlationId: "trace-1",
    role: "ai"
  });
  assert.deepEqual(decodeSalesClientState(state), {
    sales_call_id: "sales-call-1",
    correlation_id: "trace-1",
    role: "ai"
  });
}

async function validateTelnyxAdapter() {
  const sleepDelays = [];
  const prospectCommandId = deriveSalesCommandId({
    correlationId: "trace-1",
    operation: "dial_prospect",
    target: "+15551234567"
  });
  const aiCommandId = deriveSalesCommandId({
    correlationId: "trace-1",
    operation: "dial_ai",
    target: "sip"
  });
  const conferenceCommandId = deriveSalesCommandId({
    correlationId: "trace-1",
    operation: "conference",
    target: "sales-call-1"
  });
  const answerCommandId = deriveSalesCommandId({
    correlationId: "trace-1",
    operation: "answer_operator",
    target: "operator-control"
  });
  const joinCommandId = deriveSalesCommandId({
    correlationId: "trace-1",
    operation: "join",
    target: "ai-control"
  });
  const queue = createQueuedFetch([
    {
      assert: ({ url, body }) => {
        assert.match(url, /\/calls\/operator-control\/actions\/answer$/);
        assert.equal(body.command_id, answerCommandId);
        assert.deepEqual(decodeSalesClientState(body.client_state), {
          sales_call_id: "sales-call-1",
          correlation_id: "trace-1",
          role: "operator"
        });
      }
    },
    {
      status: 503,
      body: { errors: [{ code: "temporarily_unavailable", detail: "retry" }] },
      assert: ({ body }) => assert.equal(body.command_id, conferenceCommandId)
    },
    {
      body: { data: { id: "conf-1", name: "sales-call-1" } },
      assert: ({ body }) => {
        assert.equal(body.command_id, conferenceCommandId);
        assert.equal(body.call_control_id, "operator-control");
        assert.equal(Object.hasOwn(body, "mute"), false);
      }
    },
    {
      body: {
        data: {
          call_control_id: "prospect-control",
          call_leg_id: "prospect-leg",
          call_session_id: "prospect-session"
        }
      },
      assert: ({ body }) => {
        assert.equal(body.command_id, prospectCommandId);
        assert.equal(body.connection_id, "sales-call-control-app");
        assert.deepEqual(body.conference_config, {
          conference_name: "sales-call-1",
          start_conference_on_enter: true
        });
        assert.equal(Object.hasOwn(body, "sip_headers"), false);
      }
    },
    {
      body: {
        data: {
          call_control_id: "ai-control",
          call_leg_id: "ai-leg",
          call_session_id: "ai-session"
        }
      },
      assert: ({ body }) => {
        assert.equal(body.command_id, aiCommandId);
        assert.equal(body.connection_id, "sales-call-control-app");
        assert.equal(body.to, "sip:proj_test@sip.api.openai.com;transport=tls");
        assert.equal(body.sip_transport_protocol, "TLS");
        assert.equal(body.send_silence_when_idle, true);
        assert.deepEqual(body.sip_headers, [{ name: "User-to-User", value: "encoded-uui" }]);
        assert.equal(Object.hasOwn(body, "conference_config"), false);
      }
    },
    {
      assert: ({ body }) => {
        assert.equal(body.call_control_id, "ai-control");
        assert.equal(body.command_id, joinCommandId);
        assert.equal(body.mute, false);
        assert.equal(body.hold, false);
        assert.equal(body.supervisor_role, "barge");
      }
    },
    {
      body: {
        data: [{
          call_control_id: "ai-control",
          status: "joined"
        }]
      }
    },
    {},
    {},
    {}
  ]);

  const client = createSalesTelnyxClient({
    apiKey: "telnyx-test-key",
    callControlApplicationId: "sales-call-control-app",
    callerId: "+15550001111",
    baseUrl: "https://telnyx.test/v2",
    fetchImpl: queue.fetchImpl,
    sleep: async (delayMs) => sleepDelays.push(delayMs)
  });

  await client.answerCall({
    callControlId: "operator-control",
    clientState: encodeSalesClientState({
      salesCallId: "sales-call-1",
      correlationId: "trace-1",
      role: "operator"
    }),
    commandId: answerCommandId
  });

  const conference = await client.createConference({
    anchorCallControlId: "operator-control",
    name: "sales-call-1",
    commandId: conferenceCommandId
  });
  assert.equal(conference.conference_id, "conf-1");
  assert.deepEqual(sleepDelays, [100]);

  const prospect = await client.dialProspect({
    to: "+15551234567",
    conferenceName: "sales-call-1",
    commandId: prospectCommandId
  });
  assert.equal(prospect.call.call_control_id, "prospect-control");

  const ai = await client.dialOpenAISipStandby({
    sipUri: "sip:proj_test@sip.api.openai.com;transport=tls",
    userToUser: "encoded-uui",
    commandId: aiCommandId
  });
  assert.equal(ai.call.call_control_id, "ai-control");

  await client.joinConference({
    conferenceId: "conf-1",
    callControlId: "ai-control",
    commandId: joinCommandId
  });
  const participant = await client.waitForConferenceParticipant({
    conferenceId: "conf-1",
    callControlId: "ai-control",
    timeoutMs: 100
  });
  assert.equal(participant.status, "joined");

  await client.leaveConference({
    conferenceId: "conf-1",
    callControlId: "ai-control",
    commandId: deriveSalesCommandId({
      correlationId: "trace-1",
      operation: "leave",
      target: "ai-control"
    })
  });
  await client.hangupCall({
    callControlId: "ai-control",
    commandId: deriveSalesCommandId({
      correlationId: "trace-1",
      operation: "hangup",
      target: "ai-control"
    })
  });
  await client.endConference({
    conferenceId: "conf-1",
    commandId: deriveSalesCommandId({
      correlationId: "trace-1",
      operation: "end",
      target: "conf-1"
    })
  });
  assert.equal(queue.remaining(), 0);

  const strictParticipantQueue = createQueuedFetch([
    {
      body: {
        data: [{
          call_control_id: "strict-ai-control",
          status: "joining",
          on_hold: false
        }]
      }
    },
    {
      body: {
        data: [{
          call_control_id: "strict-ai-control",
          status: "joined"
        }]
      }
    }
  ]);
  const strictParticipantClient = createSalesTelnyxClient({
    apiKey: "telnyx-test-key",
    callControlApplicationId: "sales-call-control-app",
    callerId: "+15550001111",
    baseUrl: "https://telnyx.test/v2",
    fetchImpl: strictParticipantQueue.fetchImpl,
    sleep: async () => {}
  });
  const strictlyJoined = await strictParticipantClient.waitForConferenceParticipant({
    conferenceId: "strict-conference",
    callControlId: "strict-ai-control",
    timeoutMs: 100
  });
  assert.equal(strictlyJoined.status, "joined");
  assert.equal(strictParticipantQueue.calls.length, 2);

  const timeoutClient = createSalesTelnyxClient({
    apiKey: "telnyx-test-key",
    callControlApplicationId: "sales-call-control-app",
    callerId: "+15550001111",
    baseUrl: "https://telnyx.test/v2",
    fetchImpl: () => new Promise(() => {}),
    maxAttempts: 1,
    requestTimeoutMs: 25
  });
  await assert.rejects(
    timeoutClient.hangupCall({
      callControlId: "hung-provider-call",
      commandId: deriveSalesCommandId({
        correlationId: "timeout-test",
        operation: "hangup",
        target: "hung-provider-call"
      })
    }),
    (error) => {
      assert.equal(error.code, "request_timeout");
      return true;
    }
  );
  const stalledBodyClient = createSalesTelnyxClient({
    apiKey: "telnyx-test-key",
    callControlApplicationId: "sales-call-control-app",
    callerId: "+15550001111",
    baseUrl: "https://telnyx.test/v2",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: () => new Promise(() => {})
    }),
    maxAttempts: 1,
    requestTimeoutMs: 25
  });
  await assert.rejects(
    stalledBodyClient.hangupCall({
      callControlId: "stalled-body-call",
      commandId: deriveSalesCommandId({
        correlationId: "stalled-body-test",
        operation: "hangup",
        target: "stalled-body-call"
      })
    }),
    (error) => {
      assert.equal(error.code, "request_timeout");
      return true;
    }
  );

  const alreadyGoneQueue = createQueuedFetch([
    {
      status: 422,
      body: {
        errors: [{
          code: "90018",
          detail: "Call has already ended"
        }]
      }
    },
    {
      status: 422,
      body: {
        errors: [{
          code: "90019",
          detail: "Conference has already ended"
        }]
      }
    }
  ]);
  const alreadyGoneClient = createSalesTelnyxClient({
    apiKey: "telnyx-test-key",
    callControlApplicationId: "sales-call-control-app",
    callerId: "+15550001111",
    baseUrl: "https://telnyx.test/v2",
    fetchImpl: alreadyGoneQueue.fetchImpl,
    maxAttempts: 1
  });
  const alreadyEndedCall = await alreadyGoneClient.hangupCall({
    callControlId: "already-ended-call",
    commandId: deriveSalesCommandId({
      correlationId: "already-gone-test",
      operation: "hangup",
      target: "already-ended-call"
    })
  });
  assert.equal(alreadyEndedCall.data.result, "already_gone");
  const alreadyEndedConference = await alreadyGoneClient.endConference({
    conferenceId: "already-ended-conference",
    commandId: deriveSalesCommandId({
      correlationId: "already-gone-test",
      operation: "end",
      target: "already-ended-conference"
    })
  });
  assert.equal(alreadyEndedConference.data.result, "already_gone");
  assert.equal(alreadyGoneQueue.remaining(), 0);

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const rawBody = JSON.stringify({ data: { id: "event-1" } });
  const timestamp = "1785200000";
  const signature = crypto.sign(
    null,
    Buffer.from(`${timestamp}|${rawBody}`, "utf8"),
    privateKey
  ).toString("base64");
  assert.equal(verifySalesTelnyxWebhook({
    rawBody,
    headers: {
      "telnyx-timestamp": timestamp,
      "telnyx-signature-ed25519": signature
    },
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
    nowMs: Number(timestamp) * 1000
  }), true);

  const clientState = encodeSalesClientState({
    salesCallId: "sales-call-1",
    correlationId: "trace-1",
    role: "prospect"
  });
  const normalizedEvent = normalizeSalesTelnyxWebhookEvent({
    data: {
      id: "telnyx-event-1",
      event_type: "call.answered",
      occurred_at: "2026-07-28T12:00:00Z",
      payload: {
        client_state: clientState,
        call_control_id: "prospect-control",
        call_leg_id: "prospect-leg",
        call_session_id: "prospect-session"
      }
    }
  });
  assert.equal(normalizedEvent.sales_call_id, "sales-call-1");
  assert.equal(normalizedEvent.state_hint, "prospect_connected");
  assert.equal(normalizedEvent.patch.prospect_call_control_id, "prospect-control");

  const initialOperatorEvent = normalizeSalesTelnyxWebhookEvent({
    data: {
      id: "telnyx-event-operator",
      event_type: "call.initiated",
      payload: {
        call_control_id: "operator-control",
        call_leg_id: "operator-leg",
        call_session_id: "operator-session",
        custom_headers: [
          {
            name: "X-EveryCall-Sales-Call-Id",
            value: "sales-call-browser"
          },
          {
            header_name: "X-EveryCall-Call-Role",
            header_value: "operator"
          }
        ]
      }
    }
  });
  assert.equal(initialOperatorEvent.sales_call_id, "sales-call-browser");
  assert.equal(initialOperatorEvent.correlation_id, "sales-call-browser");
  assert.equal(initialOperatorEvent.role, "operator");
  assert.equal(initialOperatorEvent.patch.operator_call_control_id, "operator-control");

  const conferenceParticipantEvent = normalizeSalesTelnyxWebhookEvent({
    data: {
      id: "telnyx-event-conference-participant",
      event_type: "conference.participant.joined",
      payload: {
        // Telnyx conference webhooks carry the conference owner's client state,
        // even when the payload identifiers belong to a different participant.
        client_state: encodeSalesClientState({
          salesCallId: "sales-call-browser",
          correlationId: "sales-call-browser",
          role: "operator"
        }),
        conference_id: "conference-browser",
        call_control_id: "ai-control",
        call_leg_id: "ai-leg",
        call_session_id: "ai-session"
      }
    }
  });
  assert.equal(conferenceParticipantEvent.sales_call_id, "sales-call-browser");
  assert.equal(conferenceParticipantEvent.role, null);
  assert.equal(conferenceParticipantEvent.patch.conference_id, "conference-browser");
  assert.equal(
    Object.hasOwn(conferenceParticipantEvent.patch, "operator_call_control_id"),
    false
  );
  assert.equal(
    Object.hasOwn(conferenceParticipantEvent.patch, "ai_telnyx_call_control_id"),
    false
  );
}

class FakeWebSocket {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.readyState = 0;
    this.handlers = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open");
    });
  }

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(handler);
  }

  emit(event, value) {
    for (const handler of this.handlers.get(event) || []) handler(value);
  }

  send(value) {
    assert.equal(this.readyState, 1);
    this.sent.push(String(value));
    const event = JSON.parse(String(value));
    if (event.type === "response.create") {
      queueMicrotask(() => {
        this.emit("message", JSON.stringify({
          type: "response.created",
          response: { id: "resp-greeting-1" }
        }));
        this.emit("message", JSON.stringify({
          type: "response.done",
          response: { id: "resp-greeting-1", status: "completed" }
        }));
        this.emit("message", JSON.stringify({
          type: "output_audio_buffer.stopped",
          response_id: "resp-greeting-1"
        }));
      });
    }
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", 1000, "test");
  }
}

async function validateOpenAIAdapter() {
  assert.equal(
    buildSalesOpenAISipUri("proj_sales123"),
    "sip:proj_sales123@sip.api.openai.com;transport=tls"
  );
  const session = buildSalesRealtimeAcceptPayload({
    instructions: "Use only this temporary demo fact bundle.",
    model: "gpt-realtime-2.1",
    voice: "marin"
  });
  assert.equal(session.type, "realtime");
  assert.equal(session.audio.input.turn_detection.create_response, false);
  assert.equal(session.audio.input.turn_detection.interrupt_response, true);
  assert.deepEqual(session.tools, []);

  const queue = createQueuedFetch([
    {
      assert: ({ url, options, body }) => {
        assert.equal(url, "https://openai.test/v1/realtime/calls/rtc_sales_1/accept");
        assert.equal(options.headers.Authorization, "Bearer openai-test-key");
        assert.equal(options.headers["X-Client-Request-Id"], "accept-request-1");
        assert.equal(body.audio.input.turn_detection.create_response, false);
      },
      body: null
    },
    {
      assert: ({ url, options }) => {
        assert.equal(url, "https://openai.test/v1/realtime/calls/rtc_sales_1/hangup");
        assert.equal(options.body, undefined);
      },
      body: null
    }
  ]);
  const client = createSalesOpenAIRealtimeClient({
    apiKey: "openai-test-key",
    projectId: "proj_sales123",
    baseUrl: "https://openai.test/v1",
    realtimeWebSocketUrl: "wss://openai.test/v1/realtime",
    fetchImpl: queue.fetchImpl,
    WebSocketImpl: FakeWebSocket,
    sleep: async () => {}
  });
  await client.acceptIncomingCall({
    callId: "rtc_sales_1",
    session,
    clientRequestId: "accept-request-1"
  });
  const controller = await client.connectMonitor({
    callId: "rtc_sales_1",
    correlationId: "trace-1"
  });
  const socket = FakeWebSocket.instances.at(-1);
  assert.equal(socket.url, "wss://openai.test/v1/realtime?call_id=rtc_sales_1");
  assert.equal(socket.options.headers.Authorization, "Bearer openai-test-key");
  assert.deepEqual(socket.sent, [], "Opening the monitor must not make the standby AI speak.");

  const quietPause = controller.pause();
  assert.equal(quietPause.cancel_event, null);
  const quietPauseEvents = socket.sent.map((value) => JSON.parse(value));
  assert.deepEqual(
    quietPauseEvents.map((event) => event.type),
    ["session.update", "output_audio_buffer.clear"]
  );
  socket.sent.length = 0;

  const started = await controller.startDemo({
    businessName: "Acme Appliance Repair"
  });
  assert.equal(started.greeting, "Thanks for calling Acme Appliance Repair. How can I help you?");
  const startEvents = socket.sent.map((value) => JSON.parse(value));
  assert.equal(startEvents.length, 5);
  assert.equal(startEvents[0].type, "session.update");
  assert.equal(startEvents[0].session.audio.input.turn_detection, null);
  assert.equal(startEvents[1].type, "input_audio_buffer.clear");
  assert.equal(startEvents[2].type, "response.create");
  assert.equal(startEvents[2].response.output_modalities[0], "audio");
  assert.equal(startEvents[3].type, "input_audio_buffer.clear");
  assert.equal(startEvents[4].type, "session.update");
  assert.equal(startEvents[4].session.audio.input.turn_detection.create_response, true);
  assert.equal(startEvents[4].session.audio.input.turn_detection.interrupt_response, true);
  assert.match(
    startEvents[2].response.instructions,
    /"Thanks for calling Acme Appliance Repair\. How can I help you\?"/
  );
  assert.equal(started.playback_stopped.response_id, "resp-greeting-1");

  const paused = controller.pause();
  assert.equal(paused.cancel_event, null);
  const pauseEvents = socket.sent.slice(5).map((value) => JSON.parse(value));
  assert.equal(pauseEvents[0].session.audio.input.turn_detection.create_response, false);
  assert.equal(pauseEvents[1].type, "output_audio_buffer.clear");

  await client.hangupCall({
    callId: "rtc_sales_1",
    clientRequestId: "hangup-request-1"
  });
  controller.close();
  assert.equal(queue.remaining(), 0);

  const webhookKey = Buffer.from("openai-webhook-test-secret", "utf8");
  const secret = `whsec_${webhookKey.toString("base64")}`;
  const webhookBody = JSON.stringify({
    object: "event",
    id: "evt-openai-1",
    type: "realtime.call.incoming",
    created_at: 1785200000,
    data: {
      call_id: "rtc_sales_1",
      sip_headers: [{
        name: "User-to-User",
        value: encodeSalesClientState({
          salesCallId: "sales-call-1",
          correlationId: "trace-1",
          role: "ai"
        })
      }]
    }
  });
  const webhookId = "wh_openai_1";
  const webhookTimestamp = "1785200000";
  const webhookSignature = crypto
    .createHmac("sha256", webhookKey)
    .update(`${webhookId}.${webhookTimestamp}.${webhookBody}`, "utf8")
    .digest("base64");
  assert.equal(verifySalesOpenAIWebhook({
    rawBody: webhookBody,
    headers: {
      "webhook-id": webhookId,
      "webhook-timestamp": webhookTimestamp,
      "webhook-signature": `v1,${webhookSignature}`
    },
    secret,
    nowMs: Number(webhookTimestamp) * 1000
  }), true);
  const incoming = normalizeSalesOpenAIIncomingCallEvent(webhookBody);
  assert.equal(incoming.openai_call_id, "rtc_sales_1");
  assert.equal(incoming.sales_call_id, "sales-call-1");
  assert.equal(incoming.patch.ai_state, "incoming");

  const timeoutClient = createSalesOpenAIRealtimeClient({
    apiKey: "openai-test-key",
    projectId: "proj_sales123",
    baseUrl: "https://openai.test/v1",
    fetchImpl: () => new Promise(() => {}),
    maxAttempts: 1,
    requestTimeoutMs: 25
  });
  await assert.rejects(
    timeoutClient.hangupCall({
      callId: "rtc_hung",
      clientRequestId: "timeout-request"
    }),
    (error) => {
      assert.equal(error.code, "request_timeout");
      return true;
    }
  );
  const stalledBodyClient = createSalesOpenAIRealtimeClient({
    apiKey: "openai-test-key",
    projectId: "proj_sales123",
    baseUrl: "https://openai.test/v1",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: () => new Promise(() => {})
    }),
    maxAttempts: 1,
    requestTimeoutMs: 25
  });
  await assert.rejects(
    stalledBodyClient.hangupCall({
      callId: "rtc_stalled_body",
      clientRequestId: "stalled-body-request"
    }),
    (error) => {
      assert.equal(error.code, "request_timeout");
      return true;
    }
  );
}

async function validateOrchestrator() {
  const events = [];
  const runtime = createInMemorySalesRealtimeRegistry();
  const controller = {
    callId: "rtc-sales-1",
    isOpen: true,
    startDemo({ businessName }) {
      events.push("openai:greeting");
      return { greeting: buildSalesDemoGreeting(businessName) };
    },
    pause() {
      events.push("openai:pause");
      return { type: "paused" };
    },
    close() {
      events.push("openai:close");
      this.isOpen = false;
    }
  };
  const telnyx = {
    async createConference() {
      events.push("telnyx:create_conference");
      return {
        conference_id: "conf-sales-1",
        conference_name: "sales-sales-call-1"
      };
    },
    async dialProspect() {
      events.push("telnyx:dial_prospect");
      return {
        call: {
          call_control_id: "prospect-control",
          call_leg_id: "prospect-leg",
          call_session_id: "prospect-session"
        }
      };
    },
    async dialOpenAISipStandby() {
      events.push("telnyx:dial_ai");
      return {
        call: {
          call_control_id: "ai-control",
          call_leg_id: "ai-leg",
          call_session_id: "ai-session"
        }
      };
    },
    async joinConference() {
      events.push("telnyx:join_ai");
      return { data: { result: "ok" } };
    },
    async waitForConferenceParticipant() {
      events.push("telnyx:ai_join_confirmed");
      return { call_control_id: "ai-control", status: "joined" };
    },
    async leaveConference() {
      events.push("telnyx:leave_ai");
      return { data: { result: "ok" } };
    },
    async hangupCall({ callControlId }) {
      events.push(`telnyx:hangup:${callControlId}`);
      return { data: { result: "ok" } };
    },
    async endConference() {
      events.push("telnyx:end_conference");
      return { data: { result: "ok" } };
    }
  };
  const openai = {
    buildSipUri() {
      return "sip:proj_sales123@sip.api.openai.com;transport=tls";
    },
    async acceptIncomingCall() {
      events.push("openai:accept");
      return { ai_state: "accepted" };
    },
    async connectMonitor() {
      events.push("openai:monitor_open_silent");
      return controller;
    },
    async hangupCall() {
      events.push("openai:hangup");
      return { ai_state: "ended" };
    }
  };
  const orchestrator = createSalesCallOrchestrator({
    telnyx,
    openai,
    realtimeRegistry: runtime,
    now: () => new Date("2026-07-28T12:00:00Z")
  });

  const beforeUnpreparedStart = events.length;
  await assert.rejects(
    orchestrator.startDemo({
      salesCallId: "sales-call-not-ready",
      conferenceId: "conf-not-ready",
      aiTelnyxCallControlId: "ai-not-ready",
      businessName: "Not Ready Repair"
    }),
    (error) => {
      assert.equal(error.code, "sales_ai_standby_not_ready");
      return true;
    }
  );
  assert.equal(
    events.length,
    beforeUnpreparedStart,
    "Start Receptionist must not join a conference until the AI standby is already ready."
  );

  const begun = await orchestrator.beginCall({
    salesCallId: "sales-call-1",
    correlationId: "trace-1",
    correlationNonce: "one-time-correlation-nonce",
    operator: {
      call_control_id: "operator-control",
      call_leg_id: "operator-leg",
      call_session_id: "operator-session"
    },
    prospectNumber: "+15551234567",
    onCheckpoint(patch) {
      events.push(`checkpoint:${Object.keys(patch).sort().join(",")}`);
    }
  });
  assert.equal(begun.patch.conference_id, "conf-sales-1");
  assert.equal(begun.patch.operator_call_control_id, "operator-control");
  assert.equal(begun.patch.prospect_call_control_id, "prospect-control");
  assert.equal(begun.patch.ai_telnyx_call_control_id, "ai-control");
  assert.equal(begun.patch.state, "dialing_prospect");
  assert.equal(begun.patch.ai_state, "dialing_standby");
  assert.ok(events.some((event) => (
    event.includes("checkpoint:conference_id")
    && event.includes("operator_call_control_id")
  )));
  assert.ok(events.some((event) => (
    event === "checkpoint:prospect_call_control_id,prospect_leg_id,prospect_session_id"
  )));
  assert.ok(events.some((event) => (
    event === "checkpoint:ai_telnyx_call_control_id,ai_telnyx_leg_id,ai_telnyx_session_id"
  )));

  const resumeStart = events.length;
  const resumed = await orchestrator.beginCall({
    salesCallId: "sales-call-resumed",
    correlationId: "trace-resumed",
    correlationNonce: "resumed-correlation-nonce",
    operator: {
      call_control_id: "operator-control",
      call_leg_id: "operator-leg",
      call_session_id: "operator-session"
    },
    prospectNumber: "+15551234567",
    existingConference: {
      conference_id: "conf-resumed",
      conference_name: "sales-sales-call-resumed"
    },
    existingProspect: {
      call_control_id: "prospect-existing",
      call_leg_id: "prospect-existing-leg",
      call_session_id: "prospect-existing-session"
    }
  });
  const resumeEvents = events.slice(resumeStart);
  assert.equal(resumeEvents.includes("telnyx:create_conference"), false);
  assert.equal(resumeEvents.includes("telnyx:dial_prospect"), false);
  assert.equal(resumeEvents.includes("telnyx:dial_ai"), true);
  assert.equal(resumed.patch.conference_id, "conf-resumed");
  assert.equal(resumed.patch.prospect_call_control_id, "prospect-existing");

  const standby = await orchestrator.prepareAIStandby({
    salesCallId: "sales-call-1",
    correlationId: "trace-1",
    openaiCallId: "rtc-sales-1",
    aiTelnyxCallControlId: "ai-control",
    realtimeSession: buildSalesRealtimeAcceptPayload({
      instructions: "Temporary sales demo only."
    })
  });
  assert.equal(standby.patch.ai_state, "ready");
  assert.equal(events.includes("openai:greeting"), false);

  const demo = await orchestrator.startDemo({
    salesCallId: "sales-call-1",
    correlationId: "trace-1",
    conferenceId: "conf-sales-1",
    aiTelnyxCallControlId: "ai-control",
    openaiCallId: "rtc-sales-1",
    businessName: "Acme Appliance Repair"
  });
  assert.equal(demo.patch.state, "ai_live");
  assert.deepEqual(
    events.slice(events.indexOf("telnyx:join_ai"), events.indexOf("openai:greeting") + 1),
    ["telnyx:join_ai", "telnyx:ai_join_confirmed", "openai:greeting"]
  );

  const paused = await orchestrator.pauseAI({ salesCallId: "sales-call-1" });
  assert.equal(paused.patch.ai_state, "paused");
  const beforeEndDemo = events.length;
  const endedDemo = await orchestrator.endDemo({
    salesCallId: "sales-call-1",
    correlationId: "trace-1",
    conferenceId: "conf-sales-1",
    aiTelnyxCallControlId: "ai-control",
    openaiCallId: "rtc-sales-1"
  });
  assert.equal(endedDemo.patch.state, "demo_ended");
  assert.ok(events.includes("telnyx:leave_ai"));
  assert.ok(events.includes("openai:hangup"));
  assert.ok(events.includes("telnyx:hangup:ai-control"));
  assert.equal(runtime.size(), 0);
  const endDemoEvents = events.slice(beforeEndDemo);
  assert.equal(endDemoEvents.includes("telnyx:end_conference"), false);
  assert.equal(endDemoEvents.includes("telnyx:hangup:operator-control"), false);
  assert.equal(endDemoEvents.includes("telnyx:hangup:prospect-control"), false);

  const noAnswer = await orchestrator.teardownNoAnswer({
    salesCallId: "sales-call-2",
    correlationId: "trace-2",
    conferenceId: "conf-sales-2",
    aiTelnyxCallControlId: "ai-control-2",
    openaiCallId: "rtc-sales-2"
  });
  assert.equal(noAnswer.patch.state, "closed");
  assert.equal(noAnswer.patch.outcome, "no_answer");
  assert.ok(events.includes("telnyx:end_conference"));

  const failureEvents = [];
  const failingOrchestrator = createSalesCallOrchestrator({
    openai,
    now: () => new Date("2026-07-28T12:00:00Z"),
    telnyx: {
      ...telnyx,
      async dialProspect() {
        return {
          call: {
            call_control_id: "rollback-prospect",
            call_leg_id: "rollback-leg",
            call_session_id: "rollback-session"
          }
        };
      },
      async dialOpenAISipStandby() {
        throw new SalesProviderError("AI dial unavailable", {
          provider: "telnyx",
          operation: "dial",
          code: "dial_failed"
        });
      },
      async hangupCall({ callControlId }) {
        failureEvents.push(`hangup:${callControlId}`);
      },
      async endConference() {
        failureEvents.push("end_conference");
      }
    }
  });
  await assert.rejects(
    failingOrchestrator.beginCall({
      salesCallId: "sales-call-failure",
      correlationNonce: "failure-correlation-nonce",
      operator: { call_control_id: "operator-control" },
      prospectNumber: "+15551234567"
    }),
    (error) => {
      assert.ok(error instanceof SalesCallOrchestrationError);
      assert.equal(error.code, "sales_parallel_dial_failed");
      assert.equal(error.patch.state, "failed");
      return true;
    }
  );
  assert.deepEqual(failureEvents.sort(), ["end_conference", "hangup:rollback-prospect"].sort());

  const fallbackEvents = [];
  const fallbackOrchestrator = createSalesCallOrchestrator({
    openai,
    telnyx: {
      ...telnyx,
      async endConference() {
        fallbackEvents.push("end_conference_failed");
        throw new Error("conference end unavailable");
      },
      async hangupCall({ callControlId }) {
        fallbackEvents.push(`hangup:${callControlId}`);
      }
    }
  });
  const fallbackEnded = await fallbackOrchestrator.endCall({
    salesCallId: "sales-call-fallback",
    correlationId: "trace-fallback",
    conferenceId: "conf-fallback",
    operatorCallControlId: "operator-fallback",
    prospectCallControlId: "prospect-fallback"
  });
  assert.equal(fallbackEnded.patch.state, "closed");
  assert.ok(fallbackEvents.includes("hangup:operator-fallback"));
  assert.ok(fallbackEvents.includes("hangup:prospect-fallback"));

  const incompleteOrchestrator = createSalesCallOrchestrator({
    openai,
    telnyx: {
      ...telnyx,
      async endConference() {
        throw new Error("conference end unavailable");
      },
      async hangupCall({ callControlId }) {
        if (callControlId === "prospect-incomplete") {
          throw new Error("prospect hangup unavailable");
        }
      }
    }
  });
  const incomplete = await incompleteOrchestrator.endCall({
    salesCallId: "sales-call-incomplete",
    correlationId: "trace-incomplete",
    conferenceId: "conf-incomplete",
    operatorCallControlId: "operator-incomplete",
    prospectCallControlId: "prospect-incomplete"
  });
  assert.equal(incomplete.patch.state, "ending");
  assert.equal(incomplete.patch.ai_state, "tearing_down");
  assert.equal(incomplete.teardown_complete, false);
}

await validateProviderUtilities();
await validateTelnyxAdapter();
await validateOpenAIAdapter();
await validateOrchestrator();

console.log("Sales telephony validation passed.");
