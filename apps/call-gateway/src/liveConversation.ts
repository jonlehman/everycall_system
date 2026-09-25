/** Backend policy decisions and conversational recommendations, never spoken facts. */
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
EXPERT ADVISER CONTEXT — use conversation history to answer the specific question or support the protected action:
Use conversation_state, the latest caller AND assistant turns, and the exact pending question to understand short answers, corrections and refusals. Preserve the caller's goal across 'exterior', 'the whole thing' and side questions. Live owns ordinary flow and general industry discussion; neither a delegation nor an application transcript observation requires you to plan another conversational turn. Do not call a second planning model or narrate a plan.
For an ordinary project description or natural exchange with no missing company fact or protected task, return recommended_move=acknowledge, next_question=null, verified_facts=[] and boundaries=[] unless an actual restriction must be communicated. This is a quiet no-op, not a direction to reflect, wait or stop. Acknowledge never resolves an open goal. Answer a concrete fact request with only the relevant supported facts. Use ask only for an essential factual clarification or protected application step; leave ordinary discovery to Live. Do not choose explain_limit to report optional-advice delays, internal problems or lack of anything useful to add.
The application retains the two-question optional-discovery budget, exact-question binding, callback consent, capture and closing gates. Do not relabel optional discovery as clarification or required_contact to bypass them. A true factual clarification is needed to answer the caller's specific company question, not to fill out a project questionnaire. Set clarifies_question_id to caller:TURN_ID for that current caller question; the runtime retains it across the clarification answer. A once-only repeat of an exact currently pending, heard question instead uses its application question ID. Otherwise set clarifies_question_id=null.
For required_contact, use an actual missing field from conversation_state.allowed_contact_questions and one of that field's supplied questions. Set contact_field to that field; otherwise use null. Application-confirmed callback consent is required. After first name, the canonical first-name-plus-surname-spelling form is also allowed. A self-declared readiness, an unrelated yes, or a discovery answer is never permission. A callback offer requires receptive; preserve hesitation or refusal unless the caller explicitly reopens that path. A refusal does not end the call.
Use knowledge_lookup selectively for an actual missing approved company, product or service fact. The tool requires lookup_intent with purpose=caller_question or service_fit and a specific missing_fact. Use caller_question for a question that approved context or a relevant prior successful lookup does not answer. Use service_fit only when the actual requested service is not plainly covered and a company capability decision is necessary. A caller describing a painting project, naming the exterior, explaining peeling paint, or answering discovery is not by itself a lookup request. General industry context, recognition, question choice and pacing require no lookup. Preserve pricing and factual-source rules.
Every lookup_intent must name caller_turn_id from the latest finalized caller turn and caller_quote copied exactly from that turn. Quote the actual company question or service request. If unresolved_business_question records an original company question and its heard clarifier has just been answered, cite either that original question or the latest clarification answer; the gateway combines their exact evidence. Otherwise never cite an assistant question, older request, or short discovery answer as new lookup authority. The gateway constructs retrieval input from caller evidence, never an invented missing_fact.
Return conversation_plan because the application schema requires it: caller_goal briefly records the ongoing request, readiness reflects the caller's words, and beat/question_purpose describe only the current factual or protected task. For a quiet no-op use beat=listen and question_purpose=none. This record is context, not a plan for Live to follow. Keep it out of verified_facts. Return concise quiet facts with provenance; keep raw tools and private reasoning in the backend. Do not repeat an answer or question already delivered, reset intake, or override a newer correction.`;

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

/** A narrow bypass for content-free human beats, not a business-intent parser.
 * Unknown wording, appended requests and all fact repetition require the backend.
 * Runtime callers must also rule out outstanding questions, work and actions.
 */
export function classifyLocalLiveBeat(text: string): "acknowledge" | "clarify" | undefined {
  // Strip only ordinary speech punctuation. Dropping arbitrary Unicode could
  // hide a substantive non-English suffix behind an otherwise allowed hello.
  const value = text.toLowerCase().replace(/[’']/g, "'").replace(/[.!?,;:]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:hello|hi|hey|good morning|good afternoon|good evening|thanks|thank you|thanks very much|thank you very much|thank you for your help)$/.test(value)) return "acknowledge";
  if (/^(?:can you help me|could you help me|i need help|i have a question|i'm not sure how to explain|i am not sure how to explain)$/.test(value)) return "clarify";
  return undefined;
}

type CallerEvidence = { id: number; text: string };
type QuestionEvidence = { id: string; kind: string; text: string; spokenSequence?: number; answerTurnId?: number };
export type UnresolvedBusinessQuestion = { caller: CallerEvidence; questionId: string; questionText: string };
export type ConversationEvidence = { caller?: CallerEvidence | undefined; pendingQuestion?: QuestionEvidence | undefined; capturedFields: Record<string, unknown>; contactFields: string[] };

export function isCallerBusinessQuestion(text: string) {
  const quote = normalized(text);
  // A conservative authority boundary: factual questions need the adviser even
  // when the caller omits "you/your" ("Where is the office?"). A false positive
  // delays a local offer; a false negative could invite an unsupported answer.
  return /[?]/.test(text)
    || /^(?:what|when|where|how|why|which|do|does|did|can|could|would|will|are|is)\b/.test(quote)
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
  if (!/\b(?:i|we) (?:need|want|would like|am looking|are looking|have)\b/.test(quote)
    && !/\b(?:my|our)\b.{1,80}\bneeds?\b/.test(quote)
    && !/\b(?:do|can|could|will|would) you\b/.test(quote)) return { error: "lookup_not_service_request" };
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
const callbackRefusal = (text: string) => /\b(?:no|not|never|don't|do not|stop|cancel|decline|refuse)\b.{0,60}\b(?:call|callback|contact|follow up)\b/.test(normalized(text));
const callbackHesitation = (text: string) => /\b(?:not ready|not comfortable|unsure|uncertain|maybe later)\b.{0,60}\b(?:call|callback|contact|phone|number|details)\b/.test(normalized(text))
  || /\b(?:only|just)\b.{0,24}\b(?:want|need)\b.{0,24}\b(?:information|answer|details)\b/.test(normalized(text));

/** Conservative semantic boundary, independent of a prepared question or model
 * claim. Unknown or multi-intent wording must get a fresh callback-specific
 * question. Never delete arbitrary characters before an authorization match. */
export function isCallbackInvitation(text: string, confirmedCallbackRole?: string): boolean {
  const value = text.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
  if ((value.match(/\?/g)?.length || 0) > 1 || /\b(?:or|not|don't|do not|never|unless)\b/.test(value)) return false;
  const sentences = value.split(/[.!?]+/).map(part => part.trim()).filter(Boolean);
  const question = sentences.at(-1) || "";
  // One invitation must be the only question/request in the completed turn.
  // Question marks are unreliable in live transcription: reject comma-joined,
  // unpunctuated and imperative contact questions as well.
  const questionStart = /^(?:what|where|when|why|how|which|who|would|could|can|may|shall|should|do|does|did|are|is|will|have|has|tell|give|share|spell|provide|confirm)\b/;
  if (sentences.slice(0, -1).some(sentence => questionStart.test(sentence))) return false;
  if (/[,;:]|\b(?:and|also|plus)\b/.test(question)) return false;
  if (/\b(?:and|or|to|if|because|with|about|from|for|the|a|an)$/.test(question)) return false;
  const invitation = /^(?:would you like|do you want|shall i|should i|can i|may i|could i|are you interested in|would it help|would that help|would that work|does that sound good|is that something you'd like)\b/;
  const opening = question.match(invitation)?.[0];
  if (!opening) return false;
  const competingClause = (clause: string) => {
    const expanded = clause.replace(/\b(what|where|when|why|how|who|there|that)'s\b/g, "$1 is");
    return /[,;:]|\b(?:and|also|plus)\b/.test(expanded)
      || /\b(?:may|can|could|would|will|shall|should|do|does|did|are|is|have|has)\s+(?:i|you|we|your|our|the|there|it|this|that)\b/.test(expanded)
      || /\b(?:tell|give|share|spell|provide|confirm)\s+(?:me|us|your)\b/.test(expanded)
      || /\b(?:your|first|last|full|best|callback)\s+(?:name|phone|number|email|address)\b/.test(expanded);
  };
  if (competingClause(question.slice(opening.length))) return false;
  const role = "(?:estimator|plumber|technician|electrician|roofer|project manager|team member|representative|specialist|coordinator|office manager|manager|consultant)";
  const confirmedRole = confirmedCallbackRole?.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
  const tenantActor = confirmedRole && /^[\p{L}][\p{L} '-]{0,100}$/u.test(confirmedRole)
    ? `|${confirmedRole.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` : "";
  const actor = `(?:someone(?: from (?:the|our) team)?|one of our ${role}s|(?:an?|our|the) ${role}|(?:our|the) team|them${tenantActor})`;
  const call = "(?:(?:call|phone|ring) you(?: back)?|give you a call)(?=$|[, ](?:about|to|for|on|later|this|tomorrow|at|so|who|from)\\b)";
  const direct = new RegExp(`^(?:would you like|do you want|are you interested in) (?:a (?:callback|call back|return call)(?:$| (?:from|about|to|so)\\b)|${actor} to ${call}|me to (?:${call}|(?:have|ask|arrange for) ${actor} (?:to )?${call}))`);
  const arrange = new RegExp(`^(?:(?:shall|should|can|may|could) i |would it help (?:if i |to ))(?:(?:have|ask|arrange for) ${actor} (?:to )?${call}|arrange a (?:callback|call back|return call)(?:$| (?:from|about|to|so)\\b))`);
  // A deictic invitation is safe only with one immediately preceding callback
  // statement in this same completed assistant turn.
  if (direct.test(question) || arrange.test(question)) return true;
  const antecedent = sentences.at(-2) || "";
  return /^(?:would you like that|would that help|would that work|does that sound good|is that something you'd like)$/.test(question)
    && !competingClause(antecedent)
    && new RegExp(`^(?:${actor} (?:can|will|would) ${call}|(?:the natural next step|the next step) is a (?:callback|call back|return call)(?:$| from\\b))`).test(antecedent);
}

export function callbackAgreement(text: string): "agreed" | "declined" | "ambiguous" {
  const value = text.toLowerCase().replace(/[’]/g, "'").replace(/[.!?,;:…]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(?:no|nope|don't|do not|not now|not interested|cancel|stop)\b/.test(value)) return "declined";
  if (/[?]/.test(text) || /\b(?:but|actually|instead|wait|correction|rather|maybe|perhaps|probably|guess|think|suppose)\b/.test(value)) return "ambiguous";
  const bare = value.replace(/ (?:please|thanks|thank you)$/, "");
  const agreement = /^(?:yes|yeah|yep|sure|absolutely|certainly|definitely|please do|go ahead|sounds good|that sounds good|that'd be (?:helpful|great)|that would be (?:helpful|great|fine|good)|i'd like that|i would like that)$/;
  if (agreement.test(bare) || agreement.test(bare.replace(/^(?:yes|yeah|yep|sure|absolutely|certainly|definitely) /, ""))) return "agreed";
  if (/^(?:(?:yes|yeah|yep|sure|okay|ok) )?(?:please )?(?:have (?:them|someone|the team|an estimator|a technician) call me(?: back)?|call me(?: back)?|i(?:'d| would) like a callback|i want a callback)(?: please)?$/.test(bare)) return "agreed";
  // In particular, a lone okay is not explicit callback agreement.
  return "ambiguous";
}

/** Tracks accepted decisions, without trying to derive business intent from transcript regexes. */
export class LiveConversationController {
  private discoveryQuestions = 0;
  private plan: ConversationPlan | null = null;
  private callbackConsent = false;
  private callbackDeclined = false;
  private repeatedQuestions = new Set<string>();
  private clarifiedCallerQuestions = new Set<string>();

  bindCallbackDecision(decision: "agreed" | "declined" | "ambiguous") {
    this.callbackConsent = decision === "agreed";
    this.callbackDeclined = decision === "declined";
  }

  canOfferCallback(caller?: CallerEvidence) {
    const text = normalized(caller?.text || "");
    return !this.callbackConsent && !callbackRefusal(text) && !callbackHesitation(text)
      && (!(this.callbackDeclined || ["hesitant", "declined"].includes(this.plan?.readiness || "")) ||
      (/\b(?:call me|call us|want.*callback|like.*(?:callback|call)|please.*call)\b/.test(text)
        && !clearlyNo(text) && !/\b(?:don't|do not)\b/.test(text)));
  }

  observeAnswer(question: QuestionEvidence, answer: CallerEvidence) {
    if (question.kind === "callback_consent" && question.spokenSequence && question.answerTurnId === answer.id) {
      this.callbackConsent = clearlyYes(answer.text);
      this.callbackDeclined = clearlyNo(answer.text);
    }
    this.observeCaller(answer);
  }

  observeCaller(answer: CallerEvidence) {
    if (callbackRefusal(answer.text)) { this.callbackConsent = false; this.callbackDeclined = true; }
    else if (callbackHesitation(answer.text)) { this.callbackConsent = false; this.callbackDeclined = true; }
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
    if (plan.clarifies_question_id?.startsWith("caller:")) this.clarifiedCallerQuestions.add(plan.clarifies_question_id);
    else if (plan.clarifies_question_id && question) this.repeatedQuestions.add(normalized(question.text));
    this.plan = { ...plan };
  }

  // Count observed ordinary questions, including questions Live chose itself.
  // Merely suggesting a question is not proof it was asked. Protected questions
  // retain their explicit application binding and never become discovery.
  observeAssistantQuestion(protectedQuestion: boolean) {
    if (!protectedQuestion) this.discoveryQuestions++;
  }
}
