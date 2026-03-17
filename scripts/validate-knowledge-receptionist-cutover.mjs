import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

import { ensureTables, getPool } from "../pages/api/_lib/db.js";
import { syncCanonicalKnowledgePacks } from "../pages/api/_lib/knowledgeReceptionistPacks.js";

import onboardHandler from "../pages/api/v1/tenants/onboard.js";
import businessCallIntentHandler from "../pages/api/v1/knowledge/business-call-intent.js";
import runtimeProfileHandler from "../pages/api/v1/knowledge/runtime-profile.js";
import callOutcomeSchemaHandler from "../pages/api/v1/knowledge/call-outcome-schema.js";
import setupInterviewHandler from "../pages/api/v1/knowledge/setup-interview.js";
import uploadedDocumentsHandler from "../pages/api/v1/knowledge/uploaded-documents.js";
import overridesHandler from "../pages/api/v1/knowledge/overrides.js";
import guardrailsHandler from "../pages/api/v1/knowledge/guardrails.js";
import readinessHandler from "../pages/api/v1/knowledge/readiness.js";
import buildsHandler from "../pages/api/v1/knowledge/builds/index.js";
import publishBuildHandler from "../pages/api/v1/knowledge/builds/[buildId]/publish.js";
import promptHandler from "../pages/api/v1/gateway/prompt.js";
import { assembleKnowledgeRuntimeTurn } from "../pages/api/_lib/knowledgeReceptionistPrompt.js";

const { Pool } = pg;

const REPO_ROOT = process.cwd();
const LEGACY_ROUTE_FILES = [
  "pages/api/v1/knowledge.js",
  "pages/api/v1/knowledge/query.js",
  "pages/api/v1/knowledge/feedback.js",
  "pages/api/v1/knowledge/review-feedback.js",
  "pages/api/v1/assistant/status.js",
  "pages/api/v1/config/agent.js",
  "pages/api/v1/agent.js",
  "pages/api/v1/admin/industries.js",
  "pages/api/v1/gateway/runtime-bundle.js",
  "pages/api/_lib/knowledge.js",
  "pages/api/_lib/knowledgeReview.js",
  "pages/api/_lib/agentConfig.js",
  "pages/api/_lib/setupReadiness.js",
  "pages/api/_lib/industryKnowledge.js"
];
const LEGACY_TABLES = [
  "site_crawls",
  "site_pages",
  "site_sections",
  "site_topics",
  "knowledge_coverage_checks",
  "knowledge_entries",
  "knowledge_card_facts",
  "knowledge_feedback_events",
  "guardrail_question_tests",
  "agents",
  "agent_versions",
  "industry_prompts",
  "industry_knowledge_entries",
  "industry_guardrail_question_templates",
  "knowledge_runtime_settings",
  "knowledge_overrides_v2",
  "knowledge_guardrails_v2",
  "call_states_v2"
];

function createMockRes() {
  const headers = {};
  let statusCode = 200;
  let body = undefined;
  return {
    headers,
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
      return this;
    },
    get result() {
      return { statusCode, body, headers };
    }
  };
}

async function invokeHandler(handler, { method = "GET", query = {}, body = undefined, headers = {} } = {}) {
  const req = { method, query, body, headers };
  const res = createMockRes();
  await handler(req, res);
  return res.result;
}

function cookieFromHeaders(headers) {
  const raw = headers["set-cookie"];
  if (!raw) return "";
  if (Array.isArray(raw)) {
    return raw.map((chunk) => String(chunk).split(";")[0]).join("; ");
  }
  return String(raw).split(";")[0];
}

async function resetDatabase(connectionString) {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO PUBLIC");
  } finally {
    client.release();
    await pool.end();
  }
}

async function readMigrations(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function applyMigrations(pool) {
  const migrationsDir = path.join(REPO_ROOT, "migrations");
  const migrationNames = await readMigrations(migrationsDir);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const appliedRes = await client.query(`SELECT name FROM schema_migrations`);
    const applied = new Set(appliedRes.rows.map((row) => String(row.name)));

    for (const migrationName of migrationNames) {
      if (applied.has(migrationName)) continue;
      const sql = await fs.readFile(path.join(migrationsDir, migrationName), "utf8");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [migrationName]);
    }

    await client.query("COMMIT");
    return migrationNames;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function assertLegacyTablesDropped(pool) {
  const res = await pool.query(
    `SELECT name, to_regclass(name) AS regclass
     FROM unnest($1::text[]) AS name`,
    [LEGACY_TABLES]
  );
  const present = res.rows.filter((row) => row.regclass);
  assert.equal(present.length, 0, `Legacy tables still present: ${present.map((row) => row.name).join(", ")}`);
  return res.rows.reduce((acc, row) => ({ ...acc, [row.name]: row.regclass }), {});
}

async function assertLegacyFilesRemoved() {
  const results = {};
  for (const relativePath of LEGACY_ROUTE_FILES) {
    try {
      await fs.access(path.join(REPO_ROOT, relativePath));
      results[relativePath] = true;
    } catch {
      results[relativePath] = false;
    }
  }
  const remaining = Object.entries(results).filter(([, exists]) => exists).map(([filePath]) => filePath);
  assert.equal(remaining.length, 0, `Legacy files still present: ${remaining.join(", ")}`);
  return results;
}

async function assertSinglePathCode() {
  const promptSource = await fs.readFile(path.join(REPO_ROOT, "pages/api/v1/gateway/prompt.js"), "utf8");
  const serverSource = await fs.readFile(path.join(REPO_ROOT, "apps/call-gateway/src/server.ts"), "utf8");
  const runtimeSource = await fs.readFile(path.join(REPO_ROOT, "apps/call-gateway/src/knowledgeRuntime.ts"), "utf8");

  const forbiddenMatches = {
    prompt_runtime_path: promptSource.includes("runtime_path"),
    prompt_tenant_knowledge: promptSource.includes("tenant_knowledge"),
    server_legacy_payload: serverSource.includes("LegacyGatewayPromptPayload"),
    server_tenant_knowledge: serverSource.includes("tenant_knowledge"),
    server_runtime_bundle_route: serverSource.includes("runtime-bundle"),
    runtime_legacy_prompt_union: runtimeSource.includes("tenant_knowledge")
  };
  const present = Object.entries(forbiddenMatches).filter(([, found]) => found);
  assert.equal(present.length, 0, `Legacy runtime markers still present: ${present.map(([key]) => key).join(", ")}`);
  return forbiddenMatches;
}

async function startFixtureSite() {
  const downloadableText = [
    "After-hours: urgent leaks route to the on-call manager at 206-555-0144.",
    "Pricing is confirmed after technician assessment.",
    "Service area includes Seattle, Bellevue, Kirkland, and Redmond."
  ].join("\n");

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    if (pathname === "/files/after-hours.txt") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(downloadableText);
      return;
    }
    const pages = {
      "/": `<!doctype html><html><head><title>North Sound Plumbing</title></head><body>
        <h1>North Sound Plumbing</h1>
        <p>Drain cleaning, leak repair, and water heater service across Seattle and the Eastside.</p>
        <p>We answer every call, collect callback details, and route urgent issues for review.</p>
        <a href="/services">Services</a>
        <a href="/coverage">Coverage</a>
        <a href="/files/after-hours.txt">After Hours Policy</a>
      </body></html>`,
      "/services": `<!doctype html><html><head><title>Services</title></head><body>
        <h1>Services</h1>
        <p>Drain cleaning, leak repair, sewer inspection, tankless install, and water heater replacement.</p>
        <p>Emergency leak calls are prioritized for rapid callback review.</p>
      </body></html>`,
      "/coverage": `<!doctype html><html><head><title>Coverage</title></head><body>
        <h1>Coverage</h1>
        <p>We serve Seattle, Bellevue, Kirkland, and Redmond for plumbing calls.</p>
        <p>Callbacks are available Monday through Friday from 8 AM to 6 PM.</p>
      </body></html>`
    };
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pages[pathname] || pages["/"]);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  };
}

async function importGatewayRuntime() {
  const moduleUrl = pathToFileURL(path.join(REPO_ROOT, "apps/call-gateway/dist/apps/call-gateway/src/knowledgeRuntime.js")).href;
  return import(moduleUrl);
}

function joinTurnText(turn) {
  return [
    ...(turn.selectedCards || []).map((item) => item.canonical_name || item.speakable_summary || ""),
    ...(turn.selectedFacts || [])
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGatewayTurn(turn) {
  return {
    runtimeMode: turn.runtime_bundle.runtime_mode,
    matchedOverrides: turn.matched_overrides || [],
    matchedGuardrails: turn.matched_guardrails || [],
    selectedCards: turn.runtime_bundle.selected_cards || [],
    selectedFacts: (turn.runtime_bundle.selected_answer_facts || []).map((item) => item.claim),
    callState: turn.call_state,
    retrievalTelemetry: turn.retrieval_telemetry,
    tokenCounts: turn.token_counts
  };
}

function normalizeAppTurn(turn) {
  return {
    runtimeMode: turn.runtimeBundle.runtime_mode,
    matchedOverrides: turn.matchedOverrides || [],
    matchedGuardrails: turn.matchedGuardrails || [],
    selectedCards: turn.runtimeBundle.selected_cards || [],
    selectedFacts: (turn.runtimeBundle.selected_answer_facts || []).map((item) => item.claim),
    callState: turn.callState,
    retrievalTelemetry: turn.retrievalTelemetry,
    tokenCounts: turn.tokenCounts
  };
}

function assertNoFalsePolicyMatches(turn, label) {
  assert.equal(turn.matchedOverrides.length, 0, `${label}: unexpected override match`);
  assert.equal(turn.matchedGuardrails.length, 0, `${label}: unexpected guardrail match`);
}

function assertRuntimeMode(turn, expectedMode, label) {
  assert.equal(turn.runtimeMode, expectedMode, `${label}: expected runtime mode ${expectedMode}`);
}

function assertTurnIncludes(turn, expectedFragments, label) {
  const haystack = joinTurnText(turn);
  assert(
    expectedFragments.some((fragment) => haystack.includes(String(fragment).toLowerCase())),
    `${label}: expected one of ${expectedFragments.join(", ")} in selected cards/facts`
  );
}

function assertTurnExcludes(turn, unexpectedFragments, label) {
  const haystack = joinTurnText(turn);
  for (const fragment of unexpectedFragments) {
    const normalizedFragment = String(fragment).toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
    assert(!haystack.includes(normalizedFragment), `${label}: unexpected fragment ${fragment}`);
  }
}

function assertSelectedCardsExclude(turn, unexpectedFragments, label) {
  const selectedNames = (turn.selectedCards || [])
    .map((item) => String(item.canonical_name || item.speakable_summary || ""))
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const fragment of unexpectedFragments) {
    const normalizedFragment = String(fragment).toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
    assert(!selectedNames.includes(normalizedFragment), `${label}: unexpected selected card ${fragment}`);
  }
}

function assertPrimaryCardIncludes(turn, expectedFragments, label) {
  const primary = String(turn.selectedCards?.[0]?.canonical_name || turn.selectedCards?.[0]?.speakable_summary || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  assert(
    expectedFragments.some((fragment) => primary.includes(String(fragment).toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim())),
    `${label}: expected primary selected card to include one of ${expectedFragments.join(", ")}`
  );
}

function summarizeTurn(turn) {
  return {
    runtimeMode: turn.runtimeMode,
    matchedOverrides: turn.matchedOverrides.map((item) => item.title || item.knowledge_override_id || "override"),
    matchedGuardrails: turn.matchedGuardrails.map((item) => item.guardrail_type || item.knowledge_guardrail_id || "guardrail"),
    selectedCards: turn.selectedCards.map((item) => item.canonical_name),
    selectedFacts: turn.selectedFacts,
    retrievalTelemetry: turn.retrievalTelemetry,
    tokenCounts: turn.tokenCounts
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  assert(databaseUrl, "DATABASE_URL is required");
  process.env.CALL_SUMMARY_TOKEN ||= "knowledge-cutover-validation-token";

  const summary = {
    reset: {},
    migrations: [],
    legacyFiles: {},
    legacyTables: {},
    codeSweep: {},
    packSeeding: {},
    onboarding: {},
    businessCallIntent: {},
    runtimeProfile: {},
    callOutcomeSchema: {},
    setupInterview: {},
    uploadedDocument: {},
    overrides: {},
    guardrails: {},
    builds: {},
    prompt: {},
    runtime: {},
    runtimeQuality: {},
    callState: {},
    readiness: {}
  };

  const site = await startFixtureSite();
  let sharedPool = null;
  try {
    await resetDatabase(databaseUrl);
    summary.reset.completed = true;
    console.error("phase:reset");

    const pool = getPool();
    sharedPool = pool;
    assert(pool, "Shared pool is unavailable");
    await ensureTables(pool);
    summary.migrations = await applyMigrations(pool);
    const packRun = await syncCanonicalKnowledgePacks(pool);
    summary.packSeeding = packRun;
    console.error("phase:migrations_and_packs");

    summary.legacyFiles = await assertLegacyFilesRemoved();
    summary.legacyTables = await assertLegacyTablesDropped(pool);
    summary.codeSweep = await assertSinglePathCode();
    console.error("phase:legacy_cleanup_checks");

    const onboardRes = await invokeHandler(onboardHandler, {
      method: "POST",
      body: {
        businessName: "North Sound Plumbing",
        industry: "plumbing",
        ownerName: "Nora Owner",
        ownerEmail: "north.sound.owner@example.test",
        password: "Password123!",
        website: site.url,
        phone: "+12065550100",
        serviceArea: "Seattle, Bellevue, Kirkland, Redmond",
        address: "100 Main St, Seattle, WA 98101",
        timezone: "America/Los_Angeles",
        businessHours: "Mon-Fri 8 AM - 6 PM",
        greetingText: "Thanks for calling North Sound Plumbing. How can I help?",
        bootstrapMode: "website_first"
      }
    });
    assert.equal(onboardRes.statusCode, 200, JSON.stringify(onboardRes.body));
    const tenantKey = onboardRes.body?.tenantKey;
    assert(tenantKey, "tenantKey missing from onboarding response");
    const cookie = cookieFromHeaders(onboardRes.headers);
    assert(cookie.includes("everycall_session="), "missing session cookie after onboarding");
    summary.onboarding = {
      tenantKey,
      assignments: onboardRes.body?.assignments || [],
      bootstrapMode: onboardRes.body?.bootstrapMode
    };
    console.error("phase:onboarding");

    const businessIntentRes = await invokeHandler(businessCallIntentHandler, {
      method: "POST",
      query: { tenantKey },
      headers: { cookie },
      body: {
        intent: {
          businessCallIntentId: onboardRes.body?.businessCallIntent?.business_call_intent_id,
          status: "approved_live",
          primaryGoal: "Welcome callers, answer directly from approved business truth, and move toward the next supported step.",
          secondaryGoals: onboardRes.body?.businessCallIntent?.secondary_goals_json || [],
          preferredOutcomes: ["callback_request", "message_taken", "transfer"],
          disallowedOutcomes: onboardRes.body?.businessCallIntent?.disallowed_outcomes_json || [],
          toneRules: [
            "Be clear, short, and helpful on every turn.",
            "Answer direct questions before continuing the script.",
            "Ask one question at a time."
          ],
          salesStyle: onboardRes.body?.businessCallIntent?.sales_style_json || {},
          disclosureStrategy: onboardRes.body?.businessCallIntent?.disclosure_strategy_json || {},
          handoffStrategy: onboardRes.body?.businessCallIntent?.handoff_strategy_json || {},
          afterHoursStrategy: onboardRes.body?.businessCallIntent?.after_hours_strategy_json || {},
          greetingConfig: onboardRes.body?.businessCallIntent?.greeting_config_json || {},
          terminologyPreferences: onboardRes.body?.businessCallIntent?.terminology_preferences_json || {},
          conversationStagePlaybook: onboardRes.body?.businessCallIntent?.conversation_stage_playbook_json || []
        }
      }
    });
    assert.equal(businessIntentRes.statusCode, 200, JSON.stringify(businessIntentRes.body));
    summary.businessCallIntent = {
      id: businessIntentRes.body?.intent?.business_call_intent_id,
      primaryGoal: businessIntentRes.body?.intent?.primary_goal
    };

    const runtimeProfileRes = await invokeHandler(runtimeProfileHandler, {
      method: "POST",
      query: { tenantKey },
      headers: { cookie },
      body: {
        profile: {
          greetingText: "Thanks for calling North Sound Plumbing. Tell me what you need.",
          sessionConfig: { voice: "marin" },
          wordingDefaults: {
            aiDisclosure: "I'm North Sound Plumbing's automated assistant.",
            uncertaintyPhrase: "I want to make sure I get that right.",
            pricingFallback: "I can help with the next step, but final pricing is confirmed after assessment.",
            closingPhrase: "I'll make sure the team has that."
          }
        }
      }
    });
    assert.equal(runtimeProfileRes.statusCode, 200, JSON.stringify(runtimeProfileRes.body));
    summary.runtimeProfile = {
      greeting: runtimeProfileRes.body?.profile?.greeting_text,
      voice: runtimeProfileRes.body?.profile?.session_config?.voice
    };

    const outcomeSchemaRes = await invokeHandler(callOutcomeSchemaHandler, {
      method: "POST",
      query: { tenantKey },
      headers: { cookie },
      body: {
        schema: {
          callOutcomeSchemaId: onboardRes.body?.callOutcomeSchema?.call_outcome_schema_id,
          status: "approved_live",
          outcomeTypes: ["callback_request", "message_taken", "transfer"],
          requiredFieldsByOutcome: {
            callback_request: ["first_name", "callback_number", "service_request"],
            message_taken: ["first_name", "callback_number", "service_request"],
            transfer: ["first_name", "callback_number"]
          },
          optionalFieldsByOutcome: {
            callback_request: ["requested_date", "requested_time"],
            message_taken: ["requested_date"],
            transfer: ["service_request"]
          },
          summaryTemplate: "Outcome: {outcome_type}"
        }
      }
    });
    assert.equal(outcomeSchemaRes.statusCode, 200, JSON.stringify(outcomeSchemaRes.body));
    summary.callOutcomeSchema = {
      id: outcomeSchemaRes.body?.schema?.call_outcome_schema_id,
      outcomeTypes: outcomeSchemaRes.body?.schema?.outcome_types_json || []
    };

    const setupInterviewRes = await invokeHandler(setupInterviewHandler, {
      method: "POST",
      query: { tenantKey },
      headers: { cookie },
      body: {
        intent: {
          status: "approved_live",
          primaryGoal: "Confirm after-hours and service-area facts before launch.",
          requiredCaptureCategories: ["after_hours", "service_area"]
        },
        session: {
          completionStatus: "completed",
          rawTranscriptText: "After-hours calls go to the on-call manager, and the business covers Seattle, Bellevue, Kirkland, and Redmond.",
          confirmedSummaryBlocks: [
            {
              title: "After Hours Routing",
              summaryText: "After-hours urgent plumbing calls route to the on-call manager at 206-555-0144."
            },
            {
              title: "Service Area",
              summaryText: "North Sound Plumbing serves Seattle, Bellevue, Kirkland, and Redmond."
            }
          ]
        }
      }
    });
    assert.equal(setupInterviewRes.statusCode, 200, JSON.stringify(setupInterviewRes.body));
    summary.setupInterview = {
      intentId: setupInterviewRes.body?.intent?.setup_interview_intent_id,
      sessionId: setupInterviewRes.body?.session?.setup_interview_session_id,
      summaryBlockCount: setupInterviewRes.body?.summaryBlocks?.length || 0
    };

    const uploadedDocumentRes = await invokeHandler(uploadedDocumentsHandler, {
      method: "POST",
      query: { tenantKey },
      headers: { cookie },
      body: {
        document: {
          title: "Warranty And Financing",
          filename: "warranty-and-financing.txt",
          mimeType: "text/plain",
          documentClass: "policy",
          fileBase64: Buffer.from(
            "Warranty details are confirmed after the completed service visit. Financing may be discussed on site after technician assessment.",
            "utf8"
          ).toString("base64")
        }
      }
    });
    assert.equal(uploadedDocumentRes.statusCode, 200, JSON.stringify(uploadedDocumentRes.body));
    summary.uploadedDocument = {
      id: uploadedDocumentRes.body?.document?.uploaded_document_id,
      parseMethod: uploadedDocumentRes.body?.document?.metadata_json?.parse_method || null
    };

    const overrideRes = await invokeHandler(overridesHandler, {
      method: "POST",
      query: { tenantKey },
      headers: { cookie },
      body: {
        override: {
          status: "approved_live",
          overrideType: "temporary_notice",
          priority: 10,
          title: "After Hours Hotline",
          body: "After-hours urgent calls should mention the on-call manager number 206-555-0144.",
          appliesToDomains: ["service_business"],
          appliesToSubdomains: ["service_business.plumbing"]
        }
      }
    });
    assert.equal(overrideRes.statusCode, 200, JSON.stringify(overrideRes.body));
    summary.overrides = {
      id: overrideRes.body?.override?.knowledge_override_id,
      type: overrideRes.body?.override?.override_type
    };

    const guardrailRes = await invokeHandler(guardrailsHandler, {
      method: "POST",
      query: { tenantKey },
      headers: { cookie },
      body: {
        guardrail: {
          status: "approved_live",
          guardrailType: "dangerous_question",
          triggerPatterns: ["drano", "chemical drain cleaner", "repair it myself"],
          riskLevel: "high",
          mode: "handoff",
          approvedResponsePattern: "I can't advise on that directly, but I can help get your details to the team.",
          requiredNextStep: "capture_callback",
          appliesToDomains: ["service_business"],
          appliesToSubdomains: ["service_business.plumbing"]
        }
      }
    });
    assert.equal(guardrailRes.statusCode, 200, JSON.stringify(guardrailRes.body));
    summary.guardrails = {
      id: guardrailRes.body?.guardrail?.knowledge_guardrail_id,
      mode: guardrailRes.body?.guardrail?.mode
    };
    console.error("phase:tenant_configuration");

    const buildRes = await invokeHandler(buildsHandler, {
      method: "POST",
      query: { tenantKey },
      headers: { cookie },
      body: {
        websiteUrl: site.url,
        uploadedDocumentIds: [summary.uploadedDocument.id],
        setupInterviewSessionIds: [summary.setupInterview.sessionId]
      }
    });
    assert.equal(buildRes.statusCode, 200, JSON.stringify(buildRes.body));
    const buildId = buildRes.body?.build?.build_id;
    assert(buildId, "build id missing");
    assert.equal(buildRes.body?.build?.status, "ready_to_publish");
    summary.builds.created = {
      buildId,
      status: buildRes.body?.build?.status,
      artifactCounts: buildRes.body?.build?.artifact_counts_json,
      warnings: buildRes.body?.build?.warnings_json || [],
      sourceChannels: buildRes.body?.build?.source_channels_json || []
    };
    console.error("phase:build_created");

    const publishRes = await invokeHandler(publishBuildHandler, {
      method: "POST",
      query: { tenantKey, buildId },
      headers: { cookie }
    });
    assert.equal(publishRes.statusCode, 200, JSON.stringify(publishRes.body));
    assert.equal(publishRes.body?.cache_prewarmed, true);
    summary.builds.published = publishRes.body;
    console.error("phase:build_published");

    const readinessRes = await invokeHandler(readinessHandler, {
      method: "POST",
      query: { tenantKey },
      headers: { cookie },
      body: {
        checklist: {
          hours_confirmed: true,
          address_confirmed: true,
          phone_confirmed: true,
          after_hours_configured: true,
          service_area_confirmed: true,
          dangerous_question_reviewed: true,
          hard_overrides_reviewed: true,
          temporary_notices_checked: true,
          approved_answer_snippets_reviewed: true,
          sample_calls_passed: true,
          handoff_path_tested: true,
          outcome_capture_tested: true,
          pack_eval_suites_passed: true
        }
      }
    });
    assert.equal(readinessRes.statusCode, 200, JSON.stringify(readinessRes.body));
    summary.readiness = readinessRes.body?.readiness || null;
    assert.ok(
      ["ready_for_go_live", "live"].includes(summary.readiness?.status),
      JSON.stringify(summary.readiness)
    );
    console.error("phase:readiness");

    const promptRes = await invokeHandler(promptHandler, {
      method: "POST",
      headers: { "x-everycall-internal": process.env.CALL_SUMMARY_TOKEN },
      body: {
        tenantKey,
        callSid: "CALL_CUTOVER_VALIDATION_1"
      }
    });
    assert.equal(promptRes.statusCode, 200, JSON.stringify(promptRes.body));
    assert.equal(promptRes.body?.knowledge_runtime?.active_build_id, buildId);
    summary.prompt = {
      buildId: promptRes.body?.knowledge_runtime?.active_build_id,
      greeting: promptRes.body?.tenant_greeting,
      promptTokens: promptRes.body?.knowledge_runtime?.token_counts?.prompt_payload_tokens || 0,
      startupTokens: promptRes.body?.knowledge_runtime?.token_counts?.startup_instruction_tokens || 0
    };
    console.error("phase:prompt");

    const gatewayRuntime = await importGatewayRuntime();
    const promptPayload = gatewayRuntime.validateGatewayPromptPayload(promptRes.body);
    const sessionInstructions = gatewayRuntime.buildGatewaySessionInstructions(promptPayload);
    let callState = gatewayRuntime.initializeKnowledgeCallState(promptPayload);
    await gatewayRuntime.persistKnowledgeCallState(pool, tenantKey, "call_cutover_1", callState, { phase: "initial" });
    const prewarm = await gatewayRuntime.prewarmKnowledgeBuildAssets(pool, tenantKey, buildId);
    assert.equal(prewarm.fetchMs >= 0, true);

    const afterHoursTurn = await gatewayRuntime.fetchKnowledgeRuntimeTurn(pool, promptPayload, {
      tenantKey,
      callId: "call_cutover_1",
      query: "Who handles calls after hours?",
      callState
    });
    callState = gatewayRuntime.mergeRuntimeTurnState(callState, afterHoursTurn);
    await gatewayRuntime.persistKnowledgeCallState(pool, tenantKey, "call_cutover_1", callState, { phase: "after_hours" });

    const guardrailTurn = await gatewayRuntime.fetchKnowledgeRuntimeTurn(pool, promptPayload, {
      tenantKey,
      callId: "call_cutover_1",
      query: "Should I pour Drano into the drain myself?",
      callState
    });
    callState = gatewayRuntime.mergeRuntimeTurnState(callState, guardrailTurn);
    await gatewayRuntime.persistKnowledgeCallState(pool, tenantKey, "call_cutover_1", callState, { phase: "guardrail" });

    const callStateRes = await pool.query(
      `SELECT current_stage, runtime_entry_mode, last_bundle_id, captured_fields_json, metadata_json
       FROM call_states
       WHERE call_id = $1
       LIMIT 1`,
      ["call_cutover_1"]
    );
    assert.equal(callStateRes.rowCount, 1, "call state row missing");

    summary.runtime = {
      sessionInstructionLength: sessionInstructions.length,
      prewarm,
      afterHours: {
        runtimeMode: afterHoursTurn.runtime_bundle.runtime_mode,
        matchedOverrides: afterHoursTurn.matched_overrides.map((item) => item.title),
        bundleTokens: afterHoursTurn.token_counts.runtime_bundle_tokens,
        promptTokens: afterHoursTurn.token_counts.prompt_payload_tokens
      },
      dangerousQuestion: {
        runtimeMode: guardrailTurn.runtime_bundle.runtime_mode,
        matchedGuardrails: guardrailTurn.matched_guardrails.map((item) => item.guardrail_type),
        bundleTokens: guardrailTurn.token_counts.runtime_bundle_tokens,
        promptTokens: guardrailTurn.token_counts.prompt_payload_tokens
      }
    };
    summary.callState = callStateRes.rows[0];

    assert(summary.runtime.afterHours.matchedOverrides.length > 0, "Expected after-hours override to match");
    assert(summary.runtime.dangerousQuestion.matchedGuardrails.length > 0, "Expected dangerous-question guardrail to match");

    const gatewayNormalTurnRaw = await gatewayRuntime.fetchKnowledgeRuntimeTurn(pool, promptPayload, {
      tenantKey,
      callId: "call_cutover_quality_gateway_normal",
      query: "Do you replace water heaters?",
      callState: gatewayRuntime.initializeKnowledgeCallState(promptPayload)
    });
    const gatewayNormalTurn = normalizeGatewayTurn(gatewayNormalTurnRaw);
    assertNoFalsePolicyMatches(gatewayNormalTurn, "gateway normal service");
    assertRuntimeMode(gatewayNormalTurn, "answer", "gateway normal service");
    assertPrimaryCardIncludes(gatewayNormalTurn, ["water heater", "services", "north sound plumbing"], "gateway normal service");
    assertTurnIncludes(gatewayNormalTurn, ["water heater", "replacement", "tankless"], "gateway normal service");
    assertSelectedCardsExclude(gatewayNormalTurn, ["after-hours"], "gateway normal service");
    assertTurnExcludes(gatewayNormalTurn, ["after-hours", "dangerous question"], "gateway normal service");

    const gatewayServiceAreaRaw = await gatewayRuntime.fetchKnowledgeRuntimeTurn(pool, promptPayload, {
      tenantKey,
      callId: "call_cutover_quality_gateway_area",
      query: "Do you serve Bellevue?",
      callState: gatewayRuntime.initializeKnowledgeCallState(promptPayload)
    });
    const gatewayServiceAreaTurn = normalizeGatewayTurn(gatewayServiceAreaRaw);
    assertNoFalsePolicyMatches(gatewayServiceAreaTurn, "gateway service area");
    assertRuntimeMode(gatewayServiceAreaTurn, "answer", "gateway service area");
    assertPrimaryCardIncludes(gatewayServiceAreaTurn, ["service area", "coverage", "geographic coverage", "cities served"], "gateway service area");
    assertTurnIncludes(gatewayServiceAreaTurn, ["bellevue", "service area", "serve"], "gateway service area");
    assertSelectedCardsExclude(gatewayServiceAreaTurn, ["after-hours"], "gateway service area");
    assertTurnExcludes(gatewayServiceAreaTurn, ["after-hours"], "gateway service area");

    let gatewayFollowState = gatewayRuntime.initializeKnowledgeCallState(promptPayload);
    const gatewayFollowBase = normalizeGatewayTurn(await gatewayRuntime.fetchKnowledgeRuntimeTurn(pool, promptPayload, {
      tenantKey,
      callId: "call_cutover_quality_gateway_follow",
      query: "Do you replace water heaters?",
      callState: gatewayFollowState
    }));
    gatewayFollowState = gatewayRuntime.mergeRuntimeTurnState(gatewayFollowState, gatewayNormalTurnRaw);
    const gatewayFollowTanklessRaw = await gatewayRuntime.fetchKnowledgeRuntimeTurn(pool, promptPayload, {
      tenantKey,
      callId: "call_cutover_quality_gateway_follow",
      query: "What about tankless ones?",
      callState: gatewayFollowState
    });
    const gatewayFollowTankless = normalizeGatewayTurn(gatewayFollowTanklessRaw);
    assertNoFalsePolicyMatches(gatewayFollowTankless, "gateway follow-up tankless");
    assertRuntimeMode(gatewayFollowTankless, "answer", "gateway follow-up tankless");
    assertPrimaryCardIncludes(gatewayFollowTankless, ["tankless", "water heater", "services", "north sound plumbing"], "gateway follow-up tankless");
    assertTurnIncludes(gatewayFollowTankless, ["tankless", "water heater"], "gateway follow-up tankless");

    gatewayFollowState = gatewayRuntime.mergeRuntimeTurnState(gatewayFollowState, gatewayFollowTanklessRaw);
    const gatewayFollowBellevue = normalizeGatewayTurn(await gatewayRuntime.fetchKnowledgeRuntimeTurn(pool, promptPayload, {
      tenantKey,
      callId: "call_cutover_quality_gateway_follow",
      query: "And Bellevue?",
      callState: gatewayFollowState
    }));
    assertNoFalsePolicyMatches(gatewayFollowBellevue, "gateway follow-up bellevue");
    assertRuntimeMode(gatewayFollowBellevue, "answer", "gateway follow-up bellevue");
    assertPrimaryCardIncludes(gatewayFollowBellevue, ["service area", "coverage", "geographic coverage", "cities served"], "gateway follow-up bellevue");
    assertTurnIncludes(gatewayFollowBellevue, ["bellevue", "service area", "serve"], "gateway follow-up bellevue");
    assertSelectedCardsExclude(gatewayFollowBellevue, ["after-hours"], "gateway follow-up bellevue");
    assertTurnExcludes(gatewayFollowBellevue, ["after-hours"], "gateway follow-up bellevue");

    const appNormalTurn = normalizeAppTurn(await assembleKnowledgeRuntimeTurn(pool, tenantKey, {
      callId: "call_cutover_quality_app_normal",
      query: "Do you replace water heaters?",
      runtimeEntryMode: "customer_call"
    }));
    assertNoFalsePolicyMatches(appNormalTurn, "app normal service");
    assertRuntimeMode(appNormalTurn, "answer", "app normal service");
    assertPrimaryCardIncludes(appNormalTurn, ["water heater", "services", "north sound plumbing"], "app normal service");
    assertTurnIncludes(appNormalTurn, ["water heater", "replacement", "tankless"], "app normal service");
    assertSelectedCardsExclude(appNormalTurn, ["after-hours"], "app normal service");
    assertTurnExcludes(appNormalTurn, ["after-hours"], "app normal service");

    const appServiceAreaTurn = normalizeAppTurn(await assembleKnowledgeRuntimeTurn(pool, tenantKey, {
      callId: "call_cutover_quality_app_area",
      query: "Do you serve Bellevue?",
      runtimeEntryMode: "customer_call"
    }));
    assertNoFalsePolicyMatches(appServiceAreaTurn, "app service area");
    assertRuntimeMode(appServiceAreaTurn, "answer", "app service area");
    assertPrimaryCardIncludes(appServiceAreaTurn, ["service area", "coverage", "geographic coverage", "cities served"], "app service area");
    assertTurnIncludes(appServiceAreaTurn, ["bellevue", "service area", "serve"], "app service area");
    assertSelectedCardsExclude(appServiceAreaTurn, ["after-hours"], "app service area");
    assertTurnExcludes(appServiceAreaTurn, ["after-hours"], "app service area");

    const appFollowBase = normalizeAppTurn(await assembleKnowledgeRuntimeTurn(pool, tenantKey, {
      callId: "call_cutover_quality_app_follow",
      query: "Do you replace water heaters?",
      runtimeEntryMode: "customer_call"
    }));
    const appFollowTankless = normalizeAppTurn(await assembleKnowledgeRuntimeTurn(pool, tenantKey, {
      callId: "call_cutover_quality_app_follow",
      query: "What about tankless ones?",
      runtimeEntryMode: "customer_call",
      callState: appFollowBase.callState
    }));
    assertNoFalsePolicyMatches(appFollowTankless, "app follow-up tankless");
    assertRuntimeMode(appFollowTankless, "answer", "app follow-up tankless");
    assertPrimaryCardIncludes(appFollowTankless, ["tankless", "water heater", "services", "north sound plumbing"], "app follow-up tankless");
    assertTurnIncludes(appFollowTankless, ["tankless", "water heater"], "app follow-up tankless");

    const appFollowBellevue = normalizeAppTurn(await assembleKnowledgeRuntimeTurn(pool, tenantKey, {
      callId: "call_cutover_quality_app_follow",
      query: "And Bellevue?",
      runtimeEntryMode: "customer_call",
      callState: appFollowTankless.callState
    }));
    assertNoFalsePolicyMatches(appFollowBellevue, "app follow-up bellevue");
    assertRuntimeMode(appFollowBellevue, "answer", "app follow-up bellevue");
    assertPrimaryCardIncludes(appFollowBellevue, ["service area", "coverage", "geographic coverage", "cities served"], "app follow-up bellevue");
    assertTurnIncludes(appFollowBellevue, ["bellevue", "service area", "serve"], "app follow-up bellevue");
    assertSelectedCardsExclude(appFollowBellevue, ["after-hours"], "app follow-up bellevue");
    assertTurnExcludes(appFollowBellevue, ["after-hours"], "app follow-up bellevue");

    summary.runtimeQuality = {
      gateway: {
        normalService: summarizeTurn(gatewayNormalTurn),
        serviceArea: summarizeTurn(gatewayServiceAreaTurn),
        followUpBase: summarizeTurn(gatewayFollowBase),
        followUpTankless: summarizeTurn(gatewayFollowTankless),
        followUpBellevue: summarizeTurn(gatewayFollowBellevue)
      },
      app: {
        normalService: summarizeTurn(appNormalTurn),
        serviceArea: summarizeTurn(appServiceAreaTurn),
        followUpBase: summarizeTurn(appFollowBase),
        followUpTankless: summarizeTurn(appFollowTankless),
        followUpBellevue: summarizeTurn(appFollowBellevue)
      }
    };
    console.error("phase:runtime");

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await site.close();
    if (sharedPool && typeof sharedPool.end === "function") {
      await sharedPool.end();
      delete globalThis.__everycallPool;
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
