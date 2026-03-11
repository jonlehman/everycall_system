import { cleanupTenantByKey, findQaTenantsByNamePatterns } from "./_tenantCleanup.mjs";

const patterns = ["ClientUI QA %", "Intake QA %", "Collision QA %"];
const dryRun = process.env.QA_CLEANUP_DRY_RUN === "1";

async function run() {
  const matches = await findQaTenantsByNamePatterns(patterns);
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
