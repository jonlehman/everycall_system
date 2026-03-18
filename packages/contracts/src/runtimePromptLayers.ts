export type RuntimePromptConfig = {
  baseSystemPrompt: {
    instructionLines: string[];
  };
  companyContext: {
    headerLabel: string;
    summaryTemplate: string;
  };
  callMission: {
    headerLabel: string;
    summaryTemplate: string;
  };
  tenantPersona: {
    headerLabel: string;
    lineTemplates: {
      businessRole: string;
      greetingStyle: string;
      tone: string;
      aiDisclosure: string;
      uncertainty: string;
      pricingFallback: string;
      closing: string;
      responseStyle: string;
    };
    defaults: {
      greetingStyle: string;
      tone: string;
      aiDisclosure: string;
      uncertainty: string;
      pricingFallback: string;
      closing: string;
      conciseResponseStyle: string;
      completeResponseStyle: string;
    };
  };
  knowledgeToolPolicy: {
    headerLabel: string;
    requireKnowledgeLookupTemplate: string;
    maxClarifyingQuestionsTemplate: string;
    endCallAfterSpokenCloseTemplate: string;
  };
  runtimeContext: {
    headerLabel: string;
    stageTemplate: string;
    assignmentTemplate: string;
  };
  greetingInstruction: {
    template: string;
    fallbackGreeting: string;
  };
  responseRestrictions: {
    baselineRules: string[];
    setupInterviewRule: string;
    conciseResponseRule: string;
    overridePriorityRule: string;
    dangerousQuestionRule: string;
  };
};

export type ResponseRestrictionDetails = {
  baselineRules: string[];
  conditionalTemplates: {
    setupInterviewRule: string;
    conciseResponseRule: string;
    overridePriorityRule: string;
    dangerousQuestionRule: string;
  };
  activeConditionalRules: string[];
  allRules: string[];
};

const DEFAULT_RUNTIME_PROMPT_CONFIG: RuntimePromptConfig = {
  baseSystemPrompt: {
    instructionLines: [
      "You are the live phone receptionist and soft-sales assistant for the business.",
      "Answer direct caller questions first, then move to the next supported step.",
      "For tenant-specific facts, call knowledge_lookup and speak only from the returned answer_packet.",
      "If answer_packet.unsupported_requested_items is non-empty, say you do not have confirmed details and offer the next supported step.",
      "After answering, keep the conversation moving with one gentle, natural follow-up unless the caller is clearly done.",
      "For broad or exploratory questions, prefer one soft discovery question over a hard close.",
      "For specific factual questions, answer first and then use the lightest natural follow-up instead of pushing a concrete next step.",
      "Use next_step_options only when they genuinely fit the caller's stage or when the answer is incomplete.",
      "When retrieved material overlaps or contains noise, prefer the most directly relevant and concrete capability or policy statements.",
      "Ignore privacy-policy, contact-form, and admin text unless the caller is explicitly asking about those topics.",
      "If the remaining material still conflicts, avoid making a hard unsupported claim and offer a callback or follow-up.",
      "Keep each response to one or two short sentences unless the caller clearly needs a concise clarification."
    ]
  },
  companyContext: {
    headerLabel: "Company context:",
    summaryTemplate: "- What this business does: {company_context_summary}"
  },
  callMission: {
    headerLabel: "Call handling mission:",
    summaryTemplate: "- Mission for this call flow: {business_call_intent_summary}"
  },
  tenantPersona: {
    headerLabel: "Tenant persona and wording:",
    lineTemplates: {
      businessRole: "Business role: {intent_summary}",
      greetingStyle: "Greeting style: {greeting_style}",
      tone: "Tone: {tone}",
      aiDisclosure: "AI disclosure wording: {ai_disclosure}",
      uncertainty: "Uncertainty wording: {uncertainty_phrase}",
      pricingFallback: "Pricing fallback wording: {pricing_fallback}",
      closing: "Closing wording: {closing_phrase}",
      responseStyle: "Response style: {response_style}"
    },
    defaults: {
      greetingStyle: "Warm, concise, and helpful.",
      tone: "Be clear, short, and helpful on every turn.",
      aiDisclosure: "I'm the business's automated assistant.",
      uncertainty: "I want to make sure I get that right.",
      pricingFallback: "I can help with the next step, but final pricing is confirmed by the team.",
      closing: "I'll make sure the team has that.",
      conciseResponseStyle: "one or two short sentences",
      completeResponseStyle: "helpful and complete"
    }
  },
  knowledgeToolPolicy: {
    headerLabel: "Knowledge Tool Policy:",
    requireKnowledgeLookupTemplate: "- Require knowledge lookup for tenant facts: {require_knowledge_lookup}",
    maxClarifyingQuestionsTemplate: "- Max clarifying questions: {max_clarifying_questions}",
    endCallAfterSpokenCloseTemplate: "- End call only after spoken close: {end_call_only_after_spoken_close}"
  },
  runtimeContext: {
    headerLabel: "Current runtime context:",
    stageTemplate: "- Stage: {current_stage}",
    assignmentTemplate: "- Active assignment: {active_assignment}"
  },
  greetingInstruction: {
    template: "Call just connected. Greet the caller now using this greeting: {tenant_greeting}",
    fallbackGreeting: "Hi, thanks for calling. How can I help you?"
  },
  responseRestrictions: {
    baselineRules: [
      "Answer directly and briefly.",
      "Use only source-backed business information from the answer packet for tenant-specific claims.",
      "Do not invent pricing, availability, guarantees, or policy details.",
      "Ask at most one short clarifying question if needed.",
      "Do not stop abruptly after a direct answer unless the caller is clearly done or is interrupting.",
      "After answering, make one gentle forward-motion move that fits the moment.",
      "Prefer the lightest useful move: tie back to what the caller said, ask one soft discovery question, or offer one optional helpful detail.",
      "Do not jump straight to scheduling, callback, or a hard sales close unless the caller shows clear intent or the answer is incomplete.",
      "Treat next_step_options as optional support, not mandatory spoken output.",
      "When retrieved material overlaps or contains noise, prefer the most directly relevant and concrete capability or policy statements.",
      "Ignore privacy-policy, contact-form, and admin text unless the caller is explicitly asking about those topics.",
      "If the remaining material still conflicts, avoid making a hard unsupported claim and offer a callback or follow-up."
    ],
    setupInterviewRule: "Treat confirmed summary blocks as authoritative and raw transcript text as evidence only.",
    conciseResponseRule: "Keep each response to one or two short sentences.",
    overridePriorityRule: "Approved overrides outrank retrieved build content for this turn.",
    dangerousQuestionRule: "If a dangerous-question guardrail matches, follow the approved bounded response pattern."
  }
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStringArray(value: unknown, fallback: string[]) {
  const source = Array.isArray(value) ? value : fallback;
  return source.map((item) => normalizeText(item)).filter(Boolean);
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

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_RUNTIME_PROMPT_CONFIG)) as RuntimePromptConfig;
}

function applyTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (_, key) => values[key] ?? "");
}

function normalizeBooleanWord(value: unknown, positive = "yes", negative = "no") {
  return value === false ? negative : positive;
}

export function getDefaultRuntimePromptConfig() {
  return cloneDefaults();
}

export function normalizeRuntimePromptConfig(input: unknown): RuntimePromptConfig {
  const defaults = cloneDefaults();
  const source = asObject(input);
  const baseSystemPrompt = asObject(source.baseSystemPrompt);
  const companyContext = asObject(source.companyContext);
  const callMission = asObject(source.callMission);
  const legacyBusinessContext = asObject(source.businessContext);
  const tenantPersona = asObject(source.tenantPersona);
  const tenantPersonaLines = asObject(tenantPersona.lineTemplates);
  const tenantPersonaDefaults = asObject(tenantPersona.defaults);
  const knowledgeToolPolicy = asObject(source.knowledgeToolPolicy);
  const runtimeContext = asObject(source.runtimeContext);
  const greetingInstruction = asObject(source.greetingInstruction);
  const responseRestrictions = asObject(source.responseRestrictions);

  return {
    baseSystemPrompt: {
      instructionLines: asStringArray(
        baseSystemPrompt.instructionLines,
        defaults.baseSystemPrompt.instructionLines
      )
    },
    companyContext: {
      headerLabel: normalizeText(companyContext.headerLabel) || defaults.companyContext.headerLabel,
      summaryTemplate: normalizeText(companyContext.summaryTemplate) || defaults.companyContext.summaryTemplate
    },
    callMission: {
      headerLabel: normalizeText(callMission.headerLabel) || normalizeText(legacyBusinessContext.headerLabel) || defaults.callMission.headerLabel,
      summaryTemplate: normalizeText(callMission.summaryTemplate) || normalizeText(legacyBusinessContext.summaryTemplate) || defaults.callMission.summaryTemplate
    },
    tenantPersona: {
      headerLabel: normalizeText(tenantPersona.headerLabel) || defaults.tenantPersona.headerLabel,
      lineTemplates: {
        businessRole: normalizeText(tenantPersonaLines.businessRole) || defaults.tenantPersona.lineTemplates.businessRole,
        greetingStyle: normalizeText(tenantPersonaLines.greetingStyle) || defaults.tenantPersona.lineTemplates.greetingStyle,
        tone: normalizeText(tenantPersonaLines.tone) || defaults.tenantPersona.lineTemplates.tone,
        aiDisclosure: normalizeText(tenantPersonaLines.aiDisclosure) || defaults.tenantPersona.lineTemplates.aiDisclosure,
        uncertainty: normalizeText(tenantPersonaLines.uncertainty) || defaults.tenantPersona.lineTemplates.uncertainty,
        pricingFallback: normalizeText(tenantPersonaLines.pricingFallback) || defaults.tenantPersona.lineTemplates.pricingFallback,
        closing: normalizeText(tenantPersonaLines.closing) || defaults.tenantPersona.lineTemplates.closing,
        responseStyle: normalizeText(tenantPersonaLines.responseStyle) || defaults.tenantPersona.lineTemplates.responseStyle
      },
      defaults: {
        greetingStyle: normalizeText(tenantPersonaDefaults.greetingStyle) || defaults.tenantPersona.defaults.greetingStyle,
        tone: normalizeText(tenantPersonaDefaults.tone) || defaults.tenantPersona.defaults.tone,
        aiDisclosure: normalizeText(tenantPersonaDefaults.aiDisclosure) || defaults.tenantPersona.defaults.aiDisclosure,
        uncertainty: normalizeText(tenantPersonaDefaults.uncertainty) || defaults.tenantPersona.defaults.uncertainty,
        pricingFallback: normalizeText(tenantPersonaDefaults.pricingFallback) || defaults.tenantPersona.defaults.pricingFallback,
        closing: normalizeText(tenantPersonaDefaults.closing) || defaults.tenantPersona.defaults.closing,
        conciseResponseStyle: normalizeText(tenantPersonaDefaults.conciseResponseStyle) || defaults.tenantPersona.defaults.conciseResponseStyle,
        completeResponseStyle: normalizeText(tenantPersonaDefaults.completeResponseStyle) || defaults.tenantPersona.defaults.completeResponseStyle
      }
    },
    knowledgeToolPolicy: {
      headerLabel: normalizeText(knowledgeToolPolicy.headerLabel) || defaults.knowledgeToolPolicy.headerLabel,
      requireKnowledgeLookupTemplate: normalizeText(knowledgeToolPolicy.requireKnowledgeLookupTemplate) || defaults.knowledgeToolPolicy.requireKnowledgeLookupTemplate,
      maxClarifyingQuestionsTemplate: normalizeText(knowledgeToolPolicy.maxClarifyingQuestionsTemplate) || defaults.knowledgeToolPolicy.maxClarifyingQuestionsTemplate,
      endCallAfterSpokenCloseTemplate: normalizeText(knowledgeToolPolicy.endCallAfterSpokenCloseTemplate) || defaults.knowledgeToolPolicy.endCallAfterSpokenCloseTemplate
    },
    runtimeContext: {
      headerLabel: normalizeText(runtimeContext.headerLabel) || defaults.runtimeContext.headerLabel,
      stageTemplate: normalizeText(runtimeContext.stageTemplate) || defaults.runtimeContext.stageTemplate,
      assignmentTemplate: normalizeText(runtimeContext.assignmentTemplate) || defaults.runtimeContext.assignmentTemplate
    },
    greetingInstruction: {
      template: normalizeText(greetingInstruction.template) || defaults.greetingInstruction.template,
      fallbackGreeting: normalizeText(greetingInstruction.fallbackGreeting) || defaults.greetingInstruction.fallbackGreeting
    },
    responseRestrictions: {
      baselineRules: asStringArray(responseRestrictions.baselineRules, defaults.responseRestrictions.baselineRules),
      setupInterviewRule: normalizeText(responseRestrictions.setupInterviewRule) || defaults.responseRestrictions.setupInterviewRule,
      conciseResponseRule: normalizeText(responseRestrictions.conciseResponseRule) || defaults.responseRestrictions.conciseResponseRule,
      overridePriorityRule: normalizeText(responseRestrictions.overridePriorityRule) || defaults.responseRestrictions.overridePriorityRule,
      dangerousQuestionRule: normalizeText(responseRestrictions.dangerousQuestionRule) || defaults.responseRestrictions.dangerousQuestionRule
    }
  };
}

export function buildTenantPersonaFromPromptConfig(
  promptConfig: RuntimePromptConfig | unknown,
  runtimeProfile: Record<string, any> | null | undefined,
  intentSummary: Record<string, any> | null | undefined
) {
  const config = normalizeRuntimePromptConfig(promptConfig);
  const wordingDefaults = asObject(runtimeProfile?.wording_defaults);
  const runtimeDefaults = asObject(runtimeProfile?.runtime_defaults);
  const toneRules = asStringArray(intentSummary?.tone_rules, []);
  const greetingStyle = normalizeText(runtimeProfile?.greeting_text) || config.tenantPersona.defaults.greetingStyle;
  const tone = toneRules.length ? toneRules.join(" | ") : config.tenantPersona.defaults.tone;
  const aiDisclosure = normalizeText(wordingDefaults.ai_disclosure) || config.tenantPersona.defaults.aiDisclosure;
  const uncertaintyPhrase = normalizeText(wordingDefaults.uncertainty_phrase) || config.tenantPersona.defaults.uncertainty;
  const pricingFallback = normalizeText(wordingDefaults.pricing_fallback) || config.tenantPersona.defaults.pricingFallback;
  const closingPhrase = normalizeText(wordingDefaults.closing_phrase) || config.tenantPersona.defaults.closing;
  const responseStyle = runtimeDefaults.concise_responses === false
    ? config.tenantPersona.defaults.completeResponseStyle
    : config.tenantPersona.defaults.conciseResponseStyle;

  return [
    applyTemplate(config.tenantPersona.lineTemplates.businessRole, {
      intent_summary: normalizeText(intentSummary?.summary)
    }),
    applyTemplate(config.tenantPersona.lineTemplates.greetingStyle, {
      greeting_style: greetingStyle
    }),
    applyTemplate(config.tenantPersona.lineTemplates.tone, {
      tone
    }),
    applyTemplate(config.tenantPersona.lineTemplates.aiDisclosure, {
      ai_disclosure: aiDisclosure
    }),
    applyTemplate(config.tenantPersona.lineTemplates.uncertainty, {
      uncertainty_phrase: uncertaintyPhrase
    }),
    applyTemplate(config.tenantPersona.lineTemplates.pricingFallback, {
      pricing_fallback: pricingFallback
    }),
    applyTemplate(config.tenantPersona.lineTemplates.closing, {
      closing_phrase: closingPhrase
    }),
    applyTemplate(config.tenantPersona.lineTemplates.responseStyle, {
      response_style: responseStyle
    })
  ].map((line) => normalizeText(line)).filter(Boolean).join("\n");
}

export function buildCompanyContextBlockFromPromptConfig(
  promptConfig: RuntimePromptConfig | unknown,
  companyContextSummary: string | null | undefined
) {
  const config = normalizeRuntimePromptConfig(promptConfig);
  const summary = normalizeText(companyContextSummary);
  if (!summary) return "";
  const line = normalizeText(applyTemplate(config.companyContext.summaryTemplate, {
    company_context_summary: summary
  }));
  return [config.companyContext.headerLabel, line].filter(Boolean).join("\n");
}

export function buildCallMissionBlockFromPromptConfig(
  promptConfig: RuntimePromptConfig | unknown,
  businessCallIntentSummary: string | null | undefined
) {
  const config = normalizeRuntimePromptConfig(promptConfig);
  const summary = normalizeText(businessCallIntentSummary);
  if (!summary) return "";
  const line = normalizeText(applyTemplate(config.callMission.summaryTemplate, {
    business_call_intent_summary: summary
  }));
  return [config.callMission.headerLabel, line].filter(Boolean).join("\n");
}

export function buildGatewaySystemPromptFromPromptConfig(
  promptConfig: RuntimePromptConfig | unknown,
  tenantPersona: string
) {
  const config = normalizeRuntimePromptConfig(promptConfig);
  return [
    ...config.baseSystemPrompt.instructionLines,
    "",
    config.tenantPersona.headerLabel,
    tenantPersona
  ].filter(Boolean).join("\n");
}

export function buildKnowledgeToolPolicyBlockFromPromptConfig(
  promptConfig: RuntimePromptConfig | unknown,
  toolPolicy: Record<string, unknown> | null | undefined
) {
  const config = normalizeRuntimePromptConfig(promptConfig);
  const policy = asObject(toolPolicy);
  const lines = [
    applyTemplate(config.knowledgeToolPolicy.requireKnowledgeLookupTemplate, {
      require_knowledge_lookup: normalizeBooleanWord(policy.require_knowledge_lookup_for_tenant_facts)
    }),
    applyTemplate(config.knowledgeToolPolicy.maxClarifyingQuestionsTemplate, {
      max_clarifying_questions: normalizeText(policy.max_clarifying_questions) || "1"
    }),
    applyTemplate(config.knowledgeToolPolicy.endCallAfterSpokenCloseTemplate, {
      end_call_only_after_spoken_close: normalizeBooleanWord(policy.allow_end_call_only_after_spoken_close, "yes", "no")
    })
  ].map((line) => normalizeText(line)).filter(Boolean);
  return [config.knowledgeToolPolicy.headerLabel, ...lines].filter(Boolean).join("\n");
}

export function buildRuntimeContextBlockFromPromptConfig(
  promptConfig: RuntimePromptConfig | unknown,
  input: {
    currentStage: string;
    activeDomainId?: string | null | undefined;
    activeSubdomainId?: string | null | undefined;
  }
) {
  const config = normalizeRuntimePromptConfig(promptConfig);
  const activeDomainId = normalizeText(input.activeDomainId);
  const activeSubdomainId = normalizeText(input.activeSubdomainId);
  const activeAssignment = activeDomainId
    ? `${activeDomainId}${activeSubdomainId ? ` / ${activeSubdomainId}` : ""}`
    : "none";
  const lines = [
    applyTemplate(config.runtimeContext.stageTemplate, {
      current_stage: normalizeText(input.currentStage)
    }),
    applyTemplate(config.runtimeContext.assignmentTemplate, {
      active_assignment: activeAssignment
    })
  ].map((line) => normalizeText(line)).filter(Boolean);
  return [config.runtimeContext.headerLabel, ...lines].filter(Boolean).join("\n");
}

export function buildGatewaySessionInstructionsFromPromptConfig(input: {
  promptConfig?: RuntimePromptConfig | unknown;
  systemPrompt: string;
  companyContextSummary?: string | null;
  businessCallIntentSummary?: string | null;
  tenantGreeting?: string | null;
  toolPolicy?: Record<string, unknown> | null;
  currentStage: string;
  activeDomainId?: string | null;
  activeSubdomainId?: string | null;
}) {
  const companyContextBlock = buildCompanyContextBlockFromPromptConfig(
    input.promptConfig,
    input.companyContextSummary
  );
  const callMissionBlock = buildCallMissionBlockFromPromptConfig(
    input.promptConfig,
    input.businessCallIntentSummary
  );
  const policyBlock = buildKnowledgeToolPolicyBlockFromPromptConfig(input.promptConfig, input.toolPolicy);
  const runtimeContextBlock = buildRuntimeContextBlockFromPromptConfig(input.promptConfig, {
    currentStage: input.currentStage,
    activeDomainId: input.activeDomainId,
    activeSubdomainId: input.activeSubdomainId
  });
  return [
    normalizeText(input.systemPrompt),
    companyContextBlock,
    callMissionBlock,
    policyBlock,
    normalizeText(input.tenantGreeting) ? `Greeting:\n${normalizeText(input.tenantGreeting)}` : "",
    runtimeContextBlock
  ].filter(Boolean).join("\n\n");
}

export function buildGreetingInstructionFromPromptConfig(
  promptConfig: RuntimePromptConfig | unknown,
  tenantGreeting?: string | null
) {
  const config = normalizeRuntimePromptConfig(promptConfig);
  return applyTemplate(config.greetingInstruction.template, {
    tenant_greeting: normalizeText(tenantGreeting) || config.greetingInstruction.fallbackGreeting
  });
}

export function buildResponseRestrictionDetailsFromPromptConfig(input: {
  promptConfig?: RuntimePromptConfig | unknown;
  runtimeEntryMode: string;
  conciseResponses?: boolean;
  matchedOverrides?: Array<Record<string, unknown>>;
  matchedGuardrails?: Array<Record<string, unknown>>;
}) : ResponseRestrictionDetails {
  const config = normalizeRuntimePromptConfig(input.promptConfig);
  const baselineRules = uniqueValues(config.responseRestrictions.baselineRules);
  const conditionalTemplates = {
    setupInterviewRule: config.responseRestrictions.setupInterviewRule,
    conciseResponseRule: config.responseRestrictions.conciseResponseRule,
    overridePriorityRule: config.responseRestrictions.overridePriorityRule,
    dangerousQuestionRule: config.responseRestrictions.dangerousQuestionRule
  };
  const activeConditionalRules = [
    normalizeText(input.runtimeEntryMode) === "setup_interview" ? conditionalTemplates.setupInterviewRule : "",
    input.conciseResponses !== false ? conditionalTemplates.conciseResponseRule : "",
    (input.matchedOverrides || []).some((item) => {
      const overrideType = normalizeText((item as Record<string, unknown>)?.override_type);
      return overrideType === "hard_fact" || overrideType === "temporary_notice";
    }) ? conditionalTemplates.overridePriorityRule : "",
    (input.matchedGuardrails || []).length ? conditionalTemplates.dangerousQuestionRule : ""
  ].map((item) => normalizeText(item)).filter(Boolean);

  return {
    baselineRules,
    conditionalTemplates,
    activeConditionalRules,
    allRules: uniqueValues([...baselineRules, ...activeConditionalRules])
  };
}

export function buildResponseRestrictionsFromPromptConfig(input: {
  promptConfig?: RuntimePromptConfig | unknown;
  runtimeEntryMode: string;
  conciseResponses?: boolean;
  matchedOverrides?: Array<Record<string, unknown>>;
  matchedGuardrails?: Array<Record<string, unknown>>;
}) {
  return buildResponseRestrictionDetailsFromPromptConfig(input).allRules;
}
