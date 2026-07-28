import crypto from "node:crypto";

// This adapter is scoped to the outbound-sales Telnyx application.
import {
  SalesProviderError,
  compactSalesObject,
  decodeSalesClientState,
  getSalesHeader,
  isTransientProviderStatus,
  readSalesProviderResponse,
  requireSalesValue,
  withSalesProviderRetry
} from "./salesCallProviderUtils.js";

const DEFAULT_TELNYX_BASE_URL = "https://api.telnyx.com/v2";
const JOINED_PARTICIPANT_STATUSES = new Set(["active", "answered", "connected", "joined"]);

function normalizeBaseUrl(value, fallback) {
  return String(value || fallback).trim().replace(/\/+$/, "");
}

function normalizeTelnyxCall(data = {}) {
  return {
    call_control_id: String(data?.call_control_id || "").trim() || null,
    call_leg_id: String(data?.call_leg_id || "").trim() || null,
    call_session_id: String(data?.call_session_id || "").trim() || null,
    client_state: String(data?.client_state || "").trim() || null
  };
}

function telnyxErrorDetail(json, rawBody) {
  const first = Array.isArray(json?.errors) ? json.errors[0] : json?.error;
  if (first && typeof first === "object") {
    return [
      first.code,
      first.title || first.message,
      first.detail || first.description
    ].filter(Boolean).join(" | ").slice(0, 1000);
  }
  return String(rawBody || "Telnyx request failed").slice(0, 1000);
}

function telnyxResourceAlreadyGone(error) {
  const code = String(error?.code || "").toLowerCase();
  return ["90018", "90019"].includes(code)
    || [404, 410].includes(Number(error?.status))
    || /(not[_ -]?found|already[_ -]?(ended|hung|left)|call[_ -]?ended)/.test(code);
}

function resolveTelnyxPublicKey(rawKey) {
  const key = String(rawKey || "").trim();
  if (!key) return "";
  if (key.includes("BEGIN PUBLIC KEY")) return key;
  const cleaned = key.replace(/[\r\n\s]/g, "");
  const rawBytes = Buffer.from(cleaned, "base64");
  const spkiBytes = rawBytes.length === 32
    ? Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawBytes])
    : rawBytes;
  const encoded = spkiBytes.toString("base64");
  const wrapped = encoded.match(/.{1,64}/g)?.join("\n") || encoded;
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----`;
}

export function verifySalesTelnyxWebhook({
  rawBody,
  headers,
  publicKey,
  nowMs = Date.now(),
  toleranceSeconds = 300
}) {
  const signature = getSalesHeader(headers, "telnyx-signature-ed25519");
  const timestamp = getSalesHeader(headers, "telnyx-timestamp");
  const timestampNumber = Number(timestamp);
  if (!signature || !timestamp || !publicKey || !Number.isFinite(timestampNumber)) return false;
  if (Math.abs(nowMs / 1000 - timestampNumber) > toleranceSeconds) return false;
  try {
    return crypto.verify(
      null,
      Buffer.from(`${timestamp}|${String(rawBody || "")}`, "utf8"),
      resolveTelnyxPublicKey(publicKey),
      Buffer.from(signature, "base64")
    );
  } catch {
    return false;
  }
}

export function normalizeSalesTelnyxWebhookEvent(event) {
  const data = typeof event === "string" ? JSON.parse(event) : event;
  const envelope = data?.data || {};
  const payload = envelope?.payload || {};
  const clientState = decodeSalesClientState(payload?.client_state);
  const providerHeaders = [
    ...(Array.isArray(payload?.custom_headers) ? payload.custom_headers : []),
    ...(Array.isArray(payload?.sip_headers) ? payload.sip_headers : []),
    ...(Array.isArray(payload?.headers) ? payload.headers : [])
  ];
  const findProviderHeader = (name) => providerHeaders.find((entry) => (
    String(entry?.name || entry?.header_name || "").toLowerCase()
      === String(name).toLowerCase()
  ));
  const providerHeaderValue = (name) => {
    const entry = findProviderHeader(name);
    return entry?.value ?? entry?.header_value;
  };
  const headerSalesCallId = String(
    providerHeaderValue("X-EveryCall-Sales-Call-Id") || ""
  ).trim();
  const headerCorrelationId = String(
    providerHeaderValue("X-EveryCall-Correlation-Id") || ""
  ).trim();
  const headerRole = String(
    providerHeaderValue("X-EveryCall-Call-Role")
      || providerHeaderValue("X-EveryCall-Sales-Role")
      || ""
  ).trim().toLowerCase();
  const type = String(envelope?.event_type || "").trim();
  const conferenceEvent = type.startsWith("conference.");
  const explicitHeaderRole = ["operator", "prospect", "ai"].includes(headerRole)
    ? headerRole
    : null;
  // Conference webhooks inherit the conference owner's client_state. That state
  // must never be used to classify a non-owner participant's payload IDs.
  const role = conferenceEvent
    ? explicitHeaderRole
    : clientState?.role || explicitHeaderRole || (headerSalesCallId ? "operator" : null);
  const salesCallId = clientState?.sales_call_id || headerSalesCallId || null;
  const correlationId = clientState?.correlation_id
    || headerCorrelationId
    || salesCallId
    || null;
  const patch = {};

  if (payload?.conference_id) patch.conference_id = String(payload.conference_id);
  if (payload?.conference_name) patch.conference_name = String(payload.conference_name);

  const roleFields = role === "operator"
    ? ["operator_call_control_id", "operator_leg_id", "operator_session_id"]
    : role === "prospect"
      ? ["prospect_call_control_id", "prospect_leg_id", "prospect_session_id"]
      : role === "ai"
        ? ["ai_telnyx_call_control_id", "ai_telnyx_leg_id", "ai_telnyx_session_id"]
        : null;

  if (roleFields) {
    if (payload?.call_control_id) patch[roleFields[0]] = String(payload.call_control_id);
    if (payload?.call_leg_id) patch[roleFields[1]] = String(payload.call_leg_id);
    if (payload?.call_session_id) patch[roleFields[2]] = String(payload.call_session_id);
  }

  let stateHint = null;
  if (type === "call.answered" && role === "prospect") stateHint = "prospect_connected";
  if (type === "call.answered" && role === "ai") stateHint = "ai_sip_connected";
  if (type === "conference.participant.joined" && role === "ai") stateHint = "ai_joined";
  if (type === "call.hangup" && role === "prospect") stateHint = "prospect_disconnected";
  if (type === "call.hangup" && role === "ai") stateHint = "ai_disconnected";

  return {
    provider: "telnyx",
    event_id: String(envelope?.id || "").trim(),
    type,
    occurred_at: envelope?.occurred_at || null,
    sales_call_id: salesCallId,
    correlation_id: correlationId,
    role,
    state_hint: stateHint,
    patch,
    payload,
    provider_headers: providerHeaders
  };
}

export function salesTelnyxCallPatch(role, data) {
  const normalized = normalizeTelnyxCall(data);
  if (role === "operator") {
    return compactSalesObject({
      operator_call_control_id: normalized.call_control_id || undefined,
      operator_leg_id: normalized.call_leg_id || undefined,
      operator_session_id: normalized.call_session_id || undefined
    });
  }
  if (role === "prospect") {
    return compactSalesObject({
      prospect_call_control_id: normalized.call_control_id || undefined,
      prospect_leg_id: normalized.call_leg_id || undefined,
      prospect_session_id: normalized.call_session_id || undefined
    });
  }
  if (role === "ai") {
    return compactSalesObject({
      ai_telnyx_call_control_id: normalized.call_control_id || undefined,
      ai_telnyx_leg_id: normalized.call_leg_id || undefined,
      ai_telnyx_session_id: normalized.call_session_id || undefined
    });
  }
  throw new Error("unsupported_sales_call_role");
}

export function createSalesTelnyxClient({
  apiKey,
  callControlApplicationId,
  callerId,
  baseUrl,
  fetchImpl,
  sleep,
  maxAttempts = 3,
  retryBaseDelayMs = 100,
  requestTimeoutMs
} = {}) {
  const resolveApiKey = () => requireSalesValue(
    apiKey || process.env.SALES_TELNYX_API_KEY,
    "sales_telnyx_api_key"
  );
  const resolveConnectionId = (override) => requireSalesValue(
    override
      || callControlApplicationId
      || process.env.SALES_TELNYX_CALL_CONTROL_APP_ID,
    "sales_telnyx_call_control_app_id"
  );
  const resolveCallerId = (override) => requireSalesValue(
    override || callerId || process.env.SALES_TELNYX_CALLER_ID,
    "sales_telnyx_caller_id"
  );
  const resolveFetch = () => {
    const selected = fetchImpl || globalThis.fetch;
    if (typeof selected !== "function") throw new Error("fetch_unavailable");
    return selected;
  };
  const resolveBaseUrl = () => normalizeBaseUrl(
    baseUrl || process.env.SALES_TELNYX_API_BASE_URL,
    DEFAULT_TELNYX_BASE_URL
  );
  const resolveRequestTimeoutMs = (override) => Math.max(
    25,
    Math.min(
      30000,
      Number(
        override
        || requestTimeoutMs
        || process.env.SALES_TELNYX_HTTP_TIMEOUT_MS
        || 8000
      ) || 8000
    )
  );

  async function request(path, {
    method = "POST",
    body,
    operation,
    retry = true,
    timeoutMs
  } = {}) {
    return withSalesProviderRetry(async () => {
      let response;
      let parsed;
      let timedOut = false;
      const abortController = new AbortController();
      let timeout;
      try {
        const providerRequest = (async () => {
          const providerResponse = await resolveFetch()(
            `${resolveBaseUrl()}${path}`,
            {
              method,
              headers: {
                Authorization: `Bearer ${resolveApiKey()}`,
                Accept: "application/json",
                ...(body === undefined
                  ? {}
                  : { "Content-Type": "application/json" })
              },
              signal: abortController.signal,
              ...(body === undefined ? {} : { body: JSON.stringify(body) })
            }
          );
          return {
            response: providerResponse,
            parsed: await readSalesProviderResponse(providerResponse)
          };
        })();
        const completed = await Promise.race([
          providerRequest,
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              timedOut = true;
              abortController.abort();
              reject(new Error("sales_telnyx_request_timeout"));
            }, resolveRequestTimeoutMs(timeoutMs));
          })
        ]);
        response = completed.response;
        parsed = completed.parsed;
      } catch (cause) {
        throw new SalesProviderError(`Telnyx ${operation} network failure`, {
          provider: "telnyx",
          operation,
          code: timedOut ? "request_timeout" : "network_error",
          retryable: retry,
          cause
        });
      } finally {
        if (timeout) clearTimeout(timeout);
      }

      if (!response.ok) {
        const code = parsed.json?.errors?.[0]?.code || parsed.json?.error?.code || response.status;
        throw new SalesProviderError(
          `Telnyx ${operation} failed (${response.status}): ${telnyxErrorDetail(parsed.json, parsed.rawBody)}`,
          {
            provider: "telnyx",
            operation,
            status: response.status,
            code,
            responseBody: parsed.rawBody,
            retryable: retry && isTransientProviderStatus(response.status)
          }
        );
      }
      return parsed.json || {};
    }, {
      maxAttempts: retry ? maxAttempts : 1,
      baseDelayMs: retryBaseDelayMs,
      sleep
    });
  }

  async function dialCall({
    to,
    from,
    callControlApplicationId: selectedCallControlApplicationId,
    clientState,
    commandId,
    timeoutSeconds = 30,
    timeLimitSeconds = 3600,
    conferenceConfig,
    sipHeaders,
    sipTransportProtocol,
    sendSilenceWhenIdle
  }) {
    requireSalesValue(commandId, "command_id");
    const payload = compactSalesObject({
      to: requireSalesValue(to, "to"),
      from: resolveCallerId(from),
      connection_id: resolveConnectionId(selectedCallControlApplicationId),
      client_state: clientState || undefined,
      command_id: commandId,
      timeout_secs: Math.max(5, Math.min(600, Number(timeoutSeconds) || 30)),
      time_limit_secs: Math.max(30, Math.min(14400, Number(timeLimitSeconds) || 3600)),
      conference_config: conferenceConfig,
      sip_headers: sipHeaders,
      sip_transport_protocol: sipTransportProtocol,
      send_silence_when_idle: sendSilenceWhenIdle
    });
    const result = await request("/calls", {
      operation: "dial",
      body: payload
    });
    return {
      data: result?.data || {},
      call: normalizeTelnyxCall(result?.data || {}),
      command_id: commandId
    };
  }

  async function listConferenceParticipants({
    conferenceId,
    requestTimeoutMs,
    retry = true
  }) {
    const result = await request(
      `/conferences/${encodeURIComponent(requireSalesValue(conferenceId, "conference_id"))}/participants`,
      {
        method: "GET",
        operation: "list_conference_participants",
        timeoutMs: requestTimeoutMs,
        retry
      }
    );
    return Array.isArray(result?.data) ? result.data : [];
  }

  return {
    async createConference({
      anchorCallControlId,
      name,
      clientState,
      commandId,
      durationMinutes = 60
    }) {
      requireSalesValue(commandId, "command_id");
      const result = await request("/conferences", {
        operation: "create_conference",
        body: {
          call_control_id: requireSalesValue(anchorCallControlId, "anchor_call_control_id"),
          name: requireSalesValue(name, "conference_name"),
          client_state: clientState || undefined,
          command_id: commandId,
          beep_enabled: "never",
          comfort_noise: true,
          start_conference_on_create: true,
          max_participants: 3,
          duration_minutes: Math.max(1, Math.min(240, Number(durationMinutes) || 60))
        }
      });
      return {
        data: result?.data || {},
        conference_id: String(result?.data?.id || "").trim() || null,
        conference_name: String(result?.data?.name || name).trim(),
        command_id: commandId
      };
    },

    dialProspect({
      to,
      conferenceName,
      from,
      callControlApplicationId: selectedCallControlApplicationId,
      clientState,
      commandId,
      timeoutSeconds = 30,
      timeLimitSeconds = 3600
    }) {
      return dialCall({
        to,
        from,
        callControlApplicationId: selectedCallControlApplicationId,
        clientState,
        commandId,
        timeoutSeconds,
        timeLimitSeconds,
        conferenceConfig: {
          conference_name: requireSalesValue(conferenceName, "conference_name"),
          start_conference_on_enter: true
        }
      });
    },

    dialOpenAISipStandby({
      sipUri,
      from,
      callControlApplicationId: selectedCallControlApplicationId,
      clientState,
      commandId,
      userToUser,
      timeoutSeconds = 30,
      timeLimitSeconds = 3600
    }) {
      return dialCall({
        to: requireSalesValue(sipUri, "openai_sip_uri"),
        from,
        callControlApplicationId: selectedCallControlApplicationId,
        clientState,
        commandId,
        timeoutSeconds,
        timeLimitSeconds,
        sipHeaders: userToUser
          ? [{ name: "User-to-User", value: String(userToUser) }]
          : undefined,
        sipTransportProtocol: "TLS",
        sendSilenceWhenIdle: true
      });
    },

    async joinConference({
      conferenceId,
      callControlId,
      clientState,
      commandId
    }) {
      requireSalesValue(commandId, "command_id");
      const result = await request(
        `/conferences/${encodeURIComponent(requireSalesValue(conferenceId, "conference_id"))}/actions/join`,
        {
          operation: "join_conference",
          body: {
            call_control_id: requireSalesValue(callControlId, "call_control_id"),
            client_state: clientState || undefined,
            command_id: commandId,
            end_conference_on_exit: false,
            soft_end_conference_on_exit: false,
            hold: false,
            mute: false,
            supervisor_role: "barge",
            beep_enabled: "never"
          }
        }
      );
      return { data: result?.data || {}, command_id: commandId };
    },

    async leaveConference({
      conferenceId,
      callControlId,
      commandId
    }) {
      requireSalesValue(commandId, "command_id");
      let result;
      try {
        result = await request(
          `/conferences/${encodeURIComponent(requireSalesValue(conferenceId, "conference_id"))}/actions/leave`,
          {
            operation: "leave_conference",
            body: {
              call_control_id: requireSalesValue(callControlId, "call_control_id"),
              command_id: commandId,
              beep_enabled: "never"
            }
          }
        );
      } catch (error) {
        if (!telnyxResourceAlreadyGone(error)) throw error;
        result = { data: { result: "already_gone" } };
      }
      return { data: result?.data || {}, command_id: commandId };
    },

    async hangupCall({ callControlId, commandId }) {
      requireSalesValue(commandId, "command_id");
      let result;
      try {
        result = await request(
          `/calls/${encodeURIComponent(requireSalesValue(callControlId, "call_control_id"))}/actions/hangup`,
          {
            operation: "hangup_call",
            body: { command_id: commandId }
          }
        );
      } catch (error) {
        if (!telnyxResourceAlreadyGone(error)) throw error;
        result = { data: { result: "already_gone" } };
      }
      return { data: result?.data || {}, command_id: commandId };
    },

    async endConference({ conferenceId, commandId }) {
      requireSalesValue(commandId, "command_id");
      let result;
      try {
        result = await request(
          `/conferences/${encodeURIComponent(requireSalesValue(conferenceId, "conference_id"))}/actions/end`,
          {
            operation: "end_conference",
            body: { command_id: commandId }
          }
        );
      } catch (error) {
        if (!telnyxResourceAlreadyGone(error)) throw error;
        result = { data: { result: "already_gone" } };
      }
      return { data: result?.data || {}, command_id: commandId };
    },

    listConferenceParticipants,

    async waitForConferenceParticipant({
      conferenceId,
      callControlId,
      timeoutMs = 5000,
      pollIntervalMs = 100
    }) {
      const target = requireSalesValue(callControlId, "call_control_id");
      const startedAt = Date.now();
      while (Date.now() - startedAt <= timeoutMs) {
        const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
        const participants = await listConferenceParticipants({
          conferenceId,
          requestTimeoutMs: remainingMs,
          retry: false
        });
        const participant = participants.find((entry) => (
          String(entry?.call_control_id || "") === target
          && JOINED_PARTICIPANT_STATUSES.has(
            String(entry?.status || "").toLowerCase()
          )
        ));
        if (participant) return participant;
        const delayMs = Math.min(
          Math.max(0, Number(pollIntervalMs) || 0),
          Math.max(0, timeoutMs - (Date.now() - startedAt))
        );
        await (sleep || ((selectedDelayMs) => (
          new Promise((resolve) => setTimeout(resolve, selectedDelayMs))
        )))(delayMs);
      }
      throw new SalesProviderError("Telnyx conference participant join confirmation timed out", {
        provider: "telnyx",
        operation: "wait_for_conference_participant",
        code: "participant_join_timeout",
        retryable: false
      });
    }
  };
}
