import { z } from "zod";

export const knowledgeBuildStatusSchema = z.enum([
  "draft",
  "running",
  "failed",
  "compiled_unpublished",
  "qa_blocked",
  "ready_to_publish",
  "published",
  "superseded",
  "rolled_back"
]);

export const packStatusSchema = z.enum(["new", "established"]);
export const runtimeEntryModeSchema = z.enum(["customer_call", "setup_interview"]);
export const runtimeModeSchema = z.enum(["answer", "partial_answer", "clarify", "handoff", "emergency_redirect"]);
export const sourceChannelSchema = z.enum(["website_page", "website_file", "owner_interview", "uploaded_document"]);
export const sourceKindSchema = z.enum(["html", "pdf", "doc", "text", "transcript", "note"]);
export const sourceAuthoritySchema = z.enum([
  "website_public_page",
  "website_public_downloadable",
  "owner_interview_unconfirmed",
  "owner_interview_confirmed",
  "uploaded_first_party_operational",
  "uploaded_first_party_policy",
  "uploaded_first_party_reference",
  "uploaded_first_party_marketing",
  "uploaded_unclassified_pending_review"
]);
export const overrideTypeSchema = z.enum(["hard_fact", "temporary_notice", "soft_guidance", "approved_answer"]);
export const configArtifactStatusSchema = z.enum(["draft", "approved_live", "rejected", "expired"]);
export const guardrailModeSchema = z.enum(["answer", "partial_answer", "clarify", "handoff", "emergency_redirect"]);
export const reviewModeSchema = z.enum(["immediate_save", "approval_required"]);
export const readinessStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "blocked",
  "ready_for_review",
  "ready_for_go_live",
  "live"
]);
export const uploadedDocumentClassSchema = z.enum(["operational", "policy", "reference", "marketing", "unclassified"]);

const stringArraySchema = z.array(z.string().min(1)).default([]);
const jsonRecordSchema = z.record(z.any()).default({});
const jsonArraySchema = z.array(z.any()).default([]);
const nullableStringSchema = z.string().min(1).nullable().optional();
const arbitraryObjectArraySchema = z.array(z.record(z.any())).default([]);

export const domainPackSchema = z.object({
  domain_id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  status: packStatusSchema,
  description: z.string().min(1),
  naics_codes: stringArraySchema.optional(),
  intent_catalog: jsonArraySchema,
  entity_catalog: jsonArraySchema,
  page_type_weights: jsonRecordSchema,
  content_class_biases: jsonRecordSchema,
  ranking_rules: jsonArraySchema,
  boundary_rules: jsonArraySchema,
  clarification_rules: jsonArraySchema,
  default_stage_guidance: jsonArraySchema,
  default_prompt_fragments: jsonArraySchema,
  required_eval_suites: stringArraySchema,
  created_at: nullableStringSchema,
  updated_at: nullableStringSchema
});

export const subdomainPackSchema = z.object({
  subdomain_id: z.string().min(1),
  parent_domain_id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  status: packStatusSchema,
  description: z.string().min(1),
  additional_intents: jsonArraySchema,
  additional_entities: jsonArraySchema,
  page_type_weight_deltas: jsonRecordSchema,
  content_class_bias_deltas: jsonRecordSchema,
  ranking_rule_deltas: jsonArraySchema,
  boundary_rule_deltas: jsonArraySchema,
  clarification_rule_deltas: jsonArraySchema,
  stage_guidance_deltas: jsonArraySchema,
  prompt_fragment_deltas: jsonArraySchema,
  required_eval_suites: stringArraySchema,
  created_at: nullableStringSchema,
  updated_at: nullableStringSchema
});

export const stageDefinitionSchema = z.object({
  stage_id: z.string().min(1),
  name: z.string().min(1),
  purpose: z.string().min(1),
  when_to_enter: stringArraySchema,
  required_inputs: stringArraySchema,
  recommended_actions: stringArraySchema,
  disallowed_actions: stringArraySchema,
  exit_conditions: stringArraySchema,
  success_criteria: stringArraySchema,
  mandatory_or_optional: z.enum(["mandatory", "optional"]),
  max_questions: z.number().int().positive().optional(),
  next_possible_stages: stringArraySchema
});

export const businessCallIntentSchema = z.object({
  business_call_intent_id: z.string().min(1),
  tenant_id: z.string().min(1),
  version: z.string().min(1),
  status: configArtifactStatusSchema.or(z.literal("active")),
  primary_goal: z.string().min(1),
  secondary_goals: stringArraySchema,
  preferred_outcomes: stringArraySchema,
  disallowed_outcomes: stringArraySchema,
  tone_rules: stringArraySchema,
  sales_style: jsonRecordSchema,
  disclosure_strategy: jsonRecordSchema,
  handoff_strategy: jsonRecordSchema,
  after_hours_strategy: jsonRecordSchema,
  greeting_config: jsonRecordSchema,
  terminology_preferences: jsonRecordSchema,
  conversation_stage_playbook: z.array(stageDefinitionSchema).default([])
});

export const setupInterviewIntentSchema = z.object({
  setup_interview_intent_id: z.string().min(1),
  tenant_id: z.string().min(1),
  version: z.string().min(1),
  status: configArtifactStatusSchema.or(z.literal("active")),
  primary_goal: z.string().min(1),
  required_capture_categories: stringArraySchema,
  confirmation_policy: jsonRecordSchema,
  completion_criteria: jsonRecordSchema,
  interview_stage_playbook: z.array(stageDefinitionSchema).default([]),
  pause_resume_policy: jsonRecordSchema,
  review_and_confirm_policy: jsonRecordSchema
});

export const uploadedDocumentSchema = z.object({
  uploaded_document_id: z.string().min(1),
  tenant_id: z.string().min(1),
  status: z.enum(["draft", "approved", "archived"]),
  title: z.string().min(1),
  filename: nullableStringSchema,
  mime_type: z.string().min(1),
  source_authority: sourceAuthoritySchema,
  document_class: uploadedDocumentClassSchema,
  body_text: z.string().min(1),
  metadata: jsonRecordSchema,
  source_hash: z.string().min(1),
  created_at: nullableStringSchema,
  updated_at: nullableStringSchema
});

export const callOutcomeSchemaSchema = z.object({
  call_outcome_schema_id: z.string().min(1),
  tenant_id: z.string().min(1),
  status: configArtifactStatusSchema.or(z.literal("active")),
  domain_scope: stringArraySchema,
  subdomain_scope: stringArraySchema,
  outcome_types: stringArraySchema,
  required_fields_by_outcome: z.record(z.array(z.string().min(1))).default({}),
  optional_fields_by_outcome: z.record(z.array(z.string().min(1))).default({}),
  summary_template: z.string().min(1),
  validation_rules: stringArraySchema,
  metadata: jsonRecordSchema
});

export const sourceRefSchema = z.object({
  source_ref_id: z.string().min(1),
  tenant_id: z.string().min(1),
  build_id: z.string().min(1),
  source_channel: sourceChannelSchema,
  source_kind: sourceKindSchema,
  source_authority: sourceAuthoritySchema,
  source_locator: z.string().min(1),
  page_type: nullableStringSchema,
  title: nullableStringSchema,
  heading_path: nullableStringSchema,
  text_span: nullableStringSchema,
  segment_index: z.number().int().nonnegative().nullable().optional(),
  content_hash: z.string().min(1),
  source_session_id: nullableStringSchema,
  captured_at: z.string().min(1)
});

export const knowledgeFactSchema = z.object({
  knowledge_fact_id: z.string().min(1),
  tenant_id: z.string().min(1),
  build_id: z.string().min(1),
  domain_id: z.string().min(1),
  subdomain_id: nullableStringSchema,
  fact_type: z.string().min(1),
  object_type: z.string().min(1),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  normalized_value: z.any().optional(),
  confidence: z.number().min(0).max(1),
  source_ref_ids: stringArraySchema,
  scope: jsonRecordSchema,
  content_class: z.string().min(1),
  is_core_fact_pinned: z.boolean().default(false),
  core_fact_fingerprint: nullableStringSchema.optional(),
  core_fact_title: nullableStringSchema.optional(),
  core_fact_spoken_text: nullableStringSchema.optional(),
  core_fact_score: z.number().min(0).max(1).nullable().optional(),
  core_fact_rank: z.number().int().positive().nullable().optional(),
  core_fact_reason: nullableStringSchema.optional(),
  core_fact_selector_version: nullableStringSchema.optional(),
  core_fact_selected_at: nullableStringSchema.optional(),
  core_fact_rating_input_hash: nullableStringSchema.optional(),
  core_fact_is_stable: z.boolean().default(false),
  core_fact_is_safe_to_speak: z.boolean().default(false),
  core_fact_rating_version: nullableStringSchema.optional(),
  core_fact_rating_model: nullableStringSchema.optional(),
  core_fact_rated_at: nullableStringSchema.optional(),
  core_fact_spoken_version: nullableStringSchema.optional(),
  core_fact_spoken_model: nullableStringSchema.optional(),
  core_fact_spoken_at: nullableStringSchema.optional()
});

export const knowledgeCardSchema = z.object({
  knowledge_card_id: z.string().min(1),
  tenant_id: z.string().min(1),
  build_id: z.string().min(1),
  domain_id: z.string().min(1),
  subdomain_id: nullableStringSchema,
  card_type: z.string().min(1),
  object_type: z.string().min(1),
  canonical_name: z.string().min(1),
  topic_path: nullableStringSchema,
  intent_tags: stringArraySchema,
  entity_tags: stringArraySchema,
  aliases: stringArraySchema,
  caller_phrases: stringArraySchema,
  scope: jsonRecordSchema,
  speakable_summary: z.string().min(1),
  answer_facts: z.array(z.any()).default([]),
  related_card_ids: stringArraySchema,
  source_ref_ids: stringArraySchema,
  content_class: z.string().min(1),
  allowed_uses: stringArraySchema,
  risk_level: z.string().min(1),
  quality_score: z.number().min(0).max(1)
});

export const knowledgeBuildSchema = z.object({
  build_id: z.string().min(1),
  tenant_id: z.string().min(1),
  status: knowledgeBuildStatusSchema,
  version: z.string().min(1),
  domain_assignments: z.array(z.object({
    domain_id: z.string().min(1),
    subdomain_id: z.string().min(1)
  })).default([]),
  source_snapshot_id: nullableStringSchema,
  source_channels: z.array(sourceChannelSchema).default([]),
  artifact_counts: jsonRecordSchema,
  quality_summary: jsonRecordSchema,
  warnings: z.array(z.any()).default([]),
  published_at: nullableStringSchema,
  supersedes_build_id: nullableStringSchema
});

const runtimeBundleSelectedFactSchema = z.object({
  fact_id: z.string().min(1),
  claim: z.string().min(1),
  content_class: z.string().min(1).optional(),
  risk_level: z.string().min(1).optional()
});

const runtimeBundleSelectedCardSchema = z.object({
  knowledge_card_id: z.string().min(1),
  canonical_name: z.string().min(1),
  speakable_summary: z.string().min(1),
  aliases: stringArraySchema,
  caller_phrases: stringArraySchema,
  selected_facts: z.array(runtimeBundleSelectedFactSchema).default([])
});

export const runtimeBundleSchema = z.object({
  runtime_bundle_id: z.string().min(1),
  call_id: z.string().min(1),
  turn_id: z.string().min(1),
  tenant_id: z.string().min(1),
  build_id: z.string().min(1),
  runtime_entry_mode: runtimeEntryModeSchema,
  runtime_mode: runtimeModeSchema,
  active_domain_id: nullableStringSchema,
  active_subdomain_id: nullableStringSchema,
  detected_turn_intent: nullableStringSchema,
  selected_cards: z.array(runtimeBundleSelectedCardSchema).default([]),
  selected_answer_facts: z.array(runtimeBundleSelectedFactSchema).default([]),
  missing_critical_slots: stringArraySchema,
  state_delta: jsonRecordSchema,
  confidence_score: z.number().min(0).max(1),
  forced_support_mode: z.boolean().optional(),
  forced_confidence_score: z.number().min(0).max(1).optional()
});

export const callStateSchema = z.object({
  call_id: z.string().min(1),
  tenant_id: z.string().min(1),
  runtime_entry_mode: runtimeEntryModeSchema,
  current_stage: z.string().min(1),
  completed_stages: stringArraySchema,
  skipped_stages: stringArraySchema,
  active_domain_id: nullableStringSchema,
  active_subdomain_id: nullableStringSchema,
  active_service: nullableStringSchema,
  active_location: nullableStringSchema,
  active_provider: nullableStringSchema,
  pending_clarifier: nullableStringSchema,
  last_turn_intent: nullableStringSchema,
  last_bundle_id: nullableStringSchema,
  captured_fields: jsonRecordSchema,
  outcome_in_progress: nullableStringSchema,
  uncertainty_mode: nullableStringSchema
});

export const sourceIngestionManifestSchema = z.object({
  tenant_id: z.string().min(1),
  runtime_entry_mode: runtimeEntryModeSchema.default("customer_call"),
  website_root_url: z.string().url().optional(),
  uploaded_document_ids: stringArraySchema.optional(),
  owner_interview_session_ids: stringArraySchema.optional(),
  domain_assignments: z.array(z.object({
    domain_id: z.string().min(1),
    subdomain_id: z.string().min(1)
  })).default([])
});

export const knowledgeOverrideSchema = z.object({
  knowledge_override_id: z.string().min(1),
  tenant_id: z.string().min(1),
  override_type: overrideTypeSchema,
  priority: z.number().int().nonnegative(),
  status: configArtifactStatusSchema,
  title: z.string().min(1),
  body: z.string().min(1),
  scope: jsonRecordSchema,
  applies_to_intents: stringArraySchema,
  applies_to_domains: stringArraySchema,
  applies_to_subdomains: stringArraySchema,
  effective_from: nullableStringSchema,
  effective_until: nullableStringSchema,
  metadata: jsonRecordSchema
});

export const knowledgeGuardrailSchema = z.object({
  knowledge_guardrail_id: z.string().min(1),
  tenant_id: z.string().min(1),
  guardrail_type: z.string().min(1),
  trigger_patterns: stringArraySchema,
  trigger_intents: stringArraySchema,
  risk_level: z.string().min(1),
  mode: guardrailModeSchema,
  approved_response_pattern: z.string().min(1),
  required_next_step: nullableStringSchema,
  optional_capture_fields: stringArraySchema,
  escalation_instruction: nullableStringSchema,
  applies_to_domains: stringArraySchema,
  applies_to_subdomains: stringArraySchema,
  enabled: z.boolean(),
  status: configArtifactStatusSchema,
  metadata: jsonRecordSchema
});

export const readinessChecklistSchema = z.object({
  hours_confirmed: z.boolean().default(false),
  address_confirmed: z.boolean().default(false),
  phone_confirmed: z.boolean().default(false),
  after_hours_configured: z.boolean().default(false),
  service_area_confirmed: z.boolean().default(false),
  dangerous_question_reviewed: z.boolean().default(false),
  hard_overrides_reviewed: z.boolean().default(false),
  temporary_notices_checked: z.boolean().default(false),
  approved_answer_snippets_reviewed: z.boolean().default(false),
  sample_calls_passed: z.boolean().default(false),
  handoff_path_tested: z.boolean().default(false),
  outcome_capture_tested: z.boolean().default(false),
  pack_eval_suites_passed: z.boolean().default(false)
});

export const knowledgeReadinessStateSchema = z.object({
  tenant_id: z.string().min(1),
  status: readinessStatusSchema,
  requested_go_live: z.boolean(),
  review_mode: reviewModeSchema,
  checklist: readinessChecklistSchema,
  blockers: stringArraySchema,
  computed_inputs: jsonRecordSchema,
  last_evaluated_at: nullableStringSchema
});

export const knowledgeRuntimeSessionConfigSchema = z.object({
  model: z.string().min(1),
  voice: z.string().min(1),
  max_output_tokens: z.number().int().positive().optional(),
  reasoning: z.object({
    effort: z.enum(["minimal", "low", "medium", "high", "xhigh"])
  }).optional(),
  turn_detection: z.object({
    type: z.string().min(1),
    eagerness: z.string().min(1).optional(),
    threshold: z.number().optional(),
    prefix_padding_ms: z.number().int().nonnegative().optional(),
    silence_duration_ms: z.number().int().nonnegative().optional(),
    idle_timeout_ms: z.number().int().nonnegative().nullable().optional(),
    create_response: z.boolean().optional(),
    interrupt_response: z.boolean().optional()
  }),
  transcription_model: z.string().min(1).optional(),
  noise_reduction: z.string().min(1).optional(),
  input_audio_format: z.string().min(1).optional(),
  output_audio_format: z.string().min(1).optional()
});

export const knowledgeRuntimeToolPolicySchema = z.object({
  require_knowledge_lookup_for_tenant_facts: z.boolean().default(true),
  max_clarifying_questions: z.number().int().nonnegative().default(1),
  allow_finish_session_only_after_spoken_close: z.boolean().default(false),
  require_single_question_turns: z.boolean().default(true)
});

export const knowledgeRuntimeWordingDefaultsSchema = z.object({
  ai_disclosure: z.string().min(1),
  uncertainty_phrase: z.string().min(1),
  pricing_fallback: z.string().min(1),
  callback_offer: z.string().min(1),
  closing_phrase: z.string().min(1)
});

export const knowledgeRuntimeDefaultsSchema = z.object({
  clarification_style: z.string().min(1),
  after_hours_mode: z.string().min(1),
  concise_responses: z.boolean(),
  callback_offer_required: z.boolean()
});

export const knowledgeRuntimeProfileSchema = z.object({
  tenant_id: z.string().min(1),
  company_description: z.string().default(""),
  greeting_text: z.string().min(1),
  session_config: knowledgeRuntimeSessionConfigSchema,
  tool_policy: knowledgeRuntimeToolPolicySchema,
  wording_defaults: knowledgeRuntimeWordingDefaultsSchema,
  runtime_defaults: knowledgeRuntimeDefaultsSchema,
  updated_at: nullableStringSchema,
  created_at: nullableStringSchema
});

export const promptIntentSummarySchema = z.object({
  intent_id: z.string().min(1),
  intent_type: z.enum(["business_call_intent", "setup_interview_intent"]),
  primary_goal: z.string().min(1),
  summary: z.string().min(1),
  disclosure_strategy: jsonRecordSchema,
  handoff_strategy: jsonRecordSchema,
  after_hours_strategy: jsonRecordSchema,
  stage_ids: stringArraySchema
});

export const promptPackContextSchema = z.object({
  domain_id: z.string().min(1),
  subdomain_id: nullableStringSchema,
  domain_name: nullableStringSchema,
  subdomain_name: nullableStringSchema,
  pack_version: z.string().min(1),
  prompt_fragments: stringArraySchema,
  stage_guidance: stringArraySchema
});

export const retrievalTelemetrySchema = z.object({
  query: z.string().min(1),
  duration_ms: z.number().nonnegative(),
  total_gateway_turn_ms: z.number().nonnegative().optional(),
  asset_cache_hit: z.boolean().optional(),
  asset_fetch_ms: z.number().nonnegative().optional(),
  asset_load_strategy: z.enum(["warm_cache", "cold_fallback"]).optional(),
  recent_conversation_summary_ms: z.number().nonnegative().optional(),
  planner_ms: z.number().nonnegative().optional(),
  embedding_ms: z.number().nonnegative().optional(),
  retrieval_ms: z.number().nonnegative().optional(),
  packet_ms: z.number().nonnegative().optional(),
  runtime_core_ms: z.number().nonnegative().optional(),
  runtime_bundle_persist_ms: z.number().nonnegative().optional(),
  coverage_gap_persist_ms: z.number().nonnegative().optional(),
  planner_coverage_items: stringArraySchema.optional(),
  embedded_coverage_items: stringArraySchema.optional(),
  planner_request_payload: z.any().optional(),
  planner_response_payload: z.any().optional(),
  embedding_request_payload: z.any().optional(),
  embedding_response_payloads: z.array(z.any()).default([]),
  coverage: z.array(z.any()).default([]),
  candidate_count: z.number().int().nonnegative().optional(),
  selected_card_count: z.number().int().nonnegative().optional(),
  lexical_weight: z.number().optional(),
  vector_weight: z.number().optional(),
  precedence_weight: z.number().optional(),
  top_scores: z.array(z.object({
    knowledge_card_id: z.string().min(1),
    lexical_score: z.number(),
    vector_score: z.number(),
    precedence_score: z.number(),
    continuity_score: z.number().optional(),
    final_score: z.number()
  })).default([])
});

export const knowledgePromptPayloadSchema = z.object({
  runtime_entry_mode: runtimeEntryModeSchema,
  runtime_mode: runtimeModeSchema,
  build_id: z.string().min(1),
  universal_role_contract: stringArraySchema,
  intent_summary: promptIntentSummarySchema,
  active_domain: z.object({
    domain_id: z.string().min(1),
    subdomain_id: nullableStringSchema
  }),
  pack_context: promptPackContextSchema,
  tenant_configuration: z.object({
    matched_overrides: z.array(knowledgeOverrideSchema).default([]),
    matched_guardrails: z.array(knowledgeGuardrailSchema).default([]),
    call_outcome_schema: callOutcomeSchemaSchema.optional(),
    readiness: knowledgeReadinessStateSchema.optional()
  }),
  runtime_bundle: runtimeBundleSchema,
  call_state: callStateSchema,
  retrieval_telemetry: retrievalTelemetrySchema
});

export const knowledgeGatewayConfigurationSchema = z.object({
  runtime_profile: knowledgeRuntimeProfileSchema,
  overrides: z.array(knowledgeOverrideSchema).default([]),
  guardrails: z.array(knowledgeGuardrailSchema).default([]),
  call_outcome_schema: callOutcomeSchemaSchema.optional(),
  readiness: knowledgeReadinessStateSchema.optional()
});

export const knowledgeGatewayRuntimeContextSchema = z.object({
  active_build_id: z.string().min(1),
  active_domain_id: nullableStringSchema,
  active_subdomain_id: nullableStringSchema,
  runtime_entry_mode: runtimeEntryModeSchema,
  initial_call_state: callStateSchema,
  company_context_summary: z.string().default(""),
  business_call_intent_summary: z.string().default(""),
  prompt_blueprint: jsonRecordSchema.optional(),
  tenant_prompt_profile: jsonRecordSchema.optional(),
  rendered_prompt_sections: arbitraryObjectArraySchema.default([]),
  approved_configuration: knowledgeGatewayConfigurationSchema,
  token_counts: z.object({
    prompt_payload_tokens: z.number().int().nonnegative(),
    startup_instruction_tokens: z.number().int().nonnegative().optional(),
    runtime_bundle_tokens: z.number().int().nonnegative().optional()
  }).optional()
});

export const gatewayPromptPayloadSchema = z.object({
  system_prompt: z.string().min(1),
  tenant_greeting: z.string(),
  field_schema: jsonRecordSchema,
  tool_definitions: arbitraryObjectArraySchema,
  session_config: knowledgeRuntimeSessionConfigSchema,
  knowledge_runtime: knowledgeGatewayRuntimeContextSchema,
  metadata: jsonRecordSchema.optional()
});

export const gatewayRuntimeTurnRequestSchema = z.object({
  tenant_key: z.string().min(1),
  call_id: z.string().min(1),
  query: z.string().min(1),
  build_id: z.string().min(1).optional(),
  runtime_entry_mode: runtimeEntryModeSchema.default("customer_call"),
  topic: z.string().optional().nullable(),
  service_tags: stringArraySchema.optional(),
  trade_hint: z.string().optional().nullable(),
  conversation_stage: z.string().optional().nullable(),
  call_state: callStateSchema
});

export const gatewayRuntimeTurnResponseSchema = z.object({
  answer_packet: jsonRecordSchema,
  runtime_bundle: runtimeBundleSchema,
  matched_overrides: z.array(knowledgeOverrideSchema).default([]),
  matched_guardrails: z.array(knowledgeGuardrailSchema).default([]),
  call_state: callStateSchema,
  retrieval_telemetry: retrievalTelemetrySchema,
  token_counts: z.object({
    startup_prompt_tokens: z.number().int().nonnegative().optional(),
    startup_instruction_tokens: z.number().int().nonnegative().optional(),
    answer_packet_tokens: z.number().int().nonnegative().optional(),
    runtime_bundle_tokens: z.number().int().nonnegative().optional()
  })
});

export type DomainPack = z.infer<typeof domainPackSchema>;
export type SubdomainPack = z.infer<typeof subdomainPackSchema>;
export type BusinessCallIntent = z.infer<typeof businessCallIntentSchema>;
export type SetupInterviewIntent = z.infer<typeof setupInterviewIntentSchema>;
export type UploadedDocument = z.infer<typeof uploadedDocumentSchema>;
export type CallOutcomeSchema = z.infer<typeof callOutcomeSchemaSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type KnowledgeFact = z.infer<typeof knowledgeFactSchema>;
export type KnowledgeCard = z.infer<typeof knowledgeCardSchema>;
export type KnowledgeBuild = z.infer<typeof knowledgeBuildSchema>;
export type KnowledgeOverride = z.infer<typeof knowledgeOverrideSchema>;
export type KnowledgeGuardrail = z.infer<typeof knowledgeGuardrailSchema>;
export type KnowledgeReadinessState = z.infer<typeof knowledgeReadinessStateSchema>;
export type KnowledgeRuntimeProfile = z.infer<typeof knowledgeRuntimeProfileSchema>;
export type RuntimeBundle = z.infer<typeof runtimeBundleSchema>;
export type CallState = z.infer<typeof callStateSchema>;
export type SourceIngestionManifest = z.infer<typeof sourceIngestionManifestSchema>;
export type KnowledgePromptPayload = z.infer<typeof knowledgePromptPayloadSchema>;
export type KnowledgeGatewayConfiguration = z.infer<typeof knowledgeGatewayConfigurationSchema>;
export type KnowledgeGatewayRuntimeContext = z.infer<typeof knowledgeGatewayRuntimeContextSchema>;
export type GatewayPromptPayload = z.infer<typeof gatewayPromptPayloadSchema>;
export type GatewayRuntimeTurnRequest = z.infer<typeof gatewayRuntimeTurnRequestSchema>;
export type GatewayRuntimeTurnResponse = z.infer<typeof gatewayRuntimeTurnResponseSchema>;
export type KnowledgeBuildStatus = z.infer<typeof knowledgeBuildStatusSchema>;
export type RuntimeEntryMode = z.infer<typeof runtimeEntryModeSchema>;
export type RuntimeMode = z.infer<typeof runtimeModeSchema>;
export type PackStatus = z.infer<typeof packStatusSchema>;
export type SourceChannel = z.infer<typeof sourceChannelSchema>;
export type SourceKind = z.infer<typeof sourceKindSchema>;
export type SourceAuthority = z.infer<typeof sourceAuthoritySchema>;
export type OverrideType = z.infer<typeof overrideTypeSchema>;
export type ConfigArtifactStatus = z.infer<typeof configArtifactStatusSchema>;
export type GuardrailMode = z.infer<typeof guardrailModeSchema>;
export type ReviewMode = z.infer<typeof reviewModeSchema>;
export type ReadinessStatus = z.infer<typeof readinessStatusSchema>;
