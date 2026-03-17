import { cleanupTenantByKey, findQaTenants, QA_TENANT_PATTERNS } from "./_tenantCleanup.mjs";
import { requireQaCleanupApproval } from "./_safety.mjs";
const dryRun = process.env.QA_CLEANUP_DRY_RUN === "1";

async function run() {
  if (!dryRun) {
    requireQaCleanupApproval("scripts/cleanup-qa-tenants.mjs");
  }
  const matches = await findQaTenants(QA_TENANT_PATTERNS);
  console.log(`[cleanup-qa-tenants] matched=${matches.length} dryRun=${dryRun}`);

  for (const match of matches) {
    console.log(`- ${match.name} (${match.tenant_key})`);
  }

  if (dryRun) {
    console.log("Dry run enabled. No tenants deleted.");
    return;
  }

  for (const match of matches) {
    const deleted = await cleanupTenantByKey(match.tenant_key, { releaseNumber: true });
    console.log(`deleted=${deleted.deleted} tenant=${deleted.tenantKey} releasedVoiceNumber=${deleted.releasedVoiceNumber || ""}`);
  }
}

run().catch((err) => {
  console.error(`[cleanup-qa-tenants] failed: ${err?.message || err}`);
  process.exit(1);
});
