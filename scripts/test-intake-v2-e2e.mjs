import crypto from "node:crypto";

const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
const dryRun = process.env.INTAKE_TEST_DRY_RUN === "1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function id() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function cookieFromHeaders(headers) {
  const raw = headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(",").map((chunk) => chunk.split(";")[0]).join("; ");
}

function payload(seed) {
  return {
    businessName: `Intake E2E ${seed}`,
    industry: "plumbing",
    ownerName: `E2E Owner ${seed}`,
    ownerEmail: `intake.e2e.${seed}@example.test`,
    password: "qa-password-123",
    phone: "+12065550124",
    serviceArea: "Seattle Metro",
    address: "100 First Ave, Seattle, WA 98101",
    timezone: "America/Los_Angeles",
    businessHours: "Mon-Fri 8 AM - 6 PM",
    averageCallsPerDay: 12,
    emergencyServices: true,
    servicesOffered: ["Drain cleaning"],
    primaryGoals: ["reduce_missed_calls"]
  };
}

async function run() {
  console.log(`[intake-v2-e2e] baseUrl=${baseUrl} dryRun=${dryRun}`);
  const seed = id();
  const body = payload(seed);

  if (dryRun) {
    console.log("DRY RUN: submit onboarding -> assert session -> save forwarding status -> assert tenant page access");
    return;
  }

  const onboardResp = await fetch(`${baseUrl}/api/v1/tenants/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const onboardData = await onboardResp.json().catch(() => null);
  assert(onboardResp.status === 200, `Expected onboarding 200, got ${onboardResp.status}`);
  assert(onboardData?.ok === true, "Expected onboarding ok=true");

  const cookie = cookieFromHeaders(onboardResp.headers);
  assert(cookie.includes("everycall_session="), "Expected session cookie from onboarding");

  const meResp = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { cookie }
  });
  const meData = await meResp.json().catch(() => null);
  assert(meResp.status === 200, `Expected auth/me 200, got ${meResp.status}`);
  assert(meData?.authenticated === true, "Expected authenticated=true");
  assert(meData?.role === "tenant", `Expected tenant role, got ${meData?.role}`);

  const forwardingResp = await fetch(`${baseUrl}/api/v1/tenants/forwarding-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ status: "acknowledged" })
  });
  const forwardingData = await forwardingResp.json().catch(() => null);
  assert(forwardingResp.status === 200, `Expected forwarding-status 200, got ${forwardingResp.status}`);
  assert(forwardingData?.ok === true, "Expected forwarding-status ok=true");
  assert(forwardingData?.forwarding?.status === "acknowledged", "Expected acknowledged forwarding status");

  const overviewResp = await fetch(`${baseUrl}/client/overview`, {
    headers: { cookie },
    redirect: "manual"
  });
  assert(overviewResp.status === 200, `Expected /client/overview 200, got ${overviewResp.status}`);

  console.log("[intake-v2-e2e] complete");
}

run().catch((err) => {
  console.error("[intake-v2-e2e] failed:", err.message);
  process.exit(1);
});
