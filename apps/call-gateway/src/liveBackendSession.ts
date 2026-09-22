import WebSocket from "ws";
import crypto from "node:crypto";

export const RESPONSES_WS_URL = "wss://api.openai.com/v1/responses";
export type BackendResponse = { id: string; status: string; output: any[]; usage?: unknown };
export type BackendTrace = { requestId: string; delegationId: string | null; generation: number; step: number };
export interface LiveBackend {
  prepare(): Promise<void>;
  respond(input: any[], signal: AbortSignal, trace?: BackendTrace): Promise<BackendResponse>;
  close(): void;
}
export type BackendSocket = Pick<WebSocket, "on" | "send" | "close" | "terminate" | "readyState">;
type Options = {
  apiKey: string; model: string; reasoningEffort: string; safetyIdentifier: string;
  instructions: string; tools: Record<string, any>[]; text: Record<string, unknown>;
  audit: (event: string, details: Record<string, unknown>) => void;
  socketFactory?: (url: string, options: { headers: Record<string, string> }) => BackendSocket;
  timeoutMs?: number;
};

export function resolveLiveReasoningEffort(value: unknown) {
  const effort = String(value || "medium").trim().toLowerCase();
  if (!["none", "low", "medium", "high", "xhigh", "max"].includes(effort)) throw new Error("invalid_live_backend_reasoning_effort");
  return effort;
}

/** One connection and one FIFO lane per phone call. Only completed responses leave this boundary. */
export class PreparedResponsesSession implements LiveBackend {
  private socket: BackendSocket | undefined;
  private connecting: Promise<void> | undefined;
  private preparing: Promise<void> | undefined;
  private previousId: string | undefined;
  private history: any[] = [];
  private closed = false;
  private pending: { resolve: (value: BackendResponse) => void; reject: (error: Error) => void; output: any[]; firstEvent: () => void } | undefined;
  private busy = false;

  constructor(private readonly options: Options) {}

  private reset() {
    const socket = this.socket;
    this.socket = undefined;
    this.previousId = undefined;
    socket?.terminate();
  }

  private async connect() {
    if (this.closed) throw new Error("live_backend_closed");
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = this.options.socketFactory
        ? this.options.socketFactory(RESPONSES_WS_URL, { headers: { Authorization: `Bearer ${this.options.apiKey}` } })
        : new WebSocket(RESPONSES_WS_URL, { headers: { Authorization: `Bearer ${this.options.apiKey}` } });
      this.socket = socket;
      const timer = setTimeout(() => { reject(new Error("live_backend_connect_timeout")); this.reset(); }, this.options.timeoutMs || 10000);
      socket.on("open", () => { clearTimeout(timer); resolve(); });
      const lost = () => {
        clearTimeout(timer);
        // Events from a replaced socket must not reject a request on its successor.
        if (this.socket !== socket) return;
        this.socket = undefined;
        this.previousId = undefined;
        const error = new Error("live_backend_disconnected");
        this.pending?.reject(error);
        reject(error);
      };
      socket.on("error", lost);
      socket.on("close", lost);
      socket.on("message", data => {
        if (this.socket !== socket || !this.pending) return;
        let event: any;
        try { event = JSON.parse(String(data)); } catch { this.pending.reject(new Error("live_backend_invalid_event")); return; }
        this.pending.firstEvent();
        if (event.type === "response.output_item.done" && event.item) this.pending.output.push(event.item);
        if (event.type === "response.completed") {
          const response = event.response;
          if (!response?.id || response.status !== "completed") { this.pending.reject(new Error("live_backend_incomplete")); return; }
          this.pending.resolve({ ...response, output: response.output?.length ? response.output : this.pending.output });
        } else if (["error", "response.failed", "response.incomplete"].includes(event.type)) {
          const code = event.error?.code || event.response?.error?.code;
          // Never log provider text: it can echo caller data, tool inputs or secrets.
          this.pending.reject(new Error(code === "previous_response_not_found" ? code : "live_backend_response_failed"));
        }
      });
    }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private exchange(input: any[], generate: boolean, signal?: AbortSignal, trace?: BackendTrace, attempt = 0): Promise<BackendResponse> {
    if (signal?.aborted) return Promise.reject(new Error("live_backend_aborted"));
    if (this.pending || this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("live_backend_not_ready"));
    return new Promise<BackendResponse>((resolve, reject) => {
      const exchangeId = crypto.randomUUID();
      const sentAt = Date.now();
      let first = true;
      const milestone = (name: string) => this.options.audit("openai_live_latency", {
        ...trace, exchangeId, attempt, milestone: name, atUnixMs: Date.now(),
        backendSentAtUnixMs: sentAt, sinceBackendSendMs: Date.now() - sentAt,
        generation: trace?.generation, phase: generate ? "generation" : "warmup", playbackConfirmed: false
      });
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); this.pending = undefined; };
      const abort = () => { cleanup(); this.reset(); reject(new Error("live_backend_aborted")); };
      const timer = setTimeout(() => { cleanup(); this.reset(); reject(new Error("live_backend_response_timeout")); }, this.options.timeoutMs || 30000);
      this.pending = {
        output: [],
        firstEvent: () => { if (first) { first = false; milestone("backend_first_event"); } },
        resolve: response => { milestone("backend_response_completed"); cleanup(); resolve(response); },
        reject: error => { cleanup(); reject(error); }
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        milestone("backend_request_sent");
        this.socket!.send(JSON.stringify({
          type: "response.create", model: this.options.model, store: false,
          ...(generate ? {} : { generate: false }),
          ...(this.previousId ? { previous_response_id: this.previousId } : {}),
          // Instructions do not inherit through previous_response_id.
          instructions: this.options.instructions, tools: this.options.tools,
          reasoning: { effort: this.options.reasoningEffort }, text: this.options.text,
          safety_identifier: this.options.safetyIdentifier,
          include: ["reasoning.encrypted_content"], parallel_tool_calls: false,
          max_output_tokens: 4096, input
        }));
      } catch { this.pending?.reject(new Error("live_backend_disconnected")); }
    });
  }

  async prepare() {
    if (this.closed) throw new Error("live_backend_closed");
    if (this.previousId && this.socket?.readyState === WebSocket.OPEN) return;
    if (this.preparing) return this.preparing;
    this.preparing = (async () => {
      await this.connect();
      const response = await this.exchange([], false);
      this.previousId = response.id;
      this.options.audit("openai_live_backend_prepared", { model: this.options.model, reasoningEffort: this.options.reasoningEffort, transport: "websocket", store: false });
    })().finally(() => { this.preparing = undefined; });
    return this.preparing;
  }

  async respond(input: any[], signal: AbortSignal, trace?: BackendTrace) {
    if (this.busy) throw new Error("live_backend_concurrent_request");
    this.busy = true;
    try {
      // Retain encrypted reasoning and exact tool results for a store:false restart.
      // Never truncate away action records or silently replay an incomplete history.
      const fullInput = [...this.history, ...input];
      if (Buffer.byteLength(JSON.stringify(fullInput)) > 512000) throw new Error("live_backend_context_limit");
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const continuing = Boolean(this.previousId && this.socket?.readyState === WebSocket.OPEN);
          await this.prepare();
          if (signal.aborted || this.closed) throw new Error("live_backend_aborted");
          const response = await this.exchange(continuing ? input : fullInput, true, signal, trace, attempt);
          this.previousId = response.id;
          this.history = [...fullInput, ...response.output];
          return response;
        } catch (error) {
          const reason = error instanceof Error ? error.message : "unknown";
          this.reset();
          if (attempt || signal.aborted || this.closed || !["previous_response_not_found", "live_backend_disconnected", "live_backend_connect_timeout", "live_backend_response_timeout"].includes(reason)) {
            // Preserve submitted function outputs even if their continuation failed.
            if (!this.closed) this.history = fullInput;
            throw error;
          }
          this.options.audit("openai_live_backend_reconnecting", { reason, attempt: attempt + 1, actionsReplayed: false });
        }
      }
      throw new Error("live_backend_unavailable");
    } finally { this.busy = false; }
  }

  close() {
    this.closed = true;
    this.pending?.reject(new Error("live_backend_closed"));
    this.reset();
    this.history = [];
  }
}
