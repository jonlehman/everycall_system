import crypto from "node:crypto";

function normalizeText(value) {
  return String(value || "").trim();
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

async function withTransaction(db, work) {
  const canBorrowClient = typeof db?.connect === "function" && typeof db?.release !== "function";
  if (!canBorrowClient) {
    return work(db);
  }
  const client = await db.connect();
  const ownsClient = true;
  await client.query("BEGIN");
  try {
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    if (ownsClient && typeof client?.release === "function") {
      client.release();
    }
  }
}

async function assertSetupInterviewTablesReady(db) {
  const res = await db.query(`SELECT to_regclass('setup_interview_intents') AS table_name`);
  if (!normalizeText(res.rows[0]?.table_name)) {
    throw new Error("knowledge_receptionist_migrations_not_applied");
  }
}

function normalizeSummaryBlocks(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];
  for (const item of value) {
    const title = normalizeText(item?.title);
    const summaryText = normalizeText(item?.summaryText || item?.summary_text);
    const blockKey = normalizeText(item?.blockKey || item?.block_key) || title.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (!title || !summaryText || !blockKey || seen.has(blockKey)) continue;
    seen.add(blockKey);
    output.push({
      blockKey,
      title,
      summaryText,
      confirmationStatus: normalizeText(item?.confirmationStatus || item?.confirmation_status) || "confirmed",
      authorityLevel: "confirmed_summary",
      metadata: item?.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {}
    });
  }
  return output;
}

async function nextSetupInterviewIntentVersion(db, tenantKey) {
  const res = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM setup_interview_intents
     WHERE tenant_key = $1`,
    [tenantKey]
  );
  return `v${Number(res.rows[0]?.count || 0) + 1}`;
}

async function loadSetupInterviewIntentById(db, setupInterviewIntentId) {
  const res = await db.query(
    `SELECT *
     FROM setup_interview_intents
     WHERE setup_interview_intent_id = $1
     LIMIT 1`,
    [setupInterviewIntentId]
  );
  return res.rows[0] || null;
}

async function resolveLinkedSetupInterviewIntentId(db, tenantKey, setupInterviewIntentId) {
  const normalizedId = normalizeText(setupInterviewIntentId);
  if (!normalizedId) return null;
  const intent = await loadSetupInterviewIntentById(db, normalizedId);
  if (!intent) {
    throw new Error("setup_interview_intent_not_found");
  }
  if (normalizeText(intent.tenant_key) !== normalizeText(tenantKey)) {
    throw new Error("setup_interview_intent_tenant_mismatch");
  }
  return normalizedId;
}

async function upsertSetupInterviewIntentRecord(db, tenantKey, payload = {}) {
  const intentId = normalizeText(payload.setupInterviewIntentId || payload.setup_interview_intent_id) || createId("setup_intent");
  const version = normalizeText(payload.version) || await nextSetupInterviewIntentVersion(db, tenantKey);

  await db.query(
    `INSERT INTO setup_interview_intents (
       setup_interview_intent_id, tenant_key, version, status, primary_goal, required_capture_categories_json,
       confirmation_policy_json, completion_criteria_json, interview_stage_playbook_json, pause_resume_policy_json,
       review_and_confirm_policy_json, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, NOW()
     )
     ON CONFLICT (setup_interview_intent_id)
     DO UPDATE SET version = EXCLUDED.version,
                   status = EXCLUDED.status,
                   primary_goal = EXCLUDED.primary_goal,
                   required_capture_categories_json = EXCLUDED.required_capture_categories_json,
                   confirmation_policy_json = EXCLUDED.confirmation_policy_json,
                   completion_criteria_json = EXCLUDED.completion_criteria_json,
                   interview_stage_playbook_json = EXCLUDED.interview_stage_playbook_json,
                   pause_resume_policy_json = EXCLUDED.pause_resume_policy_json,
                   review_and_confirm_policy_json = EXCLUDED.review_and_confirm_policy_json,
                   updated_at = NOW()`,
    [
      intentId,
      tenantKey,
      version,
      normalizeText(payload.status) || "draft",
      normalizeText(payload.primaryGoal || payload.primary_goal) || "Collect and confirm business facts needed for setup.",
      JSON.stringify(Array.isArray(payload.requiredCaptureCategories || payload.required_capture_categories) ? (payload.requiredCaptureCategories || payload.required_capture_categories) : []),
      JSON.stringify(payload.confirmationPolicy || payload.confirmation_policy || {}),
      JSON.stringify(payload.completionCriteria || payload.completion_criteria || {}),
      JSON.stringify(Array.isArray(payload.interviewStagePlaybook || payload.interview_stage_playbook) ? (payload.interviewStagePlaybook || payload.interview_stage_playbook) : []),
      JSON.stringify(payload.pauseResumePolicy || payload.pause_resume_policy || {}),
      JSON.stringify(payload.reviewAndConfirmPolicy || payload.review_and_confirm_policy || {})
    ]
  );

  const res = await db.query(
    `SELECT *
     FROM setup_interview_intents
     WHERE setup_interview_intent_id = $1
     LIMIT 1`,
    [intentId]
  );
  return res.rows[0] || null;
}

async function upsertSetupInterviewSessionRecord(db, tenantKey, payload = {}) {
  const sessionId = normalizeText(payload.setupInterviewSessionId || payload.setup_interview_session_id) || createId("setup_session");
  const intentId = await resolveLinkedSetupInterviewIntentId(
    db,
    tenantKey,
    payload.setupInterviewIntentId || payload.setup_interview_intent_id
  );
  const rawTranscriptText = normalizeText(payload.rawTranscriptText || payload.raw_transcript_text) || null;
  const summaryBlocks = normalizeSummaryBlocks(payload.confirmedSummaryBlocks || payload.confirmed_summary_blocks);

  await db.query(
    `INSERT INTO setup_interview_sessions (
       setup_interview_session_id, tenant_key, setup_interview_intent_id, status, completion_status,
       raw_transcript_text, metadata_json, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
     ON CONFLICT (setup_interview_session_id)
     DO UPDATE SET setup_interview_intent_id = EXCLUDED.setup_interview_intent_id,
                   status = EXCLUDED.status,
                   completion_status = EXCLUDED.completion_status,
                   raw_transcript_text = EXCLUDED.raw_transcript_text,
                   metadata_json = EXCLUDED.metadata_json,
                   updated_at = NOW()`,
    [
      sessionId,
      tenantKey,
      intentId,
      normalizeText(payload.status) || "draft",
      normalizeText(payload.completionStatus || payload.completion_status) || "in_progress",
      rawTranscriptText,
      JSON.stringify(payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata) ? payload.metadata : {})
    ]
  );

  for (const block of summaryBlocks) {
    await db.query(
      `INSERT INTO setup_interview_summary_blocks (
         setup_interview_session_id, tenant_key, block_key, title, summary_text, confirmation_status,
         authority_level, source_hash, metadata_json, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed_summary', $7, $8::jsonb, NOW())
       ON CONFLICT (setup_interview_session_id, block_key)
       DO UPDATE SET title = EXCLUDED.title,
                     summary_text = EXCLUDED.summary_text,
                     confirmation_status = EXCLUDED.confirmation_status,
                     authority_level = 'confirmed_summary',
                     source_hash = EXCLUDED.source_hash,
                     metadata_json = EXCLUDED.metadata_json,
                     updated_at = NOW()`,
      [
        sessionId,
        tenantKey,
        block.blockKey,
        block.title,
        block.summaryText,
        block.confirmationStatus,
        stableHash(block.summaryText),
        JSON.stringify(block.metadata)
      ]
    );
  }

  return { sessionId };
}

export async function loadSetupInterviewState(db, tenantKey) {
  await assertSetupInterviewTablesReady(db);
  const [intentRes, sessionsRes, blocksRes] = await Promise.all([
    db.query(
      `SELECT *
       FROM setup_interview_intents
       WHERE tenant_key = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [tenantKey]
    ),
    db.query(
      `SELECT *
       FROM setup_interview_sessions
       WHERE tenant_key = $1
       ORDER BY updated_at DESC
       LIMIT 5`,
      [tenantKey]
    ),
    db.query(
      `SELECT b.*
       FROM setup_interview_summary_blocks b
       INNER JOIN setup_interview_sessions s
         ON s.setup_interview_session_id = b.setup_interview_session_id
       WHERE s.tenant_key = $1
       ORDER BY b.updated_at DESC`,
      [tenantKey]
    )
  ]);

  return {
    intent: intentRes.rows[0] || null,
    sessions: sessionsRes.rows || [],
    summaryBlocks: blocksRes.rows || []
  };
}

export async function saveSetupInterviewIntent(db, tenantKey, payload = {}) {
  await assertSetupInterviewTablesReady(db);
  return upsertSetupInterviewIntentRecord(db, tenantKey, payload);
}

export async function createSetupInterviewSessionSkeleton(db, tenantKey, payload = {}) {
  await assertSetupInterviewTablesReady(db);
  const { sessionId } = await withTransaction(db, async (client) =>
    upsertSetupInterviewSessionRecord(client, tenantKey, payload)
  );

  const state = await loadSetupInterviewState(db, tenantKey);
  return {
    session: state.sessions.find((item) => item.setup_interview_session_id === sessionId) || null,
    summaryBlocks: state.summaryBlocks.filter((item) => item.setup_interview_session_id === sessionId)
  };
}

export async function saveSetupInterviewSubmission(db, tenantKey, payload = {}) {
  await assertSetupInterviewTablesReady(db);
  const result = await withTransaction(db, async (client) => {
    const intent = payload.intent
      ? await upsertSetupInterviewIntentRecord(client, tenantKey, payload.intent)
      : null;
    const sessionWrite = payload.session
      ? await upsertSetupInterviewSessionRecord(client, tenantKey, {
          ...payload.session,
          setupInterviewIntentId: payload.session.setupInterviewIntentId || intent?.setup_interview_intent_id || null
        })
      : null;
    return {
      intentId: intent?.setup_interview_intent_id || null,
      sessionId: sessionWrite?.sessionId || null
    };
  });

  const state = await loadSetupInterviewState(db, tenantKey);
  return {
    intent: result.intentId
      ? state.intent && state.intent.setup_interview_intent_id === result.intentId
        ? state.intent
        : await loadSetupInterviewIntentById(db, result.intentId)
      : null,
    session: result.sessionId
      ? state.sessions.find((item) => item.setup_interview_session_id === result.sessionId) || null
      : null,
    summaryBlocks: result.sessionId
      ? state.summaryBlocks.filter((item) => item.setup_interview_session_id === result.sessionId)
      : []
  };
}
