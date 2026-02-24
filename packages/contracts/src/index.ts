import { z } from "zod";

export const inboundWebhookSchema = z.object({
  CallSid: z.string().min(1),
  From: z.string().min(1),
  To: z.string().min(1),
  CallStatus: z.string().min(1),
  Direction: z.string().min(1),
  AccountSid: z.string().min(1).optional(),
  ApiVersion: z.string().min(1).optional(),
  CallerName: z.string().min(1).optional(),
  ForwardedFrom: z.string().min(1).optional()
});

export const orchestrateTurnSchema = z.object({
  trace_id: z.string().min(1),
  tenant_id: z.string().min(1),
  call_id: z.string().min(1),
  turn_id: z.string().min(1),
  caller_input: z.object({
    type: z.enum(["text", "audio_text"]),
    text: z.string().min(1)
  }),
  context: z.object({
    from_number: z.string().min(1),
    to_number: z.string().min(1),
    business_profile: z
      .object({
        name: z.string().min(1),
        timezone: z.string().min(1)
      })
      .passthrough(),
    faq_items: z
      .array(
        z.object({
          q: z.string().min(1),
          a: z.string().min(1)
        })
      )
      .default([])
  })
});

export const nextActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("speak"), text: z.string().min(1) }),
  z.object({
    type: z.literal("tool_call"),
    tool_name: z.string().min(1),
    tool_args: z.record(z.any()),
    idempotency_key: z.string().min(1)
  }),
  z.object({ type: z.literal("handoff"), reason: z.string().min(1) }),
  z.object({ type: z.literal("end_call"), reason: z.string().min(1) })
]);

export const ttsSynthesizeSchema = z.object({
  trace_id: z.string().min(1),
  tenant_id: z.string().min(1),
  call_id: z.string().min(1),
  utterance_id: z.string().min(1),
  provider: z.enum(["elevenlabs", "openai"]),
  voice: z.object({
    voice_id: z.string().min(1),
    stability: z.number().min(0).max(1).optional(),
    similarity_boost: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional()
  }),
  audio: z.object({
    format: z.enum(["mulaw", "mp3", "pcm16"]),
    sample_rate_hz: z.number().int().positive()
  }),
  text: z.string().min(1)
});

export type InboundWebhook = z.infer<typeof inboundWebhookSchema>;
export type OrchestrateTurnRequest = z.infer<typeof orchestrateTurnSchema>;
export type NextAction = z.infer<typeof nextActionSchema>;
export type TtsSynthesizeRequest = z.infer<typeof ttsSynthesizeSchema>;
