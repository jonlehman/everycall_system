export type OpeningStatementAwareSession = {
  openingStatementProtected?: boolean;
  openingStatementRequested?: boolean;
  openingStatementResponseId?: string | null;
  openingStatementIgnoredAudioFrames?: number;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

export function initializeOpeningStatementProtection(session: OpeningStatementAwareSession) {
  session.openingStatementProtected = true;
  session.openingStatementRequested = false;
  session.openingStatementResponseId = null;
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
  return true;
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
  if (!expectedResponseId || !completedResponseId || expectedResponseId !== completedResponseId) {
    return false;
  }
  session.openingStatementProtected = false;
  session.openingStatementRequested = false;
  return true;
}
