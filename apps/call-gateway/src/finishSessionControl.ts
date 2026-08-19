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
  accepted: boolean;
  reason: "accepted" | "closing_not_observed" | "assistant_question_requires_caller_answer" | "caller_clear_finish_after_preclose_question_required";
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
  return /\bthanks for calling\b[.!\s]*\bgoodbye\b[.!]?$/i.test(text);
}

export function callerClearlyFinished(transcript: unknown) {
  const text = normalizeText(transcript);
  if (!text) return false;
  return /^(?:no|nope|nah)(?:[,.!]?\s*(?:thanks?|thank you|that(?:'|’)s (?:all|everything|it)|i(?:'|’)m (?:good|all set)))?[.!]?$/i.test(text)
    || /^(?:that(?:'|’)s (?:all|everything|it)|nothing else|i(?:'|’)m (?:good|all set|done)|all set|goodbye|bye)[.!]?$/i.test(text);
}

export function evaluateFinishSessionRequest(state: FinishSessionDialogueState): FinishSessionDecision {
  const assistantSequence = Math.max(0, Number(state.lastAssistantTranscriptSequence || 0));
  const callerSequence = Math.max(0, Number(state.lastCallerTranscriptSequence || 0));
  if (!assistantSequence || !normalizeText(state.lastAssistantTranscript)) {
    return { accepted: false, reason: "closing_not_observed" };
  }
  if (assistantTurnContainsQuestion(state.lastAssistantTranscript)) {
    return { accepted: false, reason: "assistant_question_requires_caller_answer" };
  }
  if (!assistantTurnContainsClosing(state.lastAssistantTranscript)) {
    return { accepted: false, reason: "closing_not_observed" };
  }
  if (callerSequence > assistantSequence) {
    return { accepted: true, reason: "accepted" };
  }
  const previousAssistantSequence = Math.max(0, Number(state.previousAssistantTranscriptSequence || 0));
  const callerAnsweredPrecloseQuestion = previousAssistantSequence > 0
    && previousAssistantSequence < callerSequence
    && callerSequence < assistantSequence
    && assistantTurnContainsQuestion(state.previousAssistantTranscript)
    && callerClearlyFinished(state.lastCallerTranscript);
  if (!callerAnsweredPrecloseQuestion) {
    return { accepted: false, reason: "caller_clear_finish_after_preclose_question_required" };
  }
  return { accepted: true, reason: "accepted" };
}
