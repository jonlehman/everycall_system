import crypto from "node:crypto";
import WebSocket from "ws";
import {
  buildRuntimeToolDefinitions,
  getDefaultPromptBlueprintSeed,
  renderPromptContext
} from "@everycall/contracts";
import {
  buildOpenAiRealtimeHeaders,
  buildRealtimeResponseCreateEvent,
  buildRealtimeSessionUpdateEvent
} from "../apps/call-gateway/dist/apps/call-gateway/src/realtimePayloads.js";

const APPROVAL_ENV = "EVERYCALL_RUN_RECEPTIONIST_V12_REALTIME_ACCEPTANCE";
const LEGACY_APPROVAL_ENV = "EVERYCALL_RUN_RECEPTIONIST_V11_REALTIME_ACCEPTANCE";
const MODEL = String(process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1").trim();
const VOICE = String(process.env.OPENAI_REALTIME_VOICE || "marin").trim();
const TIMEOUT_MS = 45_000;
const MARKETING_PATTERN = /\b(scalable|enterprise[- ](?:grade|level)|robust|tailored|seamless|powerful|disparate|unified operational visibility)\b/i;

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function containsQuestion(value) {
  return /\?/.test(normalizeText(value));
}

function containsCallbackOffer(value) {
  return /\b(call(?:er)? back|callback|follow up|reach out|get in touch)\b/i.test(normalizeText(value))
    && containsQuestion(value);
}

function containsClosing(value) {
  return /\b(thanks for calling|thank you for calling|have a (?:great|good|wonderful)|take care)\b/i.test(normalizeText(value));
}

function containsOptionalNotePrompt(value) {
  const text = normalizeText(value);
  return /\b(?:short note|anything (?:else )?(?:to )?add|share one|most important|attach it|include it)\b/i.test(text);
}

function createCheck(label, passed, details = {}) {
  return { label, passed: Boolean(passed), ...details };
}

const blueprint = getDefaultPromptBlueprintSeed();
const profileA = {
  assistant_name: "Sarah",
  business_name: "Northstar Software",
  company_description: "Northstar Software builds custom internal business software and serves Greater Seattle and Puget Sound.",
  opening_line: "Thanks for calling Northstar Software. This is Sarah. How can I help you today?",
  ai_disclosure_line: "I’m Northstar Software’s automated assistant.",
  lead_goal: "callback information",
  required_contact_fields: ["caller’s name", "caller’s best phone number"],
  closing_phrase: "Thanks for calling Northstar Software. Have a great rest of your day.",
  basic_no_tool_allowed_statement: "Northstar Software builds custom internal business software."
};
const profileB = {
  ...profileA,
  business_name: "Harbor Ledger",
  company_description: "Harbor Ledger provides bookkeeping services in Tacoma.",
  opening_line: "Thanks for calling Harbor Ledger. This is Sarah. How can I help you today?",
  ai_disclosure_line: "I’m Harbor Ledger’s automated assistant.",
  closing_phrase: "Thanks for calling Harbor Ledger. Have a great rest of your day.",
  basic_no_tool_allowed_statement: "Harbor Ledger provides bookkeeping services."
};
const coreFactsA = [
  "Custom software: We create software for specific business needs and processes.",
  "Service area: We work throughout Puget Sound, from downtown Seattle to the Eastside suburbs.",
  "Internal systems: We build internal systems, tools, and custom platforms rather than marketing websites.",
  "Next.js development: We use Next.js for prototypes, applications, and performance work."
].join("\n");
const coreFactsB = "Bookkeeping: We provide bookkeeping services in Tacoma.";
const fieldSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    outcome_type: { type: "string", enum: ["callback", "information_only", "declined"] },
    first_name: { type: "string" },
    last_name: { type: "string" },
    phone_e164: { type: "string" },
    project_summary: { type: "string" },
    note: { type: "string" }
  },
  required: ["outcome_type"]
};
const tools = buildRuntimeToolDefinitions(blueprint, fieldSchema, { includeTransferTools: false });

function renderFixture(mode, profile = profileA) {
  return renderPromptContext(blueprint, profile, {
    promptMode: mode,
    coreFactsBlock: profile === profileA ? coreFactsA : coreFactsB
  });
}

class RealtimeAcceptanceSession {
  constructor({ instructions, label }) {
    this.instructions = instructions;
    this.label = label;
    this.socket = null;
    this.events = [];
    this.waiters = [];
  }

  pushEvent(event) {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(event);
    else this.events.push(event);
  }

  nextEvent() {
    if (this.events.length) return Promise.resolve(this.events.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`realtime_acceptance_timeout:${this.label}`)), TIMEOUT_MS);
      this.waiters.push({
        resolve: (event) => {
          clearTimeout(timer);
          resolve(event);
        }
      });
    });
  }

  send(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`realtime_acceptance_socket_not_open:${this.label}`);
    }
    this.socket.send(JSON.stringify(payload));
  }

  async waitForType(type) {
    while (true) {
      const event = await this.nextEvent();
      if (event.type === "error") {
        throw new Error(`realtime_acceptance_error:${this.label}:${event.error?.message || "unknown"}`);
      }
      if (event.type === type) return event;
    }
  }

  async connect() {
    const apiKey = normalizeText(process.env.OPENAI_API_KEY);
    if (!apiKey) throw new Error("OPENAI_API_KEY is required");
    const safetyIdentifier = crypto.createHash("sha256").update("everycall:realtime-receptionist").digest("hex");
    this.socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}`, {
      headers: buildOpenAiRealtimeHeaders({ apiKey, apiShape: "realtime2", safetyIdentifier })
    });
    this.socket.on("message", (data) => {
      try {
        this.pushEvent(JSON.parse(data.toString()));
      } catch {
        // Ignore non-JSON provider frames.
      }
    });
    this.socket.on("error", (error) => this.pushEvent({ type: "error", error: { message: error.message } }));
    await this.waitForType("session.created");
    this.send(buildRealtimeSessionUpdateEvent({
      apiShape: "realtime2",
      instructions: this.instructions,
      tools,
      sessionConfig: {
        model: MODEL,
        voice: VOICE,
        max_output_tokens: 900,
        turn_detection: null,
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw"
      }
    }));
    await this.waitForType("session.updated");
  }

  async collectResponse() {
    const transcripts = [];
    const toolCalls = new Map();
    let usage = {};
    while (true) {
      const event = await this.nextEvent();
      if (event.type === "error") {
        throw new Error(`realtime_acceptance_error:${this.label}:${event.error?.message || "unknown"}`);
      }
      if (["response.output_audio_transcript.done", "response.audio_transcript.done", "response.output_text.done"].includes(event.type)) {
        const text = normalizeText(event.transcript || event.text || event.data);
        if (text) transcripts.push(text);
      }
      if (event.type === "response.function_call_arguments.done") {
        const callId = normalizeText(event.call_id || event.function_call?.call_id || event.response_id);
        if (callId) toolCalls.set(callId, {
          callId,
          name: normalizeText(event.name || event.function_call?.name),
          arguments: normalizeText(event.arguments || event.function_call?.arguments)
        });
      }
      if (event.type === "response.output_item.done") {
        const item = event.item || event.output_item || {};
        if (item.type === "function_call") {
          const callId = normalizeText(item.call_id || item.id);
          if (callId) toolCalls.set(callId, {
            callId,
            name: normalizeText(item.name),
            arguments: normalizeText(item.arguments)
          });
        }
      }
      if (event.type === "response.done") {
        usage = event.response?.usage || event.usage || {};
        for (const item of event.response?.output || []) {
          if (item?.type !== "function_call") continue;
          const callId = normalizeText(item.call_id || item.id);
          if (callId) toolCalls.set(callId, {
            callId,
            name: normalizeText(item.name),
            arguments: normalizeText(item.arguments)
          });
        }
        return { transcripts, toolCalls: [...toolCalls.values()], usage };
      }
    }
  }

  toolOutput(toolCall) {
    if (toolCall.name === "knowledge_lookup") {
      const args = (() => {
        try { return JSON.parse(toolCall.arguments || "{}"); } catch { return {}; }
      })();
      if (/\b(?:repair|fix|freez|stuck|sticking)\b/i.test(normalizeText(args.query))) {
        return { status: "not_found", answer: "The approved information does not confirm repair work for existing systems." };
      }
      return { status: "answered", answer: "Northstar Software builds custom internal software and serves Puget Sound." };
    }
    if (toolCall.name === "data_capture") return { status: "accepted" };
    if (toolCall.name === "lookup_transfer_target") return { status: "unavailable", matches: [] };
    if (toolCall.name === "transfer_call") return { status: "failed", reason: "staging_target_unavailable" };
    return { status: "accepted" };
  }

  async collectTurn() {
    const responses = [];
    const transcripts = [];
    const toolCalls = [];
    for (let cycle = 0; cycle < 8; cycle += 1) {
      const response = await this.collectResponse();
      responses.push(response);
      transcripts.push(...response.transcripts);
      toolCalls.push(...response.toolCalls);
      const continuations = response.toolCalls.filter((toolCall) => toolCall.name !== "finish_session");
      if (!continuations.length) {
        return { text: normalizeText(transcripts.join(" ")), toolCalls, responses };
      }
      for (const toolCall of continuations) {
        this.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: toolCall.callId,
            output: JSON.stringify(this.toolOutput(toolCall))
          }
        });
      }
      this.send(buildRealtimeResponseCreateEvent({}, "realtime2"));
    }
    throw new Error(`realtime_acceptance_tool_loop:${this.label}`);
  }

  async assistantTurn() {
    this.send(buildRealtimeResponseCreateEvent({}, "realtime2"));
    return this.collectTurn();
  }

  async callerTurn(text) {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }]
      }
    });
    return this.assistantTurn();
  }

  close() {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close();
  }
}

async function withSession(mode, caseName, profile, run) {
  const rendered = renderFixture(mode, profile);
  const session = new RealtimeAcceptanceSession({
    instructions: rendered.startupPrompt,
    label: `${mode}:${caseName}:${profile.business_name}`
  });
  await session.connect();
  try {
    return await run(session, rendered);
  } finally {
    session.close();
  }
}

async function reachCallbackOffer(session) {
  const turns = [];
  turns.push(await session.callerTurn("We need a custom scheduling and customer-record system for our staff. We're comparing options and want to understand the next step."));
  const followUps = [
    "About twenty employees would use it, and we would like to start in two months. What happens next?",
    "That covers the project. What would the next step be?",
    "I’m interested. What do you suggest as the next step?"
  ];
  for (let index = 0; index < followUps.length && !containsCallbackOffer(turns.at(-1)?.text); index += 1) {
    turns.push(await session.callerTurn(followUps[index]));
  }
  return { turns, offer: turns.find((turn) => containsCallbackOffer(turn.text)) || turns.at(-1) };
}

async function runCaptureCase(mode) {
  return withSession(mode, "capture", profileA, async (session) => {
    await session.assistantTurn();
    const checks = [];
    const callback = await reachCallbackOffer(session);
    checks.push(createCheck("callback offer waits for explicit yes", containsCallbackOffer(callback.offer?.text)
      && !/\b(?:your name|name and|phone|number)\b/i.test(callback.offer?.text), { observed: callback.offer?.text }));
    const nameTurn = await session.callerTurn("Yes, please.");
    checks.push(createCheck("name requested only after yes", /\bname\b/i.test(nameTurn.text) && !/\b(phone|number)\b/i.test(nameTurn.text), { observed: nameTurn.text }));
    const nameTurns = [await session.callerTurn("I'm John Lyman.")];
    checks.push(createCheck("name is echoed exactly", /\bJohn Lyman\b/i.test(nameTurns[0].text), { observed: nameTurns[0].text }));
    if (/\bspell\b/i.test(nameTurns.at(-1).text)) {
      nameTurns.push(await session.callerTurn("L Y M A N."));
    }
    if (!/\b(phone|number)\b/i.test(nameTurns.at(-1).text)) {
      nameTurns.push(await session.callerTurn("That's correct."));
    }
    const phoneTurn = nameTurns.at(-1);
    checks.push(createCheck("phone requested after name capture", /\b(phone|number)\b/i.test(phoneTurn.text), { observed: phoneTurn.text }));
    const confirmationTurn = await session.callerTurn("206 555 0199.");
    checks.push(createCheck("number read-back asks and waits", normalizeDigits(confirmationTurn.text).includes("2065550199")
      && containsQuestion(confirmationTurn.text)
      && !confirmationTurn.toolCalls.some((toolCall) => toolCall.name === "finish_session"), { observed: confirmationTurn.text }));

    let closingTurn = await session.callerTurn("Yes, that's right.");
    if ((containsQuestion(closingTurn.text) || containsOptionalNotePrompt(closingTurn.text)) && !containsClosing(closingTurn.text)) {
      checks.push(createCheck("optional note question waits", !closingTurn.toolCalls.some((toolCall) => toolCall.name === "finish_session"), { observed: closingTurn.text }));
      closingTurn = await session.callerTurn("Please note that weekday afternoons are best.");
    }
    if ((containsQuestion(closingTurn.text) || containsOptionalNotePrompt(closingTurn.text)) && !containsClosing(closingTurn.text)) {
      checks.push(createCheck("additional closing question waits", !closingTurn.toolCalls.some((toolCall) => toolCall.name === "finish_session"), { observed: closingTurn.text }));
      closingTurn = await session.callerTurn("No, that's everything.");
    }
    checks.push(createCheck("closing turn contains no question or finish", containsClosing(closingTurn.text)
      && !containsQuestion(closingTurn.text)
      && !closingTurn.toolCalls.some((toolCall) => toolCall.name === "finish_session"), { observed: closingTurn.text }));
    const goodbyeTurns = [await session.callerTurn("Thanks, goodbye.")];
    if (!goodbyeTurns[0].toolCalls.some((toolCall) => toolCall.name === "finish_session")) {
      goodbyeTurns.push(await session.callerTurn("Goodbye."));
    }
    checks.push(createCheck("finish only after caller responds to closing", goodbyeTurns.some((turn) =>
      turn.toolCalls.some((toolCall) => toolCall.name === "finish_session")), {
      observed: goodbyeTurns.map((turn) => turn.text),
      tools: goodbyeTurns.flatMap((turn) => turn.toolCalls.map((toolCall) => toolCall.name))
    }));
    const everyTurn = [...callback.turns, nameTurn, ...nameTurns, confirmationTurn, closingTurn, ...goodbyeTurns];
    checks.push(createCheck("finish never shares a question turn", everyTurn.every((turn) =>
      !containsQuestion(turn.text) || !turn.toolCalls.some((toolCall) => toolCall.name === "finish_session"))));
    checks.push(createCheck("confirmed name is used in final close", /\bJohn Lyman\b/i.test(closingTurn.text), { observed: closingTurn.text }));
    const captures = everyTurn.flatMap((turn) => turn.toolCalls)
      .filter((toolCall) => toolCall.name === "data_capture")
      .map((toolCall) => {
        try { return JSON.parse(toolCall.arguments || "{}"); } catch { return {}; }
      });
    const capturedName = Object.assign({}, ...captures);
    checks.push(createCheck("captured payload preserves confirmed name", capturedName.first_name === "John" && capturedName.last_name === "Lyman", { capturedName }));
    return { case: "capture", checks };
  });
}

async function runJokeCase(mode) {
  return withSession(mode, "joke", profileA, async (session) => {
    await session.assistantTurn();
    const turn = await session.callerTurn("Can your AI build my patio? I'm kidding—I actually need help with a custom scheduling system.");
    const lightLine = /\b(ha|haha|not yet|if only|good one|wish)\b/i.test(turn.text);
    return {
      case: "joke",
      checks: [
        createCheck("one light line then back to business", lightLine && /\b(scheduling|software|system|project)\b/i.test(turn.text), { observed: turn.text }),
        createCheck("no literal patio service-list answer", !/\bwe (?:offer|provide|do) (?:patio|landscap|construction)/i.test(turn.text))
      ]
    };
  });
}

async function runPinnedFactCase(mode) {
  return withSession(mode, "pinned_fact", profileA, async (session) => {
    await session.assistantTurn();
    const turn = await session.callerTurn("What kind of work do you do, and what area do you serve?");
    return {
      case: "pinned_fact",
      checks: [
        createCheck("answers without lookup", !turn.toolCalls.some((toolCall) => toolCall.name === "knowledge_lookup"), { tools: turn.toolCalls.map((toolCall) => toolCall.name) }),
        createCheck("answers service and area", /\b(software|internal systems?|custom)\b/i.test(turn.text) && /\b(Puget Sound|Seattle|Eastside)\b/i.test(turn.text), { observed: turn.text }),
        createCheck("spoken register has no marketing phrasing", !MARKETING_PATTERN.test(turn.text), { observed: turn.text }),
        createCheck("does not volunteer technology names", !/\bNext\.?js\b/i.test(turn.text), { observed: turn.text })
      ]
    };
  });
}

async function runDeclineCase(mode) {
  return withSession(mode, "decline", profileA, async (session) => {
    await session.assistantTurn();
    const callback = await reachCallbackOffer(session);
    const decline = await session.callerTurn("No thanks, I don't want a callback.");
    return {
      case: "decline",
      checks: [
        createCheck("callback was offered before decline", containsCallbackOffer(callback.offer?.text), { observed: callback.offer?.text }),
        createCheck("decline is accepted warmly", /\b(no problem|no pressure|totally (?:fine|okay)|of course|understand|absolutely|happy to help|anything else)\b/i.test(decline.text), { observed: decline.text }),
        createCheck("no callback re-ask", !containsCallbackOffer(decline.text), { observed: decline.text }),
        createCheck("no immediate hangup", !containsClosing(decline.text)
          && !decline.toolCalls.some((toolCall) => toolCall.name === "finish_session"), {
          observed: decline.text,
          tools: decline.toolCalls.map((toolCall) => toolCall.name)
        })
      ]
    };
  });
}

async function runAdjacentCase(mode) {
  return withSession(mode, "adjacent", profileA, async (session) => {
    await session.assistantTurn();
    const turn = await session.callerTurn("Our old internal reporting system keeps freezing. Can you repair it?");
    const firstResponse = turn.responses[0] || { transcripts: [], toolCalls: [] };
    const firstSentence = normalizeText(firstResponse.transcripts.join(" "));
    const sameResponseLookup = firstResponse.toolCalls.some((toolCall) => toolCall.name === "knowledge_lookup");
    const bareHold = /^(?:let me check|one moment|let me look|please wait)\b/i.test(firstSentence);
    const holdThenAnswer = /\b(?:let me check|one moment|let me look|please wait)[.!]?\s+(?:we|our|the approved|i found|it looks)/i.test(turn.text);
    return {
      case: "adjacent",
      checks: [
        createCheck("first response engages the caller's situation", /\b(?:system|reporting|freez\w*)\b/i.test(firstSentence) && !bareHold, { observed: firstSentence }),
        createCheck("lookup starts in the same response as engagement", sameResponseLookup && Boolean(firstSentence), { observed: firstSentence, tools: firstResponse.toolCalls.map((toolCall) => toolCall.name) }),
        createCheck("no hold then answer collision", !holdThenAnswer, { observed: turn.text }),
        createCheck("unconfirmed service leads to honest callback offer", /\b(?:not confirmed|can't confirm|cannot confirm|don't have that confirmed|team can|callback|call back)\b/i.test(turn.text), { observed: turn.text })
      ]
    };
  });
}

function usageSummary(turn) {
  const usage = turn.responses.at(-1)?.usage || {};
  const inputTokens = Number(usage.input_tokens || 0);
  const cachedTokens = Number(usage.input_token_details?.cached_tokens || 0);
  return {
    inputTokens,
    cachedTokens,
    cacheHitRate: inputTokens > 0 ? Number((cachedTokens / inputTokens).toFixed(4)) : 0
  };
}

async function runCacheCase(mode) {
  const first = await withSession(mode, "cache_warm", profileA, async (session) => usageSummary(await session.assistantTurn()));
  const secondProfile = mode === "layered" ? profileB : profileA;
  const second = await withSession(mode, "cache_probe", secondProfile, async (session) => usageSummary(await session.assistantTurn()));
  return {
    case: "cache",
    first,
    second,
    comparison: mode === "layered" ? "cross_tenant_shared_layer_1" : "same_tenant_legacy_prompt",
    checks: [createCheck("second call reports cached input", second.cachedTokens > 0, second)]
  };
}

async function runMode(mode) {
  const cases = [];
  const configuredCases = new Set(normalizeText(process.env.EVERYCALL_RECEPTIONIST_V12_ACCEPTANCE_CASES || "capture,joke,pinned_fact,decline,cache,adjacent")
    .split(",").map((value) => normalizeText(value)).filter(Boolean));
  for (const [caseName, runner] of [
    ["capture", runCaptureCase],
    ["joke", runJokeCase],
    ["pinned_fact", runPinnedFactCase],
    ["decline", runDeclineCase],
    ["cache", runCacheCase],
    ["adjacent", runAdjacentCase]
  ]) {
    if (!configuredCases.has(caseName)) continue;
    try {
      cases.push(await runner(mode));
    } catch (error) {
      cases.push({
        case: runner.name.replace(/^run|Case$/g, "").toLowerCase(),
        checks: [createCheck("case completed", false, { error: error instanceof Error ? error.message : String(error) })]
      });
    }
  }
  return { mode, cases };
}

async function main() {
  if (normalizeText(process.env[APPROVAL_ENV]) !== "1" && normalizeText(process.env[LEGACY_APPROVAL_ENV]) !== "1") {
    throw new Error(`${APPROVAL_ENV}=1 is required`);
  }
  if (!normalizeText(process.env.OPENAI_API_KEY)) throw new Error("OPENAI_API_KEY is required");
  const results = [];
  const modes = normalizeText(process.env.EVERYCALL_RECEPTIONIST_V12_ACCEPTANCE_MODES || "legacy,layered")
    .split(",").map((value) => normalizeText(value)).filter((value) => ["legacy", "layered"].includes(value));
  if (!modes.length) throw new Error("receptionist_v12_acceptance_modes_required");
  for (const mode of modes) results.push(await runMode(mode));
  const failedChecks = results.flatMap((result) => result.cases.flatMap((testCase) =>
    testCase.checks.filter((check) => !check.passed).map((check) => ({ mode: result.mode, case: testCase.case, ...check }))
  ));
  const summary = {
    ok: failedChecks.length === 0,
    model: MODEL,
    voice: VOICE,
    fixture: "synthetic_staging_tenant",
    results,
    failedChecks
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failedChecks.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
