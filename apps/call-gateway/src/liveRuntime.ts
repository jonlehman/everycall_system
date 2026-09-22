import crypto from "node:crypto";
import { PreparedResponsesSession, resolveLiveReasoningEffort, type LiveBackend } from "./liveBackendSession.js";
import { LIVE_BACKEND_ADAPTER, LIVE_HANDOFF_FORMAT, parseBackendHandoff, type HandoffQuestion } from "./liveContract.js";
import { LiveTranscript, normalizeSpokenText, type Transcript } from "./liveTranscript.js";

export type VoiceRuntime = "realtime" | "live";
export function resolveVoiceRuntime(configured: unknown): VoiceRuntime {
  const value = String(configured || "realtime").trim().toLowerCase();
  if (value !== "realtime" && value !== "live") throw new Error("invalid_voice_runtime");
  return value;
}

export const LIVE_URL = "wss://api.openai.com/v1/live/sessions";
export function buildLiveStart(instructions: string, voice: string) {
  return {
    type: "session.start",
    session: {
      model: "gpt-live-1", instructions,
      audio: { format: { type: "audio/pcmu", rate: 8000 }, output: { voice } },
      delegation: { type: "client" }, store: false
    }
  };
}

// Bound appends conservatively by UTF-8 bytes: at most one token per byte.
export function liveAppend(type: "instructions" | "thinking" | "commentary", content: string, delegationId: string | null) {
  const pieces: string[] = [];
  let piece = "";
  for (const char of content) {
    if (Buffer.byteLength(piece + char, "utf8") > 480) { pieces.push(piece); piece = ""; }
    piece += char;
  }
  if (piece) pieces.push(piece);
  return pieces.map(content => ({
    type: `session.${type}.append`, event_id: crypto.randomUUID(), delegation_id: delegationId, content
  }));
}

export function pcmuHasSpeech(bytes: Buffer) {
  // Decode mu-law magnitude; tiny codec noise and silence must not keep a close alive.
  let energy = 0;
  for (const byte of bytes) {
    const value = (~byte) & 255;
    const magnitude = (((value & 15) << 3) + 132) * (1 << ((value >> 4) & 7)) - 132;
    energy += magnitude * magnitude;
  }
  return bytes.length > 0 && Math.sqrt(energy / bytes.length) > 180;
}

type Tool = Record<string, any>;
type Task = { id: string; generation: number; revision: number; controller: AbortController; finished: boolean; startedAt: number };
type Operation = { id: string; name: string; arguments: string; status: "pending" | "completed" | "failed" | "unknown"; result?: unknown };
type PendingQuestion = HandoffQuestion & { id: string; afterSequence: number; heardText?: string; spokenSequence?: number; spokenEndMs?: number; answerTurnId?: number; answer?: string };
type Dependencies = {
  tenantKey: string; callSid: string; apiKey: string; safetyIdentifier: string;
  backendModel: string; reasoningEffort?: string; instructions: string; tools: Tool[];
  send: (event: Record<string, unknown>) => void;
  isActive: () => boolean;
  executeTool: (name: string, callId: string, args: string, mayCommit: () => boolean) => Promise<unknown>;
  validateTool: (name: string, args: unknown) => boolean;
  state: () => unknown;
  transcript: (entry: Transcript) => void;
  audio: (bytes: Buffer) => void;
  ready: () => void;
  finish: (reason: string) => void;
  audit: (event: string, details: Record<string, unknown>) => void;
  backend?: LiveBackend;
  settleMs?: number;
};

/** Client delegation owns backend state; speech events never commit or cancel tools. */
export class LiveRuntime {
  started = false;
  closed = false;
  private closing = false;
  private generation = 0;
  private task?: Task;
  private context = new LiveTranscript();
  private question: PendingQuestion | undefined;
  private transcriptTimer?: ReturnType<typeof setTimeout>;
  private lastCallerAt = 0;
  private ackPending = false;
  private eventIds = new Set<string>();
  private delegationIds = new Set<string>();
  private operations = new Map<string, Operation>();
  private backend: LiveBackend;
  private prepared?: Promise<void>;
  private toolOutputs: any[] = [];
  private lastBackendTurnId = 0;
  private tail: Promise<void> = Promise.resolve();
  private finalized?: () => void;
  private closePromise?: Promise<void>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private finishState: { text: string; transcript: string; requestedAt: number; heardAudio: boolean; transcriptAt: number } | undefined;
  private lastAudiblePlaybackAt = 0;

  constructor(private readonly deps: Dependencies) {
    this.backend = deps.backend || new PreparedResponsesSession({
      apiKey: deps.apiKey, model: deps.backendModel, safetyIdentifier: deps.safetyIdentifier,
      reasoningEffort: resolveLiveReasoningEffort(deps.reasoningEffort),
      instructions: deps.instructions + LIVE_BACKEND_ADAPTER,
      tools: deps.tools.map(tool => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })),
      text: LIVE_HANDOFF_FORMAT, audit: deps.audit
    });
  }

  prepare() {
    // Attach a handler immediately: startup preparation can fail before delegation.
    if (!this.prepared) {
      this.prepared = this.backend.prepare();
      void this.prepared.catch(() => this.deps.audit("openai_live_backend_prepare_failed", {}));
    }
    return this.prepared;
  }

  append(type: "instructions" | "thinking" | "commentary", text: string, delegationId: string | null = null) {
    if (!this.started || this.closing || this.closed) return;
    for (const event of liveAppend(type, text, delegationId)) this.deps.send(event);
  }

  input(audio: string) {
    if (this.started && !this.closing && !this.closed) this.deps.send({ type: "session.input_audio.append", audio });
  }

  latestCallerText() { return this.context.provisional?.role === "user" ? this.context.provisional.text : this.context.latestCaller()?.text || ""; }
  get transcriptRevision() { return this.context.sequence; }
  get taskRevision() { return this.context.revision; }
  callerConfirmationAfter(lookupRevision: number, targetId: string) {
    const question = this.question;
    return question?.kind === "transfer_confirmation" && question.target_id === targetId
      && question.afterSequence >= lookupRevision && question.spokenSequence !== undefined
      && question.spokenSequence > lookupRevision && question.answerTurnId === this.context.latestCaller()?.id
      && !this.context.pendingWork(true) ? question.answer || "" : "";
  }

  private finalizeTranscript() {
    clearTimeout(this.transcriptTimer);
    const turn = this.context.finalize(Boolean(this.question?.spokenSequence && !this.question.answerTurnId));
    if (!turn) return;
    const question = this.question;
    if (turn.role === "assistant" && question && turn.sequence > question.afterSequence) {
      // The exact supplied question must have reached the transcript. Unrelated
      // yes/no answers and a question invented by Live cannot authorize an action.
      if (normalizeSpokenText(question.heardText || turn.text).endsWith(normalizeSpokenText(question.text))) {
        question.spokenSequence = turn.sequence;
        question.spokenEndMs = turn.end_ms;
      }
      else if (turn.text.includes("?")) this.question = undefined;
    }
    if (turn.role === "user" && turn.kind === "meaningful") {
      if (question?.spokenSequence && turn.sequence > question.spokenSequence && turn.start_ms >= (question.spokenEndMs ?? Infinity) && !question.answerTurnId) {
        question.answerTurnId = turn.id;
        question.answer = turn.text;
      }
      this.deps.audit("openai_live_turn_finalized", { turnId: turn.id, revision: this.context.revision, startMs: turn.start_ms, endMs: turn.end_ms });
    }
  }

  private async settleTranscript() {
    const delay = this.deps.settleMs ?? 350;
    while (this.context.provisional?.role === "user" && delay > 0 && Date.now() - this.lastCallerAt < delay) {
      await new Promise(resolve => setTimeout(resolve, delay - (Date.now() - this.lastCallerAt)));
      if (this.closed || this.closing) return;
    }
    this.finalizeTranscript();
  }

  private noteLiveAck() {
    if (!this.ackPending) return;
    this.ackPending = false;
    this.deps.audit("openai_live_latency", { milestone: "live_ack", elapsedMs: Date.now() - this.lastCallerAt, playbackConfirmed: false });
  }

  async handle(event: Record<string, any>) {
    if (this.closed) return;
    const id = String(event.event_id || "");
    if (id && this.eventIds.has(id)) return;
    if (id) {
      this.eventIds.add(id);
      if (this.eventIds.size > 10000) this.eventIds.delete(this.eventIds.values().next().value!);
    }
    if (event.type === "session.closed") {
      const requestedClose = this.closing;
      this.closed = true;
      this.started = false;
      this.task?.controller.abort();
      clearTimeout(this.transcriptTimer);
      this.backend.close();
      this.deps.audit("openai_live_session_closed", { usage: event.usage, finalUsageConfirmed: true });
      this.finalized?.();
      if (!requestedClose) this.deps.finish("openai_live_provider_closed");
      return;
    }
    if (event.type === "session.started") {
      if (this.started) return;
      this.started = true;
      void this.prepare();
      this.deps.ready();
      return;
    }
    if (event.type === "error") {
      this.deps.audit("openai_live_error", { code: event.error?.code, clientEventId: event.error?.client_event_id });
      // Fail closed for rejected startup/configuration and context commands.
      this.deps.finish("openai_live_protocol_error");
      return;
    }
    if (event.type === "session.usage.updated") {
      this.deps.audit("openai_live_usage_snapshot", { usage: event.usage });
      return;
    }
    if (this.closing || !this.started) return;
    if (event.type === "session.output_audio.delta" && typeof event.delta === "string") {
      if (pcmuHasSpeech(Buffer.from(event.delta, "base64"))) this.noteLiveAck();
      this.deps.audio(Buffer.from(event.delta, "base64"));
      return;
    }
    if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
      if (typeof event.delta !== "string" || !event.delta) return;
      const role = event.type === "session.input_transcript.delta" ? "user" : "assistant";
      if (this.context.provisional && this.context.provisional.role !== role) this.finalizeTranscript();
      const entry = this.context.append(role, event.delta, Number(event.start_ms), Number(event.end_ms), Boolean(this.question?.spokenSequence));
      if (role === "assistant" && this.question && entry.sequence > this.question.afterSequence && !this.question.answerTurnId) {
        this.question.heardText = ((this.question.heardText || "") + entry.text).slice(-2400);
      }
      if (role === "user") {
        this.lastCallerAt = Date.now();
        this.ackPending = true;
        // Do not abort an action already submitted. Revision guards prevent its stale
        // response, the next tool, or a deferred close from reaching the live call.
        if (this.finishState && this.context.pendingWork(false)) {
          this.finishState = undefined;
          this.append("instructions", "The caller has spoken again. Continue helping them and delegate any remaining work before ending the call.");
        }
      } else if (this.finishState) {
        this.finishState.transcript += entry.text;
        this.finishState.transcriptAt = Date.now();
      }
      clearTimeout(this.transcriptTimer);
      this.transcriptTimer = setTimeout(() => this.finalizeTranscript(), this.deps.settleMs ?? 350);
      this.deps.transcript(entry);
      return;
    }
    if (event.type === "session.delegation.created" && event.delegation?.target === "client") {
      const delegationId = String(event.delegation.id || "");
      if (!delegationId || this.delegationIds.has(delegationId) || !this.deps.isActive()) return;
      if (this.delegationIds.size >= 128) { this.deps.finish("openai_live_task_limit"); return; }
      this.delegationIds.add(delegationId);
      await this.settleTranscript();
      if (!this.context.latestCaller() || this.closing || this.closed) return;
      // A repeated delegation caused by a backchannel continues the existing work.
      if (this.task?.revision === this.context.revision) return;
      this.task?.controller.abort();
      const task = { id: delegationId, generation: ++this.generation, revision: this.context.revision, controller: new AbortController(), finished: false, startedAt: this.lastCallerAt };
      this.task = task;
      // Serialize backend actions across generations; a newer task cannot race an
      // in-flight capture/transfer. The next task receives committed application state.
      this.tail = this.tail.then(() => this.run(task)).catch(() => {});
      await this.tail;
    }
    // Append acknowledgments only describe context delivery; never playback completion.
  }

  private current(task: Task) {
    return this.task === task && task.generation === this.generation && !this.closing && !this.closed && this.deps.isActive();
  }

  private fresh(task: Task) { return this.current(task) && !task.controller.signal.aborted && task.revision === this.context.revision && !this.context.pendingWork(Boolean(this.question?.spokenSequence && !this.question.answerTurnId)); }

  private async run(task: Task) {
    if (!this.current(task)) return;
    const timeout = setTimeout(() => task.controller.abort(), 30000);
    let queuedOutputCount = this.toolOutputs.length;
    let input: any[] = [...this.toolOutputs, { role: "user", content: JSON.stringify({
      application_state: this.deps.state(), operation_records: [...this.operations.values()].map(({ result: _result, ...record }) => record),
      pending_question: this.question || null, meaningful_revision: this.context.revision,
      finalized_turns: this.context.turns.filter(turn => turn.id > this.lastBackendTurnId), provisional_transcript: this.context.provisional || null
    }) }];
    this.deps.audit("openai_live_task_started", { delegationId: task.id, generation: task.generation, revision: task.revision });
    try {
      // Warmup may have failed transiently at call startup. respond() owns its one
      // bounded transport retry, always before any application tool execution.
      await this.prepare().catch(() => {});
      for (let step = 0; step < 6 && this.fresh(task); step++) {
        this.lastBackendTurnId = this.context.turns.at(-1)?.id || this.lastBackendTurnId;
        // Remove outputs only when actually submitted. A newer provisional turn
        // or the round limit must not strand an unresolved function in the chain.
        this.toolOutputs.splice(0, queuedOutputCount);
        const body = await this.backend.respond(input, task.controller.signal);
        this.deps.audit("openai_live_backend_usage", { delegationId: task.id, generation: task.generation, model: this.deps.backendModel, usage: body.usage });
        if (body.status !== "completed" || !Array.isArray(body.output)) throw new Error("live_backend_incomplete");
        const calls = body.output.filter((item: any) => item.type === "function_call");
        // Even skipped calls need an output before continuing a Responses chain.
        const outputs = calls.map((call: any) => ({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ status: "not_executed", reason: "superseded_or_invalid" }) }));
        this.toolOutputs.push(...outputs);
        await this.settleTranscript();
        if (!this.fresh(task)) break;
        if (!calls.length) {
          const text = body.output.flatMap((item: any) => item.type === "message" ? item.content || [] : []).filter((part: any) => part.type === "output_text").map((part: any) => part.text).join("");
          const completed = new Set([...this.operations.values()].filter(x => x.status === "completed").map(x => x.id));
          const handoff = parseBackendHandoff(text, completed);
          // Facts only. Never send Responses reasoning items, raw results or the
          // structured contract to Live's quiet context or caller-facing channel.
          for (const fact of handoff.verified_facts) this.append("thinking", fact.text, task.id);
          this.question = handoff.next_question ? { ...handoff.next_question, id: crypto.randomUUID(), afterSequence: this.context.sequence } : undefined;
          const speech = [handoff.spoken_response, handoff.next_question?.text].filter(Boolean).join(" ");
          if (speech) this.append("commentary", speech, task.id);
          if (handoff.verified_facts.length || handoff.spoken_response) this.deps.audit("openai_live_latency", {
            delegationId: task.id, milestone: "backend_useful_fact", elapsedMs: Date.now() - task.startedAt, playbackConfirmed: false
          });
          return;
        }
        // The backend is configured serially; reject a protocol-violating batch
        // before any side effect so capture cannot be followed by an unreviewed close.
        if (calls.length !== 1) throw new Error("live_backend_parallel_tools_rejected");
        for (const [index, call] of calls.entries()) {
          if (!this.fresh(task) || this.finishState) return;
          const tool = this.deps.tools.find(t => t.name === call.name && t.type === "function");
          let args: unknown;
          try { args = JSON.parse(call.arguments); } catch { throw new Error("live_backend_invalid_arguments"); }
          if (!tool || !call.call_id || !args || typeof args !== "object" || Array.isArray(args) || !this.deps.validateTool(call.name, args)) throw new Error("live_backend_unauthorized_tool");
          const stable = (value: any): any => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
          // A regenerated function-call ID is not permission to repeat an action.
          const readOnly = call.name === "knowledge_lookup" || call.name === "lookup_transfer_target";
          let key = crypto.createHash("sha256").update(JSON.stringify([this.deps.tenantKey, this.deps.callSid, call.name, stable(args), this.context.latestCaller()?.id])).digest("hex");
          let operation = this.operations.get(key);
          if (readOnly && operation?.status === "failed") {
            // A read-only cancellation/failure is safe to retry. Keep the failed
            // attempt in the ledger, with a distinct ID for the new bounded round.
            key = crypto.createHash("sha256").update(`${key}:retry:${this.operations.size}`).digest("hex");
            operation = undefined;
          }
          // Uncertain side effects are never resubmitted merely because the caller
          // spoke again or the backend regenerated a different function-call ID.
          if (!readOnly) operation ||= [...this.operations.values()].find(previous => previous.name === call.name && previous.status === "unknown" && JSON.stringify(stable(JSON.parse(previous.arguments))) === JSON.stringify(stable(args)));
          if (!operation) {
            if (this.operations.size >= 128) throw new Error("live_operation_limit");
            operation = { id: key, name: call.name, arguments: call.arguments, status: "pending" };
            this.operations.set(key, operation);
            this.deps.audit("openai_live_operation", { operationId: key, name: call.name, status: "pending", delegationId: task.id });
            try {
              operation.result = await this.deps.executeTool(call.name, key, call.arguments, () => this.fresh(task));
              const resultStatus = (operation.result as any)?.status;
              operation.status = resultStatus === "unknown" || resultStatus === "pending" ? (readOnly ? "failed" : "unknown")
                : ["failed", "rejected", "invalid", "stale", "error"].includes(resultStatus) ? "failed"
                  : readOnly || resultStatus === "accepted" || resultStatus === "completed" ? "completed" : "unknown";
            } catch {
              // The request might have committed before a persistence/network error.
              operation.status = readOnly ? "failed" : "unknown";
              operation.result = readOnly ? { status: "failed", reason: "lookup_incomplete_safe_to_retry" }
                : { status: "unknown", reason: "operation_outcome_unconfirmed_do_not_repeat" };
            }
            this.deps.audit("openai_live_operation", { operationId: key, name: call.name, status: operation.status, delegationId: task.id });
            if (operation.status === "completed") this.deps.audit("openai_live_latency", { operationId: key, delegationId: task.id, milestone: "action_complete", elapsedMs: Date.now() - task.startedAt });
          }
          outputs[index]!.output = JSON.stringify({ operation_id: operation.id, action_status: operation.status, result: operation.result });
          await this.settleTranscript();
          if (!this.fresh(task) || this.finishState) return;
        }
        queuedOutputCount = this.toolOutputs.length;
        input = [...this.toolOutputs];
      }
      if (this.fresh(task)) throw new Error("live_backend_step_limit");
    } catch (error) {
      const code = error instanceof Error && /^(live_|previous_response_not_found)/.test(error.message) ? error.message : "live_backend_failed";
      this.deps.audit("openai_live_task_failed", { delegationId: task.id, generation: task.generation, error: code });
      if (this.current(task) && task.revision === this.context.revision && !this.context.pendingWork(false)) {
        // Transport/contract failure has no authority to advance intake, reopen
        // a refused callback, or fabricate a pending confirmation question.
        this.append("commentary", "I'm sorry, I couldn't confirm that.", task.id);
      }
    } finally {
      clearTimeout(timeout);
      task.finished = true;
      await this.settleTranscript();
      if (this.current(task) && task.revision !== this.context.revision) {
        this.append("thinking", "The caller's request changed. Earlier uncommitted work was superseded; completed actions remain recorded.", task.id);
        // A correction need not wait for Live to invent a second delegation. Reuse
        // the known client delegation ID, serialize after committed work, and bind
        // the new task to the newly finalized meaningful turn.
        const next = { ...task, generation: ++this.generation, revision: this.context.revision, controller: new AbortController(), finished: false, startedAt: this.lastCallerAt };
        this.task = next;
        this.tail = this.tail.then(() => this.run(next)).catch(() => {});
      }
    }
  }

  requestFinish(text: string) {
    if (!this.task || !this.fresh(this.task) || this.finishState) return false;
    if (this.question?.kind !== "other_questions" || !this.question.spokenSequence || this.question.answerTurnId !== this.context.latestCaller()?.id) return false;
    this.finishState = { text, transcript: "", requestedAt: Date.now(), heardAudio: false, transcriptAt: 0 };
    this.append("instructions", `Say exactly this closing once, then remain silent: ${text}`);
    return true;
  }

  notePlayback(bytes: Buffer, now = Date.now()) {
    if (!pcmuHasSpeech(bytes)) return;
    this.lastAudiblePlaybackAt = now;
    if (this.finishState) this.finishState.heardAudio = true;
  }

  checkFinish(queueDrained: boolean, now = Date.now()) {
    const state = this.finishState;
    if (!state) return;
    const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (queueDrained && state.heardAudio && normalize(state.transcript).includes(normalize(state.text))
      && now - Math.max(this.lastAudiblePlaybackAt, state.transcriptAt) >= 1500) {
      this.finishState = undefined;
      this.deps.audit("openai_live_close_playback_quiet", { quietMs: 1500, providerAudioDone: false });
      this.deps.finish("assistant_finish_session");
    } else if (now - state.requestedAt >= 15000) {
      this.finishState = undefined;
      this.deps.audit("openai_live_close_unverified", { reason: "playback_confirmation_timeout" });
      this.deps.finish("openai_live_close_unverified");
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.closed) return Promise.resolve();
    this.closing = true;
    this.task?.controller.abort();
    clearTimeout(this.transcriptTimer);
    this.backend.close();
    this.closePromise = new Promise(resolve => {
      this.finalized = () => { clearTimeout(this.closeTimer); resolve(); };
      this.closeTimer = setTimeout(() => {
        this.deps.audit("openai_live_final_usage_unconfirmed", {});
        this.closed = true;
        resolve();
      }, 1500);
      if (this.started) this.deps.send({ type: "session.close" });
      else { this.closed = true; this.finalized(); }
    });
    return this.closePromise;
  }
}
