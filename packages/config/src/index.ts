import { z } from "zod";

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development")
});

const callGatewayEnvSchema = baseSchema.extend({
  PORT: z.coerce.number().int().positive().default(3101),
  TELNYX_PUBLIC_KEY: z.string().min(1).optional(),
  TELNYX_API_KEY: z.string().min(1).optional(),
  TELNYX_AI_MODEL: z.string().min(1).optional(),
  TELNYX_TRANSCRIPTION_MODEL: z.string().min(1).optional(),
  XAI_API_KEY: z.string().min(1).optional(),
  XAI_REALTIME_AUDIO_RATE_PER_MINUTE_USD: z.string().min(1).optional(),
  TELNYX_RTP_PAYLOAD_TYPE: z.string().min(1).optional(),
  TELNYX_BIDIRECTIONAL_PAYLOAD_MODE: z.string().min(1).optional(),
  APP_BASE_URL: z.string().min(1).optional(),
  CALL_SUMMARY_TOKEN: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional()
});

export type CallGatewayEnv = z.infer<typeof callGatewayEnvSchema>;

export function readCallGatewayEnv(env: NodeJS.ProcessEnv): CallGatewayEnv {
  return callGatewayEnvSchema.parse(env);
}
