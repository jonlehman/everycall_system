export type Transcript = { role: "user" | "assistant"; text: string; start_ms: number; end_ms: number; sequence: number };
export type MeaningfulTurn = Transcript & { id: number; kind: "meaningful" | "backchannel" | "noise" };

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
export { normalize as normalizeSpokenText };
export function classifyCallerTurn(text: string, answeringQuestion: boolean): MeaningfulTurn["kind"] {
  if (!text.trim() || /^\s*\[(?:noise|silence|inaudible|background noise)\]\s*$/i.test(text)) return "noise";
  // Yes/no are never discarded: they can express consent, refusal or a correction.
  // Preserve non-English words and symbols: stripping every non-ASCII
  // character can turn a substantive request/refusal into a bare "thanks".
  const backchannel = text.toLowerCase().replace(/[.!?,;:\-\s]/g, "");
  if (!answeringQuestion && ["mhm", "mmhmm", "uhhuh", "okay", "ok", "right", "thanks", "thankyou", "goon"].includes(backchannel)) return "backchannel";
  return "meaningful";
}

/** Live sends deltas, not final-turn events. Finalization is an explicit application boundary. */
export class LiveTranscript {
  sequence = 0;
  revision = 0;
  turns: MeaningfulTurn[] = [];
  provisional: Transcript | undefined;
  private turnId = 0;

  append(role: Transcript["role"], text: string, start: number, end: number, answeringQuestion: boolean) {
    if (this.provisional && this.provisional.role !== role) this.finalize(answeringQuestion);
    const entry = { role, text, start_ms: Number.isFinite(start) ? start : 0, end_ms: Number.isFinite(end) ? end : 0, sequence: ++this.sequence };
    if (this.provisional) {
      this.provisional.text += text;
      this.provisional.end_ms = entry.end_ms;
      this.provisional.sequence = entry.sequence;
    } else this.provisional = { ...entry };
    if (this.provisional.text.length > 48000) throw new Error("live_transcript_turn_limit");
    return entry;
  }

  finalize(answeringQuestion: boolean) {
    const current = this.provisional;
    if (!current) return undefined;
    this.provisional = undefined;
    const kind = current.role === "assistant" ? "meaningful" : classifyCallerTurn(current.text, answeringQuestion);
    const turn = { ...current, id: ++this.turnId, kind };
    this.turns.push(turn);
    if (current.role === "user" && kind === "meaningful") this.revision++;
    while (this.turns.length > 128 || (this.turns.length > 1 && this.turns.reduce((n, x) => n + x.text.length, 0) > 48000)) this.turns.shift();
    return turn;
  }

  pendingWork(answeringQuestion: boolean) {
    return this.provisional?.role === "user" && classifyCallerTurn(this.provisional.text, answeringQuestion) === "meaningful";
  }
  latestCaller() { return this.turns.filter(x => x.role === "user" && x.kind === "meaningful").at(-1); }
}
