import pg from "pg";
import {
  buildKnowledgeHeartCatalogRevision,
  confirmKnowledgeHeartFacts,
  publishKnowledgeHeartCatalog,
  validateKnowledgeHeartText
} from "../pages/api/_lib/knowledgeHeartCatalog.js";
import {
  backfillActiveBuildCoreFacts,
  rewriteCoreFactCatalogCandidatesForSpeech
} from "../pages/api/_lib/knowledgeCoreFacts.js";
import { consolidateCoreFactCatalogCandidates } from "../pages/api/_lib/knowledgeReceptionistCompiler.js";

const { Pool } = pg;
const APPLY_ENV = "EVERYCALL_APPLY_KNOWS_BY_HEART_BACKFILL";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function hasArgument(name) {
  return process.argv.includes(name);
}

const LEGACY_CONFIRMATION_CONFIG = {
  repairs_service: { title: "Repairs and service", category: "repairs_service" },
  estimates: { title: "Estimates and quotes", category: "estimate_policy" },
  service_area: { title: "Service area", category: "service_area" },
  hours: { title: "Business hours", category: "hours" },
  emergency: { title: "Emergency availability", category: "emergency_availability" }
};

function normalizeKnownLegacyConfirmation(key, original, rewritten) {
  const validation = validateKnowledgeHeartText(rewritten, { requireFirstPerson: true });
  if (validation.ok) return validation.text;
  const source = String(original || "").trim().toLowerCase();
  const replacements = {
    hours: /monday\s+through\s+friday.*flexib/.test(source)
      ? "We typically work Monday through Friday, with flexibility depending on the project."
      : "",
    emergency: /^not\s+typically.*depends\s+on\s+the\s+project/.test(source)
      ? "We do not typically offer emergency service except when a project warrants it."
      : "",
    estimates: /send\s+someone.*location.*provide.*estimate/.test(source)
      ? "We can visit the project, discuss it in person, and provide a complete estimate for approval."
      : "",
    service_area: /king.*surrounding\s+count/.test(source)
      ? "We serve all of King County and surrounding counties."
      : "",
    repairs_service: /repairs?.*carpentry.*painting/.test(source)
      ? "We offer repairs ranging from carpentry to painting."
      : ""
  };
  const replacement = replacements[key] || "";
  const replacementValidation = validateKnowledgeHeartText(replacement, { requireFirstPerson: true });
  if (!replacementValidation.ok) {
    throw new Error(`legacy_caller_faq_manual_review_required:${key}:${validation.reasons.join(",")}`);
  }
  return replacementValidation.text;
}

async function migrateLegacyCallerFaqConfirmation(pool, tenantKey) {
  const confirmationResult = await pool.query(
    `SELECT answers_json
     FROM tenant_caller_faq_confirmations
     WHERE tenant_key = $1 AND status = 'completed'
     LIMIT 1`,
    [tenantKey]
  );
  const answers = confirmationResult.rows?.[0]?.answers_json;
  if (!answers || typeof answers !== "object") return { migrated: false, reason: "not_completed" };
  const existing = await pool.query(
    `SELECT category
     FROM kb_tenant_facts
     WHERE tenant_key = $1 AND kind = 'confirmed' AND archived_at IS NULL`,
    [tenantKey]
  );
  const existingCategories = new Set((existing.rows || []).map((row) => row.category));
  const sourceFacts = Object.entries(answers)
    .filter(([key, value]) => LEGACY_CONFIRMATION_CONFIG[key]
      && !existingCategories.has(LEGACY_CONFIRMATION_CONFIG[key].category)
      && String(value || "").trim()
      && !/^(?:not sure|unknown|i don't know|i do not know)[.!]?$/i.test(String(value || "").trim()))
    .map(([key, value]) => ({
      knowledge_fact_id: `legacy-confirm-${key}`,
      claim_text: String(value || "").trim(),
      fact_role: key,
      subject: LEGACY_CONFIRMATION_CONFIG[key].title,
      core_fact_is_stable: true,
      core_fact_is_safe_to_speak: true,
      core_fact_score: 1,
      core_fact_title: "",
      core_fact_spoken_text: "",
      core_fact_spoken_version: null,
      core_fact_spoken_model: null,
      qualifier_json: {},
      boundary_json: {},
      confirmation_key: key
    }));
  if (!sourceFacts.length) return { migrated: false, reason: "no_confirmed_answers" };
  const rewritten = await rewriteCoreFactCatalogCandidatesForSpeech({
    facts: sourceFacts,
    model: process.env.OPENAI_CORE_FACTS_SPOKEN_MODEL || "gpt-5.2"
  });
  const spokenAnswers = {};
  const rewrittenByKey = new Map((rewritten.facts || []).map((fact) => [fact.confirmation_key, fact]));
  for (const sourceFact of sourceFacts) {
    const key = sourceFact.confirmation_key;
    spokenAnswers[key] = normalizeKnownLegacyConfirmation(
      key,
      answers[key],
      rewrittenByKey.get(key)?.core_fact_spoken_text || ""
    );
  }
  if (!Object.keys(spokenAnswers).length) throw new Error(`legacy_caller_faq_rewrite_failed:${tenantKey}`);
  const state = await pool.query(
    `SELECT selection_version FROM kb_selection_state WHERE tenant_key = $1 LIMIT 1`,
    [tenantKey]
  );
  const result = await confirmKnowledgeHeartFacts(pool, {
    tenantKey,
    selectionVersion: Number(state.rows?.[0]?.selection_version || 0),
    answers: spokenAnswers,
    actor: "tenant:migrated-caller-faq-confirmation",
    requestId: `migration:${tenantKey}`,
    idempotencyKey: `migration:caller-faq:${tenantKey}:${sourceFacts.map((fact) => fact.confirmation_key).sort().join("-")}`
  });
  return { migrated: true, answerCount: Object.keys(spokenAnswers).length, result };
}

async function resetUntouchedInitialCatalog(client, tenantKey) {
  await client.query(
    `INSERT INTO kb_selection_state (tenant_key, selection_version, updated_at)
     VALUES ($1, 0, NOW())
     ON CONFLICT (tenant_key) DO NOTHING`,
    [tenantKey]
  );
  await client.query(
    `SELECT selection_version
     FROM kb_selection_state
     WHERE tenant_key = $1
     FOR UPDATE`,
    [tenantKey]
  );
  const protectedState = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE slot_ownership = 'manual')::int AS manual_slots,
       (SELECT COUNT(*)::int FROM kb_selection_history WHERE tenant_key = $1) AS history_rows,
       (SELECT COUNT(*)::int FROM kb_suppressions WHERE tenant_key = $1) AS suppressions,
       (SELECT COUNT(*)::int FROM kb_tenant_facts WHERE tenant_key = $1) AS tenant_facts
     FROM kb_selection
     WHERE tenant_key = $1`,
    [tenantKey]
  );
  const state = protectedState.rows?.[0] || {};
  if (Number(state.manual_slots || 0) > 0
      || Number(state.history_rows || 0) > 0
      || Number(state.suppressions || 0) > 0
      || Number(state.tenant_facts || 0) > 0) {
    throw new Error(`kb_initial_catalog_reset_refused_tenant_state_exists:${tenantKey}`);
  }
  const prior = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM kb_selection WHERE tenant_key = $1) AS auto_slots,
       (SELECT COUNT(*)::int FROM kb_catalog_revisions WHERE tenant_key = $1) AS revisions,
       EXISTS(SELECT 1 FROM kb_block WHERE tenant_key = $1) AS had_block`,
    [tenantKey]
  );
  await client.query(`DELETE FROM kb_selection WHERE tenant_key = $1`, [tenantKey]);
  await client.query(`DELETE FROM kb_block WHERE tenant_key = $1`, [tenantKey]);
  await client.query(`DELETE FROM kb_catalog_revisions WHERE tenant_key = $1`, [tenantKey]);
  await client.query(
    `UPDATE kb_selection_state
     SET selection_version = selection_version + 1, updated_at = NOW()
     WHERE tenant_key = $1`,
    [tenantKey]
  );
  return prior.rows?.[0] || { auto_slots: 0, revisions: 0, had_block: false };
}

async function main() {
  const apply = String(process.env[APPLY_ENV] || "").trim() === "1";
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const onlyTenant = argumentValue("--tenant");
  const analyze = hasArgument("--analyze");
  const confirmOnly = hasArgument("--confirm-only");
  const rebuildInitialCatalog = hasArgument("--rebuild-initial-catalog");
  const allowAi = String(process.env.EVERYCALL_ALLOW_KNOWS_BY_HEART_AI_BACKFILL || "").trim() === "1";
  if (rebuildInitialCatalog && !onlyTenant) {
    throw new Error("--rebuild-initial-catalog requires --tenant");
  }
  if (rebuildInitialCatalog && (confirmOnly || !allowAi)) {
    throw new Error("--rebuild-initial-catalog requires AI backfill and cannot be used with --confirm-only");
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const active = await pool.query(
      `SELECT active.tenant_key, active.active_build_id,
              COUNT(fact.knowledge_fact_id)::int AS fact_count,
              COUNT(fact.knowledge_fact_id) FILTER (
                WHERE fact.core_fact_is_safe_to_speak = TRUE
                  AND COALESCE(fact.core_fact_score, 0) > 0
              )::int AS eligible_candidate_count,
              COUNT(fact.knowledge_fact_id) FILTER (
                WHERE fact.core_fact_is_safe_to_speak = TRUE
                  AND COALESCE(fact.core_fact_score, 0) > 0
                  AND NULLIF(BTRIM(fact.core_fact_spoken_text), '') IS NOT NULL
                  AND NULLIF(BTRIM(fact.core_fact_title), '') IS NOT NULL
              )::int AS prepared_candidate_count
       FROM tenant_active_knowledge_builds active
       LEFT JOIN knowledge_build_facts fact
         ON fact.tenant_key = active.tenant_key
        AND fact.build_id = active.active_build_id
       WHERE ($1 = '' OR active.tenant_key = $1)
       GROUP BY active.tenant_key, active.active_build_id
       ORDER BY active.tenant_key`,
      [onlyTenant]
    );
    if (!apply) {
      const analyzedTenants = [];
      if (analyze) {
        for (const row of active.rows || []) {
          const facts = await pool.query(
            `SELECT * FROM knowledge_build_facts
             WHERE tenant_key = $1 AND build_id = $2
               AND core_fact_is_safe_to_speak = TRUE
               AND COALESCE(core_fact_score, 0) > 0
             ORDER BY knowledge_fact_id`,
            [row.tenant_key, row.active_build_id]
          );
          const consolidated = await consolidateCoreFactCatalogCandidates(facts.rows || []);
          analyzedTenants.push({
            tenantKey: row.tenant_key,
            eligibleCandidateCount: facts.rowCount,
            consolidatedCandidateCount: consolidated.facts.length,
            duplicateCount: facts.rowCount - consolidated.facts.length,
            embeddingModel: consolidated.embeddingModel || null
          });
        }
      }
      console.log(JSON.stringify({
        ok: true,
        dryRun: true,
        analyze,
        applyWith: `${APPLY_ENV}=1`,
        allowAiWith: "EVERYCALL_ALLOW_KNOWS_BY_HEART_AI_BACKFILL=1",
        tenants: active.rows || [],
        analyzedTenants
      }, null, 2));
      return;
    }
    const results = [];
    for (const row of active.rows || []) {
      if (confirmOnly) {
        const legacyConfirmation = allowAi
          ? await migrateLegacyCallerFaqConfirmation(pool, row.tenant_key)
          : { migrated: false, reason: "ai_disabled" };
        results.push({ tenantKey: row.tenant_key, buildId: row.active_build_id, legacyConfirmation });
        continue;
      }
      if (allowAi && !confirmOnly) {
        await backfillActiveBuildCoreFacts(pool, {
          tenantKey: row.tenant_key,
          buildId: row.active_build_id,
          apply: true,
          allowModelScoring: true,
          catalogMode: true,
          catalogConsolidator: consolidateCoreFactCatalogCandidates
        });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query(
          `SELECT active_build_id FROM tenant_active_knowledge_builds WHERE tenant_key = $1 FOR UPDATE`,
          [row.tenant_key]
        );
        if (locked.rows?.[0]?.active_build_id !== row.active_build_id) throw new Error("active_build_changed_during_kb_backfill");
        const initialCatalogReset = rebuildInitialCatalog
          ? await resetUntouchedInitialCatalog(client, row.tenant_key)
          : null;
        const revision = await buildKnowledgeHeartCatalogRevision(client, {
          tenantKey: row.tenant_key,
          buildId: row.active_build_id
        });
        const published = await publishKnowledgeHeartCatalog(client, {
          tenantKey: row.tenant_key,
          buildId: row.active_build_id
        });
        await client.query("COMMIT");
        const legacyConfirmation = allowAi
          ? await migrateLegacyCallerFaqConfirmation(pool, row.tenant_key)
          : { migrated: false, reason: "ai_disabled" };
        results.push({
          tenantKey: row.tenant_key,
          buildId: row.active_build_id,
          initialCatalogReset,
          legacyConfirmation,
          revision,
          published
        });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
    console.log(JSON.stringify({ ok: true, dryRun: false, allowAi, tenantCount: results.length, results }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
