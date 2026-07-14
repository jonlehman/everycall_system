export type RealtimeApiShape = "legacy" | "realtime2";

export type RealtimeSessionConfig = {
  model?: string;
  voice?: string;
  max_output_tokens?: number;
  maxOutputTokens?: number;
  turn_detection?: Record<string, unknown> | null;
  turnDetection?: Record<string, unknown> | null;
  transcription_model?: string;
  transcriptionModel?: string;
  noise_reduction?: string | null;
  noiseReduction?: string | null;
  input_audio_format?: string;
  inputAudioFormat?: string;
  output_audio_format?: string;
  outputAudioFormat?: string;
};

type RealtimeSessionUpdateInput = {
  apiShape: RealtimeApiShape;
  instructions: string;
  tools: Array<Record<string, unknown>>;
  sessionConfig: RealtimeSessionConfig;
};

type OpenAiRealtimeHeadersInput = {
  apiKey: string;
  apiShape: RealtimeApiShape;
  safetyIdentifier?: string | null;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => pruneUndefined(item)) as T;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === undefined) continue;
    output[key] = pruneUndefined(entry);
  }
  return output as T;
}

export function isRealtime2Model(model: unknown) {
  const normalized = normalizeText(model).toLowerCase();
  return /^gpt-realtime-2(?:$|[.-])/.test(normalized);
}

export function resolveRealtimeApiShape(configured: unknown, model?: unknown): RealtimeApiShape {
  const normalized = normalizeText(configured).toLowerCase();
  if (["realtime2", "realtime_2", "v2", "current", "nested"].includes(normalized)) {
    return "realtime2";
  }
  if (["legacy", "v1", "classic"].includes(normalized)) {
    return "legacy";
  }
  return isRealtime2Model(model) ? "realtime2" : "legacy";
}

export function buildOpenAiRealtimeHeaders(input: OpenAiRealtimeHeadersInput) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.apiKey}`
  };
  if (input.apiShape === "legacy") {
    headers["OpenAI-Beta"] = "realtime=v1";
  }
  const safetyIdentifier = normalizeText(input.safetyIdentifier);
  if (safetyIdentifier) {
    headers["OpenAI-Safety-Identifier"] = safetyIdentifier;
  }
  return headers;
}

export function buildRealtimeTurnDetectionConfig(turnDetection: Record<string, unknown> | null | undefined) {
  if (turnDetection === null) return null;
  const type = normalizeText(turnDetection?.type || "semantic_vad") || "semantic_vad";
  const createResponse = turnDetection?.create_response === undefined ? true : Boolean(turnDetection.create_response);
  const interruptResponse = turnDetection?.interrupt_response === undefined ? true : Boolean(turnDetection.interrupt_response);
  if (type === "semantic_vad") {
    const eagerness = normalizeText(turnDetection?.eagerness || "high") || "high";
    return {
      type: "semantic_vad",
      eagerness,
      create_response: createResponse,
      interrupt_response: interruptResponse
    };
  }
  return {
    type,
    threshold: typeof turnDetection?.threshold === "number" ? turnDetection.threshold : 0.75,
    prefix_padding_ms: typeof turnDetection?.prefix_padding_ms === "number" ? turnDetection.prefix_padding_ms : 300,
    silence_duration_ms: typeof turnDetection?.silence_duration_ms === "number" ? turnDetection.silence_duration_ms : 600,
    idle_timeout_ms: turnDetection?.idle_timeout_ms === undefined ? null : turnDetection.idle_timeout_ms,
    create_response: createResponse,
    interrupt_response: interruptResponse
  };
}

function legacyAudioFormat(value: unknown, fallback: string) {
  return normalizeText(value) || fallback;
}

export function realtime2AudioFormat(value: unknown, fallback = "g711_ulaw") {
  const normalized = (normalizeText(value) || fallback).toLowerCase();
  if (normalized === "pcm16" || normalized === "pcm" || normalized === "audio/pcm") {
    return { type: "audio/pcm", rate: 24000 };
  }
  if (["g711_ulaw", "ulaw", "pcmu", "audio/pcmu"].includes(normalized)) {
    return { type: "audio/pcmu" };
  }
  if (["g711_alaw", "alaw", "pcma", "audio/pcma"].includes(normalized)) {
    return { type: "audio/pcma" };
  }
  return realtime2AudioFormat(fallback, "g711_ulaw");
}

function maxOutputTokens(sessionConfig: RealtimeSessionConfig) {
  const raw = sessionConfig.max_output_tokens ?? sessionConfig.maxOutputTokens;
  return Number.isFinite(Number(raw)) ? Number(raw) : 4096;
}

function turnDetectionConfig(sessionConfig: RealtimeSessionConfig) {
  return buildRealtimeTurnDetectionConfig(sessionConfig.turn_detection ?? sessionConfig.turnDetection);
}

export function buildRealtimeSessionUpdateEvent(input: RealtimeSessionUpdateInput) {
  const sessionConfig = input.sessionConfig || {};
  const inputFormat = legacyAudioFormat(sessionConfig.input_audio_format ?? sessionConfig.inputAudioFormat, "g711_ulaw");
  const outputFormat = legacyAudioFormat(sessionConfig.output_audio_format ?? sessionConfig.outputAudioFormat, "g711_ulaw");
  const voice = normalizeText(sessionConfig.voice) || "marin";
  const transcriptionModel = normalizeText(sessionConfig.transcription_model || sessionConfig.transcriptionModel)
    || "gpt-4o-mini-transcribe";
  const noiseReduction = normalizeText(sessionConfig.noise_reduction ?? sessionConfig.noiseReduction);

  if (input.apiShape === "realtime2") {
    return pruneUndefined({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: input.instructions,
        tools: input.tools,
        output_modalities: ["audio"],
        audio: {
          input: {
            format: realtime2AudioFormat(inputFormat, "g711_ulaw"),
            transcription: {
              model: transcriptionModel,
              language: "en"
            },
            noise_reduction: noiseReduction ? { type: noiseReduction } : undefined,
            turn_detection: turnDetectionConfig(sessionConfig)
          },
          output: {
            format: realtime2AudioFormat(outputFormat, "g711_ulaw"),
            voice
          }
        },
        max_output_tokens: maxOutputTokens(sessionConfig)
      }
    });
  }

  return pruneUndefined({
    type: "session.update",
    session: {
      modalities: ["audio", "text"],
      instructions: input.instructions,
      tools: input.tools,
      input_audio_format: inputFormat,
      output_audio_format: outputFormat,
      voice,
      turn_detection: turnDetectionConfig(sessionConfig),
      input_audio_transcription: {
        model: transcriptionModel,
        language: "en"
      },
      input_audio_noise_reduction: noiseReduction ? { type: noiseReduction } : undefined,
      max_response_output_tokens: maxOutputTokens(sessionConfig)
    }
  });
}

export function buildRealtimeResponseCreateEvent(
  response: Record<string, unknown> = {},
  apiShape: RealtimeApiShape
) {
  if (apiShape === "realtime2") {
    const { modalities: _modalities, ...rest } = response;
    return {
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        ...rest
      }
    };
  }
  return {
    type: "response.create",
    response: {
      modalities: ["audio", "text"],
      ...response
    }
  };
}
