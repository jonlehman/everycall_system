import { URL } from "node:url";

function normalizeText(value) {
  return String(value || "").trim();
}

function summarizeDatabaseTarget(databaseUrl = "") {
  const raw = normalizeText(databaseUrl);
  if (!raw) return "unknown_database_target";
  try {
    const parsed = new URL(raw);
    const host = normalizeText(parsed.hostname) || "unknown-host";
    const dbName = normalizeText(parsed.pathname).replace(/^\/+/, "") || "unknown-db";
    return `${host}/${dbName}`;
  } catch {
    return raw.replace(/:[^:@/]+@/, ":***@");
  }
}

function parseAllowedValues(raw) {
  return normalizeText(raw)
    .split(/[,\s]+/g)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function failGuard({ scriptName, action, envName, expectedValue, databaseUrl, extra = [] }) {
  const lines = [
    `[safety] ${scriptName} blocked.`,
    `Action: ${action}`,
    `Database target: ${summarizeDatabaseTarget(databaseUrl)}`,
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
