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

export type AssistantClosingEvidence = {
  audioObserved?: boolean;
  transcript?: unknown;
};

export type AssistantResponseEvidence = {
  responseId: string;
  transcript: string;
  audioObserved: boolean;
  playbackDrained: boolean;
  responseDone: boolean;
};

export type AssistantResponseEvidenceState = {
  assistantResponseEvidence?: Map<string, AssistantResponseEvidence>;
  currentResponseId?: string | null;
  lastAssistantResponseId?: string | null;
};

export type FinishSessionClosingRecovery = {
  closing: string;
  response: {
    instructions: string;
    tool_choice: "none";
    tools: [];
  };
};

function normalizeText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeResponseId(value: unknown) {
  return String(value || "").trim();
}

export function ensureAssistantResponseEvidence(state: AssistantResponseEvidenceState, responseId: unknown) {
  const normalizedResponseId = normalizeResponseId(responseId)
    || normalizeResponseId(state.currentResponseId)
    || normalizeResponseId(state.lastAssistantResponseId);
  if (!normalizedResponseId) return null;
  if (!(state.assistantResponseEvidence instanceof Map)) {
    state.assistantResponseEvidence = new Map<string, AssistantResponseEvidence>();
  }
  let evidence = state.assistantResponseEvidence.get(normalizedResponseId);
  if (!evidence) {
    evidence = {
      responseId: normalizedResponseId,
      transcript: "",
      audioObserved: false,
      playbackDrained: false,
      responseDone: false
    };
    state.assistantResponseEvidence.set(normalizedResponseId, evidence);
    while (state.assistantResponseEvidence.size > 12) {
      const oldestResponseId = state.assistantResponseEvidence.keys().next().value;
      if (!oldestResponseId) break;
      state.assistantResponseEvidence.delete(oldestResponseId);
    }
  }
  state.lastAssistantResponseId = normalizedResponseId;
  return evidence;
}

export function getAssistantResponseEvidence(state: AssistantResponseEvidenceState, responseId: unknown) {
  const normalizedResponseId = normalizeResponseId(responseId);
  return normalizedResponseId && state.assistantResponseEvidence instanceof Map
    ? state.assistantResponseEvidence.get(normalizedResponseId) || null
    : null;
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

export function assistantResponseContainsSpokenClosing(evidence: AssistantClosingEvidence | null | undefined) {
  return Boolean(evidence?.audioObserved && assistantTurnContainsClosing(evidence.transcript));
}

export function normalizeConfirmedFirstName(value: unknown) {
  const raw = String(value || "");
  if (/[\r\n\t]/.test(raw)) return "";
  const normalized = normalizeText(raw).normalize("NFKC");
  if (!normalized || normalized.length > 50) return "";
  return /^[\p{L}\p{M}][\p{L}\p{M}'’.-]*$/u.test(normalized)
    ? normalized
    : "";
}

export function buildFinishSessionClosing(firstName: unknown) {
  const normalizedFirstName = normalizeConfirmedFirstName(firstName);
  return normalizedFirstName
    ? `Thanks for calling, ${normalizedFirstName}. Have a good one.`
    : "Thanks for calling. Have a good one.";
}

export function buildFinishSessionClosingRecovery(firstName: unknown): FinishSessionClosingRecovery {
  const closing = buildFinishSessionClosing(firstName);
  return {
    closing,
    response: {
      instructions: `Say exactly this and nothing else: ${JSON.stringify(closing)}`,
      tool_choice: "none",
      tools: []
    }
  };
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
