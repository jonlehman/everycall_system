export type OpeningStatementAwareSession = {
  openingStatementProtected?: boolean;
  openingStatementRequested?: boolean;
  openingStatementResponseId?: string | null;
  openingStatementResponseStatus?: string | null;
  openingStatementRetryCount?: number;
  openingStatementIgnoredAudioFrames?: number;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

export function buildOpeningStatementResponse(statement: unknown) {
  return {
    instructions: `Say exactly this opening statement, with no additions: ${JSON.stringify(String(statement || ""))}`,
    tool_choice: "none" as const,
    tools: []
  };
}

export function initializeOpeningStatementProtection(session: OpeningStatementAwareSession) {
  session.openingStatementProtected = true;
  session.openingStatementRequested = false;
  session.openingStatementResponseId = null;
  session.openingStatementResponseStatus = null;
  session.openingStatementRetryCount = 0;
  session.openingStatementIgnoredAudioFrames = 0;
  return session;
}

export function markOpeningStatementRequested(session: OpeningStatementAwareSession) {
  session.openingStatementProtected = true;
  session.openingStatementRequested = true;
}

export function markOpeningStatementResponseCreated(
  session: OpeningStatementAwareSession,
  responseId: unknown
) {
  const normalizedResponseId = normalizeText(responseId);
  if (!session.openingStatementProtected || !session.openingStatementRequested || !normalizedResponseId) {
    return false;
  }
  session.openingStatementRequested = false;
  session.openingStatementResponseId = normalizedResponseId;
  session.openingStatementResponseStatus = null;
  return true;
}

export function markOpeningStatementResponseDone(
  session: OpeningStatementAwareSession,
  responseId: unknown,
  status: unknown
) {
  const expectedResponseId = normalizeText(session.openingStatementResponseId);
  const completedResponseId = normalizeText(responseId);
  if (!session.openingStatementProtected
    || !expectedResponseId
    || expectedResponseId !== completedResponseId) {
    return false;
  }
  session.openingStatementResponseStatus = normalizeText(status).toLowerCase() || "unknown";
  return session.openingStatementResponseStatus === "completed";
}

export function shouldRetryOpeningStatementAfterPlayback(
  session: OpeningStatementAwareSession,
  responseId: unknown
) {
  const expectedResponseId = normalizeText(session.openingStatementResponseId);
  const drainedResponseId = normalizeText(responseId);
  return Boolean(
    session.openingStatementProtected
      && expectedResponseId
      && expectedResponseId === drainedResponseId
      && session.openingStatementResponseStatus
      && session.openingStatementResponseStatus !== "completed"
      && Math.max(0, Number(session.openingStatementRetryCount || 0)) < 1
  );
}

export function markOpeningStatementRetryRequested(session: OpeningStatementAwareSession) {
  session.openingStatementRetryCount = Math.max(
    0,
    Number(session.openingStatementRetryCount || 0)
  ) + 1;
  session.openingStatementRequested = true;
  session.openingStatementResponseId = null;
  session.openingStatementResponseStatus = null;
}

export function shouldIgnoreCallerDuringOpening(session: OpeningStatementAwareSession | null | undefined) {
  return Boolean(session?.openingStatementProtected);
}

export function noteOpeningCallerAudioIgnored(session: OpeningStatementAwareSession) {
  session.openingStatementIgnoredAudioFrames = Math.max(
    0,
    Number(session.openingStatementIgnoredAudioFrames || 0)
  ) + 1;
  return session.openingStatementIgnoredAudioFrames;
}

export function completeOpeningStatementAfterPlayback(
  session: OpeningStatementAwareSession,
  responseId: unknown
) {
  if (!session.openingStatementProtected) return false;
  const expectedResponseId = normalizeText(session.openingStatementResponseId);
  const completedResponseId = normalizeText(responseId);
  if (!expectedResponseId
    || !completedResponseId
    || expectedResponseId !== completedResponseId
    || session.openingStatementResponseStatus !== "completed") {
    return false;
  }
  session.openingStatementProtected = false;
  session.openingStatementRequested = false;
  return true;
}
