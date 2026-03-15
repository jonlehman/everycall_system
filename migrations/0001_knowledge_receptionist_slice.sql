CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS domain_packs (
  id BIGSERIAL PRIMARY KEY,
  domain_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  description TEXT NOT NULL,
  naics_codes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  intent_catalog_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  entity_catalog_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  page_type_weights_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_class_biases_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ranking_rules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  boundary_rules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  clarification_rules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_stage_guidance_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_prompt_fragments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_eval_suites_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_path TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subdomain_packs (
  id BIGSERIAL PRIMARY KEY,
  subdomain_id TEXT NOT NULL UNIQUE,
  parent_domain_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  description TEXT NOT NULL,
  additional_intents_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  additional_entities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  page_type_weight_deltas_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_class_bias_deltas_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ranking_rule_deltas_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  boundary_rule_deltas_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  clarification_rule_deltas_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  stage_guidance_deltas_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt_fragment_deltas_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_eval_suites_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_path TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subdomain_packs_parent_domain_idx
  ON subdomain_packs (parent_domain_id);

CREATE TABLE IF NOT EXISTS tenant_domain_assignments (
  id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  domain_id TEXT NOT NULL,
  subdomain_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_key, domain_id, subdomain_id)
);

CREATE INDEX IF NOT EXISTS tenant_domain_assignments_tenant_idx
  ON tenant_domain_assignments (tenant_key, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS business_call_intents (
  business_call_intent_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  primary_goal TEXT NOT NULL,
  secondary_goals_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferred_outcomes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  disallowed_outcomes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  tone_rules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sales_style TEXT NOT NULL DEFAULT 'balanced',
  disclosure_strategy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  handoff_strategy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_hours_strategy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  conversation_stage_playbook_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS business_call_intents_tenant_version_idx
  ON business_call_intents (tenant_key, version);

CREATE TABLE IF NOT EXISTS setup_interview_intents (
  setup_interview_intent_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  primary_goal TEXT NOT NULL,
  required_capture_categories_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmation_policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  completion_criteria_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  interview_stage_playbook_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  pause_resume_policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_and_confirm_policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS setup_interview_intents_tenant_version_idx
  ON setup_interview_intents (tenant_key, version);

CREATE TABLE IF NOT EXISTS setup_interview_sessions (
  setup_interview_session_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  setup_interview_intent_id TEXT REFERENCES setup_interview_intents(setup_interview_intent_id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  completion_status TEXT NOT NULL DEFAULT 'in_progress',
  raw_transcript_text TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS setup_interview_sessions_tenant_idx
  ON setup_interview_sessions (tenant_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS setup_interview_summary_blocks (
  id BIGSERIAL PRIMARY KEY,
  setup_interview_session_id TEXT NOT NULL REFERENCES setup_interview_sessions(setup_interview_session_id) ON DELETE CASCADE,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  block_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  confirmation_status TEXT NOT NULL DEFAULT 'confirmed',
  authority_level TEXT NOT NULL DEFAULT 'confirmed_summary',
  source_hash TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (setup_interview_session_id, block_key)
);

CREATE TABLE IF NOT EXISTS source_intake_sessions (
  source_intake_session_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL,
  runtime_entry_mode TEXT NOT NULL DEFAULT 'customer_call',
  status TEXT NOT NULL DEFAULT 'draft',
  website_root_url TEXT,
  source_channels_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  errors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by_type TEXT NOT NULL DEFAULT 'tenant',
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS source_intake_sessions_tenant_idx
  ON source_intake_sessions (tenant_key, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_builds (
  build_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  status TEXT NOT NULL,
  version TEXT NOT NULL,
  domain_assignments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_snapshot_id TEXT,
  source_channels_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  artifact_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  quality_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at TIMESTAMPTZ,
  supersedes_build_id TEXT,
  created_by_type TEXT NOT NULL DEFAULT 'tenant',
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_builds_tenant_idx
  ON knowledge_builds (tenant_key, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_active_knowledge_builds (
  tenant_key TEXT PRIMARY KEY REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  active_build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE RESTRICT,
  previous_build_id TEXT REFERENCES knowledge_builds(build_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_refs (
  source_ref_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  source_intake_session_id TEXT REFERENCES source_intake_sessions(source_intake_session_id) ON DELETE SET NULL,
  source_channel TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_authority TEXT NOT NULL,
  source_locator TEXT NOT NULL,
  title TEXT,
  page_type TEXT,
  content_hash TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS source_refs_build_idx
  ON source_refs (build_id, source_channel);

CREATE TABLE IF NOT EXISTS source_segments (
  id BIGSERIAL PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  source_ref_id TEXT NOT NULL REFERENCES source_refs(source_ref_id) ON DELETE CASCADE,
  heading_path TEXT,
  segment_index INTEGER NOT NULL,
  text_span TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_ref_id, segment_index)
);

CREATE INDEX IF NOT EXISTS source_segments_build_idx
  ON source_segments (build_id, source_ref_id);

CREATE TABLE IF NOT EXISTS knowledge_build_facts (
  knowledge_fact_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  domain_id TEXT NOT NULL,
  subdomain_id TEXT,
  fact_type TEXT NOT NULL,
  object_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_text TEXT NOT NULL,
  normalized_value_json JSONB,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  source_ref_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_class TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'normal',
  claim_text TEXT NOT NULL,
  evidence_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_build_facts_build_idx
  ON knowledge_build_facts (build_id);

CREATE TABLE IF NOT EXISTS knowledge_build_cards (
  knowledge_card_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  domain_id TEXT NOT NULL,
  subdomain_id TEXT,
  card_type TEXT NOT NULL,
  object_type TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  topic_path TEXT,
  intent_tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  entity_tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  caller_phrases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  speakable_summary TEXT NOT NULL,
  answer_facts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  related_card_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_ref_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_class TEXT NOT NULL,
  allowed_uses_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_level TEXT NOT NULL DEFAULT 'normal',
  quality_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  search_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_build_cards_build_idx
  ON knowledge_build_cards (build_id);

CREATE TABLE IF NOT EXISTS knowledge_build_embeddings (
  id BIGSERIAL PRIMARY KEY,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  knowledge_card_id TEXT NOT NULL REFERENCES knowledge_build_cards(knowledge_card_id) ON DELETE CASCADE,
  embedding_model TEXT NOT NULL,
  embedding_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (knowledge_card_id, embedding_model)
);

CREATE TABLE IF NOT EXISTS call_states_v2 (
  call_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  runtime_entry_mode TEXT NOT NULL,
  current_stage TEXT NOT NULL,
  completed_stages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  skipped_stages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_domain_id TEXT,
  active_subdomain_id TEXT,
  active_service TEXT,
  active_location TEXT,
  active_provider TEXT,
  pending_clarifier TEXT,
  last_turn_intent TEXT,
  last_bundle_id TEXT,
  captured_fields_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome_in_progress TEXT,
  uncertainty_mode TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS runtime_bundles (
  runtime_bundle_id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  tenant_key TEXT NOT NULL REFERENCES tenants(tenant_key) ON DELETE CASCADE,
  build_id TEXT NOT NULL REFERENCES knowledge_builds(build_id) ON DELETE CASCADE,
  runtime_entry_mode TEXT NOT NULL,
  runtime_mode TEXT NOT NULL,
  active_domain_id TEXT NOT NULL,
  active_subdomain_id TEXT,
  detected_turn_intent TEXT,
  bundle_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS runtime_bundles_build_idx
  ON runtime_bundles (build_id, created_at DESC);
