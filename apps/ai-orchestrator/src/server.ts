import express from "express";
import { readAiOrchestratorEnv } from "@everycall/config";
import { orchestrateTurnSchema } from "@everycall/contracts";
import { logError, logInfo } from "@everycall/observability";
import { decideNextAction } from "@everycall/ai";

const env = readAiOrchestratorEnv(process.env);
const app = express();

app.use(express.json());

app.post("/v1/ai/orchestrate-turn", async (req, res) => {
  const parsed = orchestrateTurnSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: "invalid_payload", details: parsed.error.flatten() });
  }

  const body = parsed.data;

  const decision = await decideNextAction(body, {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL
  });

  const response = {
    trace_id: body.trace_id,
    tenant_id: body.tenant_id,
    call_id: body.call_id,
    turn_id: body.turn_id,
    next_action: decision.nextAction,
    extracted: {
      intent: "general_inquiry",
      urgency: "normal",
      entities: {}
    }
  };

  logInfo("ai_turn_decision", {
    trace_id: body.trace_id,
    call_id: body.call_id,
    tenant_id: body.tenant_id,
    action_type: response.next_action.type,
    decision_provider: decision.provider
  });

  return res.status(200).json(response);
});

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "ai-orchestrator" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logError("ai_orchestrator_unhandled_error", { message: err instanceof Error ? err.message : "unknown" });
  res.status(500).json({ error: "internal_error" });
});

app.listen(env.PORT, () => {
  logInfo("ai_orchestrator_started", {
    port: env.PORT,
    openai_model: env.OPENAI_MODEL,
    openai_enabled: Boolean(env.OPENAI_API_KEY)
  });
});
