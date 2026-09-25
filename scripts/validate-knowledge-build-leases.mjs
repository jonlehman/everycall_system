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

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function timeoutError() {
  return Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
}

async function leaseFixture(name, intercept, work, options = {}) {
  const buildId = `build_${name}`;
  await db.query(`INSERT INTO knowledge_builds (build_id, tenant_key, status) VALUES ($1, 'tenant_test', 'queued')`, [buildId]);
  const connection = {
    query: (sql, params) => intercept(sql, params, () => db.query(sql, params))
  };
  return withKnowledgeBuildExecutionLease(connection, {
    tenantKey: "tenant_test", buildId, owner: name, leaseSeconds: 180, heartbeatSeconds: 30, ...options
  }, work);
}

const isHeartbeat = (sql) => sql.includes("SET execution_lease_heartbeat_at");
const isRelease = (sql) => sql.includes("SET execution_lease_token = NULL");

let recoveredAttempts = 0;
let recoveryEffects = 0;
let heartbeatActive = 0;
let maxHeartbeatActive = 0;
const recovered = await leaseFixture("transient_recovery", async (sql, params, run) => {
  if (!isHeartbeat(sql)) return run();
  recoveredAttempts += 1;
  heartbeatActive += 1;
  maxHeartbeatActive = Math.max(maxHeartbeatActive, heartbeatActive);
  try {
    // The first write committed but its acknowledgement was lost. Repeating only
    // this fenced renewal is safe; never repeat the work callback or its effects.
    const result = await run();
    if (recoveredAttempts === 1) throw new Error("wrapped database failure", { cause: timeoutError() });
    return result;
  } finally {
    heartbeatActive -= 1;
  }
}, async ({ heartbeat, assertOwned }) => {
  const results = await Promise.all([heartbeat(), heartbeat(), assertOwned()]);
  assert.equal(results[0].owned, true);
  assert.equal(results[1].owned, true);
  const duplicate = await withKnowledgeBuildExecutionLease(db, {
    tenantKey: "tenant_test", buildId: "build_transient_recovery", owner: "overlap"
  }, async () => { throw new Error("duplicate work executed"); });
  assert.equal(duplicate.acquired, false);
  recoveryEffects += 1;
  return "recovered";
});
assert.deepEqual(recovered, { acquired: true, result: "recovered" });
assert.equal(recoveredAttempts, 2);
assert.equal(maxHeartbeatActive, 1, "concurrent renewal callers must share one query/retry chain");
assert.equal(recoveryEffects, 1, "recovery must not replay application effects");

for (const scenario of ["expired", "taken_over"]) {
  let attempts = 0;
  await assert.rejects(leaseFixture(scenario, async (sql, params, run) => {
    if (isHeartbeat(sql)) {
      attempts += 1;
      if (attempts === 1) {
        await db.query(`UPDATE knowledge_builds SET execution_lease_expires_at = NOW() - INTERVAL '1 second' WHERE build_id = $1`, [params[1]]);
        if (scenario === "taken_over") {
          const next = await claimKnowledgeBuildExecutionLease(db, {
            tenantKey: "tenant_test", buildId: params[1], owner: "new-owner", token: "replacement-token"
          });
          assert.equal(next.acquired, true);
        }
        throw timeoutError();
      }
    }
    return run();
  }, async ({ heartbeat, assertOwned }) => {
    assert.equal((await heartbeat()).owned, false);
    await assert.rejects(assertOwned(), /knowledge_build_execution_lease_lost/);
    assert.equal((await heartbeat()).owned, false, "observed ownership loss must remain terminal");
  }), /knowledge_build_execution_lease_lost/);
  assert.equal(attempts, 2, "ownership loss must not be retried");
  if (scenario === "taken_over") {
    const replacement = await db.query(`SELECT execution_lease_token FROM knowledge_builds WHERE build_id = 'build_taken_over'`);
    assert.equal(replacement.rows[0].execution_lease_token, "replacement-token", "cleanup cannot release the new owner's lease");
  }
}

for (const scenario of ["retry_limit", "local_expiry", "permanent_error"]) {
  let attempts = 0;
  const error = scenario === "permanent_error"
    ? Object.assign(new Error("permission denied"), { code: "42501" }) : timeoutError();
  await assert.rejects(leaseFixture(scenario, async (sql, params, run) => {
    if (isHeartbeat(sql)) { attempts += 1; throw error; }
    return run();
  }, async ({ heartbeat, assertOwned }) => {
    assert.equal((await heartbeat()).owned, false);
    await assert.rejects(assertOwned(), (caught) => caught === error);
  }, scenario === "local_expiry" ? { leaseSeconds: 0.2 } : {}), (caught) => caught === error);
  assert.equal(attempts, scenario === "retry_limit" ? 3 : 1);
}

const pendingFailure = deferred();
const pendingStarted = deferred();
let failedReleased = false;
const finishedBeforeHeartbeat = leaseFixture("completion_race", async (sql, params, run) => {
  if (isHeartbeat(sql)) {
    pendingStarted.resolve();
    await pendingFailure.promise;
    return { rows: [] };
  }
  if (isRelease(sql)) failedReleased = true;
  return run();
}, async ({ heartbeat }) => {
  void heartbeat();
  return "must-not-report-success";
});
const completionCheck = assert.rejects(finishedBeforeHeartbeat, /knowledge_build_execution_lease_lost/);
await pendingStarted.promise;
assert.equal(failedReleased, false);
pendingFailure.resolve();
await completionCheck;
assert.equal(failedReleased, true, "pending heartbeat must settle before release");

const pendingWorkError = deferred();
const workErrorStarted = deferred();
const originalWorkError = new Error("work_failed");
let workErrorReleased = false;
let workErrorAttempts = 0;
const failedDuringHeartbeat = leaseFixture("work_error_race", async (sql, params, run) => {
  if (isHeartbeat(sql)) {
    workErrorAttempts += 1;
    workErrorStarted.resolve();
    await pendingWorkError.promise;
    throw timeoutError();
  }
  if (isRelease(sql)) workErrorReleased = true;
  return run();
}, async ({ heartbeat }) => {
  void heartbeat();
  throw originalWorkError;
});
const workErrorCheck = assert.rejects(failedDuringHeartbeat, (error) => error === originalWorkError);
await workErrorStarted.promise;
// Let the callback rejection enter cleanup before settling the heartbeat.
await new Promise((resolve) => setImmediate(resolve));
assert.equal(workErrorReleased, false);
pendingWorkError.resolve();
await workErrorCheck;
assert.equal(workErrorReleased, true);
assert.equal(workErrorAttempts, 1, "failed work must stop heartbeat retries without hiding its error");

async function rejectsPromptly(promise, expected) {
  let timer;
  try {
    await assert.rejects(Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("lease_wait_exceeded_test_deadline")), 1500);
      })
    ]), expected);
  } finally {
    clearTimeout(timer);
  }
}

for (const scenario of ["hung_assert", "hung_completion", "hung_work_error"]) {
  const pendingQuery = deferred();
  let attempts = 0;
  let releases = 0;
  let savedHeartbeat;
  let savedAssert;
  let lateOwned = null;
  const workError = new Error("original_hung_work_error");
  const run = leaseFixture(scenario, async (sql, params, query) => {
    if (isHeartbeat(sql)) {
      attempts += 1;
      await pendingQuery.promise;
      if (scenario === "hung_work_error") throw timeoutError();
      const result = await query();
      lateOwned = result.rows.length === 1;
      return result;
    }
    if (isRelease(sql)) releases += 1;
    return query();
  }, async ({ heartbeat, assertOwned }) => {
    savedHeartbeat = heartbeat;
    savedAssert = assertOwned;
    void heartbeat();
    if (scenario === "hung_assert") await assertOwned();
    if (scenario === "hung_work_error") throw workError;
    return "must-not-succeed";
  }, { leaseSeconds: 0.1 });
  await rejectsPromptly(run, scenario === "hung_work_error"
    ? (error) => error === workError : /knowledge_build_execution_lease_lost/);
  assert.equal(attempts, 1, "an unresolved SQL query must never be retried");
  assert.equal(releases, 0, "do not release while the raw renewal SQL is still pending");
  // Force database expiry independently of timer granularity, then prove a late
  // fenced renewal/cleanup cannot modify a newly claimed token.
  await db.query(`UPDATE knowledge_builds SET execution_lease_expires_at = NOW() - INTERVAL '1 second' WHERE build_id = $1`, [`build_${scenario}`]);
  assert.equal((await claimKnowledgeBuildExecutionLease(db, {
    tenantKey: "tenant_test", buildId: `build_${scenario}`, owner: "replacement", token: "after-timeout"
  })).acquired, true);
  pendingQuery.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await savedHeartbeat()).owned, false, "late results cannot restart a stopped invocation");
  await assert.rejects(savedAssert(), /knowledge_build_execution_lease_lost/);
  if (scenario !== "hung_work_error") assert.equal(lateOwned, false);
  const nextOwner = await db.query(`SELECT execution_lease_token FROM knowledge_builds WHERE build_id = $1`, [`build_${scenario}`]);
  assert.equal(nextOwner.rows[0].execution_lease_token, "after-timeout");
  assert.equal(releases, 0);
}

const pendingAssertion = deferred();
await rejectsPromptly(leaseFixture("hung_select", async (sql, params, run) => {
  if (sql.includes("SELECT status")) await pendingAssertion.promise;
  return run();
}, async ({ assertOwned }) => {
  await assertOwned();
}, { leaseSeconds: 0.1 }), /knowledge_build_execution_lease_lost/);
pendingAssertion.resolve();

const pendingRelease = deferred();
let cleanupAttempts = 0;
const cleanupRun = await leaseFixture("hung_release", async (sql, params, run) => {
  if (isRelease(sql)) {
    cleanupAttempts += 1;
    await pendingRelease.promise;
  }
  return run();
}, async () => "completed", { leaseSeconds: 0.1 });
assert.deepEqual(cleanupRun, { acquired: true, result: "completed" });
assert.equal(cleanupAttempts, 1, "best-effort cleanup must also have a bounded wait");
pendingRelease.resolve();
await new Promise((resolve) => setTimeout(resolve, 20));

await db.close();
console.log("knowledge build lease validation passed");
