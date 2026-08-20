export type FinishSessionDialogueState = {
  dialogueTurnSequence?: number;
  lastCallerTranscriptSequence?: number;
  previousAssistantTranscriptSequence?: number;
  lastAssistantTranscriptSequence?: number;
  lastCallerTranscript?: string;
  previousAssistantTranscript?: string;
  lastAssistantTranscript?: string;
};

export type FinishSessionDecision = {
  accepted: true;
  reason: "accepted";
};

function normalizeText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function noteFinishSessionDialogueTurn(
  state: FinishSessionDialogueState,
  role: "caller" | "assistant",
  transcript: string
) {
  const text = normalizeText(transcript);
  if (!text) return state;
  const sequence = Math.max(0, Number(state.dialogueTurnSequence || 0)) + 1;
  state.dialogueTurnSequence = sequence;
  if (role === "caller") {
    state.lastCallerTranscriptSequence = sequence;
    state.lastCallerTranscript = text;
  } else {
    state.previousAssistantTranscriptSequence = Math.max(0, Number(state.lastAssistantTranscriptSequence || 0));
    state.previousAssistantTranscript = normalizeText(state.lastAssistantTranscript);
    state.lastAssistantTranscriptSequence = sequence;
    state.lastAssistantTranscript = text;
  }
  return state;
}

export function assistantTurnContainsQuestion(transcript: unknown) {
  const text = normalizeText(transcript);
  if (!text) return false;
  return /\?/.test(text)
    || /(?:^|[.!]\s+)(?:who|what|when|where|why|how|would|could|can|may|is|are|do|does|did|have|has)\b[^.!?]*$/i.test(text)
    || /\b(?:anything|something)\s+else\b[^.!?]*(?:share|tell|ask|add|mention|want|need)/i.test(text)
    || /\b(?:share|tell|ask|add|mention)\b[^.!?]*(?:anything|something)\s+else\b/i.test(text)
    || /\b(?:you can|feel free to)\s+(?:share|tell|ask|add|mention)\b/i.test(text);
}

export function assistantTurnContainsClosing(transcript: unknown) {
  const text = normalizeText(transcript);
  return /\bthanks for calling(?:,\s*[^.!?]+)?\.\s*have a good one\.[.!]?$/i.test(text);
}

export function callerClearlyFinished(transcript: unknown) {
  const text = normalizeText(transcript);
  if (!text) return false;
  return /^(?:no|nope|nah)(?:[,.!]?\s*(?:thanks?|thank you|that(?:'|’)s (?:all|everything|it)|i(?:'|’)m (?:good|all set)))?[.!]?$/i.test(text)
    || /^(?:that(?:'|’)s (?:all|everything|it)|nothing else|i(?:'|’)m (?:good|all set|done)|all set|goodbye|bye)[.!]?$/i.test(text);
}

export function evaluateFinishSessionRequest(_state: FinishSessionDialogueState): FinishSessionDecision {
  // The Realtime model owns the conversational close. Once it emits the tool,
  // the gateway must not second-guess the call from incomplete transcript state.
  return { accepted: true, reason: "accepted" };
}
