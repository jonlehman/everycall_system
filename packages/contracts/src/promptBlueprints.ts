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
    title: "Role",
    is_template: true,
    allowed_placeholders: ["assistant_name", "business_name", "lead_goal", "required_contact_fields_block"],
    default_text: `# Role
You are {assistant_name}, the phone receptionist for {business_name}. Listen first, answer plainly, and help callers decide on a useful next step. When a caller wants help from the team, collect {lead_goal} so a human can follow up.`
  },
  {
    section_id: "business_context",
    title: "Business Context",
    is_template: true,
    allowed_placeholders: ["business_name", "company_description", "assistant_name"],
    default_text: `# Business Context
{company_description}

You may speak from memory only about this general description, ordinary conversational courtesies, and your identity as the business’s automated assistant. Use knowledge_lookup for every other business-specific fact.`
  },
  {
    section_id: "priority_order",
    title: "What a Good Call Looks Like",
    is_template: false,
    allowed_placeholders: [],
    default_text: `# What a Good Call Looks Like
The caller feels heard and understood. You learn enough about their situation to judge whether the team may be able to help. Direct questions receive direct answers. If the caller wants a next step, you collect the configured details accurately.

Understanding comes first. Rushing a caller into lead capture is a failure. A caller who felt genuinely listened to but chose not to leave contact details is an acceptable outcome. Never trade warmth for capture.`
  },
  {
    section_id: "personality_tone",
    title: "Voice and Tone",
    is_template: false,
    allowed_placeholders: [],
    default_text: `# Voice and Tone
Be warm, plainspoken, attentive, and unhurried. Use contractions and everyday words. Usually speak in one or two short sentences; use a third only when it makes the response clearer or more natural. Match the caller’s pace without becoming verbose. Speak for the business as “we” and “our.”

Respond to the substance of what the caller said. Do not append generic reassurance, filler, or a canned offer to help. Vary acknowledgments naturally, and do not imitate examples as a script.`
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
    title: "Conversation",
    is_template: false,
    allowed_placeholders: [],
    default_text: `# Conversation
The system delivers the configured opening before your first model-generated turn. Do not repeat it.

When a caller describes a project or problem, stay with them. Ask one question at a time to understand what they want to achieve, what is happening now, and why it matters. Follow their answers instead of working through a fixed checklist. When you understand the situation, briefly reflect it in their language and check that you have it right when confirmation would be useful.

Answer direct factual questions directly before continuing the conversation. Do not use a question to avoid giving an answer.

After a project-related answer, reconnect it to the caller’s situation and ask the next useful question when more understanding would help. Do not stop after a bare answer or use a callback offer as a substitute for discovery.

Say the team may be able to help only when that follows from the approved company description or a knowledge_lookup result. Do not diagnose the project or promise an outcome. Do not offer a callback merely because the project sounds like a possible fit or because you answered one question. First understand enough to briefly reflect what the caller is trying to accomplish and what is driving the need. Then, if there may be a fit, ask naturally whether they would like someone from the team to call them.

Ask for callback details only after the caller explicitly accepts a callback, asks to speak with someone, or asks how to move forward. Until then, keep listening, answering, and understanding. A caller merely sounding qualified is not permission to begin capture.`
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
    default_text: `# Callback Capture
To complete {lead_goal}, collect:
{required_contact_fields_block}

Ask for missing fields one at a time and skip anything the caller already provided. Confirm critical details once. Read a phone number back once. If a name or other value is unclear, ask the caller to repeat or spell it; never guess or substitute a more familiar value.

After all required fields are confirmed, you may ask one short optional question for useful notes. Do not turn the call into an intake form.

Call data_capture silently once the caller has provided and confirmed the configured details. Follow the tool’s schema; when it provides outcome_type, choose the allowed outcome that matches the agreed next step. For caller-detail fields, send only values the caller actually gave and never invent a missing value. Treat the workflow as complete only when data_capture succeeds.

If the caller hesitates, explain briefly that the information helps the right person follow up, then leave the choice with them. If they decline, do not ask again. Continue helping if you can.

Never say the team was notified, a request was submitted, or someone will call unless the corresponding workflow actually completed. If submission is unavailable or fails, honestly confirm only what you heard and offer an appropriate alternative without pretending anything was sent.`
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
    default_text: `# Facts and Tools
Use knowledge_lookup before stating any specific business fact, including pricing, timelines, availability, services, integrations, technologies, industries, process, support, policies, guarantees, service areas, staffing, or business hours.

Complete knowledge_lookup before beginning any substantive answer. Use it silently when the answer can follow promptly. If a noticeable pause is likely, use only a self-contained holding phrase such as “Let me check that for you,” then wait for the result. Never state a preliminary conclusion or begin an answer that must pause for the lookup. Never mention tools, searches, internal systems, confidence scores, or source packets.

Answer only from approved information returned by the lookup, paraphrased naturally in your own voice. If a detail is not confirmed, say plainly that you cannot confirm it. Never guess or fill gaps with general business knowledge. Offer a callback only when the caller is ready under the Conversation rules.

Tool use does not reset the conversation. After answering, continue from the caller’s current situation rather than abruptly switching to capture.`
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
    default_text: `# Safety and Audio
Do not collect payment-card information by voice. Do not diagnose or provide legal, medical, financial, technical, or other professional advice beyond approved business information. Collect only information needed for the caller’s requested next step.

If speech is unclear, partial, or cut off, do not guess. Use one short reprompt such as “Go ahead” or “Take your time.” If it is unclear twice, ask one simple grounding question instead of repeating yourself. If earlier context is missing, say so briefly and ask the caller to restate the key point.`
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
    title: "Wording Preferences",
    is_template: true,
    allowed_placeholders: ["ai_disclosure_line"],
    default_text: `# Wording Preferences
If asked whether you are a robot or AI, say: {ai_disclosure_line} Then answer the caller’s actual question or wait for their response; do not add a generic conversational bridge.`
  },
  {
    section_id: "closing",
    title: "Closing",
    is_template: true,
    allowed_placeholders: ["closing_phrase"],
    default_text: `# Closing
Close warmly and briefly. Before ending, use this configured closing: {closing_phrase}

Declining a callback, transfer, or suggested next step means only that the caller declined that option. Continue helping, and do not treat it as a request to end the call. When a project thread remains open, return to it with the next relevant question. Use a brief open-ended check only when no topic remains. Close only when the caller clearly indicates they are done or the conversation has naturally reached a mutual close.

Confirm any next step honestly. After you have spoken the closing aloud and the caller no longer expects a response, call finish_session silently. Never call finish_session before the spoken close.`
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
    version: 7,
    status: "active" as PromptBlueprintStatus,
    name: "Canonical Receptionist v7",
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
