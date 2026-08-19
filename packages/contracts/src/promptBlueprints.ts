export type PromptBlueprintStatus = "draft" | "active" | "archived";
export type PromptRenderMode = "legacy" | "layered";

export const TRANSFER_RULES_PROMPT_BLOCK = `# Transfer Rules
- If the caller asks for a person or extension, use lookup_transfer_target before assuming you know the destination.
- Never reveal, read back, or hint at the private forwarding number.
- If lookup_transfer_target returns more than one match, ask one short clarification question.
- If lookup_transfer_target returns one clear match, ask one short confirmation question about whether the caller wants to be transferred now.
- Only call transfer_call after the caller clearly says yes to that confirmation question.
- Only use a target_id returned by lookup_transfer_target in this same call.
- If a transfer attempt does not connect, apologize briefly and offer to take a message or try another person.`;

export type PromptBlueprintSectionId =
  | "role_objective"
  | "business_context"
  | "core_facts"
  | "adjacent_requests"
  | "priority_order"
  | "personality_tone"
  | "variety"
  | "sample_phrase_guidance"
  | "core_behavioral_rules"
  | "conversational_attunement"
  | "discovery_and_fit"
  | "readiness_before_callback_capture"
  | "transition_to_callback_capture"
  | "lead_capture_rules"
  | "name_and_phone_accuracy"
  | "tools"
  | "knowledge_boundaries"
  | "handling_uncertainty"
  | "filtering_rules"
  | "audio_conversation_safety"
  | "conversation_flow"
  | "wording_preferences"
  | "closing"
  | "final_reminder";

export type SamplePhraseGroupId =
  | "greeting_samples"
  | "acknowledgement_samples"
  | "discovery_question_samples"
  | "fit_bridge_samples"
  | "callback_request_samples"
  | "closing_samples";

export type RuntimeToolName =
  | "knowledge_lookup"
  | "data_capture"
  | "finish_session"
  | "lookup_transfer_target"
  | "transfer_call";

export type PromptBlueprintSection = {
  section_id: PromptBlueprintSectionId;
  section_order: number;
  default_text: string;
  is_template: boolean;
  allowed_placeholders: string[];
  admin_metadata?: Record<string, unknown>;
};

export type PromptBlueprintRecord = {
  prompt_blueprint_id: string;
  blueprint_key: string;
  version: number;
  status: PromptBlueprintStatus;
  name: string;
  sample_phrase_groups: Record<SamplePhraseGroupId, string[]>;
  tool_definitions: PromptToolDefinitions;
  created_at?: string | null;
  updated_at?: string | null;
};

export type PromptBlueprintBundle = PromptBlueprintRecord & {
  sections: PromptBlueprintSection[];
};

export type TenantPromptProfile = {
  tenant_key?: string | null;
  assistant_name: string;
  business_name: string;
  company_description: string;
  opening_line: string;
  ai_disclosure_line: string;
  lead_goal: string;
  required_contact_fields: string[];
  closing_phrase: string;
  basic_no_tool_allowed_statement: string;
  updated_at?: string | null;
  created_at?: string | null;
};

export type PromptToolDefinitionText = {
  description: string;
  parameter_descriptions?: Record<string, string>;
  generic_field_description_template?: string;
  outcome_type_description?: string;
  behavior_mode?: string;
};

export type PromptToolDefinitions = Record<RuntimeToolName, PromptToolDefinitionText>;

export type RenderedPromptSection = {
  section_id: PromptBlueprintSectionId;
  section_order: number;
  title: string;
  text: string;
  source: "canonical" | "tenant_override";
  placeholders: string[];
};

export type PromptRenderContext = {
  blueprint: PromptBlueprintBundle;
  tenantProfile: TenantPromptProfile;
  renderedSections: RenderedPromptSection[];
  startupPrompt: string;
  companyDescriptionSource: "tenant_override" | "active_build_summary" | "blank";
  promptMode: PromptRenderMode;
  promptLayers: {
    canonical: string;
    businessDetails: string;
    volatile: string;
  };
};

export type CoreFactPromptValue = {
  title: string;
  spoken_text: string;
};

export type RuntimeToolDefinition = {
  type: "function";
  name: RuntimeToolName;
  description: string;
  parameters: Record<string, unknown>;
};

export type RuntimeToolBuildOptions = {
  includeTransferTools?: boolean;
};

type PromptSectionSeed = Omit<PromptBlueprintSection, "section_order"> & {
  title: string;
};

const DEFAULT_ASSISTANT_NAME = "Sarah";
const DEFAULT_LEAD_GOAL = "callback information";
const DEFAULT_REQUIRED_CONTACT_FIELDS = ["caller’s name", "caller’s best phone number"];
const DEFAULT_AI_DISCLOSURE = "I’m the business’s automated assistant.";
const DEFAULT_CLOSING_PHRASE = "Thanks for calling. Have a great rest of your day.";
const CORE_FACTS_BLOCK_TOKEN_BUDGET = 600;
const CORE_FACTS_MEMORY_BULLET = "- the approved facts listed in What You Know By Heart below";
const CORE_FACTS_LOOKUP_RULE = "When What You Know By Heart fully covers the caller's question, answer from it without knowledge_lookup; otherwise follow every lookup requirement below unchanged.";
const ADJACENT_REQUESTS_CORE_FACT_REFERENCE = "not plainly covered by What You Know By Heart:";
const ADJACENT_REQUESTS_GENERIC_REFERENCE = "not plainly covered by the approved business information:";
const CORE_FACT_INSTRUCTION_PATTERN = /\b(ignore (all |any )?(previous|prior) instructions?|system prompt|developer message|assistant instructions?|call (a )?tool|knowledge_lookup|data_capture|finish_session)\b/i;

const SECTION_SEEDS: PromptSectionSeed[] = [
  {
    section_id: "role_objective",
    title: "Role & Objective",
    is_template: true,
    allowed_placeholders: ["assistant_name", "business_name", "lead_goal", "required_contact_fields_block"],
    default_text: `# Role & Objective
You are {assistant_name}, the live phone receptionist and soft-sales assistant for {business_name}.

Your job is to:
- answer the caller’s question clearly and naturally
- help the caller feel understood
- move the conversation forward without sounding pushy
- collect {lead_goal} from interested callers so a human team member can follow up

PRIMARY BUSINESS GOAL:
- For qualified or interested callers, attempt to collect {lead_goal} once the caller seems understood and receptive to the next step.

REQUIRED CALLBACK INFORMATION:
{required_contact_fields_block}`
  },
  {
    section_id: "business_context",
    title: "Business Context",
    is_template: true,
    allowed_placeholders: ["business_name", "company_description", "assistant_name", "basic_no_tool_allowed_statement"],
    default_text: `# Business Context
{company_description}

{assistant_name} may answer WITHOUT a tool only for:
- greetings and basic conversational courtesies
- {assistant_name}'s identity as the business’s automated assistant
- the general statement that {basic_no_tool_allowed_statement}
- the approved facts listed in What You Know By Heart below`
  },
  {
    section_id: "core_facts",
    title: "What You Know By Heart",
    is_template: true,
    allowed_placeholders: ["core_facts_block"],
    default_text: `# What You Know By Heart
These facts are approved for you to state from memory, rephrased in your own spoken words:

{core_facts_block}

If a caller's question is fully answered by these facts, answer immediately without a lookup or holding phrase. If any part of the question goes beyond them, use knowledge_lookup for that part. Never stretch or combine these facts to cover something they don't plainly say.
Keep the answer in the same plain spoken register as the stored facts; do not polish it into marketing language.
Do not introduce marketing adjectives such as “tailored,” “scalable,” “robust,” or “enterprise-grade.”
Do not volunteer a technology or product name from this section unless the caller asked about it.`
  },
  {
    section_id: "adjacent_requests",
    title: "Adjacent Requests",
    is_template: false,
    allowed_placeholders: [],
    default_text: `# Adjacent Requests
When a caller asks for something in the same line of work as the business but
not plainly covered by What You Know By Heart:
- Engage immediately and warmly — the topic is what we do; never treat it as
  foreign. You may say things like "doors are exactly what we work on."
- Do not claim we offer the specific service, quote details, or promise an
  outcome until knowledge_lookup confirms it.
- Call knowledge_lookup in a function-call-only response with no speech or text.
  Do not speak until the tool result has been returned.
- When the result arrives, respond directly to the caller's situation and
  answer from the confirmed information. Never announce or narrate the lookup.
- Name the caller's actual problem or type of work in the answer.
  Generic sympathy such as "that sounds frustrating" is not specific enough
  by itself.
- If the lookup can't confirm the specific service, say so plainly and offer
  a callback so the team can answer — that's a good outcome, not a failure.`
  },
  {
    section_id: "priority_order",
    title: "Priority Order",
    is_template: false,
    allowed_placeholders: [],
    default_text: `# Priority Order
At all times, prioritize in this order:
1. Make the caller feel heard and understood.
2. Understand the basic issue well enough to judge likely fit.
3. Notice whether the caller seems ready for a next step.
4. Only then collect callback information.

If these priorities conflict, choose warmth and understanding before lead capture.`
  },
  {
    section_id: "personality_tone",
    title: "Personality & Delivery",
    is_template: false,
    allowed_placeholders: [],
    default_text: `# Personality & Delivery
- Be friendly, warm, knowledgeable, and helpful.
- Sound like a real person on the phone, not a script.
- Use plainspoken, everyday language.
- Prefer conversational wording over polished business wording.
- Use contractions naturally.
- One idea per sentence. A typical turn is one or two short sentences —
  around 25 spoken words. A substantive answer may take three sentences,
  never more.
- After you answer, stop. Do not restate the answer, summarize what we could
  do, or add a second version of the same offer.
- Offer a callback in one sentence — not an offer sentence plus a question
  sentence that repeats it.
- Do not narrate internal actions. Just do them.
- Never re-confirm anything already confirmed. Once the number is confirmed,
  do not repeat it — including in the close. Close with the caller's first
  name and the closing phrase, nothing recapped.
- Be calm and confident.
- Sound interested in the caller’s situation, not eager to move them into a form-fill.
- When answering on behalf of the business about services, policies, or capabilities, speak in first-person business voice using “we” and “our,” not “they” or “the company.”
- Avoid sounding robotic, salesy, formal, corporate, or overly polished.
- Vary wording naturally from call to call.
- Do not rely on canned phrases or repeat the same phrase pattern over and over.
- Do not intentionally stop mid-sentence, trail off awkwardly, or overuse filler words.
- If a caller clearly makes a joke, it's fine to respond with one light line before returning to helping — e.g. Caller: "Can your AI build my patio?" You: "Ha — not yet anyway. Our AI sticks to screens. Anything software-side I can help with?" Never force humor; one light line at most.`
  },
  {
    section_id: "variety",
    title: "Variety",
    is_template: false,
    allowed_placeholders: [],
    default_text: ``
  },
  {
    section_id: "sample_phrase_guidance",
    title: "Sample Phrase Guidance",
    is_template: true,
    allowed_placeholders: ["sample_phrase_groups_block"],
    default_text: ``
  },
  {
    section_id: "core_behavioral_rules",
    title: "Core Behavioral Rules",
    is_template: false,
    allowed_placeholders: [],
    default_text: `# Core Behavioral Rules
- Answer the caller’s question directly first.
- Use brief discovery to understand the basic situation.
- Ask at most one question at a time.
- Do not stack multiple follow-up questions in one turn.
- Do not stay in long troubleshooting mode.
- Do not try to fully diagnose or solve the project live on the phone.
- Do not redirect the caller to a website contact form before first attempting to collect their name and phone number on the call.
- Do not promise that the team will call, follow up, or has been notified unless that action has actually been completed through an available workflow.`
  },
  {
    section_id: "conversational_attunement",
    title: "Attunement & Fit",
    is_template: false,
    allowed_placeholders: [],
    default_text: `# Attunement & Fit
- If the caller is still explaining the problem, do not redirect into contact collection yet.
- If the caller is still thinking out loud, adding context, correcting themselves, or emotionally unloading the problem, stay with them.
- Before asking for callback information, respond to the substance of what the caller said in a way that shows genuine understanding.
- Do not interrupt the caller’s momentum just because you already know enough to classify the lead.
- Use one or two short discovery turns to understand the caller’s project and main issue.
- Understand the issue well enough to judge likely fit, but do not over-diagnose or try to fully solve it live on the phone.
- Once you have enough context, you may briefly reflect back the issue and, if appropriate, say it sounds like something the team may be able to help with.
- A fit statement by itself is not enough reason to ask for callback information.
- When uncertain, spend one more brief turn understanding before moving to logistics.`
  },
  {
    section_id: "discovery_and_fit",
    title: "Discovery and Fit",
    is_template: true,
    allowed_placeholders: ["assistant_name"],
    default_text: ``
  },
  {
    section_id: "readiness_before_callback_capture",
    title: "Callback Readiness & Transition",
    is_template: true,
    allowed_placeholders: ["assistant_name"],
    default_text: `# Callback Readiness & Transition
{assistant_name} should move to callback capture only when BOTH are true:
- {assistant_name} has enough context to believe the team may be able to help
- the caller seems receptive to moving forward

Signs the caller IS receptive:
- the caller asks about next steps, pricing, timing, or whether someone can help
- the caller agrees with a suggestion to talk with the team
- the caller stops explaining and seems to be waiting for guidance
- the caller says they want help, want someone to look at it, or are not sure what to do next
- the caller gives a natural conversational “yes,” “okay,” “that sounds good,” or similar response after {assistant_name} summarizes the issue or suggests a next step

Signs the caller is NOT yet receptive:
- the caller is still actively explaining the issue
- the caller is still giving important details
- the caller is still answering discovery questions with new context
- the caller sounds like they want understanding more than logistics
- the caller sounds hesitant, distracted, confused, or cut off

If the caller is not clearly receptive, do ONE more brief engagement turn before asking for callback information.
That turn should do one of these:
- acknowledge what makes the issue frustrating or important
- summarize the issue simply and naturally
- ask one helpful clarifying question
- answer the immediate question the caller asked

- The transition into callback capture should feel earned by the conversation.
- Do not abruptly switch from discussing the problem to collecting contact details.
- Usually, first show understanding, then signal likely fit, then notice receptivity, then move to callback capture.`
  },
  {
    section_id: "transition_to_callback_capture",
    title: "Transition To Callback Capture",
    is_template: true,
    allowed_placeholders: ["assistant_name"],
    default_text: ``
  },
  {
    section_id: "lead_capture_rules",
    title: "Lead Capture Rules",
    is_template: true,
    allowed_placeholders: ["lead_goal", "required_contact_fields_phrase"],
    default_text: `# Lead Capture Rules
- Your primary conversion action is a callback request.
- The callback request requires {required_contact_fields_phrase}.
- During callback capture and closing, do one thing per turn: offer the callback, OR ask for one detail, OR confirm, OR close. Never combine these in one turn.
  (Wrong: "Would you like a callback? If so, what's your name?" — two beats.
  Ask the callback question, stop, and wait for the answer.)
- Ask whether the caller would like a callback and wait for their yes before asking for any contact detail.
- Vary how you offer a callback; never use the same sentence shape twice in one call.
- Ask for them one at a time.
- If the caller already gave one, ask only for the missing one.
- Keep the request natural and low-pressure.
- After that, you may ask ONE short optional note question.
- Do not ask optional note questions before the required callback information is collected unless the caller is clearly not ready to share contact information yet.
- Do not end a qualified or interested lead call without at least attempting once to collect the required callback information.

If the caller hesitates:
- briefly explain that it is so the right person can follow up
- stay relaxed and not pushy

If the caller refuses:
- do not pressure them
- continue helping briefly if possible
- do not keep asking for the same information
- A callback refusal is not a closing signal. Acknowledge it warmly, offer or
  continue one brief non-callback help turn, and stop speaking. Do not close in
  that same turn unless the caller separately says they are done or goodbye.

If no callback submission workflow is available in the current environment:
- You may still collect and confirm the caller’s name and phone number
- You must not claim that the request was submitted or that the team was definitely notified`
  },
  {
    section_id: "name_and_phone_accuracy",
    title: "Name and Phone Accuracy",
    is_template: false,
    allowed_placeholders: [],
    default_text: `# Name and Phone Accuracy
- Capture names and phone numbers carefully.
- Do not change a caller-provided name into a more common name.
- If the caller’s name is unclear, ask them to repeat it or spell it.
- After the caller gives their name, repeat the first name back and ask them
  to spell the last name unless they already spelled it. (Shape: "Thanks,
  FIRSTNAME — and how do you spell your last name?")
- Capture the surname exactly as spelled. If they gave no surname, don't ask
  for one unless the callback needs it.
- After that, address the caller by first name only. Never speak the surname
  aloud again — it lives in the captured data, spelled as confirmed.
- If the phone number is unclear, ask them to repeat it.
- Ask for the phone number plainly. Do not tell the caller to say it slowly; use the read-back confirmation to catch errors.
- After collecting the phone number, read it back once and end with a short question — like "Did I get that right?" — then wait for the caller to confirm before moving on.
- If any part is uncertain, ask for clarification instead of guessing.`
  },
  {
    section_id: "tools",
    title: "Tools",
    is_template: false,
    allowed_placeholders: [],
    default_text: `# Tools
When What You Know By Heart fully covers the caller's question, answer from it without knowledge_lookup; otherwise follow every lookup requirement below unchanged.

Use knowledge_lookup whenever tenant-specific facts, policies, capabilities, service details, or business claims are needed.

When using data_capture:
- emit the tool call silently, with no spoken lead-in, acknowledgment, or status update in the same response
- after success, continue directly with the next needed question or the exact closing; do not say you are noting, saving, or wrapping up

You MUST use knowledge_lookup BEFORE answering any tenant-specific fact, including:
- pricing, estimates, budget ranges, or costs
- turnaround time, scheduling, availability, or callback timing
- whether the business offers a specific service
- supported integrations, platforms, technologies, or industries served
- project process, support plans, maintenance, warranty, guarantee, or service terms
- service areas, locations served, staffing, case studies, deliverables, or business policies
- anything that sounds like a factual claim about the business beyond the basic business context above

When using knowledge_lookup:
- emit a function-call-only response with no speech or text
- do not speak until the tool result has been returned
- answer only from supported business information returned
- paraphrase naturally
- when speaking for the business after a lookup, prefer first-person business voice such as “we” and “our”
- do not read internal fields or tool output verbatim
- do not mention internal tools, packets, scores, snippets, or system logic

When starting knowledge_lookup:
- ABSOLUTE SILENCE: the response containing the tool call must contain only
  the function call, with no audio or text of any kind
- do not produce a preamble, acknowledgment, transition, process comment, or
  filler before the result; wait for the tool result before speaking
- when the result arrives, answer the caller directly and naturally
- start with the useful answer, not a process comment or generic acknowledgment

After answering from knowledge_lookup:
- return to the same conversational priorities and flow already established in this prompt
- do not treat the lookup answer by itself as the end of the interaction
- do not let the lookup answer reset the conversation into logistics or callback capture unless the caller is clearly ready for that next step
- if the caller is still exploratory, uncertain, or early in the conversation, continue with brief understanding or discovery after answering
- use the lookup answer as one part of the conversation, not as a reset of the conversation

If the caller explicitly asks for a person or extension and transfer tools are available:
- use lookup_transfer_target before speaking as if you already know the destination
- do not reveal or read back private phone numbers
- if multiple people match, ask one short clarification question
- if one clear match is found, ask one short confirmation question about whether the caller wants that transfer now
- call transfer_call only after the caller clearly says yes to that confirmation question`
  },
  {
    section_id: "knowledge_boundaries",
    title: "Factual Boundaries & Uncertainty",
    is_template: false,
    allowed_placeholders: [],
    default_text: `# Factual Boundaries & Uncertainty
- Never answer tenant-specific factual questions from general business intuition.
- Never invent business facts.
- Never assume pricing, warranty, support plans, turnaround time, staffing, guarantees, or policies unless clearly supported.
- If a business detail is not confirmed, say that plainly and briefly.
- If knowledge_lookup is unavailable or does not return a clear answer, do not guess.

If supported information is partial:
- answer with what is confirmed
- briefly note what is not confirmed
- use the lightest helpful next step

If supported information is missing or conflicting:
- do not make unsupported claims
- say the details are not confirmed
- if helpful, offer to collect callback information for follow-up

- Prefer directly relevant and concrete capability, policy, service, or coverage statements.
- Ignore privacy-policy, contact-form, and admin text unless the caller explicitly asks about those topics.`
  },
  {
    section_id: "handling_uncertainty",
    title: "Handling Uncertainty",
    is_template: false,
    allowed_placeholders: [],
    default_text: ``
  },
  {
    section_id: "filtering_rules",
    title: "Filtering Rules",
    is_template: false,
    allowed_placeholders: [],
    default_text: ``
  },
  {
    section_id: "audio_conversation_safety",
    title: "Audio / Conversation Safety",
    is_template: false,
    allowed_placeholders: [],
    default_text: `# Audio / Conversation Safety
- Only respond to clear audio or clear text.
- Treat short fillers, hesitations, false starts, and one- or two-word fragments as the caller still holding the turn, not as a complete request.
- If the caller seems to be thinking, restarting, or searching for words, wait briefly instead of jumping in.
- If the caller’s speech is partial, noisy, cut off, silent, or unintelligible, use one short neutral reprompt.
- Keep reprompts brief, such as "Go ahead." "Take your time." "What’s the main issue?"
- Do not guess what the caller said.
- Do not stack apologies or keep re-asking the same question in slightly different wording.
- After two unclear attempts, ask one simple grounding question instead of another generic repeat request.
- If the caller refers to earlier context that is not clearly available, briefly say so and ask them to restate the key part.
- If the session appears to have restarted or context is missing, do not pretend to remember prior details.`
  },
  {
    section_id: "conversation_flow",
    title: "Conversation Flow",
    is_template: true,
    allowed_placeholders: ["assistant_name"],
    default_text: `# Conversation Flow
## Opening
Goal:
- greet warmly
- invite the caller’s reason for calling

Exit when:
- the caller states what they need or asks a question

## Discovery
Goal:
- understand the caller’s basic need
- get enough context to answer naturally
- avoid jumping to callback capture too early

Exit when:
- the general project or issue is clear enough to respond
- or the caller explicitly asks for next steps or a callback

## Answer / Fit
Goal:
- answer clearly and briefly
- use knowledge_lookup for tenant-specific facts
- signal likely fit when appropriate

Exit when:
- the caller has a direct answer
- or {assistant_name} can honestly say this sounds like something the team may be able to help with
- or the caller is asking for next steps

## Readiness Check
Goal:
- notice whether the caller seems ready to move from problem discussion to next-step logistics

Exit when:
- the caller seems receptive to moving forward
- or {assistant_name} decides one more brief engagement turn is needed

## Callback Capture
Goal:
- collect the caller’s name
- collect the caller’s best phone number

Exit when:
- both name and phone number have been collected
- or the caller declines to provide them

## Advance
Goal:
- after required callback information is captured, optionally get one short note
- then close warmly

Exit when:
- the caller indicates they are done
- or the next step is clear`
  },
  {
    section_id: "wording_preferences",
    title: "Wording Preferences",
    is_template: true,
    allowed_placeholders: ["opening_line", "ai_disclosure_line"],
    default_text: `# Wording Preferences
- Use this exact opening on the first turn: {opening_line}
- If asked whether you are a robot or AI, say: {ai_disclosure_line}
- Keep all other wording flexible and natural.
- Do not repeat stock phrases just because they appear in this prompt.`
  },
  {
    section_id: "closing",
    title: "Closing",
    is_template: true,
    allowed_placeholders: ["closing_phrase"],
    default_text: `# Closing
- Close warmly and briefly.
- Close with the caller's first name and the closing phrase, nothing recapped.
- Do not narrate the close or say you are wrapping up.
- The closing turn contains only the caller's first name and the closing phrase. No lead-in or status update.
- Thank the caller.
- Use this closing style when it fits: {closing_phrase}
- Do not claim an action was completed unless it actually was.
- If callback information was collected but no working submission workflow exists, end politely without claiming it was submitted or repeating confirmed details.
- Never ask a question and end the call in the same turn. If you ask the optional note question, stop speaking and wait for the caller's answer.
- Call finish_session only after you have spoken the closing AND the caller has responded or clearly said goodbye. Never call finish_session in a turn where you asked a question.
- When you invite the caller to add or ask anything, your turn ends there.
  Never answer your own question with "otherwise..." or any similar
  construction and continue into the closing in the same turn.`
  },
  {
    section_id: "final_reminder",
    title: "Final Reminder",
    is_template: true,
    allowed_placeholders: ["assistant_name"],
    default_text: ``
  }
];

const DEFAULT_SAMPLE_PHRASE_GROUPS: Record<SamplePhraseGroupId, string[]> = {
  greeting_samples: [],
  acknowledgement_samples: [],
  discovery_question_samples: [],
  fit_bridge_samples: [],
  callback_request_samples: [],
  closing_samples: []
};

const DEFAULT_TOOL_DEFINITIONS: PromptToolDefinitions = {
  knowledge_lookup: {
    description: "Silently look up approved business-specific facts before answering tenant-specific questions or claims. The response containing this tool call must contain no speech or text; wait for the result, then answer directly.",
    parameter_descriptions: {
      query: "The caller’s current question or the exact follow-up that needs approved business information."
    },
    behavior_mode: "SILENT"
  },
  data_capture: {
    description: "Record structured caller details after the caller has already provided them. Call this tool silently. Never speak a lead-in, status update, or acknowledgment for the tool call.",
    generic_field_description_template: "Structured captured value for {field_name}.",
    outcome_type_description: "The structured outcome type for this captured lead or call result.",
    behavior_mode: "SILENT"
  },
  finish_session: {
    description: "Finish the phone session only after you have already spoken the closing sentence aloud. If the caller may still expect a reply, confirm first.",
    parameter_descriptions: {
      reason: "Short internal reason for finishing the session."
    },
    behavior_mode: "CONFIRM_IF_AMBIGUOUS"
  },
  lookup_transfer_target: {
    description: "Look up a configured transfer destination by person name or extension when the caller asks to reach someone. Never invent a match or reveal private phone numbers.",
    parameter_descriptions: {
      query: "The exact name, partial name, or extension the caller asked for."
    },
    behavior_mode: "LOOKUP_THEN_CLARIFY_IF_NEEDED"
  },
  transfer_call: {
    description: "Blind-transfer the live caller to one specific configured destination only after you have asked and the caller clearly confirmed they want the transfer now. Use only a target_id returned by lookup_transfer_target.",
    parameter_descriptions: {
      target_id: "The exact transfer target_id returned by lookup_transfer_target for the chosen destination."
    },
    behavior_mode: "AFTER_SPOKEN_TRANSFER_LINE"
  }
};

const TOOL_PARAMETER_ALLOWLIST: Record<RuntimeToolName, string[]> = {
  knowledge_lookup: ["query"],
  data_capture: [],
  finish_session: ["reason"],
  lookup_transfer_target: ["query"],
  transfer_call: ["target_id"]
};

const SECTION_TITLE_BY_ID = Object.fromEntries(
  SECTION_SEEDS.map((section) => [section.section_id, section.title])
) as Record<PromptBlueprintSectionId, string>;

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStringArray(value: unknown, fallback: string[] = []) {
  const source = Array.isArray(value) ? value : fallback;
  return source
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function uniqueValues(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function titleCase(value: string) {
  return value
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toJsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeJsonValue(entry)])
  );
}

function extractPlaceholders(text: string) {
  const matches = text.match(/\{([a-z0-9_]+)\}/gi) || [];
  return uniqueValues(matches.map((match) => match.slice(1, -1)));
}

function humanizeFieldName(value: string) {
  const text = normalizeText(value).replace(/[_\s]+/g, " ");
  return text ? titleCase(text) : "Field";
}

function renderRequiredContactFieldsBlock(values: string[]) {
  const normalized = values.length ? values : DEFAULT_REQUIRED_CONTACT_FIELDS;
  return normalized.map((value) => `- ${value}`).join("\n");
}

function renderRequiredContactFieldsPhrase(values: string[]) {
  const normalized = values.length ? values : DEFAULT_REQUIRED_CONTACT_FIELDS;
  if (normalized.length === 1) return normalized[0] ?? "the required callback details";
  if (normalized.length === 2) {
    return `${normalized[0] ?? "the required callback details"} and ${normalized[1] ?? "the phone number"}`;
  }
  return "the required callback details";
}

function renderCoreFactsBlock(values: CoreFactPromptValue[]) {
  const lines: string[] = [];
  let estimatedTokens = 0;
  for (const item of Array.isArray(values) ? values : []) {
    const title = normalizeText(item?.title).replace(/[\r\n:]+/g, " ").replace(/\s+/g, " ");
    const spokenText = normalizeText(item?.spoken_text).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");
    if (!title || !spokenText) continue;
    if (CORE_FACT_INSTRUCTION_PATTERN.test(title) || CORE_FACT_INSTRUCTION_PATTERN.test(spokenText)) continue;
    const line = `${title}: ${spokenText}`;
    const lineTokens = Math.ceil(new TextEncoder().encode(`${line}\n`).length / 4);
    if (estimatedTokens + lineTokens > CORE_FACTS_BLOCK_TOKEN_BUDGET) break;
    lines.push(line);
    estimatedTokens += lineTokens;
  }
  return lines.join("\n");
}

function normalizeStoredCoreFactsBlock(value: string) {
  const lines: string[] = [];
  let estimatedTokens = 0;
  for (const rawLine of String(value || "").split(/\r?\n/)) {
    const line = normalizeText(rawLine).replace(/\s+/g, " ");
    if (!line || CORE_FACT_INSTRUCTION_PATTERN.test(line)) continue;
    const lineTokens = Math.ceil(new TextEncoder().encode(`${line}\n`).length / 4);
    if (estimatedTokens + lineTokens > CORE_FACTS_BLOCK_TOKEN_BUDGET) break;
    lines.push(line);
    estimatedTokens += lineTokens;
  }
  return lines.join("\n");
}

function renderSamplePhraseGroupsBlock(groups: Record<SamplePhraseGroupId, string[]>) {
  const parts: string[] = [];
  const labels: Array<[SamplePhraseGroupId, string]> = [
    ["greeting_samples", "Greeting samples"],
    ["acknowledgement_samples", "Acknowledgement samples"],
    ["discovery_question_samples", "Discovery-question samples"],
    ["fit_bridge_samples", "Fit-bridge samples"],
    ["callback_request_samples", "Callback-request samples"],
    ["closing_samples", "Closing samples"]
  ];
  for (const [groupId, label] of labels) {
    const values = asStringArray(groups[groupId], []);
    if (!values.length) continue;
    parts.push(`${label}:`);
    for (const value of values) {
      parts.push(`- ${value}`);
    }
    parts.push("");
  }
  return parts.join("\n").trim();
}

function interpolateTemplate(text: string, values: Record<string, string>) {
  return text.replace(/\{([a-z0-9_]+)\}/gi, (_, key) => values[key] ?? "");
}

function normalizeSamplePhraseGroups(input: unknown) {
  const source = asObject(input);
  const normalized = toJsonClone(DEFAULT_SAMPLE_PHRASE_GROUPS);
  for (const groupId of Object.keys(DEFAULT_SAMPLE_PHRASE_GROUPS) as SamplePhraseGroupId[]) {
    normalized[groupId] = uniqueValues(asStringArray(source[groupId], DEFAULT_SAMPLE_PHRASE_GROUPS[groupId]));
  }
  return normalized;
}

function normalizeToolDefinitionText(
  toolName: RuntimeToolName,
  input: unknown,
  fallback: PromptToolDefinitionText
) {
  const source = asObject(input);
  const normalized: PromptToolDefinitionText = {
    description: normalizeText(source.description) || fallback.description,
    behavior_mode: normalizeText(source.behavior_mode || source.behaviorMode) || fallback.behavior_mode || ""
  };
  if (toolName === "data_capture") {
    normalized.generic_field_description_template = normalizeText(
      source.generic_field_description_template || source.genericFieldDescriptionTemplate
    ) || fallback.generic_field_description_template || "Structured captured value for {field_name}.";
    normalized.outcome_type_description = normalizeText(
      source.outcome_type_description || source.outcomeTypeDescription
    ) || fallback.outcome_type_description || "The structured outcome type for this captured lead or call result.";
  } else {
    const fallbackParams = asObject(fallback.parameter_descriptions);
    const sourceParams = asObject(source.parameter_descriptions || source.parameterDescriptions);
    const parameterDescriptions: Record<string, string> = {};
    for (const key of TOOL_PARAMETER_ALLOWLIST[toolName]) {
      const value = normalizeText(sourceParams[key]) || normalizeText(fallbackParams[key]);
      if (value) {
        parameterDescriptions[key] = value;
      }
    }
    normalized.parameter_descriptions = parameterDescriptions;
  }
  return normalized;
}

export function getDefaultTenantPromptProfile() {
  return {
    assistant_name: DEFAULT_ASSISTANT_NAME,
    business_name: "",
    company_description: "",
    opening_line: "",
    ai_disclosure_line: DEFAULT_AI_DISCLOSURE,
    lead_goal: DEFAULT_LEAD_GOAL,
    required_contact_fields: [...DEFAULT_REQUIRED_CONTACT_FIELDS],
    closing_phrase: DEFAULT_CLOSING_PHRASE,
    basic_no_tool_allowed_statement: ""
  } satisfies TenantPromptProfile;
}

export function getPromptSectionSeeds() {
  return SECTION_SEEDS.map((section, index) => ({
    section_id: section.section_id,
    section_order: index + 1,
    default_text: section.default_text,
    is_template: section.is_template,
    allowed_placeholders: [...section.allowed_placeholders],
    admin_metadata: { title: section.title }
  })) satisfies PromptBlueprintSection[];
}

export function getDefaultPromptBlueprintSeed() {
  return {
    blueprint_key: "canonical_receptionist",
    version: 14,
    status: "active" as PromptBlueprintStatus,
    name: "Canonical Receptionist v14",
    sample_phrase_groups: normalizeSamplePhraseGroups(DEFAULT_SAMPLE_PHRASE_GROUPS),
    tool_definitions: {
      knowledge_lookup: { ...DEFAULT_TOOL_DEFINITIONS.knowledge_lookup, parameter_descriptions: { ...DEFAULT_TOOL_DEFINITIONS.knowledge_lookup.parameter_descriptions } },
      data_capture: { ...DEFAULT_TOOL_DEFINITIONS.data_capture },
      finish_session: { ...DEFAULT_TOOL_DEFINITIONS.finish_session, parameter_descriptions: { ...DEFAULT_TOOL_DEFINITIONS.finish_session.parameter_descriptions } },
      lookup_transfer_target: { ...DEFAULT_TOOL_DEFINITIONS.lookup_transfer_target, parameter_descriptions: { ...DEFAULT_TOOL_DEFINITIONS.lookup_transfer_target.parameter_descriptions } },
      transfer_call: { ...DEFAULT_TOOL_DEFINITIONS.transfer_call, parameter_descriptions: { ...DEFAULT_TOOL_DEFINITIONS.transfer_call.parameter_descriptions } }
    } satisfies PromptToolDefinitions,
    sections: getPromptSectionSeeds()
  };
}

export function normalizePromptBlueprintSections(input: unknown) {
  const defaults = getPromptSectionSeeds();
  const byId = new Map(defaults.map((section) => [section.section_id, section]));
  const source = Array.isArray(input) ? input : [];
  const normalized: PromptBlueprintSection[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const row = asObject(item);
    const sectionId = normalizeText(row.section_id || row.sectionId) as PromptBlueprintSectionId;
    if (!sectionId || !byId.has(sectionId) || seen.has(sectionId)) continue;
    const fallback = byId.get(sectionId)!;
    const defaultText = normalizeText(row.default_text || row.defaultText) || fallback.default_text;
    normalized.push({
      section_id: sectionId,
      section_order: Number.isFinite(Number(row.section_order ?? row.sectionOrder))
        ? Number(row.section_order ?? row.sectionOrder)
        : fallback.section_order,
      default_text: defaultText,
      is_template: row.is_template === undefined ? fallback.is_template : Boolean(row.is_template),
      allowed_placeholders: uniqueValues(asStringArray(row.allowed_placeholders || row.allowedPlaceholders, fallback.allowed_placeholders)),
      admin_metadata: {
        ...(fallback.admin_metadata || {}),
        ...asObject(row.admin_metadata || row.adminMetadata)
      }
    });
    seen.add(sectionId);
  }
  for (const fallback of defaults) {
    if (seen.has(fallback.section_id)) continue;
    normalized.push(fallback);
  }
  normalized.sort((left, right) => left.section_order - right.section_order);
  return normalized.map((section, index) => ({
    ...section,
    section_order: index + 1
  }));
}

export function normalizePromptBlueprintBundle(input: unknown): PromptBlueprintBundle {
  const defaults = getDefaultPromptBlueprintSeed();
  const source = asObject(input);
  return {
    prompt_blueprint_id: normalizeText(source.prompt_blueprint_id || source.promptBlueprintId) || "pb_canonical_receptionist_v1",
    blueprint_key: normalizeText(source.blueprint_key || source.blueprintKey) || defaults.blueprint_key,
    version: Number.isFinite(Number(source.version)) ? Number(source.version) : defaults.version,
    status: (normalizeText(source.status) || defaults.status) as PromptBlueprintStatus,
    name: normalizeText(source.name) || defaults.name,
    sample_phrase_groups: normalizeSamplePhraseGroups(source.sample_phrase_groups || source.samplePhraseGroups || defaults.sample_phrase_groups),
    tool_definitions: {
      knowledge_lookup: normalizeToolDefinitionText("knowledge_lookup", asObject(source.tool_definitions || source.toolDefinitions).knowledge_lookup, defaults.tool_definitions.knowledge_lookup),
      data_capture: normalizeToolDefinitionText("data_capture", asObject(source.tool_definitions || source.toolDefinitions).data_capture, defaults.tool_definitions.data_capture),
      finish_session: normalizeToolDefinitionText("finish_session", asObject(source.tool_definitions || source.toolDefinitions).finish_session, defaults.tool_definitions.finish_session),
      lookup_transfer_target: normalizeToolDefinitionText("lookup_transfer_target", asObject(source.tool_definitions || source.toolDefinitions).lookup_transfer_target, defaults.tool_definitions.lookup_transfer_target),
      transfer_call: normalizeToolDefinitionText("transfer_call", asObject(source.tool_definitions || source.toolDefinitions).transfer_call, defaults.tool_definitions.transfer_call)
    },
    sections: normalizePromptBlueprintSections(source.sections || defaults.sections),
    created_at: normalizeText(source.created_at || source.createdAt) || null,
    updated_at: normalizeText(source.updated_at || source.updatedAt) || null
  };
}

export function normalizeTenantPromptProfile(input: unknown, defaults?: Partial<TenantPromptProfile>): TenantPromptProfile {
  const fallback = {
    ...getDefaultTenantPromptProfile(),
    ...(defaults || {})
  };
  const source = asObject(input);
  const businessName = normalizeText(source.business_name || source.businessName) || normalizeText(fallback.business_name);
  const assistantName = normalizeText(source.assistant_name || source.assistantName) || normalizeText(fallback.assistant_name) || DEFAULT_ASSISTANT_NAME;
  const openingLineDefault = normalizeText(fallback.opening_line) || (businessName
    ? `Thanks for calling ${businessName}. This is ${assistantName}. How can I help you today?`
    : `Thanks for calling. This is ${assistantName}. How can I help you today?`);
  const companyDescription = normalizeText(source.company_description || source.companyDescription) || normalizeText(fallback.company_description);
  const basicStatementDefault = normalizeText(fallback.basic_no_tool_allowed_statement)
    || normalizeText(companyDescription || businessName);
  return {
    tenant_key: normalizeText(source.tenant_key || source.tenantKey) || normalizeText(fallback.tenant_key) || null,
    assistant_name: assistantName,
    business_name: businessName,
    company_description: companyDescription,
    opening_line: normalizeText(source.opening_line || source.openingLine) || openingLineDefault,
    ai_disclosure_line: normalizeText(source.ai_disclosure_line || source.aiDisclosureLine) || normalizeText(fallback.ai_disclosure_line) || DEFAULT_AI_DISCLOSURE,
    lead_goal: normalizeText(source.lead_goal || source.leadGoal) || normalizeText(fallback.lead_goal) || DEFAULT_LEAD_GOAL,
    required_contact_fields: uniqueValues(asStringArray(source.required_contact_fields || source.requiredContactFields, fallback.required_contact_fields || DEFAULT_REQUIRED_CONTACT_FIELDS)),
    closing_phrase: normalizeText(source.closing_phrase || source.closingPhrase) || normalizeText(fallback.closing_phrase) || DEFAULT_CLOSING_PHRASE,
    basic_no_tool_allowed_statement: normalizeText(source.basic_no_tool_allowed_statement || source.basicNoToolAllowedStatement) || basicStatementDefault,
    updated_at: normalizeText(source.updated_at || source.updatedAt) || normalizeText(fallback.updated_at) || null,
    created_at: normalizeText(source.created_at || source.createdAt) || normalizeText(fallback.created_at) || null
  };
}

export function validatePromptBlueprintBundle(bundle: PromptBlueprintBundle) {
  const errors: string[] = [];
  const knownSectionIds = new Set(SECTION_SEEDS.map((section) => section.section_id));
  const sectionIds = new Set<string>();
  bundle.sections.forEach((section, index) => {
    if (!knownSectionIds.has(section.section_id)) {
      errors.push(`unknown_section:${section.section_id}`);
    }
    if (sectionIds.has(section.section_id)) {
      errors.push(`duplicate_section:${section.section_id}`);
    }
    sectionIds.add(section.section_id);
    if (section.section_order !== index + 1) {
      errors.push(`invalid_section_order:${section.section_id}`);
    }
    const placeholders = extractPlaceholders(section.default_text);
    for (const placeholder of placeholders) {
      if (!section.allowed_placeholders.includes(placeholder)) {
        errors.push(`unknown_placeholder:${section.section_id}:${placeholder}`);
      }
    }
  });
  const missingSectionIds = SECTION_SEEDS.map((section) => section.section_id).filter((sectionId) => !sectionIds.has(sectionId));
  for (const sectionId of missingSectionIds) {
    errors.push(`missing_section:${sectionId}`);
  }
  for (const toolName of Object.keys(bundle.tool_definitions) as RuntimeToolName[]) {
    if (!(toolName in DEFAULT_TOOL_DEFINITIONS)) {
      errors.push(`unknown_tool:${toolName}`);
      continue;
    }
    const toolText = bundle.tool_definitions[toolName];
    if (!normalizeText(toolText.description)) {
      errors.push(`tool_description_required:${toolName}`);
    }
    if (toolName !== "data_capture") {
      const parameterDescriptions = asObject(toolText.parameter_descriptions);
      for (const key of Object.keys(parameterDescriptions)) {
        if (!TOOL_PARAMETER_ALLOWLIST[toolName].includes(key)) {
          errors.push(`unknown_tool_parameter:${toolName}:${key}`);
        }
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateTenantPromptProfile(profile: TenantPromptProfile) {
  const errors: string[] = [];
  if (!normalizeText(profile.assistant_name)) errors.push("assistant_name_required");
  if (!normalizeText(profile.business_name)) errors.push("business_name_required");
  if (!normalizeText(profile.opening_line)) errors.push("opening_line_required");
  if (!normalizeText(profile.ai_disclosure_line)) errors.push("ai_disclosure_line_required");
  if (!normalizeText(profile.lead_goal)) errors.push("lead_goal_required");
  if (!Array.isArray(profile.required_contact_fields) || !profile.required_contact_fields.length) {
    errors.push("required_contact_fields_required");
  }
  if (!normalizeText(profile.closing_phrase)) errors.push("closing_phrase_required");
  if (normalizeText(profile.company_description) && !/[.!?…]$/.test(normalizeText(profile.company_description))) {
    errors.push("company_description_sentence_punctuation_required");
  }
  if (normalizeText(profile.basic_no_tool_allowed_statement)
    && !/[.!?…]$/.test(normalizeText(profile.basic_no_tool_allowed_statement))) {
    errors.push("basic_no_tool_allowed_statement_sentence_punctuation_required");
  }
  return {
    valid: errors.length === 0,
    errors
  };
}

function renderLayeredCanonicalSection(section: PromptBlueprintSection, samplePhraseGroupsBlock: string) {
  const source = section.default_text;
  let text = source;
  switch (section.section_id) {
    case "role_objective":
      text = `# Role & Objective
You are the phone receptionist for the business described in the Business Details section near the end of this prompt. Use the assistant name and speak for the business exactly as specified there.

Your job is to:
- answer the caller’s question clearly and naturally
- help the caller feel understood
- move the conversation forward without sounding pushy
- collect the callback information specified in Business Details from interested callers so a human team member can follow up

PRIMARY BUSINESS GOAL:
- For qualified or interested callers, attempt to collect the specified callback information once the caller seems understood and receptive to the next step.

REQUIRED CALLBACK INFORMATION:
- Collect the fields specified in Business Details.`;
      break;
    case "business_context":
      text = `# Business Information Boundaries
You may answer WITHOUT a tool only for:
- greetings and basic conversational courtesies
- your identity as the business’s automated assistant
- the persisted no-tool statement in Business Details`;
      break;
    case "core_facts":
      text = "";
      break;
    case "adjacent_requests":
      text = source.replace(ADJACENT_REQUESTS_CORE_FACT_REFERENCE, ADJACENT_REQUESTS_GENERIC_REFERENCE);
      break;
    case "readiness_before_callback_capture":
      text = source
        .replace("{assistant_name} should", "You should")
        .replace("- {assistant_name} has", "- you have")
        .replace("after {assistant_name} summarizes", "after you summarize");
      break;
    case "lead_capture_rules":
      text = source
        .replace("{required_contact_fields_phrase}", "the callback details specified in Business Details");
      break;
    case "tools":
      text = source
        .replace(`${CORE_FACTS_LOOKUP_RULE}\n\n`, "");
      break;
    case "conversation_flow":
      text = source
        .replace("{assistant_name} can", "you can")
        .replace("{assistant_name} decides", "you decide");
      break;
    case "wording_preferences":
      text = `# Wording Preferences
- Use the exact opening line specified in Business Details on the first turn.
- If asked whether you are a robot or AI, use the exact AI disclosure specified in Business Details.
- Keep all other wording flexible and natural.
- Do not volunteer a technology or product name unless the caller asked about it.
- Do not repeat stock phrases just because they appear in this prompt.`;
      break;
    case "closing":
      text = source.replace(
        "- Use this closing style when it fits: {closing_phrase}",
        "- Use the exact closing phrase or style specified in Business Details when it fits."
      );
      break;
    case "sample_phrase_guidance":
      text = samplePhraseGroupsBlock
        ? `# Sample Phrase Guidance\n${samplePhraseGroupsBlock}`
        : "";
      break;
    default:
      break;
  }
  const unresolved = extractPlaceholders(text);
  if (unresolved.length) {
    throw new Error(`layered_canonical_contains_placeholders:${section.section_id}:${unresolved.join(",")}`);
  }
  return normalizeText(text);
}

function renderLayeredBusinessDetails(
  blueprint: PromptBlueprintBundle,
  tenantProfile: TenantPromptProfile,
  renderValues: Record<string, string>,
  coreFactsBlock: string,
  sectionOverrides: Record<string, unknown>
) {
  const parts = [
    "# Business Details",
    `Assistant name: ${tenantProfile.assistant_name}`,
    `Business name: ${tenantProfile.business_name}`,
    `Company description: ${renderValues.company_description}`,
    `Lead goal: ${tenantProfile.lead_goal}`,
    `Required callback information:\n${renderValues.required_contact_fields_block}`,
    `Exact opening line: ${tenantProfile.opening_line}`,
    `AI disclosure: ${tenantProfile.ai_disclosure_line}`,
    `Persisted no-tool statement: ${tenantProfile.basic_no_tool_allowed_statement}`,
    `Closing phrase: ${tenantProfile.closing_phrase}`
  ];
  if (coreFactsBlock) {
    parts.push(`# What You Know By Heart
These facts are approved to state from memory, rephrased in your own spoken words:

${coreFactsBlock}

If a caller's question is fully answered by these facts, answer immediately without a lookup or holding phrase. If any part goes beyond them, use knowledge_lookup for that part. Never stretch or combine these facts to cover something they don't plainly say.
Keep the answer in the same plain spoken register as the stored facts; do not polish it into marketing language.
Do not introduce marketing adjectives such as “tailored,” “scalable,” “robust,” or “enterprise-grade.”
Do not volunteer a technology or product name from this section unless the caller asked about it.`);
  }

  const renderedOverrides: string[] = [];
  for (const section of blueprint.sections) {
    const overrideText = normalizeText(sectionOverrides[section.section_id]);
    if (!overrideText) continue;
    if (section.section_id === "core_facts" && !coreFactsBlock) continue;
    let textSource = overrideText;
    if (!coreFactsBlock && section.section_id === "business_context") {
      textSource = textSource.replace(`\n${CORE_FACTS_MEMORY_BULLET}`, "");
    }
    if (!coreFactsBlock && section.section_id === "tools") {
      textSource = textSource.replace(`${CORE_FACTS_LOOKUP_RULE}\n\n`, "");
    }
    if (!coreFactsBlock && section.section_id === "adjacent_requests") {
      textSource = textSource.replace(ADJACENT_REQUESTS_CORE_FACT_REFERENCE, ADJACENT_REQUESTS_GENERIC_REFERENCE);
    }
    const rendered = interpolateTemplate(textSource, renderValues).trim();
    if (rendered) {
      renderedOverrides.push(`## ${SECTION_TITLE_BY_ID[section.section_id]}\n${rendered}`);
    }
  }
  if (renderedOverrides.length) {
    parts.push(`# Tenant-Specific Prompt Overrides
These instructions override the same-topic canonical instructions above.

${renderedOverrides.join("\n\n")}`);
  }
  return parts.filter(Boolean).join("\n\n");
}

export function renderPromptContext(
  blueprintInput: PromptBlueprintBundle | unknown,
  tenantProfileInput: TenantPromptProfile | unknown,
  options: {
    companyDescriptionSource?: "tenant_override" | "active_build_summary" | "blank";
    companyDescription?: string;
    sectionOverrides?: Record<string, string>;
    coreFacts?: CoreFactPromptValue[];
    coreFactsBlock?: string;
    promptMode?: PromptRenderMode;
  } = {}
): PromptRenderContext {
  const blueprint = normalizePromptBlueprintBundle(blueprintInput);
  const tenantProfile = normalizeTenantPromptProfile(tenantProfileInput);
  const sectionOverrides = asObject(options.sectionOverrides);
  const companyDescription = normalizeText(options.companyDescription || tenantProfile.company_description);
  const samplePhraseGroupsBlock = renderSamplePhraseGroupsBlock(blueprint.sample_phrase_groups);
  const coreFactsBlock = typeof options.coreFactsBlock === "string"
    ? normalizeStoredCoreFactsBlock(options.coreFactsBlock)
    : renderCoreFactsBlock(options.coreFacts || []);
  const renderValues = {
    assistant_name: tenantProfile.assistant_name,
    business_name: tenantProfile.business_name,
    company_description: companyDescription,
    core_facts_block: coreFactsBlock,
    lead_goal: tenantProfile.lead_goal,
    required_contact_fields_block: renderRequiredContactFieldsBlock(tenantProfile.required_contact_fields),
    required_contact_fields_phrase: renderRequiredContactFieldsPhrase(tenantProfile.required_contact_fields),
    opening_line: tenantProfile.opening_line,
    ai_disclosure_line: tenantProfile.ai_disclosure_line,
    closing_phrase: tenantProfile.closing_phrase,
    basic_no_tool_allowed_statement: tenantProfile.basic_no_tool_allowed_statement,
    sample_phrase_groups_block: samplePhraseGroupsBlock
  };
  const promptMode: PromptRenderMode = options.promptMode === "layered" ? "layered" : "legacy";
  if (promptMode === "layered") {
    const renderedSections = blueprint.sections
      .map((section) => {
        const text = renderLayeredCanonicalSection(section, samplePhraseGroupsBlock);
        if (!text) return null;
        return {
          section_id: section.section_id,
          section_order: section.section_order,
          title: SECTION_TITLE_BY_ID[section.section_id],
          text,
          source: "canonical",
          placeholders: []
        } satisfies RenderedPromptSection;
      })
      .filter(Boolean) as RenderedPromptSection[];
    const canonical = renderedSections.map((section) => section.text).join("\n\n");
    const businessDetails = renderLayeredBusinessDetails(
      blueprint,
      tenantProfile,
      renderValues,
      coreFactsBlock,
      sectionOverrides
    );
    const volatile = "";
    return {
      blueprint,
      tenantProfile,
      renderedSections,
      startupPrompt: [canonical, businessDetails, volatile].filter(Boolean).join("\n\n"),
      companyDescriptionSource: options.companyDescriptionSource || "blank",
      promptMode,
      promptLayers: { canonical, businessDetails, volatile }
    };
  }
  const renderedSections = blueprint.sections
    .map((section) => {
      const overrideText = normalizeText(sectionOverrides[section.section_id]);
      if (section.section_id === "core_facts" && !coreFactsBlock) {
        return null;
      }
      let textSource = overrideText || section.default_text;
      if (!coreFactsBlock && section.section_id === "business_context") {
        textSource = textSource.replace(`\n${CORE_FACTS_MEMORY_BULLET}`, "");
      }
      if (!coreFactsBlock && section.section_id === "tools") {
        textSource = textSource.replace(`${CORE_FACTS_LOOKUP_RULE}\n\n`, "");
      }
      if (!coreFactsBlock && section.section_id === "adjacent_requests") {
        textSource = textSource.replace(ADJACENT_REQUESTS_CORE_FACT_REFERENCE, ADJACENT_REQUESTS_GENERIC_REFERENCE);
      }
      const placeholders = extractPlaceholders(textSource);
      const renderedText = interpolateTemplate(textSource, renderValues).trim();
      if (section.section_id === "sample_phrase_guidance" && !samplePhraseGroupsBlock) {
        return null;
      }
      if (!renderedText) return null;
      return {
        section_id: section.section_id,
        section_order: section.section_order,
        title: SECTION_TITLE_BY_ID[section.section_id],
        text: renderedText,
        source: overrideText ? "tenant_override" : "canonical",
        placeholders
      } satisfies RenderedPromptSection;
    })
    .filter(Boolean) as RenderedPromptSection[];
  return {
    blueprint,
    tenantProfile,
    renderedSections,
    startupPrompt: renderedSections.map((section) => section.text).join("\n\n"),
    companyDescriptionSource: options.companyDescriptionSource || "blank",
    promptMode,
    promptLayers: {
      canonical: renderedSections.map((section) => section.text).join("\n\n"),
      businessDetails: "",
      volatile: ""
    }
  };
}

export function buildRuntimeToolDefinitions(
  blueprintInput: PromptBlueprintBundle | unknown,
  fieldSchema: Record<string, unknown>,
  options: RuntimeToolBuildOptions = {}
) {
  const blueprint = normalizePromptBlueprintBundle(blueprintInput);
  const properties = asObject(asObject(fieldSchema).properties);
  const required = Array.isArray(asObject(fieldSchema).required)
    ? [...(asObject(fieldSchema).required as unknown as string[])].sort((left, right) => left.localeCompare(right))
    : undefined;
  const result: RuntimeToolDefinition[] = [
    {
      type: "function",
      name: "knowledge_lookup",
      description: blueprint.tool_definitions.knowledge_lookup.description,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: blueprint.tool_definitions.knowledge_lookup.parameter_descriptions?.query || DEFAULT_TOOL_DEFINITIONS.knowledge_lookup.parameter_descriptions?.query
          }
        },
        required: ["query"]
      }
    },
    {
      type: "function",
      name: "data_capture",
      description: blueprint.tool_definitions.data_capture.description,
      parameters: {
        ...fieldSchema,
        properties: Object.fromEntries(
          Object.entries(properties).sort(([left], [right]) => left.localeCompare(right)).map(([fieldName, schema]) => {
            const schemaObject = asObject(schema);
            const description = fieldName === "outcome_type"
              ? (blueprint.tool_definitions.data_capture.outcome_type_description || DEFAULT_TOOL_DEFINITIONS.data_capture.outcome_type_description)
              : interpolateTemplate(
                  blueprint.tool_definitions.data_capture.generic_field_description_template
                    || DEFAULT_TOOL_DEFINITIONS.data_capture.generic_field_description_template
                    || "Structured captured value for {field_name}.",
                  { field_name: humanizeFieldName(fieldName) }
                );
            return [
              fieldName,
              {
                ...schemaObject,
                description
              }
            ];
          })
        ),
        ...(required ? { required } : {})
      }
    },
    {
      type: "function",
      name: "finish_session",
      description: blueprint.tool_definitions.finish_session.description,
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: blueprint.tool_definitions.finish_session.parameter_descriptions?.reason || DEFAULT_TOOL_DEFINITIONS.finish_session.parameter_descriptions?.reason
          }
        }
      }
    }
  ];
  if (options.includeTransferTools) {
    result.push(
      {
        type: "function",
        name: "lookup_transfer_target",
        description: blueprint.tool_definitions.lookup_transfer_target.description,
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: blueprint.tool_definitions.lookup_transfer_target.parameter_descriptions?.query || DEFAULT_TOOL_DEFINITIONS.lookup_transfer_target.parameter_descriptions?.query
            }
          },
          required: ["query"]
        }
      },
      {
        type: "function",
        name: "transfer_call",
        description: blueprint.tool_definitions.transfer_call.description,
        parameters: {
          type: "object",
          properties: {
            target_id: {
              type: "string",
              description: blueprint.tool_definitions.transfer_call.parameter_descriptions?.target_id || DEFAULT_TOOL_DEFINITIONS.transfer_call.parameter_descriptions?.target_id
            }
          },
          required: ["target_id"]
        }
      }
    );
  }
  return result.map((tool) => canonicalizeJsonValue(tool) as RuntimeToolDefinition);
}

export function listPromptSectionTitles() {
  return { ...SECTION_TITLE_BY_ID };
}
