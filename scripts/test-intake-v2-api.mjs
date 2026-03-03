import crypto from "node:crypto";

const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
const dryRun = process.env.INTAKE_TEST_DRY_RUN === "1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function id() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function makePayload(seed, overrides = {}) {
  return {
    businessName: `Intake QA ${seed}`,
    industry: "plumbing",
    ownerName: `QA Owner ${seed}`,
    ownerEmail: `intake.qa.${seed}@example.test`,
    password: "qa-password-123",
    phone: "+12065550123",
    serviceArea: "Seattle Metro",
    address: "123 Main St, Seattle, WA 98101",
    timezone: "America/Los_Angeles",
    businessHours: "Mon-Fri 8 AM - 6 PM",
    averageCallsPerDay: 10,
    emergencyServices: true,
    servicesOffered: ["Drain cleaning"],
    primaryGoals: ["reduce_missed_calls"],
    ...overrides
  };
}

async function postJson(path, body, headers = {}) {
  const resp = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  const data = await resp.json().catch(() => null);
  return { status: resp.status, data, headers: resp.headers };
}

async function run() {
  console.log(`[intake-v2-api] baseUrl=${baseUrl} dryRun=${dryRun}`);

  const seed = id();
  const validPayload = makePayload(seed);

  const tests = [
    {
      name: "validation: missing required field returns invalid_payload",
      run: async () => {
        const payload = makePayload(`${seed}a`, { serviceArea: "" });
        const res = await postJson("/api/v1/tenants/onboard", payload);
        assert(res.status === 400, `Expected 400, got ${res.status}`);
        assert(res.data?.error === "invalid_payload", `Expected invalid_payload, got ${res.data?.error}`);
      }
    },
    {
      name: "happy path: onboarding succeeds with canonical response",
      run: async () => {
        const res = await postJson("/api/v1/tenants/onboard", validPayload);
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data?.ok === true, "Expected ok=true");
        assert(typeof res.data?.tenantKey === "string" && res.data.tenantKey.length > 0, "Missing tenantKey");
        assert(res.data?.redirectTo === "/client/overview", `Unexpected redirectTo: ${res.data?.redirectTo}`);
        assert(res.data?.provisioning && typeof res.data.provisioning.voiceStatus === "string", "Missing provisioning block");
      }
    },
    {
      name: "duplicate email: deterministic conflict",
      run: async () => {
        const payload = makePayload(`${seed}b`, { ownerEmail: validPayload.ownerEmail });
        const res = await postJson("/api/v1/tenants/onboard", payload);
        assert(res.status === 409, `Expected 409, got ${res.status}`);
        assert(res.data?.error === "email_exists", `Expected email_exists, got ${res.data?.error}`);
      }
    },
    {
      name: "tenant key collision: same businessName gets suffixed tenantKey",
      run: async () => {
        const payload = makePayload(`${seed}c`, { businessName: validPayload.businessName });
        const res = await postJson("/api/v1/tenants/onboard", payload);
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        assert(res.data?.ok === true, "Expected ok=true");
        assert(res.data?.tenantKey && res.data.tenantKey !== validPayload.businessName, "Missing tenantKey");
      }
    },
    {
      name: "idempotency replay: same key + payload returns consistent success",
      run: async () => {
        const idemSeed = id();
        const idemPayload = makePayload(idemSeed);
        const idemKey = crypto.randomUUID();
        const first = await postJson("/api/v1/tenants/onboard", idemPayload, { "Idempotency-Key": idemKey });
        const second = await postJson("/api/v1/tenants/onboard", idemPayload, { "Idempotency-Key": idemKey });
        assert(first.status === 200 && second.status === 200, `Expected 200/200, got ${first.status}/${second.status}`);
        assert(first.data?.tenantKey === second.data?.tenantKey, "Idempotent replay returned different tenantKey");
      }
    },
    {
      name: "idempotency conflict: same key + different payload returns conflict",
      run: async () => {
        const idemKey = crypto.randomUUID();
        const p1 = makePayload(`${seed}d1`);
        const p2 = makePayload(`${seed}d2`);
        const first = await postJson("/api/v1/tenants/onboard", p1, { "Idempotency-Key": idemKey });
        assert(first.status === 200, `Expected first 200, got ${first.status}`);
        const second = await postJson("/api/v1/tenants/onboard", p2, { "Idempotency-Key": idemKey });
        assert(second.status === 409, `Expected second 409, got ${second.status}`);
        assert(second.data?.error === "idempotency_key_reused", `Expected idempotency_key_reused, got ${second.data?.error}`);
      }
    }
  ];

  for (const test of tests) {
    if (dryRun) {
      console.log(`DRY RUN: ${test.name}`);
      continue;
    }
    process.stdout.write(`- ${test.name} ... `);
    await test.run();
    console.log("ok");
  }

  console.log("[intake-v2-api] complete");
}

run().catch((err) => {
  console.error("[intake-v2-api] failed:", err.message);
  process.exit(1);
});
