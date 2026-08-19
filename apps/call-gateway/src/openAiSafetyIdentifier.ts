import crypto from "node:crypto";

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeCallerIdentity(value: unknown) {
  const raw = normalizeText(value);
  if (!raw) return "";
  const digits = raw.replace(/\D+/g, "");
  return digits || raw.toLowerCase();
}

export function buildStableOpenAiSafetyIdentifier({
  callerNumber,
  tenantKey,
  configuredIdentifier,
  secret
}: {
  callerNumber?: unknown;
  tenantKey?: unknown;
  configuredIdentifier?: unknown;
  secret?: unknown;
}) {
  const configured = normalizeText(configuredIdentifier);
  if (configured) return configured;

  const callerIdentity = normalizeCallerIdentity(callerNumber);
  const subject = callerIdentity
    ? `everycall:voice-caller:${callerIdentity}`
    : `everycall:anonymous-voice:${normalizeText(tenantKey).toLowerCase() || "unknown-tenant"}`;
  const normalizedSecret = normalizeText(secret);
  return normalizedSecret
    ? crypto.createHmac("sha256", normalizedSecret).update(subject).digest("hex")
    : crypto.createHash("sha256").update(subject).digest("hex");
}
