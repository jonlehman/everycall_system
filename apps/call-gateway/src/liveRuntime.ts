import crypto from "node:crypto";

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

type Transcript = { role: "user" | "assistant"; text: string; start_ms: number; end_ms: number; sequence: number };
type Tool = Record<string, any>;
type Task = { id: string; generation: number; revision: number; controller: AbortController };
type Dependencies = {
  tenantKey: string; callSid: string; apiKey: string; safetyIdentifier: string;
  backendModel: string; instructions: string; tools: Tool[];
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
  fetch?: typeof fetch;
};

/** Client delegation owns backend state; speech events never commit or cancel tools. */
export class LiveRuntime {
  started = false;
  closed = false;
  private closing = false;
  private generation = 0;
  private revision = 0;
  private transcriptSequence = 0;
  private task?: Task;
  private history: Transcript[] = [];
  private eventIds = new Set<string>();
  private delegationIds = new Set<string>();
  private executions = new Map<string, Promise<unknown>>();
  private completedActions: Array<{ name: string; arguments: string; result: unknown }> = [];
  private tail: Promise<void> = Promise.resolve();
  private finalized?: () => void;
  private closePromise?: Promise<void>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private finishState: { text: string; transcript: string; requestedAt: number; heardAudio: boolean; transcriptAt: number } | undefined;
  private lastAudiblePlaybackAt = 0;

  constructor(private readonly deps: Dependencies) {}

  append(type: "instructions" | "thinking" | "commentary", text: string, delegationId: string | null = null) {
    if (!this.started || this.closing || this.closed) return;
    for (const event of liveAppend(type, text, delegationId)) this.deps.send(event);
  }

  input(audio: string) {
    if (this.started && !this.closing && !this.closed) this.deps.send({ type: "session.input_audio.append", audio });
  }

  latestCallerText() { return this.history.filter(x => x.role === "user").at(-1)?.text || ""; }
  get transcriptRevision() { return this.transcriptSequence; }
  callerConfirmationAfter(lookupRevision: number) {
    const caller = this.history.at(-1);
    const question = this.history.at(-2);
    // Require a fresh question after the lookup, then a new caller turn. Never
    // reinterpret the original transfer request (or its later fragments) as consent.
    return caller?.role === "user" && caller.sequence > lookupRevision
      && question?.role === "assistant" && question.sequence > lookupRevision
      && /\b(?:transfer|connect|put you through)\b[^?]*\?\s*$/i.test(question.text)
      ? caller.text : "";
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
      this.deps.audit("openai_live_session_closed", { usage: event.usage, finalUsageConfirmed: true });
      this.finalized?.();
      if (!requestedClose) this.deps.finish("openai_live_provider_closed");
      return;
    }
    if (event.type === "session.started") {
      if (this.started) return;
      this.started = true;
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
      this.deps.audio(Buffer.from(event.delta, "base64"));
      return;
    }
    if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
      if (typeof event.delta !== "string" || !event.delta) return;
      const role = event.type === "session.input_transcript.delta" ? "user" : "assistant";
      const entry: Transcript = { role, text: event.delta, start_ms: Number(event.start_ms), end_ms: Number(event.end_ms), sequence: ++this.transcriptSequence };
      const last = this.history.at(-1);
      if (last?.role === role) { last.text += entry.text; last.end_ms = entry.end_ms; }
      else this.history.push({ ...entry });
      // Bound retained context while keeping the authoritative captured state separately.
      while (this.history.length > 128 || (this.history.length > 1 && this.history.reduce((n, x) => n + x.text.length, 0) > 48000)) this.history.shift();
      if (this.history.at(-1)!.text.length > 48000) this.history.at(-1)!.text = this.history.at(-1)!.text.slice(-48000);
      if (role === "user") {
        this.revision++;
        // Do not abort an action already submitted. Revision guards prevent its stale
        // response, the next tool, or a deferred close from reaching the live call.
        if (this.finishState) {
          this.finishState = undefined;
          this.append("instructions", "The caller has spoken again. Continue helping them and delegate any remaining work before ending the call.");
        }
      } else if (this.finishState) {
        this.finishState.transcript += entry.text;
        this.finishState.transcriptAt = Date.now();
      }
      this.deps.transcript(entry);
      return;
    }
    if (event.type === "session.delegation.created" && event.delegation?.target === "client") {
      const delegationId = String(event.delegation.id || "");
      if (!delegationId || this.delegationIds.has(delegationId) || !this.deps.isActive()) return;
      if (this.delegationIds.size >= 128) { this.deps.finish("openai_live_task_limit"); return; }
      this.delegationIds.add(delegationId);
      this.task?.controller.abort();
      const task = { id: delegationId, generation: ++this.generation, revision: this.revision, controller: new AbortController() };
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

  private fresh(task: Task) { return this.current(task) && task.revision === this.revision; }

  private async run(task: Task) {
    if (!this.current(task)) return;
    task.revision = this.revision;
    const timeout = setTimeout(() => task.controller.abort(), 30000);
    let redelegationHintSent = false;
    const input: any[] = [{ role: "developer", content: "Verified application state and previously completed actions (do not repeat): " + JSON.stringify({ state: this.deps.state(), actions: this.completedActions }) }, ...this.history.map(x => ({ role: x.role, content: x.text }))];
    this.deps.audit("openai_live_task_started", { delegationId: task.id, generation: task.generation, revision: task.revision });
    try {
      for (let step = 0; step < 6 && this.fresh(task); step++) {
        const response = await (this.deps.fetch || fetch)("https://api.openai.com/v1/responses", {
          method: "POST", signal: task.controller.signal,
          headers: { Authorization: `Bearer ${this.deps.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.deps.backendModel, store: false,
            safety_identifier: this.deps.safetyIdentifier,
            instructions: this.deps.instructions + "\nYou are the backend for a live voice receptionist. Transcripts can be unfinished or corrected. Apply the business rules and required confirmations above using current context. Execute only supplied tools. Never repeat completed actions. Return a concise factual result or the next question for the voice model, at most 80 words. Do not claim an action succeeded before its tool confirms success. After successful data_capture continue to the next needed question, not a closing. Use finish_session only at the specified completed-call checkpoint.",
            input, tools: this.deps.tools.map(tool => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })),
            parallel_tool_calls: false, max_output_tokens: 1200
          })
        });
        if (!response.ok) throw new Error(`live_backend_http_${response.status}`);
        const body = await response.json() as any;
        this.deps.audit("openai_live_backend_usage", { delegationId: task.id, generation: task.generation, model: this.deps.backendModel, usage: body.usage });
        if (!this.fresh(task)) break;
        if (body.status !== "completed" || !Array.isArray(body.output)) throw new Error("live_backend_incomplete");
        input.push(...body.output);
        const calls = body.output.filter((item: any) => item.type === "function_call");
        if (!calls.length) {
          const text = body.output.flatMap((item: any) => item.type === "message" ? item.content || [] : []).filter((part: any) => part.type === "output_text").map((part: any) => part.text).join("");
          if (text) this.append("commentary", text.slice(0, 1600), task.id);
          return;
        }
        for (const call of calls) {
          if (!this.fresh(task) || this.finishState) return;
          const tool = this.deps.tools.find(t => t.name === call.name && t.type === "function");
          let args: unknown;
          try { args = JSON.parse(call.arguments); } catch { throw new Error("live_backend_invalid_arguments"); }
          if (!tool || !call.call_id || !args || typeof args !== "object" || Array.isArray(args) || !this.deps.validateTool(call.name, args)) throw new Error("live_backend_unauthorized_tool");
          // Binding is derived exclusively from the authenticated server call context.
          const key = crypto.createHash("sha256").update(JSON.stringify([this.deps.tenantKey, this.deps.callSid, task.id, call.call_id])).digest("hex");
          let execution = this.executions.get(key);
          if (!execution) {
            execution = this.deps.executeTool(call.name, key, call.arguments, () => this.fresh(task));
            this.executions.set(key, execution);
          }
          const result = await execution;
          this.completedActions.push({ name: call.name, arguments: call.arguments, result });
          if (this.completedActions.length > 32) this.completedActions.shift();
          if (!this.fresh(task) || this.finishState) return;
          input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
        }
      }
      if (this.current(task)) {
        this.append("thinking", "The previous backend request is incomplete or the caller supplied newer information. Delegate again using the latest conversation before relying on a result.", task.id);
        redelegationHintSent = true;
      }
    } catch (error) {
      this.deps.audit("openai_live_task_failed", { delegationId: task.id, generation: task.generation, error: error instanceof Error ? error.message : "unknown" });
      if (this.fresh(task)) this.append("commentary", "The requested backend work could not be confirmed. Do not claim it succeeded. Ask whether the caller would like a callback.", task.id);
    } finally {
      clearTimeout(timeout);
      if (this.current(task) && task.revision !== this.revision && !redelegationHintSent) {
        this.append("thinking", "The caller supplied newer information while the backend was working. Delegate again using the latest conversation and verified action state before relying on a result.", task.id);
      }
    }
  }

  requestFinish(text: string) {
    if (!this.task || !this.fresh(this.task) || this.finishState) return false;
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
