import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  assertKnowledgeBuildExecutionLease,
  claimKnowledgeBuildExecutionLease,
  heartbeatKnowledgeBuildExecutionLease,
  markKnowledgeBuildFailedIfLeaseOwned,
  releaseKnowledgeBuildExecutionLease,
  withKnowledgeBuildExecutionLease
} from "../pages/api/_lib/knowledgeBuildLease.js";

const db = new PGlite();
await db.exec(`
  CREATE TABLE knowledge_builds (
    build_id TEXT PRIMARY KEY,
    tenant_key TEXT NOT NULL,
    status TEXT NOT NULL,
    execution_lease_token TEXT,
    execution_lease_owner TEXT,
    execution_lease_acquired_at TIMESTAMPTZ,
    execution_lease_heartbeat_at TIMESTAMPTZ,
    execution_lease_expires_at TIMESTAMPTZ,
    execution_attempt_count INTEGER NOT NULL DEFAULT 0,
    warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  INSERT INTO knowledge_builds (build_id, tenant_key, status)
  VALUES ('build_test', 'tenant_test', 'queued');
`);

const first = await claimKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  owner: "worker-a",
  token: "lease-a",
  leaseSeconds: 180
});
assert.equal(first.acquired, true);

const overlapping = await claimKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  owner: "worker-b",
  token: "lease-b",
  leaseSeconds: 180
});
assert.equal(overlapping.acquired, false, "only one overlapping invocation may own a build");

assert.equal((await heartbeatKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  token: "wrong-token",
  leaseSeconds: 180
})).owned, false);
assert.equal((await heartbeatKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  token: "lease-a",
  leaseSeconds: 180
})).owned, true);
await db.query(`UPDATE knowledge_builds SET execution_lease_expires_at = NOW() - INTERVAL '1 second' WHERE build_id = 'build_test'`);
assert.equal((await heartbeatKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  token: "lease-a",
  leaseSeconds: 180
})).owned, false, "an expired owner must not revive its lease");
await db.query(`UPDATE knowledge_builds SET execution_lease_expires_at = NOW() + INTERVAL '180 seconds' WHERE build_id = 'build_test'`);
await assertKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  token: "lease-a"
});
await assert.rejects(
  assertKnowledgeBuildExecutionLease(db, {
    tenantKey: "tenant_test",
    buildId: "build_test",
    token: "lease-b"
  }),
  /knowledge_build_execution_lease_lost/
);

assert.equal(await releaseKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  token: "lease-b"
}), false);
assert.equal(await releaseKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  token: "lease-a"
}), true);

const reclaimed = await claimKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  owner: "worker-b",
  token: "lease-b",
  leaseSeconds: 180
});
assert.equal(reclaimed.acquired, true);
await db.query(`UPDATE knowledge_builds SET execution_lease_expires_at = NOW() - INTERVAL '1 second' WHERE build_id = 'build_test'`);
const expiredTakeover = await claimKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  owner: "worker-c",
  token: "lease-c",
  leaseSeconds: 180
});
assert.equal(expiredTakeover.acquired, true, "an expired lease must be resumable");
await releaseKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  token: "lease-c"
});

let releaseWork;
const workGate = new Promise((resolve) => {
  releaseWork = resolve;
});
const activeWork = withKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  owner: "worker-d",
  leaseSeconds: 180,
  heartbeatSeconds: 30
}, async ({ assertOwned }) => {
  await assertOwned();
  await workGate;
  return "completed";
});
await new Promise((resolve) => setTimeout(resolve, 20));
const skippedWork = await withKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  owner: "worker-e",
  leaseSeconds: 180,
  heartbeatSeconds: 30
}, async () => "must-not-run");
assert.equal(skippedWork.acquired, false);
releaseWork();
assert.deepEqual(await activeWork, { acquired: true, result: "completed" });

await db.query(`UPDATE knowledge_builds SET status = 'ready_to_publish' WHERE build_id = 'build_test'`);
const readyClaim = await claimKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  owner: "worker-ready",
  token: "lease-ready",
  leaseSeconds: 180
});
assert.equal(readyClaim.acquired, true, "a terminated worker's ready build must be claimable for publication");
await db.query(`UPDATE knowledge_builds SET status = 'published' WHERE build_id = 'build_test'`);
assert.equal(await markKnowledgeBuildFailedIfLeaseOwned(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  token: "lease-ready",
  failureMessages: ["stale_worker_failure"]
}), false, "even the prior owner token cannot overwrite a published build");
await assert.rejects(
  markKnowledgeBuildFailedIfLeaseOwned(db, {
    tenantKey: "tenant_test",
    buildId: "build_test",
    failureMessages: ["unleased_failure"]
  }),
  /knowledge_build_execution_lease_required/
);
const publishedState = await db.query(`SELECT status, warnings_json FROM knowledge_builds WHERE build_id = 'build_test'`);
assert.equal(publishedState.rows[0].status, "published");
assert.deepEqual(publishedState.rows[0].warnings_json, []);
await releaseKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  token: "lease-ready"
});

const terminalClaim = await claimKnowledgeBuildExecutionLease(db, {
  tenantKey: "tenant_test",
  buildId: "build_test",
  owner: "worker-f",
  token: "lease-f",
  leaseSeconds: 180
});
assert.equal(terminalClaim.acquired, false, "published builds must never be reclaimed");

const state = await db.query(`SELECT execution_attempt_count, execution_lease_token FROM knowledge_builds WHERE build_id = 'build_test'`);
assert.equal(Number(state.rows[0].execution_attempt_count), 5);
assert.equal(state.rows[0].execution_lease_token, null);

await db.close();
console.log("knowledge build lease validation passed");
