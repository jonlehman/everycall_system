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

function audioFormat(value: unknown, fallback = "g711_ulaw") {
  const normalized = normalizeText(value) || fallback;
  return normalized;
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
      input_audio_format: audioFormat(config.input_audio_format ?? config.inputAudioFormat),
      output_audio_format: audioFormat(config.output_audio_format ?? config.outputAudioFormat),
      voice: normalizeText(config.voice) || "eve",
      turn_detection: buildRealtimeTurnDetectionConfig(config.turn_detection ?? config.turnDetection),
      input_audio_transcription: {
        model: "grok-transcribe",
        language: "en"
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
