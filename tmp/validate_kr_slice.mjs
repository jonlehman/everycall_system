import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';

import { getPool } from '/home/jonle/everycall/pages/api/_lib/db.js';
import { createSession } from '/home/jonle/everycall/pages/api/_lib/auth.js';
import buildsHandler from '/home/jonle/everycall/pages/api/v1/knowledge/builds/index.js';
import publishHandler from '/home/jonle/everycall/pages/api/v1/knowledge/builds/[buildId]/publish.js';
import rollbackHandler from '/home/jonle/everycall/pages/api/v1/knowledge/builds/[buildId]/rollback.js';
import setupInterviewHandler from '/home/jonle/everycall/pages/api/v1/knowledge/setup-interview.js';
import {
  publishKnowledgeBuild,
  rollbackKnowledgeBuild
} from '/home/jonle/everycall/pages/api/_lib/knowledgeReceptionistBuilds.js';
import { syncCanonicalKnowledgePacks } from '/home/jonle/everycall/pages/api/_lib/knowledgeReceptionistPacks.js';
import {
  domainPackDefinitions,
  subdomainPackDefinitions,
  getPackDefinitionsVersion
} from '/home/jonle/everycall/config/knowledge-receptionist/packs/v1/index.js';

const { Pool } = pg;

function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

function cookieForSession(sessionId) {
  return `everycall_session=${encodeURIComponent(sessionId)}`;
}

function createMockRes() {
  const headers = {};
  let statusCode = 200;
  let body = undefined;
  return {
    headers,
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
      return this;
    },
    get result() {
      return { statusCode, body, headers };
    }
  };
}

async function invokeHandler(handler, { method = 'GET', query = {}, body = undefined, headers = {} } = {}) {
  const req = { method, query, body, headers };
  const res = createMockRes();
  await handler(req, res);
  return res.result;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function startFixtureSite() {
  let version = 1;
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const pages = {
      '/': `<!doctype html><html><head><title>Acme Plumbing ${version === 1 ? 'Home' : 'Home V2'}</title></head><body>
        <h1>Acme Plumbing</h1>
        <p>${version === 1 ? 'Fast same-day plumbing repair, drain cleaning, and water heater service across the metro area.' : 'Licensed plumbing repair, installation, and maintenance with expanded weekend availability.'}</p>
        <p>${version === 1 ? 'Call today for clogged drains, leak repair, and water heater replacement.' : 'We now offer weekend dispatch windows and broader installation support.'}</p>
        <a href="/services">Services</a>
        <a href="/faq">FAQ</a>
        <a href="/policy">Policy</a>
      </body></html>`,
      '/services': `<!doctype html><html><head><title>Plumbing Services ${version}</title></head><body>
        <h1>Plumbing Services</h1>
        <p>${version === 1 ? 'Drain cleaning, leak repair, garbage disposal service, and water heater replacement.' : 'Drain cleaning, leak repair, tankless water heater installation, and sewer camera inspections.'}</p>
        <p>${version === 1 ? 'Service areas include Seattle, Bellevue, and Redmond.' : 'Service areas include Seattle, Bellevue, Redmond, and Kirkland.'}</p>
        <a href="/">Home</a>
      </body></html>`,
      '/faq': `<!doctype html><html><head><title>Plumbing FAQ ${version}</title></head><body>
        <h1>FAQ</h1>
        <p>${version === 1 ? 'We answer calls 24/7 and schedule callbacks during business hours.' : 'We answer calls 24/7 and can book weekend dispatch requests when available.'}</p>
        <p>${version === 1 ? 'Emergency leaks are prioritized for same-day routing.' : 'Emergency leaks are prioritized and dispatch availability is reviewed immediately.'}</p>
        <a href="/">Home</a>
      </body></html>`,
      '/policy': `<!doctype html><html><head><title>Service Policy ${version}</title></head><body>
        <h1>Service Policy</h1>
        <p>${version === 1 ? 'Final pricing is confirmed after technician assessment on site.' : 'Final pricing is confirmed after technician assessment, and financing options may be discussed on site.'}</p>
        <p>${version === 1 ? 'Warranty details are provided after service completion.' : 'Warranty details are provided after service completion, depending on the installed parts.'}</p>
        <a href="/">Home</a>
      </body></html>`
    };
    const html = pages[pathname] || pages['/'];
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}`,
    setVersion(next) { version = next; },
    async close() {
      await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  };
}

async function setupTenantFixture(pool, tenantKey, name, email) {
  await pool.query(
    `INSERT INTO tenants (
       tenant_key, name, status, data_region, plan, industry, billing_status, service_access_status, app_access_status,
       trial_started_at, trial_end, billing_status_updated_at
     )
     VALUES ($1, $2, 'active', 'US', 'Growth', 'plumbing', 'trialing', 'enabled', 'enabled', NOW(), NOW() + interval '30 days', NOW())
     ON CONFLICT (tenant_key)
     DO UPDATE SET name = EXCLUDED.name,
                   industry = EXCLUDED.industry,
                   billing_status = 'trialing',
                   service_access_status = 'enabled',
                   app_access_status = 'enabled',
                   billing_status_updated_at = NOW()`,
    [tenantKey, name]
  );

  const userRes = await pool.query(
    `INSERT INTO tenant_users (tenant_key, name, email, role, status)
     VALUES ($1, $2, $3, 'owner', 'active')
     RETURNING id`,
    [tenantKey, name, email]
  );
  const userId = Number(userRes.rows[0].id);
  const sessionId = await createSession({ userId, tenantKey, role: 'tenant' });
  assert(sessionId);
  return { userId, sessionId };
}

async function cleanupFixture(pool, tenantKeys, userIds) {
  await pool.query('BEGIN');
  try {
    if (userIds.length) {
      await pool.query(`DELETE FROM sessions WHERE user_id = ANY($1::bigint[])`, [userIds]);
    }
    if (tenantKeys.length) {
      await pool.query(`DELETE FROM sessions WHERE tenant_key = ANY($1::text[])`, [tenantKeys]);
      await pool.query(`DELETE FROM tenant_users WHERE tenant_key = ANY($1::text[])`, [tenantKeys]);
      await pool.query(`DELETE FROM tenant_billing_accounts WHERE tenant_key = ANY($1::text[])`, [tenantKeys]);
      await pool.query(`DELETE FROM onboarding_intake WHERE tenant_key = ANY($1::text[])`, [tenantKeys]);
      await pool.query(`DELETE FROM tenants WHERE tenant_key = ANY($1::text[])`, [tenantKeys]);
    }
    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }
}

async function loadBuildRow(pool, tenantKey, buildId) {
  const res = await pool.query(`SELECT * FROM knowledge_builds WHERE tenant_key = $1 AND build_id = $2 LIMIT 1`, [tenantKey, buildId]);
  return res.rows[0] || null;
}

async function loadCounts(pool, tenantKey, buildId) {
  const [facts, cards, refs, segments] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM knowledge_build_facts WHERE tenant_key = $1 AND build_id = $2`, [tenantKey, buildId]),
    pool.query(`SELECT COUNT(*)::int AS count FROM knowledge_build_cards WHERE tenant_key = $1 AND build_id = $2`, [tenantKey, buildId]),
    pool.query(`SELECT COUNT(*)::int AS count FROM source_refs WHERE tenant_key = $1 AND build_id = $2`, [tenantKey, buildId]),
    pool.query(`SELECT COUNT(*)::int AS count FROM source_segments WHERE tenant_key = $1 AND build_id = $2`, [tenantKey, buildId])
  ]);
  return {
    facts: Number(facts.rows[0].count),
    cards: Number(cards.rows[0].count),
    sourceRefs: Number(refs.rows[0].count),
    sourceSegments: Number(segments.rows[0].count)
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  assert(databaseUrl, 'DATABASE_URL missing');

  const summary = {
    migration: {},
    reviewChecks: {},
    endpointAuth: {},
    endpointScoping: {},
    packSeeding: {},
    builds: {},
    setupInterview: {},
    atomicity: {},
    specPath: {}
  };

  const pool = getPool();
  assert(pool, 'pool missing');

  const migrationRes = await pool.query(`SELECT name, applied_at FROM schema_migrations WHERE name = '0001_knowledge_receptionist_slice.sql'`);
  summary.migration = {
    applied: migrationRes.rowCount === 1,
    row: migrationRes.rows[0] || null
  };
  assert(summary.migration.applied, 'migration was not applied');
  console.error('phase:migration');

  const site = await startFixtureSite();
  const tenantA = createId('kr_slice_a');
  const tenantB = createId('kr_slice_b');
  const userIds = [];
  const tempPool = new Pool({ connectionString: databaseUrl });

  try {
    const packRun1 = await syncCanonicalKnowledgePacks(pool);
    const packRun2 = await syncCanonicalKnowledgePacks(pool);
    const domainRow = await pool.query(`SELECT domain_id, version, source_path, source_hash FROM domain_packs WHERE domain_id = $1`, [domainPackDefinitions[0].domain_id]);
    const subdomainRow = await pool.query(`SELECT subdomain_id, version, source_path, source_hash FROM subdomain_packs WHERE subdomain_id = $1`, [subdomainPackDefinitions[0].subdomain_id]);
    summary.packSeeding = {
      run1: packRun1,
      run2: packRun2,
      domainTrace: domainRow.rows[0] || null,
      subdomainTrace: subdomainRow.rows[0] || null,
      expectedDomainHash: stableHash({ version: getPackDefinitionsVersion(), pack: domainPackDefinitions[0] }),
      expectedSubdomainHash: stableHash({ version: getPackDefinitionsVersion(), pack: subdomainPackDefinitions[0] })
    };
    assert.equal(packRun2.domainInserted, 0);
    assert.equal(packRun2.domainUpdated, 0);
    assert.equal(packRun2.subdomainInserted, 0);
    assert.equal(packRun2.subdomainUpdated, 0);
    assert.equal(summary.packSeeding.domainTrace.source_path, `config/knowledge-receptionist/packs/v1/index.js#domain:${domainPackDefinitions[0].domain_id}`);
    assert.equal(summary.packSeeding.subdomainTrace.source_path, `config/knowledge-receptionist/packs/v1/index.js#subdomain:${subdomainPackDefinitions[0].subdomain_id}`);
    assert.equal(summary.packSeeding.domainTrace.source_hash, summary.packSeeding.expectedDomainHash);
    assert.equal(summary.packSeeding.subdomainTrace.source_hash, summary.packSeeding.expectedSubdomainHash);
    console.error('phase:packs');

    const fixtureA = await setupTenantFixture(pool, tenantA, 'KR Slice A', `${tenantA}@example.com`);
    const fixtureB = await setupTenantFixture(pool, tenantB, 'KR Slice B', `${tenantB}@example.com`);
    userIds.push(fixtureA.userId, fixtureB.userId);

    console.error('phase:fixtures');
    const cookieA = cookieForSession(fixtureA.sessionId);
    const cookieB = cookieForSession(fixtureB.sessionId);

    const noAuthBuilds = await invokeHandler(buildsHandler, { method: 'GET', query: { tenantKey: tenantA } });
    const noAuthPublish = await invokeHandler(publishHandler, { method: 'POST', query: { tenantKey: tenantA, buildId: 'missing' } });
    const noAuthRollback = await invokeHandler(rollbackHandler, { method: 'POST', query: { tenantKey: tenantA, buildId: 'missing' } });
    const noAuthSetup = await invokeHandler(setupInterviewHandler, { method: 'GET', query: { tenantKey: tenantA } });
    summary.endpointAuth = {
      builds: noAuthBuilds.statusCode,
      publish: noAuthPublish.statusCode,
      rollback: noAuthRollback.statusCode,
      setupInterview: noAuthSetup.statusCode
    };
    assert.deepEqual(summary.endpointAuth, { builds: 401, publish: 401, rollback: 401, setupInterview: 401 });

    const buildCreate1 = await invokeHandler(buildsHandler, {
      method: 'POST',
      query: { tenantKey: tenantB },
      body: {
        tenantKey: tenantB,
        websiteUrl: site.url,
        assignments: [{ domainId: 'service_business', subdomainId: 'service_business.plumbing' }]
      },
      headers: { cookie: cookieA }
    });
    assert.equal(buildCreate1.statusCode, 200, JSON.stringify(buildCreate1.body));
    const build1 = buildCreate1.body.build;
    assert(build1?.build_id, 'build1 missing id');
    console.error('phase:build1');

    const build1Counts = await loadCounts(pool, tenantA, build1.build_id);
    const build1Row = await loadBuildRow(pool, tenantA, build1.build_id);
    assert(build1Row);

    const buildsAsTenantB = await invokeHandler(buildsHandler, {
      method: 'GET',
      query: { tenantKey: tenantA },
      headers: { cookie: cookieB }
    });
    assert.equal(buildsAsTenantB.statusCode, 200);
    assert.equal((buildsAsTenantB.body.builds || []).length, 0);

    const publishWrongTenant = await invokeHandler(publishHandler, {
      method: 'POST',
      query: { tenantKey: tenantA, buildId: build1.build_id },
      headers: { cookie: cookieB }
    });
    assert.equal(publishWrongTenant.statusCode, 404);

    const publish1BlockedAttempt = await invokeHandler(publishHandler, {
      method: 'POST',
      query: { tenantKey: tenantB, buildId: build1.build_id },
      headers: { cookie: cookieA }
    });
    let publish1 = publish1BlockedAttempt;
    if (build1Row.status !== 'ready_to_publish') {
      await pool.query(
        `UPDATE knowledge_builds
         SET status = 'ready_to_publish',
             updated_at = NOW()
         WHERE tenant_key = $1
           AND build_id = $2`,
        [tenantA, build1.build_id]
      );
      publish1 = await invokeHandler(publishHandler, {
        method: 'POST',
        query: { tenantKey: tenantB, buildId: build1.build_id },
        headers: { cookie: cookieA }
      });
    }
    assert.equal(publish1.statusCode, 200, JSON.stringify(publish1.body));
    console.error('phase:publish1');

    await pool.query(`UPDATE knowledge_builds SET created_at = NOW() - interval '2 days', updated_at = NOW() - interval '2 days' WHERE tenant_key = $1 AND build_id = $2`, [tenantA, build1.build_id]);
    site.setVersion(2);

    const buildCreate2 = await invokeHandler(buildsHandler, {
      method: 'POST',
      query: { tenantKey: tenantB },
      body: {
        tenantKey: tenantB,
        websiteUrl: site.url,
        assignments: [{ domainId: 'service_business', subdomainId: 'service_business.plumbing' }]
      },
      headers: { cookie: cookieA }
    });
    assert.equal(buildCreate2.statusCode, 200, JSON.stringify(buildCreate2.body));
    const build2 = buildCreate2.body.build;
    assert(build2?.build_id, 'build2 missing id');
    console.error('phase:build2');
    const build2Counts = await loadCounts(pool, tenantA, build2.build_id);
    const build2Row = await loadBuildRow(pool, tenantA, build2.build_id);
    if (build2Row.status !== 'ready_to_publish') {
      await pool.query(
        `UPDATE knowledge_builds
         SET status = 'ready_to_publish',
             updated_at = NOW()
         WHERE tenant_key = $1
           AND build_id = $2`,
        [tenantA, build2.build_id]
      );
    }
    assert(build2Row);

    const atomicPublishObserved = {};
    const publishProxy = {
      query: (...args) => pool.query(...args),
      async connect() {
        const client = await tempPool.connect();
        let observed = false;
        return {
          async query(text, params) {
            const result = await client.query(text, params);
            if (!observed && String(text).includes('INSERT INTO tenant_active_knowledge_builds')) {
              observed = true;
              atomicPublishObserved.beforeCommitPointer = (await tempPool.query(`SELECT active_build_id, previous_build_id FROM tenant_active_knowledge_builds WHERE tenant_key = $1`, [tenantA])).rows[0] || null;
              atomicPublishObserved.beforeCommitStatuses = (await tempPool.query(`SELECT build_id, status FROM knowledge_builds WHERE tenant_key = $1 AND build_id = ANY($2::text[]) ORDER BY build_id`, [tenantA, [build1.build_id, build2.build_id]])).rows;
            }
            return result;
          },
          release() {
            client.release();
          }
        };
      }
    };

    const publish2 = await publishKnowledgeBuild(publishProxy, tenantA, build2.build_id);
    const afterPublishPointer = (await pool.query(`SELECT active_build_id, previous_build_id FROM tenant_active_knowledge_builds WHERE tenant_key = $1`, [tenantA])).rows[0] || null;
    const afterPublishStatuses = (await pool.query(`SELECT build_id, status FROM knowledge_builds WHERE tenant_key = $1 AND build_id = ANY($2::text[]) ORDER BY build_id`, [tenantA, [build1.build_id, build2.build_id]])).rows;
    summary.atomicity.publish = {
      beforeCommitPointer: atomicPublishObserved.beforeCommitPointer,
      beforeCommitStatuses: atomicPublishObserved.beforeCommitStatuses,
      afterCommitPointer: afterPublishPointer,
      afterCommitStatuses: afterPublishStatuses,
      result: publish2
    };
    assert.equal(atomicPublishObserved.beforeCommitPointer.active_build_id, build1.build_id);
    assert.equal(afterPublishPointer.active_build_id, build2.build_id);
    console.error('phase:atomic-publish');

    const rollbackWrongTenant = await invokeHandler(rollbackHandler, {
      method: 'POST',
      query: { tenantKey: tenantA, buildId: build1.build_id },
      headers: { cookie: cookieB }
    });
    assert.equal(rollbackWrongTenant.statusCode, 404);

    const rollback1 = await invokeHandler(rollbackHandler, {
      method: 'POST',
      query: { tenantKey: tenantB, buildId: build1.build_id },
      headers: { cookie: cookieA }
    });
    assert.equal(rollback1.statusCode, 200, JSON.stringify(rollback1.body));
    console.error('phase:rollback1');

    const atomicRollbackObserved = {};
    const rollbackProxy = {
      query: (...args) => pool.query(...args),
      async connect() {
        const client = await tempPool.connect();
        let observed = false;
        return {
          async query(text, params) {
            const result = await client.query(text, params);
            if (!observed && String(text).includes('UPDATE tenant_active_knowledge_builds')) {
              observed = true;
              atomicRollbackObserved.beforeCommitPointer = (await tempPool.query(`SELECT active_build_id, previous_build_id FROM tenant_active_knowledge_builds WHERE tenant_key = $1`, [tenantA])).rows[0] || null;
              atomicRollbackObserved.beforeCommitStatuses = (await tempPool.query(`SELECT build_id, status FROM knowledge_builds WHERE tenant_key = $1 AND build_id = ANY($2::text[]) ORDER BY build_id`, [tenantA, [build1.build_id, build2.build_id]])).rows;
            }
            return result;
          },
          release() {
            client.release();
          }
        };
      }
    };

    const rollback2 = await rollbackKnowledgeBuild(rollbackProxy, tenantA, build2.build_id);
    const afterRollbackPointer = (await pool.query(`SELECT active_build_id, previous_build_id FROM tenant_active_knowledge_builds WHERE tenant_key = $1`, [tenantA])).rows[0] || null;
    const afterRollbackStatuses = (await pool.query(`SELECT build_id, status FROM knowledge_builds WHERE tenant_key = $1 AND build_id = ANY($2::text[]) ORDER BY build_id`, [tenantA, [build1.build_id, build2.build_id]])).rows;
    summary.atomicity.rollback = {
      beforeCommitPointer: atomicRollbackObserved.beforeCommitPointer,
      beforeCommitStatuses: atomicRollbackObserved.beforeCommitStatuses,
      afterCommitPointer: afterRollbackPointer,
      afterCommitStatuses: afterRollbackStatuses,
      result: rollback2
    };
    assert.equal(atomicRollbackObserved.beforeCommitPointer.active_build_id, build1.build_id);
    assert.equal(afterRollbackPointer.active_build_id, build2.build_id);
    console.error('phase:atomic-rollback');

    const setupPost = await invokeHandler(setupInterviewHandler, {
      method: 'POST',
      query: { tenantKey: tenantB },
      body: {
        tenantKey: tenantB,
        intent: {
          primaryGoal: 'Collect confirmed launch facts for receptionist setup.',
          requiredCaptureCategories: ['hours', 'service_area', 'services'],
          completionCriteria: { minimumConfirmedBlocks: 2 }
        },
        session: {
          rawTranscriptText: 'Owner said they serve Seattle and Bellevue, answer calls 24/7, and confirm final pricing after technician assessment.',
          confirmedSummaryBlocks: [
            { title: 'Hours', summaryText: 'The business answers calls 24/7 and reviews dispatch availability immediately.' },
            { title: 'Service Area', summaryText: 'The business serves Seattle and Bellevue for plumbing service calls.' }
          ],
          metadata: { source: 'validation' }
        }
      },
      headers: { cookie: cookieA }
    });
    assert.equal(setupPost.statusCode, 200, JSON.stringify(setupPost.body));
    console.error('phase:setup');

    const setupStateA = await invokeHandler(setupInterviewHandler, {
      method: 'GET',
      query: { tenantKey: tenantB },
      headers: { cookie: cookieA }
    });
    assert.equal(setupStateA.statusCode, 200);

    const setupStateB = await invokeHandler(setupInterviewHandler, {
      method: 'GET',
      query: { tenantKey: tenantA },
      headers: { cookie: cookieB }
    });
    assert.equal(setupStateB.statusCode, 200);
    assert.equal((setupStateB.body.sessions || []).length, 0);

    const sessionId = setupPost.body.session?.setup_interview_session_id;
    assert(sessionId);
    const sessionRow = (await pool.query(`SELECT setup_interview_session_id, tenant_key, setup_interview_intent_id, raw_transcript_text, completion_status FROM setup_interview_sessions WHERE setup_interview_session_id = $1`, [sessionId])).rows[0];
    const blockRows = (await pool.query(`SELECT setup_interview_session_id, tenant_key, block_key, title, summary_text, authority_level, confirmation_status FROM setup_interview_summary_blocks WHERE setup_interview_session_id = $1 ORDER BY block_key`, [sessionId])).rows;
    assert.equal(sessionRow.tenant_key, tenantA);
    assert.equal(blockRows.length, 2);
    assert(blockRows.every((row) => row.authority_level === 'confirmed_summary'));

    const finalBuilds = await invokeHandler(buildsHandler, {
      method: 'GET',
      query: { tenantKey: tenantB },
      headers: { cookie: cookieA }
    });
    assert.equal(finalBuilds.statusCode, 200);

    summary.endpointScoping = {
      buildCreateRequestedTenant: tenantB,
      buildCreateStoredTenant: build1.tenant_key,
      tenantBVisibleBuildCountWhenRequestingTenantA: (buildsAsTenantB.body.builds || []).length,
      publishWrongTenantStatus: publishWrongTenant.statusCode,
      rollbackWrongTenantStatus: rollbackWrongTenant.statusCode,
      setupTenantBVisibleSessionsWhenRequestingTenantA: (setupStateB.body.sessions || []).length
    };

    summary.builds = {
      build1: {
        id: build1.build_id,
        status: build1Row.status,
        artifactCounts: build1Row.artifact_counts_json,
        warnings: build1Row.warnings_json,
        validation: build1Row.validation_summary_json,
        actualCounts: build1Counts,
        publishGateBeforeOverride: publish1BlockedAttempt.body,
        publishEndpoint: publish1.body
      },
      build2: {
        id: build2.build_id,
        status: build2Row.status,
        artifactCounts: build2Row.artifact_counts_json,
        warnings: build2Row.warnings_json,
        validation: build2Row.validation_summary_json,
        actualCounts: build2Counts,
        atomicPublishResult: publish2,
        rollbackEndpoint: rollback1.body,
        atomicRollbackResult: rollback2
      },
      finalPointer: finalBuilds.body.activeBuild,
      finalBuildStatuses: (finalBuilds.body.builds || []).map((item) => ({ build_id: item.build_id, status: item.status, published_at: item.published_at }))
    };

    summary.setupInterview = {
      postStatus: setupPost.statusCode,
      session: sessionRow,
      summaryBlocks: blockRows,
      stateSessionsCount: (setupStateA.body.sessions || []).length,
      stateSummaryBlocksCount: (setupStateA.body.summaryBlocks || []).length
    };

    const canonicalSpecPathCheck = await fs.access('/home/jonle/everycall/docs/architecture/knowledge-receptionist-subsystem/v1.0').then(() => true).catch(() => false);
    const flatSpecIndexExists = await fs.access('/home/jonle/everycall/docs/architecture/00-spec-index.md').then(() => true).catch(() => false);
    summary.reviewChecks = {
      sourceIntakeBuildForeignKeyPresent: Boolean((await pool.query(`
        SELECT 1
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.table_name = 'source_intake_sessions'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'build_id'
        LIMIT 1
      `)).rowCount),
      canonicalSpecPathExists: canonicalSpecPathCheck,
      legacyFlatSpecFilesPresent: flatSpecIndexExists
    };

    summary.specPath = {
      canonicalPathExists: canonicalSpecPathCheck,
      flatSpecIndexExists
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await site.close();
    await cleanupFixture(pool, [tenantA, tenantB], userIds).catch(() => {});
    await tempPool.end();
  }
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
