import { type TtsSynthesizeRequest } from "@everycall/contracts";

type VoiceConfig = {
  elevenLabsApiKey: string | undefined;
  elevenLabsModelId: string;
};

export type SynthesisResult = {
  chunks: Buffer[];
  provider: "elevenlabs" | "fallback";
};

function fallbackChunks(text: string): Buffer[] {
  const prefix = text.slice(0, 64);
  return [Buffer.from(`AUDIO_FALLBACK:${prefix}`)];
}

export async function synthesizeSpeech(
  request: TtsSynthesizeRequest,
  config: VoiceConfig
): Promise<SynthesisResult> {
  if (!config.elevenLabsApiKey || request.provider !== "elevenlabs") {
    return { chunks: fallbackChunks(request.text), provider: "fallback" };
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${request.voice.voice_id}/stream`;
  const payload = {
    model_id: config.elevenLabsModelId,
    text: request.text,
    voice_settings: {
      stability: request.voice.stability,
      similarity_boost: request.voice.similarity_boost,
      style: request.voice.style
    },
    output_format: request.audio.sample_rate_hz === 8000 ? "ulaw_8000" : "mp3_44100_128"
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": config.elevenLabsApiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg"
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    return { chunks: fallbackChunks(request.text), provider: "fallback" };
  }

  const arr = await resp.arrayBuffer();
  return { chunks: [Buffer.from(arr)], provider: "elevenlabs" };
}
