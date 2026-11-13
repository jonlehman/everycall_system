import { PGlite } from '@electric-sql/pglite';
import { bootstrapFixtureSchema } from './schema-migrations.mjs';

// Synthetic, disposable database. No environment files, production connection, or provider calls.
export async function createSalesReportFixture() {
  const db = new PGlite();
  const query = async (sql, params = []) => {
    const result = await db.query(sql, params);
    return { ...result, rowCount: result.rows?.length || Number(result.affectedRows) || 0 };
  };
  // PGlite has one connection; serialize transaction clients like a size-one pool.
  let available = Promise.resolve();
  const pool = { query, connect: async () => {
    const previous = available;
    let release;
    available = new Promise(resolve => { release = resolve; });
    await previous;
    return { query, release };
  } };
  await bootstrapFixtureSchema(pool, { executeSql: sql => db.exec(sql) });
  await query(`INSERT INTO admin_users(id, username, email, password_hash, role) VALUES
    (1,'alex','alex@example.test','fixture','sales'),(2,'jordan','jordan@example.test','fixture','sales'),
    (3,'admin','admin@example.test','fixture','admin')`);
  await query(`INSERT INTO sales_operator_settings(admin_user_id, display_name) VALUES (1,'Alex Sales'), (2,'Jordan Sales')`);
  await query(`INSERT INTO sessions(id,user_id,role,expires_at) VALUES
    ('report-admin',3,'admin',NOW()+interval '1 day'),('report-sales',1,'sales',NOW()+interval '1 day')`);
  await query(`INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,contact_name,timezone,permission_granted)
    VALUES ('fixture-company','fixture-company','Cedar & Pine Plumbing','+12025550111','Changed contact','America/Los_Angeles',TRUE),
    ('fixture-empty','fixture-empty','No call company','+12025550112','Uncalled','UTC',TRUE)`);
  // Multiple contacts must never multiply call counts through a one-to-many join.
  await query(`INSERT INTO sales_prospect_contacts(contact_id,prospect_id,first_name) VALUES
    ('fixture-contact-one','fixture-company','Contact one'),('fixture-contact-two','fixture-company','Contact two')`);
  // Historical live/test fixtures are seeded directly; reporting never invokes call mutations.
  await query('ALTER TABLE sales_call_sessions DISABLE TRIGGER USER');
  await query(`INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state,created_at,started_at,connected_at,demo_started_at,demo_ended_at,ended_at,outcome,outcome_recorded_at,dialed_number,metadata_json)
    SELECT 'call-'||lpad(value::text,3,'0'),'fixture-company',CASE WHEN value%2=0 THEN 1 ELSE 2 END,
      'closed','2026-11-10T12:00:00Z'::timestamptz + ((value/30)||' hours')::interval,
      '2026-11-10T12:00:00Z'::timestamptz,
      CASE WHEN value%2=0 THEN '2026-11-10T12:00:10Z'::timestamptz END,
      CASE WHEN value%4=0 THEN '2026-11-10T12:00:20Z'::timestamptz END,
      CASE WHEN value%4=0 THEN '2026-11-10T12:01:20Z'::timestamptz END,
      '2026-11-10T12:02:10Z'::timestamptz,
      CASE WHEN value%2=0 THEN 'demo_completed' ELSE 'no_answer' END,
      '2026-11-10T12:03:00Z'::timestamptz,'+12025550111',
      '{"contact_snapshot":{"displayName":"Original Contact","email":"contact@example.test","decisionMaker":true,"phoneE164":"+12025550111","private":"SECRET_SNAPSHOT"},"dispositions":["prospect","customer","SECRET_DISPOSITION"],"secret":"SECRET_METADATA"}'::jsonb
    FROM generate_series(1,205) value`);
  const rows = [
    ['micro-a','2026-11-11T12:00:00.000001Z','closed',false],
    ['micro-b','2026-11-11T12:00:00.000002Z','closed',false],
    ['micro-c','2026-11-11T12:00:00.000002Z','closed',false],
    ['in-progress','2026-11-12T12:00:00Z','prospect_connected',false],
    ['test-call','2026-11-13T12:00:00Z','failed',true],
    ['old-call','2023-01-01T12:00:00Z','failed',false],
    ['utc-boundary','2026-11-09T23:59:59.999999Z','failed',false],
  ];
  for (const [id, at, state, test] of rows) await query(`INSERT INTO sales_call_sessions(sales_call_id,prospect_id,admin_user_id,state,created_at,metadata_json)
    VALUES($1,'fixture-company',NULL,$2,$3,$4::jsonb)`, [id,state,at,JSON.stringify({phone_test_mode:test,secret:'SECRET_METADATA'})]);
  await query(`UPDATE sales_call_sessions SET metadata_json=metadata_json || '{"phone_test_mode":true}'::jsonb WHERE sales_call_id='test-call'`);
  await query(`UPDATE sales_call_sessions SET started_at=created_at,connected_at=created_at + interval '5 seconds'
    WHERE sales_call_id='in-progress'`);
  await query(`UPDATE sales_call_sessions SET live_notes=$1,outcome_notes=$2,transcript_json=$3::jsonb,recording_url=$4,
    provider_error_message='SECRET_PROVIDER_PAYLOAD', idempotency_key='SECRET_KEY' WHERE sales_call_id='micro-c'`,
    ['<img src=x onerror=alert(1)>\nNotes "quoted", second line', ' =HYPERLINK("bad","click")',
      JSON.stringify([{role:'caller',text:'Hello <script>window.bad=true</script>',at:'2026-11-11T12:00:00Z',eventId:'SECRET_EVENT'},
        {role:'assistant',text:'How can I help?'},{role:'SECRET_ROLE',text:'Third line'},{text:{private:'SECRET_TEXT'}}]),
      'https://example.test/recording?token=SECRET_RECORDING']);
  await query(`UPDATE sales_call_sessions SET dialed_number='+12025550100',metadata_json=metadata_json || '{"direction":"inbound","prospect_number":"+12025550199"}'::jsonb WHERE sales_call_id='micro-a'`);
  await query('ALTER TABLE sales_call_sessions ENABLE TRIGGER USER');
  return { pool, query, close: () => db.close() };
}

export async function seedSalesTimelineFixture(query) {
  const rows = [
    ['previous-shift',1,'2024-01-29T09:00:00-08:00','2024-01-29T09:10:00-08:00'],
    ['outer',1,'2024-02-01T09:00:00-08:00','2024-02-01T09:20:00-08:00'],
    ['nested',1,'2024-02-01T09:05:00-08:00','2024-02-01T09:10:00-08:00'],
    ['after-five',1,'2024-02-01T09:25:00-08:00','2024-02-01T09:27:00-08:00'],
    ['after-small',1,'2024-02-01T09:29:30-08:00','2024-02-01T09:32:00-08:00'],
    ['other-rep',2,'2024-02-01T09:21:00-08:00','2024-02-01T09:26:00-08:00'],
    ['unknown',1,'2024-02-01T09:35:00-08:00',null],
    ['after-unknown',1,'2024-02-01T10:00:00-08:00','2024-02-01T10:05:00-08:00'],
    ['midnight',2,'2024-02-01T23:58:00-08:00','2024-02-02T00:02:00-08:00'],
    ['next-day',2,'2024-02-02T00:07:00-08:00','2024-02-02T00:10:00-08:00'],
    ['reversed',3,'2024-02-01T09:00:00-08:00','2024-02-01T08:00:00-08:00'],
    ['unassigned-one',null,'2024-02-01T09:00:00-08:00','2024-02-01T09:01:00-08:00'],
    ['unassigned-two',null,'2024-02-01T09:10:00-08:00','2024-02-01T09:11:00-08:00'],
  ];
  for (const [id, rep, start, end] of rows) await query(`INSERT INTO sales_call_sessions
    (sales_call_id,prospect_id,admin_user_id,state,created_at,started_at,ended_at)
    VALUES($1,'fixture-company',$2,$3,$4,$4,$5)`, [`timeline-${id}`,rep,'closed',start,end]);
}

// Provider-shaped synthetic CDRs only. Keep the actual HTTP adapter and report
// handler in the test path; this fixture never loads provider credentials.
export async function installSalesTelnyxFixture(fixture) {
  const originalFetch = globalThis.fetch, originalKey = process.env.SALES_TELNYX_API_KEY, originalApp = process.env.SALES_TELNYX_CALL_CONTROL_APP_ID;
  process.env.SALES_TELNYX_CALL_CONTROL_APP_ID = 'fixture-sales-app';
  let revision = 0;
  const refresh = async () => {
    await fixture.query(`UPDATE sales_call_sessions SET prospect_leg_id='fixture-leg-'||sales_call_id,
      prospect_session_id='fixture-session-'||sales_call_id`);
    process.env.SALES_TELNYX_API_KEY = `synthetic-provider-${++revision}`;
  };
  await refresh();
  let unavailable = false;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.origin !== 'https://api.telnyx.com' || url.pathname !== '/v2/detail_records' || options.method !== 'GET') throw Error('Unexpected fixture provider request');
    if (unavailable) return new Response('{}', { status: 503 });
    const { rows } = await fixture.query(`SELECT sales_call_id, COALESCE(started_at,created_at) AS started_at, ended_at,
      prospect_leg_id, prospect_session_id, COALESCE(metadata_json->>'direction','outbound') AS direction FROM sales_call_sessions`);
    const startLt = Date.parse(url.searchParams.get('filter[started_at][lt]'));
    const startGte = url.searchParams.get('filter[started_at][gte]'), endGt = url.searchParams.get('filter[finished_at][gt]');
    const records = rows.filter(r => Date.parse(r.started_at) < startLt && (startGte ? Date.parse(r.started_at) >= Date.parse(startGte) : Date.parse(r.ended_at) > Date.parse(endGt)))
      .sort((a,b) => Date.parse(a.started_at)-Date.parse(b.started_at) || a.sales_call_id.localeCompare(b.sales_call_id))
      .map(r => ({ record_type: 'call-control', id: r.sales_call_id, telnyx_leg_id: r.prospect_leg_id,
        telnyx_session_id: r.prospect_session_id, connection_id: 'fixture-sales-app', direction: r.direction,
        started_at: new Date(r.started_at).toISOString(), finished_at: r.ended_at ? new Date(r.ended_at).toISOString() : null,
        cli: 'SECRET_PROVIDER_PHONE', dest_number: 'SECRET_PROVIDER_PHONE', user_id: 'SECRET_PROVIDER_USER' }));
    const page = Number(url.searchParams.get('page[number]')), size = Number(url.searchParams.get('page[size]'));
    return Response.json({ data: records.slice((page-1)*size,page*size), meta: { total_pages: Math.ceil(records.length/size),total_results:records.length,page_number:page,page_size:size } });
  };
  return { refresh, fail: async () => { unavailable = true; await refresh(); }, restore: () => {
    globalThis.fetch = originalFetch; if (originalApp === undefined) delete process.env.SALES_TELNYX_CALL_CONTROL_APP_ID; else process.env.SALES_TELNYX_CALL_CONTROL_APP_ID = originalApp; if (originalKey === undefined) delete process.env.SALES_TELNYX_API_KEY; else process.env.SALES_TELNYX_API_KEY = originalKey;
  } };
}
