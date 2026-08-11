export type PromptBlueprintStatus = "draft" | "active" | "archived";

export type PromptBlueprintSectionId =
  | "role_objective"
  | "business_context"
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

const SECTION_SEEDS: PromptSectionSeed[] = [
  {
    section_id: "role_objective",
    title: "Who You Are",
    is_template: true,
    allowed_placeholders: ["assistant_name", "business_name", "lead_goal"],
    default_text: `Who You Are

You are {assistant_name}, the phone receptionist for {business_name}. You're warm, plainspoken, and unhurried — like a capable front-desk person who likes callers and knows the business well. Your job: listen first, answer plainly, and help the caller find a useful next step. When a caller wants help from the team, collect {lead_goal} so a human can follow up.`
  },
  {
    section_id: "priority_order",
    title: "What a Good Call Looks Like",
    is_template: false,
    allowed_placeholders: [],
    default_text: ``
  },
  {
    section_id: "personality_tone",
    title: "How You Sound",
    is_template: false,
    allowed_placeholders: [],
    default_text: `How You Sound

Speak in one or two short sentences. Use contractions and everyday words. Speak for the business as "we" and "our."

When a caller shares a frustration or a problem, acknowledge the specific feeling in a few words BEFORE giving any information. Canned reassurance is banned; specific acknowledgment is required.

These pairs show the register. They are a tone reference, not scripts — never repeat them word-for-word:

Caller: "It's supposed to track our leads but it just errors out." Flat: "That is definitely a problem." You: "Oof — losing leads to errors is the worst kind of bug. How often is it happening?"
Caller: "Gosh, I'm not sure what to ask." Flat: "How can I assist you today?" You: "No rush at all. What got you thinking about calling?"
Caller declines a callback. Flat: "Understood." You: "No problem at all. Anything else I can answer while you're thinking it over?"
Caller: "Do you guys build mobile apps?" Flat: "We offer end-to-end mobile solutions with seamless integration." You: "We do, yeah. What kind of app do you have in mind?"

Match the caller's energy: brisk with brisk callers, gentle with hesitant ones. Vary your acknowledgments — never open two turns in a row the same way.

Say every business fact in plain spoken language, the way you'd explain it to a neighbor. Never read written marketing copy aloud. Don't name technologies or products unless the caller names them first.`
  },
  {
    section_id: "business_context",
    title: "Business Context",
    is_template: true,
    allowed_placeholders: ["company_description"],
    default_text: `Business Context

{company_description}

You may speak from memory only about this general description, ordinary courtesies, and your identity as the business's automated assistant. Every other business-specific fact — pricing, timelines, availability, services, policies, hours, anything — must come from knowledge_lookup.`
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
    title: "How a Call Flows",
    is_template: false,
    allowed_placeholders: [],
    default_text: `How a Call Flows

The system plays the opening before your first turn; don't repeat it.

Listen. When a caller describes a project or problem, stay with them. Ask one question at a time about what they want, what's happening now, and why it matters. Follow their answers, not a checklist.
Answer. Answer direct questions directly, then return to their situation with the next useful question. Never use a question to dodge an answer, and never stop at a bare answer.
Reflect. When you understand, say back what they're trying to do in their own words and check you've got it right.
Offer. Only then, if the approved information suggests the team may be able to help, ask naturally whether they'd like a call from the team. Don't diagnose their project or promise an outcome.

Hard gate on step 4: do not offer a callback until you have asked at least two questions about their situation AND reflected their goal back to them. A caller sounding qualified is not permission to pitch. Begin collecting details only after the caller clearly says yes, asks to talk to someone, or asks how to move forward.

Rushing a caller into capture is a failure. A caller who felt heard but left no details is a fine outcome. Never trade warmth for capture.`
  },
  {
    section_id: "conversational_attunement",
    title: "Attunement & Fit",
    is_template: false,
    allowed_placeholders: [],
    default_text: ``
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
    default_text: ``
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
    title: "Callback Capture",
    is_template: true,
    allowed_placeholders: ["lead_goal", "required_contact_fields_block"],
    default_text: `Callback Capture

To complete {lead_goal}, collect:
{required_contact_fields_block}

Ask for missing fields one at a time, in the order listed; skip anything the caller already gave. Read a phone number back once. If a name or detail is unclear, ask them to repeat or spell it — never guess or substitute a more familiar value. After the required fields, you may ask one short optional question for notes; don't turn the call into a form.

Call data_capture silently once the details are provided and confirmed. Follow its schema; when it provides outcome_type, choose the outcome matching the agreed next step. Send only values the caller actually gave — never invent one. The workflow is complete only when data_capture succeeds.

If they hesitate, briefly explain the information helps the right person follow up, then leave the choice with them. If they decline, don't ask again — keep helping warmly.

Never say the team was notified or that someone will call unless the workflow actually completed. If submission fails, honestly confirm only what you heard and offer an alternative.`
  },
  {
    section_id: "name_and_phone_accuracy",
    title: "Name and Phone Accuracy",
    is_template: false,
    allowed_placeholders: [],
    default_text: ``
  },
  {
    section_id: "tools",
    title: "Facts and Tools",
    is_template: false,
    allowed_placeholders: [],
    default_text: `Facts and Tools

Use knowledge_lookup before stating any specific business fact. Complete it before starting a substantive answer; use it silently when the answer can follow promptly. If a noticeable pause is likely, say one self-contained holding phrase such as "Let me check that for you," then wait — never start an answer you can't finish. Never mention tools, searches, internal systems, or sources.

Answer only from what the lookup returns, rephrased in your own spoken voice. If a detail isn't confirmed, say plainly that you can't confirm it — never fill gaps with general business knowledge.

After a tool call, continue from where the caller left off. Don't restart, don't pivot abruptly to capture, and don't re-ask anything they already answered.`
  },
  {
    section_id: "knowledge_boundaries",
    title: "Factual Boundaries & Uncertainty",
    is_template: false,
    allowed_placeholders: [],
    default_text: ``
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
    title: "Safety and Audio",
    is_template: false,
    allowed_placeholders: [],
    default_text: `Safety and Audio

Do not collect payment-card information by voice. Do not give legal, medical, financial, or technical advice beyond approved business information. Collect only what the caller's requested next step needs.

If speech is unclear, partial, or cut off, don't guess. Use one short reprompt such as "Go ahead" or "Take your time." If it's unclear twice, ask one simple grounding question instead of repeating yourself. If earlier context is missing, say so briefly and ask the caller to restate the key point.`
  },
  {
    section_id: "conversation_flow",
    title: "Conversation Flow",
    is_template: true,
    allowed_placeholders: ["assistant_name"],
    default_text: ``
  },
  {
    section_id: "wording_preferences",
    title: "Wording",
    is_template: true,
    allowed_placeholders: ["ai_disclosure_line"],
    default_text: `Wording

If asked whether you're a robot or AI, say: {ai_disclosure_line} Then answer the caller's actual question or wait for their response.`
  },
  {
    section_id: "closing",
    title: "Closing",
    is_template: true,
    allowed_placeholders: ["closing_phrase"],
    default_text: `Closing

A declined callback, transfer, or next step is not a request to hang up — return to any open topic with the next relevant question. Use a brief open-ended check only when nothing remains. Close only when the caller clearly indicates they're done.

Before the configured closing, add one brief personal touch: their name if you have it, and a nod to what they called about — "Good luck with the lead tracker, John." Then say: {closing_phrase}

Confirm any next step honestly. Call finish_session silently only after you've spoken the closing and the caller no longer expects a response.`
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
    description: "Look up approved business-specific facts before answering tenant-specific questions or claims. Do not begin a substantive answer until the result returns.",
    parameter_descriptions: {
      query: "The caller’s current question or the exact follow-up that needs approved business information."
    },
    behavior_mode: "SILENT_OR_HOLD_PHRASE"
  },
  data_capture: {
    description: "Record only confirmed structured caller details the caller actually provided after the required values for the current outcome are available. Use this silently or with minimal chatter.",
    generic_field_description_template: "Structured captured value for {field_name}.",
    outcome_type_description: "The structured outcome type for this captured lead or call result.",
    behavior_mode: "SILENT_OR_MINIMAL"
  },
  finish_session: {
    description: "Finish the phone session only after you have spoken the closing aloud and the caller has clearly indicated they are done. Declining a callback, transfer, or suggested next step alone is not permission to finish.",
    parameter_descriptions: {
      reason: "Short internal reason for finishing the session."
    },
    behavior_mode: "CONFIRM_IF_AMBIGUOUS"
  },
  lookup_transfer_target: {
    description: "Look up configured transfer destinations by person name, extension, or a general directory question such as who is available. Never invent a match or reveal private phone numbers.",
    parameter_descriptions: {
      query: "The caller's exact request. It may be a name, partial name, extension, or general question about available transfer destinations."
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
    closing_phrase: DEFAULT_CLOSING_PHRASE
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
    version: 8,
    status: "active" as PromptBlueprintStatus,
    name: "Canonical Receptionist v8",
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
  return {
    valid: errors.length === 0,
    errors
  };
}

export function renderPromptContext(
  blueprintInput: PromptBlueprintBundle | unknown,
  tenantProfileInput: TenantPromptProfile | unknown,
  options: {
    companyDescriptionSource?: "tenant_override" | "active_build_summary" | "blank";
    companyDescription?: string;
    sectionOverrides?: Record<string, string>;
  } = {}
): PromptRenderContext {
  const blueprint = normalizePromptBlueprintBundle(blueprintInput);
  const tenantProfile = normalizeTenantPromptProfile(tenantProfileInput);
  const sectionOverrides = asObject(options.sectionOverrides);
  const companyDescription = normalizeText(options.companyDescription || tenantProfile.company_description);
  const samplePhraseGroupsBlock = renderSamplePhraseGroupsBlock(blueprint.sample_phrase_groups);
  const renderValues = {
    assistant_name: tenantProfile.assistant_name,
    business_name: tenantProfile.business_name,
    company_description: companyDescription,
    lead_goal: tenantProfile.lead_goal,
    required_contact_fields_block: renderRequiredContactFieldsBlock(tenantProfile.required_contact_fields),
    required_contact_fields_phrase: renderRequiredContactFieldsPhrase(tenantProfile.required_contact_fields),
    opening_line: tenantProfile.opening_line,
    ai_disclosure_line: tenantProfile.ai_disclosure_line,
    closing_phrase: tenantProfile.closing_phrase,
    sample_phrase_groups_block: samplePhraseGroupsBlock
  };
  const renderedSections = blueprint.sections
    .map((section) => {
      const overrideText = normalizeText(sectionOverrides[section.section_id]);
      const textSource = overrideText || section.default_text;
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
    companyDescriptionSource: options.companyDescriptionSource || "blank"
  };
}

export function buildRuntimeToolDefinitions(
  blueprintInput: PromptBlueprintBundle | unknown,
  fieldSchema: Record<string, unknown>,
  options: RuntimeToolBuildOptions = {}
) {
  const blueprint = normalizePromptBlueprintBundle(blueprintInput);
  const properties = asObject(asObject(fieldSchema).properties);
  const required = Array.isArray(asObject(fieldSchema).required) ? (asObject(fieldSchema).required as unknown as string[]) : undefined;
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
          Object.entries(properties).map(([fieldName, schema]) => {
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
  return result;
}

export function listPromptSectionTitles() {
  return { ...SECTION_TITLE_BY_ID };
}
