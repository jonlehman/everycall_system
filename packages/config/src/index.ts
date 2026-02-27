import { z } from "zod";

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development")
});

const callGatewayEnvSchema = baseSchema.extend({
  PORT: z.coerce.number().int().positive().default(3101),
  TELNYX_PUBLIC_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional()
});

const aiOrchestratorEnvSchema = baseSchema.extend({
  PORT: z.coerce.number().int().positive().default(3102),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini")
});

const voiceServiceEnvSchema = baseSchema.extend({
  PORT: z.coerce.number().int().positive().default(3103),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_MODEL_ID: z.string().min(1).default("eleven_turbo_v2_5"),
  ELEVENLABS_DEFAULT_VOICE_ID: z.string().min(1).default("56AoDkrOh6qfVPDXZ7Pt")
});

export type CallGatewayEnv = z.infer<typeof callGatewayEnvSchema>;
export type AiOrchestratorEnv = z.infer<typeof aiOrchestratorEnvSchema>;
export type VoiceServiceEnv = z.infer<typeof voiceServiceEnvSchema>;

export function readCallGatewayEnv(env: NodeJS.ProcessEnv): CallGatewayEnv {
  return callGatewayEnvSchema.parse(env);
}

export function readAiOrchestratorEnv(env: NodeJS.ProcessEnv): AiOrchestratorEnv {
  return aiOrchestratorEnvSchema.parse(env);
}

export function readVoiceServiceEnv(env: NodeJS.ProcessEnv): VoiceServiceEnv {
  return voiceServiceEnvSchema.parse(env);
}
