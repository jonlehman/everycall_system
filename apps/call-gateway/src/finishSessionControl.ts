export type FinishSessionDialogueState = {
  dialogueTurnSequence?: number;
  lastCallerTranscriptSequence?: number;
  lastAssistantTranscriptSequence?: number;
  lastCallerTranscript?: string;
  lastAssistantTranscript?: string;
};

export type FinishSessionDecision = {
  accepted: boolean;
  reason: "accepted" | "closing_not_observed" | "assistant_question_requires_caller_answer" | "caller_response_after_closing_required";
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
    state.lastAssistantTranscriptSequence = sequence;
    state.lastAssistantTranscript = text;
  }
  return state;
}

export function assistantTurnContainsQuestion(transcript: unknown) {
  const text = normalizeText(transcript);
  if (!text) return false;
  return /\?/.test(text)
    || /(?:^|[.!]\s+)(?:who|what|when|where|why|how|would|could|can|may|is|are|do|does|did|have|has)\b[^.!?]*$/i.test(text);
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
  if (callerSequence <= assistantSequence) {
    return { accepted: false, reason: "caller_response_after_closing_required" };
  }
  return { accepted: true, reason: "accepted" };
}
