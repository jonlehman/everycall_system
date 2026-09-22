import crypto from "node:crypto";

export type RequestTrace = {
  requestId: string; startedAt: number; kind: "greeting" | "caller";
  lastTranscriptAt?: number; callerStartMs?: number; callerEndMs?: number;
  speechEndObservedAt?: number; firstSpeechEndObservedAt?: number; answered?: boolean;
};
export type AudioTrace = { trace: RequestTrace; delegationId?: string; commentaryEventId?: string; receivedAt?: number };
type Audit = (event: string, details: Record<string, unknown>) => void;

/** Wall-clock observation times and provider media times are deliberately distinct. */
export class LiveLatency {
  caller?: RequestTrace;
  output?: AudioTrace;
  lastSpeechAt?: number;
  private speechEndReported = false;
  private firstAudio = new Set<string>();
  private firstSent = new Set<string>();
  private chunks: Array<{ bytes: number; source?: AudioTrace }> = [];
  private frames = new WeakMap<Buffer, AudioTrace[]>();

  constructor(private readonly audit: Audit) {}

  create(kind: RequestTrace["kind"]): RequestTrace {
    return { requestId: crypto.randomUUID(), kind, startedAt: Date.now() };
  }

  mark(trace: RequestTrace, milestone: string, details: Record<string, unknown> = {}, now = Date.now()) {
    this.audit("openai_live_latency", {
      requestId: trace.requestId, requestKind: trace.kind, milestone, atUnixMs: now,
      requestStartedAtUnixMs: trace.startedAt, sinceRequestObservedMs: Math.max(0, now - trace.startedAt),
      ...(trace.lastTranscriptAt === undefined ? {} : { latestTranscriptReceivedAtUnixMs: trace.lastTranscriptAt, sinceLatestTranscriptMs: Math.max(0, now - trace.lastTranscriptAt) }),
      ...(trace.callerEndMs === undefined ? {} : { callerStartMediaMs: trace.callerStartMs, callerEndMediaMs: trace.callerEndMs }),
      ...(trace.speechEndObservedAt === undefined ? {} : { speechEndObservedAtUnixMs: trace.speechEndObservedAt, sinceEstimatedSpeechEndMs: Math.max(0, now - trace.speechEndObservedAt), speechEndSource: "gateway_pcmu_energy_estimate" }),
      ...(trace.firstSpeechEndObservedAt === undefined ? {} : { firstSpeechEndObservedAtUnixMs: trace.firstSpeechEndObservedAt, sinceFirstEstimatedSpeechEndMs: Math.max(0, now - trace.firstSpeechEndObservedAt) }),
      playbackConfirmed: false, ...details
    });
  }

  input(hasSpeech: boolean, now = Date.now()) {
    if (hasSpeech) { this.lastSpeechAt = now; this.speechEndReported = false; }
    else if (this.lastSpeechAt !== undefined && now - this.lastSpeechAt >= 200 && !this.speechEndReported) {
      this.speechEndReported = true;
      if (this.caller) {
        this.caller.speechEndObservedAt = this.lastSpeechAt;
        this.caller.firstSpeechEndObservedAt ??= this.lastSpeechAt;
        this.mark(this.caller, "caller_speech_end_observed", { observationDelayMs: now - this.lastSpeechAt }, now);
      }
    }
  }

  transcript(start: number, end: number, meaningful: boolean) {
    const now = Date.now();
    if (!this.caller || (this.caller.answered && meaningful)) this.caller = this.create("caller");
    const trace = this.caller;
    trace.lastTranscriptAt = now;
    if (Number.isFinite(start) && trace.callerStartMs === undefined) trace.callerStartMs = start;
    if (Number.isFinite(end)) trace.callerEndMs = end;
    if (this.lastSpeechAt !== undefined) {
      trace.speechEndObservedAt = this.lastSpeechAt;
      if (this.speechEndReported) trace.firstSpeechEndObservedAt ??= this.lastSpeechAt;
    }
    // One stable request survives fragmented transcripts and failed handoffs.
    this.mark(trace, "caller_transcript_received");
    return trace;
  }

  received(bytes: Buffer, audible: boolean) {
    const source = this.output || (this.caller ? { trace: this.caller } : undefined);
    const snapshot = source ? { ...source, receivedAt: Date.now() } : undefined;
    this.chunks.push({ bytes: bytes.length, ...(snapshot ? { source: snapshot } : {}) });
    if (source && audible) {
      const key = source.commentaryEventId || source.trace.requestId;
      if (!this.firstAudio.has(key)) {
        this.firstAudio.add(key);
        this.mark(source.trace, "live_audio_received", { delegationId: source.delegationId, commentaryEventId: source.commentaryEventId, correlation: "temporal_candidate", providerSuppliesAudioDelegationId: false });
      }
    }
  }

  /** Carry actual byte provenance through the existing 160-byte frame splitter. */
  queued(frame: Buffer) {
    let remaining = frame.length;
    const sources: AudioTrace[] = [];
    while (remaining > 0 && this.chunks.length) {
      const chunk = this.chunks[0]!;
      const consumed = Math.min(remaining, chunk.bytes);
      if (chunk.source) sources.push(chunk.source);
      chunk.bytes -= consumed; remaining -= consumed;
      if (!chunk.bytes) this.chunks.shift();
    }
    this.frames.set(frame, sources);
  }

  sent(frame: Buffer, audible: boolean, now = Date.now()) {
    const sources = this.frames.get(frame) || [];
    this.frames.delete(frame);
    if (!audible) return;
    for (const source of sources) {
      const key = source.commentaryEventId || source.trace.requestId;
      if (this.firstSent.has(key)) continue;
      this.firstSent.add(key);
      this.mark(source.trace, "telnyx_audio_sent", {
        delegationId: source.delegationId, commentaryEventId: source.commentaryEventId,
        correlation: "temporal_candidate", frameProvenance: "queued_pcmu_bytes",
        gatewayQueueMs: Math.max(0, now - (source.receivedAt ?? now)),
        telnyxWriteConfirmed: true, humanHearingConfirmed: false
      }, now);
    }
  }
}
