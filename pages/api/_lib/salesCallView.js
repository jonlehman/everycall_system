import {
  getSalesSignupInvitation,
  normalizeSalesText,
  salesError
} from "./salesRepository.js";

const TERMINAL_CALL_STATES = new Set([
  "closed",
  "completed",
  "ended",
  "failed",
  "no_answer",
  "voicemail",
  "wrong_number",
  "not_interested",
  "do_not_call",
  "canceled",
  "cancelled"
]);

const PROSPECT_CONNECTED_STATES = new Set([
  "prospect_connected",
  "ai_standby_ready",
  "ai_live",
  "ai_paused",
  "demo_ended",
  "signup_pending",
  "signup_completed"
]);

const AI_READY_STATES = new Set(["ready", "standby_ready", "live", "paused"]);

export function assertSalesCallAdmin(call, adminUserId) {
  if (!call) {
    throw salesError("sales_call_not_found", "Sales call not found.", 404);
  }
  if (Number(call.adminUserId || 0) !== Number(adminUserId || 0)) {
    throw salesError("sales_call_forbidden", "This sales call belongs to another operator.", 403);
  }
  return call;
}

async function loadLatestSignupProgress(pool, call) {
  const invitationResult = await pool.query(
    `SELECT invitation_id
     FROM sales_signup_invitations
     WHERE sales_call_id = $1
        OR (sales_call_id IS NULL AND prospect_id = $2)
     ORDER BY
       CASE WHEN sales_call_id = $1 THEN 0 ELSE 1 END,
       created_at DESC
     LIMIT 1`,
    [call.salesCallId, call.prospectId]
  );
  const invitationId = invitationResult.rows[0]?.invitation_id;
  if (!invitationId) return null;
  return getSalesSignupInvitation(pool, invitationId);
}

export async function buildSalesCallView(pool, call, {
  webrtc = null
} = {}) {
  if (!call) return null;
  const state = normalizeSalesText(call.state, 80).toLowerCase();
  const aiState = normalizeSalesText(call.aiState, 80).toLowerCase();
  const signup = await loadLatestSignupProgress(pool, call);
  return {
    salesCallId: call.salesCallId,
    prospectId: call.prospectId,
    state: call.state,
    aiState: call.aiState || "not_started",
    prospectConnected: Boolean(call.connectedAt) || PROSPECT_CONNECTED_STATES.has(state),
    aiReady: AI_READY_STATES.has(aiState),
    aiLive: ["live", "paused"].includes(aiState),
    terminal: TERMINAL_CALL_STATES.has(state),
    providerError: call.providerErrorMessage || call.providerErrorCode || null,
    outcome: call.outcome || null,
    startedAt: call.startedAt || null,
    connectedAt: call.connectedAt || null,
    demoStartedAt: call.demoStartedAt || null,
    demoEndedAt: call.demoEndedAt || null,
    endedAt: call.endedAt || null,
    createdAt: call.createdAt || null,
    updatedAt: call.updatedAt || null,
    signup,
    ...(webrtc ? { webrtc } : {})
  };
}
