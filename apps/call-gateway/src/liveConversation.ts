/** Backend-owned conversation decisions. None of these fields are spoken facts. */
export type ConversationPlan = {
  caller_goal: string;
  readiness: "exploring" | "receptive" | "hesitant" | "declined";
  beat: "understand" | "answer" | "offer_callback" | "capture" | "confirm" | "checkpoint" | "listen";
  question_purpose: "none" | "discovery" | "required_contact" | "clarification" | "callback_consent" | "phone_confirmation" | "transfer_confirmation" | "other_questions";
  contact_field: string | null;
  clarifies_question_id: string | null;
};

export const CONVERSATION_PLAN_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["caller_goal", "readiness", "beat", "question_purpose", "contact_field", "clarifies_question_id"],
  properties: {
    caller_goal: { type: "string" },
    readiness: { type: "string", enum: ["exploring", "receptive", "hesitant", "declined"] },
    beat: { type: "string", enum: ["understand", "answer", "offer_callback", "capture", "confirm", "checkpoint", "listen"] },
    question_purpose: { type: "string", enum: ["none", "discovery", "required_contact", "clarification", "callback_consent", "phone_confirmation", "transfer_confirmation", "other_questions"] },
    contact_field: { type: ["string", "null"] }, clarifies_question_id: { type: ["string", "null"] }
  }
};

export const LIVE_CONVERSATION_POLICY = `
CONVERSATION CONTROLLER — apply the canonical Conversation and Callback Capture sections on every turn:
You are the receptionist's conversation controller as well as its reasoning agent. First interpret what the caller is trying to accomplish in the whole conversation, then choose the lightest helpful conversational beat. Do this in the SAME response as your handoff or tool decision; do not call a second planning model or narrate a plan.
Use conversation_state and the exact pending question, not just the latest short answer. Preserve the caller's goal across 'exterior', 'the whole thing', corrections and side questions. A delegation asks you to decide what the conversation needs; it is NOT an instruction to perform a knowledge lookup or ask another intake question.
Show specific understanding in spoken_response: naturally reflect the actual work or concern, answer the direct question, or respond to hesitation. This may reference what the caller just told you without treating it as a verified business fact. Do not turn every answer into a new question. next_question=null is valid: a brief specific reflection followed by listening is often the right beat. Do not fill that pause with another prompt.
Use at most two project-discovery questions for the call. One is often enough. After house painting + exterior + whole house are known, do not ask about peeling, worn paint, repairs, size, materials or condition merely to fill out a project questionnaire. Recognize the whole exterior project and move toward the approved callback path when receptive; if still explaining or hesitant, reflect briefly and listen. Do not force a callback from the question budget.
question_purpose=discovery means any optional question about the project, condition, scope or preferences, including an optional 'note' question. clarification is only for an unclear caller statement, correction, or a fact essential to answering their actual question; it is never a renamed discovery question. required_contact is only for a missing required callback field after explicit callback consent. Never classify contact questions as discovery.
Both discovery and unbound clarification consume the two-question budget. A genuine current caller business question may need one clarification to answer it (for example which state for a service-area question); set clarifies_question_id to caller:TURN_ID using that actual caller turn ID. This does not consume project discovery. The runtime retains that unresolved business question across the clarifier answer. Alternatively, a clarification may repeat the exact currently pending, heard question once, with clarifies_question_id set to that question's application ID. Otherwise set clarifies_question_id=null. For required_contact, set contact_field to an actual missing field in conversation_state.allowed_contact_questions and use one of its supplied questions; otherwise contact_field=null. These questions require application-confirmed callback consent. After first name, the canonical first-name-plus-surname-spelling form is also allowed. A self-declared readiness or field is never permission.
Answer direct questions before resuming the prior beat. An answer does not reset discovery or consent. Do not repeat known facts as filler. Do not ask for details already given or confirmed. Respect correction and interruption; superseded speech or a half-heard question does not establish a completed beat.
Readiness is a reasoned assessment from the caller's words and the canonical rules, never inferred merely from a short answer to discovery. A callback offer requires receptive; a declined or hesitant caller is not to be pushed. Refusal does not close the call. A later explicit caller request can reopen the callback path, but an acknowledgement or an unrelated yes cannot.
Only YOU decide when knowledge_lookup is needed. The tool requires lookup_intent with purpose=caller_question or service_fit and a specific missing_fact. Use caller_question for an unanswered business question that approved context/previous successful lookup does not cover; service_fit only when the actual requested service is not plainly covered and a capability decision is necessary. A caller describing their project or answering discovery is not by itself a reason to look up information. Never look up merely to acknowledge their words, generate the next question, or decide conversational timing. Reuse established facts; lookup answers return to the existing beat and never restart intake. Retain all pricing and factual-source rules above.
Every lookup_intent must also name caller_turn_id from the latest finalized caller turn and caller_quote copied exactly from that turn. For caller_question quote the actual question; for service_fit quote the actual service request. If unresolved_business_question records an original business question and its heard clarifier has just been answered, cite either that original caller question or the latest clarification answer; the gateway combines their exact evidence. Otherwise never cite an assistant question, older request, or short discovery answer as new lookup authority. The gateway builds retrieval input from that evidence, never from an invented missing_fact.
Return conversation_plan with your caller_goal, readiness, beat and question_purpose alongside the speech handoff. It is a concise decision record, not private reasoning. The application tracks discovery usage and validates it. Do not put the plan in speech or verified_facts. The separate Live model receives only approved speech and a quiet instruction to wait after that beat.`;

export type LookupIntent = { purpose: "caller_question" | "service_fit"; missing_fact: string; caller_turn_id: number; caller_quote: string };
export const LOOKUP_INTENT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["purpose", "missing_fact", "caller_turn_id", "caller_quote"],
  properties: { purpose: { type: "string", enum: ["caller_question", "service_fit"] }, missing_fact: { type: "string" }, caller_turn_id: { type: "integer" }, caller_quote: { type: "string" } }
};

export function validLookupIntent(value: any): value is LookupIntent {
  return value && Object.keys(value).sort().join() === "caller_quote,caller_turn_id,missing_fact,purpose"
    && ["caller_question", "service_fit"].includes(value.purpose)
    && typeof value.missing_fact === "string" && value.missing_fact.trim().length > 0 && value.missing_fact.length <= 320
    && Number.isInteger(value.caller_turn_id) && typeof value.caller_quote === "string" && value.caller_quote.trim().length > 0 && value.caller_quote.length <= 2000;
}

const normalized = (text: string) => text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9']/g, " ").replace(/\s+/g, " ").trim();
type CallerEvidence = { id: number; text: string };
type QuestionEvidence = { id: string; kind: string; text: string; spokenSequence?: number; answerTurnId?: number };
export type UnresolvedBusinessQuestion = { caller: CallerEvidence; questionId: string; questionText: string };
export type ConversationEvidence = { caller?: CallerEvidence | undefined; pendingQuestion?: QuestionEvidence | undefined; capturedFields: Record<string, unknown>; contactFields: string[] };

export function isCallerBusinessQuestion(text: string) {
  const quote = normalized(text);
  return (/\b(?:you|your|business|company)\b/.test(quote)
    && (/[?]/.test(text) || /\b(?:do|does|can|could|would|will|are|is|what|when|where|how|why|which)\b/.test(quote)))
    || /\b(?:hours|warranty|prices?|pricing|cost|service area|availability|estimate policy)\b/.test(quote);
}

/** Query content comes from a real caller span, never a self-labelled missing fact. */
export function bindLookupIntent(intent: LookupIntent, caller?: CallerEvidence, pendingQuestion?: QuestionEvidence, unresolved?: UnresolvedBusinessQuestion): { query?: string; error?: string } {
  const continuing = unresolved && pendingQuestion?.id === unresolved.questionId && pendingQuestion.spokenSequence
    && pendingQuestion.answerTurnId === caller?.id;
  const original = continuing && intent.caller_turn_id === unresolved.caller.id ? unresolved.caller : caller;
  if (!caller || !original || intent.caller_turn_id !== original.id) return { error: "lookup_caller_turn_binding" };
  const quote = normalized(intent.caller_quote), source = normalized(original.text);
  if (!quote || !(` ${source} `).includes(` ${quote} `)) return { error: "lookup_caller_quote_binding" };
  if (continuing && intent.purpose === "caller_question") return { query: `${unresolved.caller.text}\nClarification asked: ${unresolved.questionText}\nCaller clarified: ${caller.text}` };
  const directQuestion = /[?]/.test(intent.caller_quote)
    || /^(?:what|when|where|how|why|which|do|does|did|can|could|would|will|are|is)\b/.test(quote)
    || /\b(?:do|does|can|could|would|will|are|is) (?:you|your|the business|there)\b/.test(quote)
    || /\b(?:hours|warranty|prices?|pricing|service area|availability|estimate policy)\b/.test(quote);
  if (intent.purpose === "caller_question") {
    // Short answers to an already-asked discovery question are not new business questions.
    if (!directQuestion || (pendingQuestion?.answerTurnId === caller.id && !/[?]/.test(intent.caller_quote) && !/^(?:do|does|can|could|would|will|are|is|what|when|where|how|why|which)\b/.test(quote))) return { error: "lookup_not_caller_question" };
    return { query: intent.caller_quote.trim() };
  }
  if (!/\b(?:i|we) (?:need|want|would like|am looking|are looking|have)\b/.test(quote) && !/\b(?:do|can|could|will|would) you\b/.test(quote)) return { error: "lookup_not_service_request" };
  // An asserted missing_fact cannot turn service-fit retrieval into a diagnostic
  // question about the caller's property. The application constructs the query.
  return { query: `Does the business offer the service requested by this caller: "${intent.caller_quote.trim()}"? Answer only the business capability, not the condition or quantity of work at the caller's property.` };
}

const CONTACT_QUESTIONS: Record<string, string[]> = {
  first_name: ["What is your first name?", "What is your name?"],
  caller_name: ["What is your name?"],
  last_name: ["Could you spell your last name?", "What is your last name?"],
  callback_number: ["What is your callback number?", "What is the best number to reach you?"],
  caller_phone: ["What is your callback number?", "What is the best number to reach you?"],
  phone: ["What is your phone number?"],
  email: ["What is your email address?"],
  caller_email: ["What is your email address?"],
  address_line1: ["What is the street address?"],
  address: ["What is the property address?"],
  city: ["What city is the property in?"],
  state: ["What state is the property in?"],
  postal_code: ["What is the ZIP code?"],
  preferred_time: ["When is a good time to reach you?"],
  requested_time: ["When is a good time to reach you?"]
};

const clearlyYes = (text: string) => /^(?:yes|yeah|yep|sure|okay|ok|please do|that sounds good|sounds good|go ahead)\b/.test(normalized(text))
  && !/\b(?:no|not|don't|do not|maybe|wait|later)\b/.test(normalized(text));
const clearlyNo = (text: string) => /^(?:no|no thanks|no thank you|not now|not interested)\b/.test(normalized(text));

/** Tracks accepted decisions, without trying to derive business intent from transcript regexes. */
export class LiveConversationController {
  private discoveryQuestions = 0;
  private plan: ConversationPlan | null = null;
  private callbackConsent = false;
  private callbackDeclined = false;
  private repeatedQuestions = new Set<string>();
  private clarifiedCallerQuestions = new Set<string>();

  observeAnswer(question: QuestionEvidence, answer: CallerEvidence) {
    if (question.kind === "callback_consent" && question.spokenSequence && question.answerTurnId === answer.id) {
      this.callbackConsent = clearlyYes(answer.text);
      this.callbackDeclined = clearlyNo(answer.text);
    }
    this.observeCaller(answer);
  }

  observeCaller(answer: CallerEvidence) {
    if (/\b(?:don't|do not|stop|cancel)\b.*\b(?:call|calling|callback|contact)\b/.test(normalized(answer.text))) { this.callbackConsent = false; this.callbackDeclined = true; }
  }

  snapshot(evidence?: ConversationEvidence) {
    return { last_plan: this.plan, discovery_questions_issued: this.discoveryQuestions,
      discovery_questions_remaining: Math.max(0, 2 - this.discoveryQuestions),
      callback_consent_confirmed: this.callbackConsent, callback_declined: this.callbackDeclined,
      allowed_contact_questions: evidence && this.callbackConsent ? Object.fromEntries(evidence.contactFields.filter(key => CONTACT_QUESTIONS[key] && !evidence.capturedFields[key]).map(key => [key, CONTACT_QUESTIONS[key]])) : {},
      instruction: "Continue the caller's goal and current beat. Optional discovery is bounded; reaching its limit does not imply callback consent or readiness." };
  }

  validate(plan: any, question: { kind: string; text?: string } | null, evidence?: ConversationEvidence): string | undefined {
    if (!plan || Object.keys(plan).sort().join() !== "beat,caller_goal,clarifies_question_id,contact_field,question_purpose,readiness"
      || typeof plan.caller_goal !== "string" || !plan.caller_goal.trim() || plan.caller_goal.length > 320
      || !CONVERSATION_PLAN_SCHEMA.properties.readiness.enum.includes(plan.readiness)
      || !CONVERSATION_PLAN_SCHEMA.properties.beat.enum.includes(plan.beat)
      || !CONVERSATION_PLAN_SCHEMA.properties.question_purpose.enum.includes(plan.question_purpose)
      || (plan.contact_field !== null && typeof plan.contact_field !== "string")
      || (plan.clarifies_question_id !== null && typeof plan.clarifies_question_id !== "string")) return "conversation_plan_shape";
    if (!question && plan.question_purpose !== "none") return "conversation_question_binding";
    if (question) {
      const allowed = question.kind === "intake" ? ["discovery", "required_contact"]
        : question.kind === "clarification" ? ["discovery", "clarification"] : [question.kind];
      if (!allowed.includes(plan.question_purpose)) return "conversation_question_binding";
    }
    // Parsing checks shape; runtime validation always supplies authoritative evidence.
    if (evidence && question && ["intake", "clarification"].includes(question.kind)) {
      if (plan.question_purpose === "required_contact") {
        if (!this.callbackConsent) return "conversation_contact_without_consent";
        const field = plan.contact_field;
        if (!field || !evidence.contactFields.includes(field) || !CONTACT_QUESTIONS[field] || evidence.capturedFields[field]) return "conversation_contact_field_binding";
        const text = normalized(question.text || "");
        const matches = CONTACT_QUESTIONS[field]!.some(value => normalized(value) === text)
          || (field === "last_name" && /^[a-z]+ could you spell your last name$/.test(text));
        if (!matches) return "conversation_contact_question_binding";
      } else {
        const pending = evidence.pendingQuestion;
        const callerQuestion = plan.question_purpose === "clarification" && evidence.caller
          && plan.clarifies_question_id === `caller:${evidence.caller.id}` && isCallerBusinessQuestion(evidence.caller.text)
          && !this.clarifiedCallerQuestions.has(plan.clarifies_question_id);
        const repeated = plan.clarifies_question_id && plan.question_purpose === "clarification"
          && pending?.spokenSequence && pending.id === plan.clarifies_question_id && pending.answerTurnId === evidence.caller?.id
          && normalized(pending.text) === normalized(question.text || "") && !this.repeatedQuestions.has(normalized(pending.text));
        if (plan.clarifies_question_id && !repeated && !callerQuestion) return "conversation_clarification_binding";
        if (!repeated && !callerQuestion && this.discoveryQuestions >= 2) return "conversation_discovery_limit";
      }
    }
    if (plan.question_purpose === "callback_consent" && (plan.beat !== "offer_callback" || plan.readiness !== "receptive")) return "conversation_callback_readiness";
    if (evidence && question?.kind === "callback_consent") {
      if (!/\b(?:callback|call|follow up)\b/.test(normalized(question.text || ""))) return "conversation_callback_question_binding";
      if (this.callbackDeclined && (!/\b(?:call me|call us|want.*callback|like.*(?:callback|call)|please.*call)\b/.test(normalized(evidence.caller?.text || "")) || clearlyNo(evidence.caller?.text || "") || /\b(?:don't|do not)\b/.test(normalized(evidence.caller?.text || "")))) return "conversation_callback_declined";
    }
    if (evidence && question?.kind === "phone_confirmation") {
      const digits = (question.text || "").replace(/\D/g, "");
      const known = Object.entries(evidence.capturedFields).filter(([key]) => /phone|number/.test(key)).map(([, value]) => String(value)).join(" ") + " " + (evidence.caller?.text || "");
      if (!this.callbackConsent || digits.length < 7 || !known.replace(/\D/g, "").includes(digits)) return "conversation_phone_confirmation_binding";
    }
    if (evidence && question?.kind === "transfer_confirmation" && !/\b(?:transfer|connect|put you through)\b/.test(normalized(question.text || ""))) return "conversation_transfer_question_binding";
    if (plan.question_purpose === "required_contact" && plan.beat !== "capture") return "conversation_capture_beat";
    if (plan.beat === "listen" && question) return "conversation_listen_question";
    return undefined;
  }

  accept(plan: ConversationPlan, question?: { kind: string; text: string } | null) {
    if (["discovery", "clarification"].includes(plan.question_purpose) && !plan.clarifies_question_id) this.discoveryQuestions++;
    if (plan.clarifies_question_id?.startsWith("caller:")) this.clarifiedCallerQuestions.add(plan.clarifies_question_id);
    else if (plan.clarifies_question_id && question) this.repeatedQuestions.add(normalized(question.text));
    this.plan = { ...plan };
  }
}
