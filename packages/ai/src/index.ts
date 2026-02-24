import { type NextAction, nextActionSchema, type OrchestrateTurnRequest } from "@everycall/contracts";

type OpenAiDecisionConfig = {
  apiKey: string | undefined;
  model: string;
};

type OpenAiResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

function fallbackDecision(request: OrchestrateTurnRequest): NextAction {
  const lowerInput = request.caller_input.text.toLowerCase();

  if (lowerInput.includes("human") || lowerInput.includes("agent")) {
    return { type: "handoff", reason: "caller_requested_human" };
  }

  if (lowerInput.includes("bye") || lowerInput.includes("stop")) {
    return { type: "end_call", reason: "caller_ended_conversation" };
  }

  if (lowerInput.includes("appointment") || lowerInput.includes("book")) {
    return {
      type: "tool_call",
      tool_name: "create_lead",
      tool_args: {
        summary: request.caller_input.text,
        source: "inbound_call"
      },
      idempotency_key: `${request.call_id}:${request.turn_id}:create_lead`
    };
  }

  return {
    type: "speak",
    text: "I can help with that. What is the service address?"
  };
}

function parseModelAction(rawText: string, request: OrchestrateTurnRequest): NextAction | null {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    const validated = nextActionSchema.safeParse(parsed);
    if (!validated.success) {
      return null;
    }

    if (validated.data.type === "tool_call" && !validated.data.idempotency_key) {
      return {
        ...validated.data,
        idempotency_key: `${request.call_id}:${request.turn_id}:${validated.data.tool_name}`
      };
    }

    return validated.data;
  } catch {
    return null;
  }
}

export async function decideNextAction(
  request: OrchestrateTurnRequest,
  config: OpenAiDecisionConfig
): Promise<{ nextAction: NextAction; provider: "openai" | "fallback" }> {
  if (!config.apiKey) {
    return { nextAction: fallbackDecision(request), provider: "fallback" };
  }

  const instructions = [
    "You are a call-routing decision engine.",
    "Return only JSON matching one of these shapes:",
    '{"type":"speak","text":"..."}',
    '{"type":"tool_call","tool_name":"create_lead","tool_args":{},"idempotency_key":"..."}',
    '{"type":"handoff","reason":"..."}',
    '{"type":"end_call","reason":"..."}',
    "No markdown. No explanation. JSON only."
  ].join(" ");

  const payload = {
    model: config.model,
    input: [
      {
        role: "system",
        content: instructions
      },
      {
        role: "user",
        content: JSON.stringify(request)
      }
    ]
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    return { nextAction: fallbackDecision(request), provider: "fallback" };
  }

  const json = (await resp.json()) as OpenAiResponse;
  const outputFromArray = json.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text" && typeof item.text === "string")
    ?.text;

  const output = (json.output_text ?? outputFromArray)?.trim();
  if (!output) {
    return { nextAction: fallbackDecision(request), provider: "fallback" };
  }

  const parsedAction = parseModelAction(output, request);
  if (!parsedAction) {
    return { nextAction: fallbackDecision(request), provider: "fallback" };
  }

  return { nextAction: parsedAction, provider: "openai" };
}
