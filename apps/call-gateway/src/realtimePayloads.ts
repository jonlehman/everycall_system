export type RealtimeSessionConfig = {
  voice?: string;
  max_output_tokens?: number;
  maxOutputTokens?: number;
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

function maxOutputTokens(config: RealtimeSessionConfig) {
  const raw = config.max_output_tokens ?? config.maxOutputTokens;
  return Number.isFinite(Number(raw)) ? Number(raw) : 4096;
}

export function buildXAiRealtimeHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}` };
}

export function buildRealtimeTurnDetectionConfig(
  configured: Record<string, unknown> | null | undefined
) {
  if (configured === null) return null;
  return {
    type: "server_vad",
    threshold: typeof configured?.threshold === "number" ? configured.threshold : 0.75,
    prefix_padding_ms: typeof configured?.prefix_padding_ms === "number" ? configured.prefix_padding_ms : 300,
    silence_duration_ms: typeof configured?.silence_duration_ms === "number" ? configured.silence_duration_ms : 600,
    create_response: configured?.create_response === undefined ? true : Boolean(configured.create_response),
    interrupt_response: configured?.interrupt_response === undefined ? true : Boolean(configured.interrupt_response)
  };
}

export function buildRealtimeSessionUpdateEvent(input: RealtimeSessionUpdateInput) {
  const config = input.sessionConfig || {};
  return {
    type: "session.update",
    session: {
      modalities: ["audio", "text"],
      instructions: input.instructions,
      tools: input.tools,
      voice: normalizeText(config.voice) || "eve",
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
      },
      max_response_output_tokens: maxOutputTokens(config)
    }
  };
}

export function buildRealtimeResponseCreateEvent(response: Record<string, unknown> = {}) {
  return {
    type: "response.create",
    response: {
      modalities: ["audio", "text"],
      ...response
    }
  };
}
