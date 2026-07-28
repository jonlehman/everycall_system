import crypto from "node:crypto";

// This Realtime client is isolated from production and public-demo voice paths.
import {
  SalesProviderError,
  compactSalesObject,
  decodeSalesClientState,
  deriveSalesRealtimeEventId,
  getSalesHeader,
  isTransientProviderStatus,
  readSalesProviderResponse,
  requireSalesValue,
  withSalesProviderRetry
} from "./salesCallProviderUtils.js";

const DEFAULT_OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_REALTIME_WS_URL = "wss://api.openai.com/v1/realtime";
const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1";
const DEFAULT_REALTIME_VOICE = "marin";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

function normalizeBaseUrl(value, fallback) {
  return String(value || fallback).trim().replace(/\/+$/, "");
}

function normalizeBusinessName(value) {
  const normalized = String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return normalized || "this business";
}

function extractOpenAIError(json, rawBody) {
  const error = json?.error;
  const code = String(error?.code || error?.type || "").trim();
  const message = String(error?.message || rawBody || "OpenAI request failed").trim();
  return {
    code,
    message: [code, message].filter(Boolean).join(" | ").slice(0, 1000)
  };
}

function openAIResourceAlreadyGone(error) {
  const code = String(error?.code || "").toLowerCase();
  return [404, 410].includes(Number(error?.status))
    || /(not[_ -]?found|already[_ -]?(ended|hung)|call[_ -]?ended)/.test(code);
}

function decodeStandardWebhookSecret(secret) {
  const value = requireSalesValue(secret, "openai_webhook_secret");
  const encoded = value.startsWith("whsec_") ? value.slice("whsec_".length) : value;
  try {
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.length > 0 && decoded.toString("base64").replace(/=+$/, "") === encoded.replace(/=+$/, "")) {
      return decoded;
    }
  } catch {
    // Fall through to raw UTF-8 for non-prefixed test and legacy secrets.
  }
  return Buffer.from(value, "utf8");
}

function standardWebhookSignatures(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map((entry) => entry.split(",", 2))
    .filter(([version, signature]) => version === "v1" && Boolean(signature))
    .map(([, signature]) => signature);
}

function timingSafeBase64Equal(expected, received) {
  try {
    const expectedBytes = Buffer.from(expected, "base64");
    const receivedBytes = Buffer.from(received, "base64");
    return expectedBytes.length === receivedBytes.length
      && crypto.timingSafeEqual(expectedBytes, receivedBytes);
  } catch {
    return false;
  }
}

function attachSocketListener(socket, event, handler) {
  if (typeof socket.on === "function") {
    socket.on(event, handler);
    return;
  }
  if (typeof socket.addEventListener === "function") {
    socket.addEventListener(event, handler);
    return;
  }
  throw new Error("websocket_event_interface_unavailable");
}

function socketMessageData(message) {
  const value = message?.data === undefined ? message : message.data;
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString("utf8");
  return String(value || "");
}

async function defaultWebSocketConstructor() {
  const imported = await import("ws");
  return imported.WebSocket || imported.default;
}

export function buildSalesOpenAISipUri(projectId) {
  const normalized = requireSalesValue(
    projectId || process.env.SALES_OPENAI_PROJECT_ID,
    "sales_openai_project_id"
  );
  if (!/^proj_[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error("invalid_sales_openai_project_id");
  }
  return `sip:${normalized}@sip.api.openai.com;transport=tls`;
}

export function buildSalesRealtimeAcceptPayload({
  instructions,
  model,
  voice,
  transcriptionModel,
  maxOutputTokens = 4096,
  noiseReduction = "far_field"
}) {
  return compactSalesObject({
    type: "realtime",
    model: String(model || process.env.SALES_OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL).trim(),
    instructions: requireSalesValue(instructions, "realtime_instructions"),
    tools: [],
    tool_choice: "none",
    output_modalities: ["audio"],
    audio: {
      input: {
        transcription: {
          model: String(
            transcriptionModel
            || process.env.SALES_OPENAI_TRANSCRIPTION_MODEL
            || DEFAULT_TRANSCRIPTION_MODEL
          ).trim(),
          language: "en"
        },
        noise_reduction: noiseReduction ? { type: String(noiseReduction) } : undefined,
        turn_detection: {
          type: "semantic_vad",
          eagerness: "high",
          create_response: false,
          interrupt_response: true
        }
      },
      output: {
        voice: String(voice || process.env.SALES_OPENAI_REALTIME_VOICE || DEFAULT_REALTIME_VOICE).trim()
      }
    },
    max_output_tokens: Math.max(1, Math.min(4096, Number(maxOutputTokens) || 4096))
  });
}

export function buildSalesRealtimeResponseModeEvent({
  enabled,
  eventId
}) {
  return {
    type: "session.update",
    ...(eventId ? { event_id: eventId } : {}),
    session: {
      type: "realtime",
      audio: {
        input: {
          turn_detection: {
            type: "semantic_vad",
            eagerness: "high",
            create_response: Boolean(enabled),
            interrupt_response: true
          }
        }
      }
    }
  };
}

export function buildSalesDemoGreeting(businessName) {
  return `Thanks for calling ${normalizeBusinessName(businessName)}. How can I help you?`;
}

export function buildSalesRealtimeGreetingEvent({
  businessName,
  correlationId,
  eventId
}) {
  const greeting = buildSalesDemoGreeting(businessName);
  return {
    type: "response.create",
    ...(eventId ? { event_id: eventId } : {}),
    response: {
      output_modalities: ["audio"],
      instructions: `Say exactly this sentence, with no additions: ${JSON.stringify(greeting)}`,
      max_output_tokens: 80,
      metadata: {
        response_purpose: "sales_demo_greeting",
        correlation_id: String(correlationId || "")
      }
    }
  };
}

export function buildSalesRealtimeCancelEvent({
  responseId,
  eventId
} = {}) {
  return compactSalesObject({
    type: "response.cancel",
    event_id: eventId || undefined,
    response_id: responseId || undefined
  });
}

export function buildSalesRealtimeOutputAudioClearEvent({
  eventId
} = {}) {
  return compactSalesObject({
    type: "output_audio_buffer.clear",
    event_id: eventId || undefined
  });
}

export function verifySalesOpenAIWebhook({
  rawBody,
  headers,
  secret,
  nowMs = Date.now(),
  toleranceSeconds = 300
}) {
  const webhookId = getSalesHeader(headers, "webhook-id");
  const timestamp = getSalesHeader(headers, "webhook-timestamp");
  const signatures = standardWebhookSignatures(getSalesHeader(headers, "webhook-signature"));
  const timestampNumber = Number(timestamp);
  if (!webhookId || !timestamp || signatures.length === 0 || !Number.isFinite(timestampNumber)) {
    return false;
  }
  if (Math.abs(nowMs / 1000 - timestampNumber) > toleranceSeconds) return false;
  try {
    const signedContent = `${webhookId}.${timestamp}.${String(rawBody || "")}`;
    const expected = crypto
      .createHmac("sha256", decodeStandardWebhookSecret(secret))
      .update(signedContent, "utf8")
      .digest("base64");
    return signatures.some((signature) => timingSafeBase64Equal(expected, signature));
  } catch {
    return false;
  }
}

export function normalizeSalesOpenAIIncomingCallEvent(event) {
  const parsed = typeof event === "string" ? JSON.parse(event) : event;
  if (parsed?.type !== "realtime.call.incoming") {
    throw new Error("unsupported_openai_realtime_webhook_event");
  }
  const callId = requireSalesValue(parsed?.data?.call_id, "openai_call_id");
  const sipHeaders = Array.isArray(parsed?.data?.sip_headers) ? parsed.data.sip_headers : [];
  const userToUser = sipHeaders.find((entry) => (
    String(entry?.name || "").toLowerCase() === "user-to-user"
  ))?.value;
  const correlation = decodeSalesClientState(userToUser);
  return {
    provider: "openai",
    event_id: String(parsed?.id || "").trim(),
    type: "realtime.call.incoming",
    occurred_at: parsed?.created_at
      ? new Date(Number(parsed.created_at) * 1000).toISOString()
      : null,
    openai_call_id: callId,
    sales_call_id: correlation?.sales_call_id || null,
    correlation_id: correlation?.correlation_id || null,
    correlation_nonce: correlation?.nonce || null,
    role: correlation?.role || "ai",
    patch: {
      openai_call_id: callId,
      ai_state: "incoming"
    },
    sip_headers: sipHeaders
  };
}

export function createSalesOpenAIRealtimeClient({
  apiKey,
  webhookSecret,
  projectId,
  baseUrl,
  realtimeWebSocketUrl,
  fetchImpl,
  WebSocketImpl,
  sleep,
  maxAttempts = 3,
  retryBaseDelayMs = 100,
  requestTimeoutMs
} = {}) {
  const resolveApiKey = () => requireSalesValue(
    apiKey || process.env.SALES_OPENAI_API_KEY,
    "sales_openai_api_key"
  );
  const resolveFetch = () => {
    const selected = fetchImpl || globalThis.fetch;
    if (typeof selected !== "function") throw new Error("fetch_unavailable");
    return selected;
  };
  const resolveBaseUrl = () => normalizeBaseUrl(
    baseUrl || process.env.SALES_OPENAI_API_BASE_URL,
    DEFAULT_OPENAI_API_BASE_URL
  );
  const resolveWebSocketUrl = () => normalizeBaseUrl(
    realtimeWebSocketUrl || process.env.SALES_OPENAI_REALTIME_WS_URL,
    DEFAULT_OPENAI_REALTIME_WS_URL
  );
  const resolveRequestTimeoutMs = () => Math.max(
    250,
    Math.min(
      30000,
      Number(
        requestTimeoutMs
        || process.env.SALES_OPENAI_HTTP_TIMEOUT_MS
        || 8000
      ) || 8000
    )
  );

  async function request(path, {
    body,
    operation,
    clientRequestId,
    retry = true
  }) {
    return withSalesProviderRetry(async () => {
      let response;
      let responsePayload;
      let timedOut = false;
      const abortController = new AbortController();
      let timeout;
      try {
        const providerRequest = (async () => {
          const providerResponse = await resolveFetch()(
            `${resolveBaseUrl()}${path}`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${resolveApiKey()}`,
                Accept: "application/json",
                ...(body === undefined
                  ? {}
                  : { "Content-Type": "application/json" }),
                ...(clientRequestId
                  ? { "X-Client-Request-Id": clientRequestId }
                  : {})
              },
              signal: abortController.signal,
              ...(body === undefined ? {} : { body: JSON.stringify(body) })
            }
          );
          return {
            response: providerResponse,
            payload: await readSalesProviderResponse(providerResponse)
          };
        })();
        const completed = await Promise.race([
          providerRequest,
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              timedOut = true;
              abortController.abort();
              reject(new Error("sales_openai_request_timeout"));
            }, resolveRequestTimeoutMs());
          })
        ]);
        response = completed.response;
        responsePayload = completed.payload;
      } catch (cause) {
        throw new SalesProviderError(`OpenAI ${operation} network failure`, {
          provider: "openai",
          operation,
          code: timedOut ? "request_timeout" : "network_error",
          retryable: retry,
          cause
        });
      } finally {
        if (timeout) clearTimeout(timeout);
      }

      if (!response.ok) {
        const detail = extractOpenAIError(responsePayload.json, responsePayload.rawBody);
        throw new SalesProviderError(
          `OpenAI ${operation} failed (${response.status}): ${detail.message}`,
          {
            provider: "openai",
            operation,
            status: response.status,
            code: detail.code || response.status,
            responseBody: responsePayload.rawBody,
            retryable: retry && isTransientProviderStatus(response.status)
          }
        );
      }
      return responsePayload.json || {};
    }, {
      maxAttempts: retry ? maxAttempts : 1,
      baseDelayMs: retryBaseDelayMs,
      sleep
    });
  }

  return {
    buildSipUri(selectedProjectId) {
      return buildSalesOpenAISipUri(selectedProjectId || projectId);
    },

    verifyWebhook({ rawBody, headers, secret, nowMs, toleranceSeconds }) {
      return verifySalesOpenAIWebhook({
        rawBody,
        headers,
        secret: secret || webhookSecret || process.env.SALES_OPENAI_WEBHOOK_SECRET,
        nowMs,
        toleranceSeconds
      });
    },

    async acceptIncomingCall({
      callId,
      session,
      clientRequestId
    }) {
      const selectedCallId = requireSalesValue(callId, "openai_call_id");
      const selectedSession = session?.session || session;
      if (selectedSession?.type !== "realtime") {
        throw new Error("invalid_sales_realtime_accept_payload");
      }
      await request(
        `/realtime/calls/${encodeURIComponent(selectedCallId)}/accept`,
        {
          operation: "accept_realtime_call",
          body: selectedSession,
          clientRequestId
        }
      );
      return {
        openai_call_id: selectedCallId,
        ai_state: "accepted",
        client_request_id: clientRequestId || null
      };
    },

    async hangupCall({ callId, clientRequestId }) {
      const selectedCallId = requireSalesValue(callId, "openai_call_id");
      try {
        await request(
          `/realtime/calls/${encodeURIComponent(selectedCallId)}/hangup`,
          {
            operation: "hangup_realtime_call",
            body: undefined,
            clientRequestId
          }
        );
      } catch (error) {
        if (!openAIResourceAlreadyGone(error)) throw error;
      }
      return {
        openai_call_id: selectedCallId,
        ai_state: "ended",
        client_request_id: clientRequestId || null
      };
    },

    async connectMonitor({
      callId,
      correlationId,
      onEvent,
      onError,
      onClose,
      openTimeoutMs = 10000
    }) {
      const selectedCallId = requireSalesValue(callId, "openai_call_id");
      const WebSocketConstructor = WebSocketImpl || await defaultWebSocketConstructor();
      const url = `${resolveWebSocketUrl()}?call_id=${encodeURIComponent(selectedCallId)}`;
      let socket;
      try {
        socket = new WebSocketConstructor(url, {
          headers: {
            Authorization: `Bearer ${resolveApiKey()}`
          }
        });
      } catch (cause) {
        throw new SalesProviderError("OpenAI Realtime WebSocket construction failed", {
          provider: "openai",
          operation: "connect_realtime_monitor",
          code: "websocket_construction_failed",
          retryable: false,
          cause
        });
      }

      let activeResponseId = null;
      let closed = false;
      const events = [];
      const responseCreatedWaiters = [];

      function rejectResponseCreatedWaiters(error) {
        while (responseCreatedWaiters.length) {
          responseCreatedWaiters.shift().reject(error);
        }
      }

      attachSocketListener(socket, "message", (message) => {
        let event;
        try {
          event = JSON.parse(socketMessageData(message));
        } catch {
          return;
        }
        if (events.length >= 100) events.shift();
        events.push(event);
        if (event?.type === "response.created" && event?.response?.id) {
          activeResponseId = String(event.response.id);
          const waiter = responseCreatedWaiters.shift();
          if (waiter) waiter.resolve(event);
        }
        if (
          event?.type === "response.done"
          && (!event?.response?.id || String(event.response.id) === activeResponseId)
        ) {
          activeResponseId = null;
        }
        if (event?.type === "error") {
          rejectResponseCreatedWaiters(new SalesProviderError(
            String(event?.error?.message || "OpenAI Realtime rejected an event"),
            {
              provider: "openai",
              operation: "await_response_created",
              code: String(event?.error?.code || "realtime_error"),
              retryable: false
            }
          ));
        }
        if (typeof onEvent === "function") onEvent(event);
      });

      attachSocketListener(socket, "close", (...args) => {
        closed = true;
        rejectResponseCreatedWaiters(new SalesProviderError(
          "OpenAI Realtime WebSocket closed before response acknowledgement",
          {
            provider: "openai",
            operation: "await_response_created",
            code: "websocket_closed",
            retryable: false
          }
        ));
        if (typeof onClose === "function") onClose(...args);
      });

      const opened = await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            socket.close();
          } catch {
            // Ignore close failure after an open timeout.
          }
          reject(new SalesProviderError("OpenAI Realtime WebSocket open timed out", {
            provider: "openai",
            operation: "connect_realtime_monitor",
            code: "websocket_open_timeout",
            retryable: false
          }));
        }, Math.max(1, Number(openTimeoutMs) || 10000));

        attachSocketListener(socket, "open", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(true);
        });

        attachSocketListener(socket, "error", (cause) => {
          if (typeof onError === "function") onError(cause);
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new SalesProviderError("OpenAI Realtime WebSocket failed before opening", {
            provider: "openai",
            operation: "connect_realtime_monitor",
            code: "websocket_open_failed",
            retryable: false,
            cause: cause instanceof Error ? cause : undefined
          }));
        });
      });

      function sendEvent(event) {
        if (!opened || closed || socket.readyState !== 1) {
          throw new SalesProviderError("OpenAI Realtime WebSocket is not open", {
            provider: "openai",
            operation: "send_realtime_event",
            code: "websocket_not_open",
            retryable: false
          });
        }
        socket.send(JSON.stringify(event));
        return event;
      }

      function waitForResponseCreated(timeoutMs) {
        return new Promise((resolve, reject) => {
          const waiter = {
            resolve: (event) => {
              clearTimeout(timer);
              resolve(event);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            }
          };
          const timer = setTimeout(() => {
            const index = responseCreatedWaiters.indexOf(waiter);
            if (index >= 0) responseCreatedWaiters.splice(index, 1);
            reject(new SalesProviderError(
              "OpenAI greeting response acknowledgement timed out",
              {
                provider: "openai",
                operation: "await_response_created",
                code: "response_created_timeout",
                retryable: false
              }
            ));
          }, Math.max(100, Number(timeoutMs) || 5000));
          responseCreatedWaiters.push(waiter);
        });
      }

      return {
        callId: selectedCallId,
        correlationId: String(correlationId || selectedCallId),
        socket,
        events,
        get activeResponseId() {
          return activeResponseId;
        },
        get isOpen() {
          return !closed && socket.readyState === 1;
        },
        sendEvent,
        async startDemo({ businessName, responseCreatedTimeoutMs = 5000 }) {
          const responseMode = buildSalesRealtimeResponseModeEvent({
            enabled: true,
            eventId: deriveSalesRealtimeEventId({
              correlationId: correlationId || selectedCallId,
              operation: "enable_demo",
              target: selectedCallId
            })
          });
          const greeting = buildSalesRealtimeGreetingEvent({
            businessName,
            correlationId: correlationId || selectedCallId,
            eventId: deriveSalesRealtimeEventId({
              correlationId: correlationId || selectedCallId,
              operation: "greeting",
              target: selectedCallId
            })
          });
          const responseCreated = waitForResponseCreated(
            responseCreatedTimeoutMs
          );
          sendEvent(greeting);
          const acknowledgement = await responseCreated;
          sendEvent(responseMode);
          return {
            response_mode_event: responseMode,
            greeting_event: greeting,
            greeting: buildSalesDemoGreeting(businessName),
            acknowledgement
          };
        },
        pause({ responseId } = {}) {
          const selectedResponseId = responseId || activeResponseId || null;
          const responseMode = buildSalesRealtimeResponseModeEvent({
            enabled: false,
            eventId: deriveSalesRealtimeEventId({
              correlationId: correlationId || selectedCallId,
              operation: "disable_demo",
              target: selectedCallId
            })
          });
          const cancel = selectedResponseId
            ? buildSalesRealtimeCancelEvent({
                responseId: selectedResponseId,
                eventId: deriveSalesRealtimeEventId({
                  correlationId: correlationId || selectedCallId,
                  operation: "cancel_response",
                  target: selectedResponseId
                })
              })
            : null;
          const clearOutputAudio = buildSalesRealtimeOutputAudioClearEvent({
            eventId: deriveSalesRealtimeEventId({
              correlationId: correlationId || selectedCallId,
              operation: "clear_output_audio",
              target: selectedResponseId || selectedCallId
            })
          });
          sendEvent(responseMode);
          if (cancel) sendEvent(cancel);
          sendEvent(clearOutputAudio);
          return {
            response_mode_event: responseMode,
            cancel_event: cancel,
            clear_output_audio_event: clearOutputAudio
          };
        },
        close() {
          if (closed) return;
          closed = true;
          socket.close();
        }
      };
    }
  };
}
