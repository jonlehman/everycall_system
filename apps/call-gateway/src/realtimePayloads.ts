export type RealtimeSessionConfig = {
  voice?: string;
  reasoning?: { effort?: string } | null;
  reasoning_effort?: string;
  reasoningEffort?: string;
  turn_detection?: Record<string, unknown> | null;
  turnDetection?: Record<string, unknown> | null;
  input_audio_format?: string;
  inputAudioFormat?: string;
  output_audio_format?: string;
  outputAudioFormat?: string;
};

type RealtimeSessionUpdateInput = {
  instructions: string;
  tools: Array<Record<string, unknown>>;
  sessionConfig: RealtimeSessionConfig;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function xAiAudioFormat(value: unknown, fallback = "g711_ulaw"): { type: string; rate?: number } {
  const normalized = (normalizeText(value) || fallback).toLowerCase();
  if (["g711_ulaw", "ulaw", "pcmu", "audio/pcmu"].includes(normalized)) {
    return { type: "audio/pcmu" };
  }
  if (["g711_alaw", "alaw", "pcma", "audio/pcma"].includes(normalized)) {
    return { type: "audio/pcma" };
  }
  if (["pcm16", "pcm", "audio/pcm"].includes(normalized)) {
    return { type: "audio/pcm", rate: 24000 };
  }
  if (["opus", "audio/opus"].includes(normalized)) {
    return { type: "audio/opus" };
  }
  return xAiAudioFormat(fallback, "g711_ulaw");
}

function xAiReasoningEffort(config: RealtimeSessionConfig) {
  const configured = normalizeText(
    config.reasoning?.effort ?? config.reasoning_effort ?? config.reasoningEffort
  ).toLowerCase();
  return configured === "none" ? "none" : "high";
}

const DEFAULT_XAI_VAD_THRESHOLD = 0.9;

export function buildXAiRealtimeHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}` };
}

export function buildRealtimeTurnDetectionConfig(
  configured: Record<string, unknown> | null | undefined
) {
  if (configured === null) return null;
  const result: Record<string, unknown> = {
    type: "server_vad",
    threshold: typeof configured?.threshold === "number"
      ? Math.max(0.1, Math.min(0.9, configured.threshold))
      : DEFAULT_XAI_VAD_THRESHOLD,
    silence_duration_ms: typeof configured?.silence_duration_ms === "number"
      ? configured.silence_duration_ms
      : 350
  };
  if (typeof configured?.prefix_padding_ms === "number") {
    result.prefix_padding_ms = configured.prefix_padding_ms;
  }
  if (configured?.idle_timeout_ms === null || typeof configured?.idle_timeout_ms === "number") {
    result.idle_timeout_ms = configured.idle_timeout_ms;
  }
  return result;
}

export function buildRealtimeSessionUpdateEvent(input: RealtimeSessionUpdateInput) {
  const config = input.sessionConfig || {};
  return {
    type: "session.update",
    session: {
      instructions: input.instructions,
      tools: input.tools,
      voice: normalizeText(config.voice) || "ara",
      reasoning: { effort: xAiReasoningEffort(config) },
      turn_detection: buildRealtimeTurnDetectionConfig(config.turn_detection ?? config.turnDetection),
      audio: {
        input: {
          format: xAiAudioFormat(config.input_audio_format ?? config.inputAudioFormat),
          transport: "json",
          transcription: {
            model: "grok-transcribe",
            language_hint: "en"
          }
        },
        output: {
          format: xAiAudioFormat(config.output_audio_format ?? config.outputAudioFormat),
          transport: "json"
        }
      }
    }
  };
}

export function buildRealtimeResponseCreateEvent(response: Record<string, unknown> = {}) {
  return Object.keys(response).length
    ? { type: "response.create", response }
    : { type: "response.create" };
}
