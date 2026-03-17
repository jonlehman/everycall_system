import { URL } from "node:url";
import crypto from "node:crypto";

function normalizeText(value) {
  return String(value || "").trim();
}

function summarizeDatabaseTarget(databaseUrl = "") {
  return getDatabaseTargetIdentity(databaseUrl).target;
}

function getDatabaseTargetIdentity(databaseUrl = "") {
  const raw = normalizeText(databaseUrl);
  if (!raw) {
    return {
      target: "unknown_database_target",
      normalizedTarget: "unknown_database_target",
      fingerprint: "unknown_target_fingerprint"
    };
  }
  try {
    const parsed = new URL(raw);
    const host = normalizeText(parsed.hostname) || "unknown-host";
    const dbName = normalizeText(parsed.pathname).replace(/^\/+/, "") || "unknown-db";
    const defaultPort = parsed.protocol === "postgresql:" || parsed.protocol === "postgres:" ? "5432" : "";
    const port = normalizeText(parsed.port) || defaultPort;
    const target = `${host}/${dbName}`;
    const normalizedTarget = `${parsed.protocol}//${host}${port ? `:${port}` : ""}/${dbName}`;
    const fingerprint = crypto.createHash("sha256").update(normalizedTarget).digest("hex").slice(0, 16);
    return { target, normalizedTarget, fingerprint };
  } catch {
    const normalizedTarget = raw.replace(/:[^:@/]+@/, ":***@");
    const fingerprint = crypto.createHash("sha256").update(normalizedTarget).digest("hex").slice(0, 16);
    return {
      target: normalizedTarget,
      normalizedTarget,
      fingerprint
    };
  }
}

function parseAllowedValues(raw) {
  return normalizeText(raw)
    .split(/[,\s]+/g)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function failGuard({ scriptName, action, envName, expectedValue, databaseUrl, extra = [] }) {
  const targetIdentity = getDatabaseTargetIdentity(databaseUrl);
  const lines = [
    `[safety] ${scriptName} blocked.`,
    `Action: ${action}`,
    `Database target: ${targetIdentity.target}`,
    `Database target fingerprint: ${targetIdentity.fingerprint}`,
    `Required approval: ${envName}=${expectedValue}`
  ];
  for (const line of extra) {
    const text = normalizeText(line);
    if (text) lines.push(text);
  }
  throw new Error(lines.join("\n"));
}

export function requireExactApproval({
  scriptName,
  action,
  envName,
  expectedValue,
  databaseUrl = process.env.DATABASE_URL || "",
  extra = []
}) {
  const actualValue = normalizeText(process.env[envName]);
  if (actualValue === normalizeText(expectedValue)) return;
  failGuard({
    scriptName,
    action,
    envName,
    expectedValue,
    databaseUrl,
    extra
  });
}

export function requireFlagApproval({
  scriptName,
  action,
  envName,
  databaseUrl = process.env.DATABASE_URL || "",
  extra = []
}) {
  requireExactApproval({
    scriptName,
    action,
    envName,
    expectedValue: "1",
    databaseUrl,
    extra
  });
}

export function requireTenantApproval({
  scriptName,
  action,
  envName,
  tenantKey,
  databaseUrl = process.env.DATABASE_URL || "",
  extra = []
}) {
  const allowedValues = parseAllowedValues(process.env[envName]);
  if (allowedValues.includes("*") || allowedValues.includes(normalizeText(tenantKey))) {
    return;
  }
  failGuard({
    scriptName,
    action,
    envName,
    expectedValue: tenantKey,
    databaseUrl,
    extra
  });
}

export function requireSchemaResetApproval(scriptName, databaseUrl = process.env.DATABASE_URL || "") {
  requireExactApproval({
    scriptName,
    action: "drop and recreate the public schema",
    envName: "EVERYCALL_ALLOW_SCHEMA_RESET",
    expectedValue: "DROP_PUBLIC_SCHEMA",
    databaseUrl,
    extra: [
      "This validator destroys all current data in the target database before rebuilding fixtures."
    ]
  });
  requireSchemaResetTargetApproval(scriptName, databaseUrl);
}

export function requireSchemaResetTargetApproval(scriptName, databaseUrl = process.env.DATABASE_URL || "") {
  const targetIdentity = getDatabaseTargetIdentity(databaseUrl);
  const allowedTargets = parseAllowedValues(process.env.EVERYCALL_ALLOW_SCHEMA_RESET_TARGETS);
  const allowedFingerprints = parseAllowedValues(process.env.EVERYCALL_ALLOW_SCHEMA_RESET_TARGET_FINGERPRINTS).map((item) => item.toLowerCase());
  const targetMatched = allowedTargets.includes(targetIdentity.target);
  const fingerprintMatched = allowedFingerprints.includes(targetIdentity.fingerprint.toLowerCase());
  if (targetMatched || fingerprintMatched) return;

  throw new Error([
    `[safety] ${scriptName} blocked.`,
    "Action: drop and recreate the public schema",
    `Database target: ${targetIdentity.target}`,
    `Database target fingerprint: ${targetIdentity.fingerprint}`,
    "Required target approval: set either",
    `- EVERYCALL_ALLOW_SCHEMA_RESET_TARGETS=${targetIdentity.target}`,
    `- EVERYCALL_ALLOW_SCHEMA_RESET_TARGET_FINGERPRINTS=${targetIdentity.fingerprint}`,
    "The schema-reset token alone is not sufficient."
  ].join("\n"));
}

export function describeDatabaseTarget(databaseUrl = process.env.DATABASE_URL || "") {
  return getDatabaseTargetIdentity(databaseUrl);
}

export function requireTenantBuildMutationApproval(scriptName, tenantKey, databaseUrl = process.env.DATABASE_URL || "") {
  requireTenantApproval({
    scriptName,
    action: `create or publish build artifacts for tenant ${tenantKey}`,
    envName: "EVERYCALL_ALLOW_TENANT_BUILD_MUTATION",
    tenantKey,
    databaseUrl
  });
}

export function requireTenantArtifactDeleteApproval(scriptName, tenantKey, databaseUrl = process.env.DATABASE_URL || "") {
  requireTenantApproval({
    scriptName,
    action: `delete existing build artifacts for tenant ${tenantKey}`,
    envName: "EVERYCALL_ALLOW_TENANT_ARTIFACT_DELETE",
    tenantKey,
    databaseUrl
  });
}

export function requireQaCleanupApproval(scriptName, databaseUrl = process.env.DATABASE_URL || "") {
  requireExactApproval({
    scriptName,
    action: "delete QA tenants and optionally release numbers",
    envName: "EVERYCALL_ALLOW_QA_TENANT_DELETE",
    expectedValue: "DELETE_QA_TENANTS",
    databaseUrl
  });
}
