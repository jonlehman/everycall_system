import { DEFAULT_RUNTIME_WORDING_DEFAULTS, DEFAULT_RUNTIME_TOOL_POLICY, DEFAULT_RUNTIME_BEHAVIOR_DEFAULTS } from "./knowledgeReceptionistConfig.js";
export function defaultBusinessIntent(payload) {
  const primaryGoal = payload.primaryGoal || "Answer callers briefly and move them to the correct next step.";
  return {
    status: "approved_live",
    primaryGoal,
    secondaryGoals: [],
    preferredOutcomes: ["callback_request", "message_taken", "transfer"],
    disallowedOutcomes: ["technical_advice", "invented_pricing"],
    toneRules: [
      "Be clear, short, and helpful on every turn.",
      "Answer direct questions before continuing the script.",
      "Ask one question at a time."
    ],
    salesStyle: {
      style: "service_forward",
      hard_sell_disallowed: true
    },
    disclosureStrategy: {
      mode: "bounded_default",
      phrase: DEFAULT_RUNTIME_WORDING_DEFAULTS.ai_disclosure
    },
    handoffStrategy: {
      preferred_outcome: "callback_request",
      allow_transfer: true
    },
    afterHoursStrategy: {
      mode: "capture_and_callback",
      phrase: "I can take your details so the team can follow up."
    },
    greetingConfig: {
      business_name: payload.businessName
    },
    terminologyPreferences: {}
  };
}

export function defaultRuntimeProfile(payload) {
  return {
    companyDescription: payload.companyDescription,
    greetingText: payload.greetingText || `Thanks for calling ${payload.businessName}. How can I help?`,
    sessionConfig: undefined,
    toolPolicy: DEFAULT_RUNTIME_TOOL_POLICY,
    wordingDefaults: DEFAULT_RUNTIME_WORDING_DEFAULTS,
    runtimeDefaults: {
      ...DEFAULT_RUNTIME_BEHAVIOR_DEFAULTS,
      after_hours_mode: "capture_and_callback"
    }
  };
}

export function defaultCallOutcomeSchema(payload, assignments) {
  const assignment = assignments[0] || { domainId: "service_business", subdomainId: null };
  return {
    status: "approved_live",
    domainScope: [assignment.domainId],
    subdomainScope: assignment.subdomainId ? [assignment.subdomainId] : [],
    outcomeTypes: ["callback_request", "message_taken", "transfer"],
    requiredFieldsByOutcome: {
      callback_request: ["first_name", "callback_number", "service_request"],
      message_taken: ["first_name", "callback_number", "service_request"],
      transfer: ["first_name", "callback_number"]
    },
    optionalFieldsByOutcome: {
      callback_request: ["last_name", "address_line1", "city", "state", "postal_code", "requested_date", "requested_time"],
      message_taken: ["last_name", "requested_date", "requested_time"],
      transfer: ["service_request"]
    },
    summaryTemplate: `${payload.businessName} call outcome: {{outcome_type}}`,
    validationRules: ["callback_number_required_for_contactable_outcomes"],
    metadata: {
      bootstrap_source: "tenant_onboard"
    }
  };
}
