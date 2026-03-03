import crypto from "node:crypto";

const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
const dryRun = process.env.CLIENT_UI_TEST_DRY_RUN === "1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function id() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

function cookieFromHeaders(headers) {
  const raw = headers.get("set-cookie");
  if (!raw) return "";
  return raw.split(",").map((chunk) => chunk.split(";")[0]).join("; ");
}

function payload(seed) {
  return {
    businessName: `ClientUI E2E ${seed}`,
    industry: "plumbing",
    ownerName: `ClientUI Owner ${seed}`,
    ownerEmail: `client.ui.e2e.${seed}@example.test`,
    password: "qa-password-123",
    phone: "+12065550188",
    serviceArea: "Seattle Metro",
    address: "123 Main St, Seattle, WA 98101",
    timezone: "America/Los_Angeles",
    businessHours: "Mon-Fri 8 AM - 6 PM",
    averageCallsPerDay: 12,
    emergencyServices: true,
    servicesOffered: ["Drain cleaning"],
    primaryGoals: ["reduce_missed_calls"]
  };
}

async function run() {
  console.log(`[client-ui-v2-e2e] baseUrl=${baseUrl} dryRun=${dryRun}`);
  if (dryRun) {
    console.log("DRY RUN: onboard -> visit client pages -> verify setup deep links");
    return;
  }

  const seed = id();
  const onboardResp = await fetch(`${baseUrl}/api/v1/tenants/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload(seed))
  });
  const onboardData = await onboardResp.json().catch(() => null);
  assert(onboardResp.status === 200 && onboardData?.ok === true, "onboarding failed");

  const cookie = cookieFromHeaders(onboardResp.headers);
  assert(cookie.includes("everycall_session="), "session cookie missing");

  async function getHtml(path) {
    const resp = await fetch(`${baseUrl}${path}`, {
      headers: { cookie },
      redirect: "manual"
    });
    assert(resp.status === 200, `${path} returned ${resp.status}`);
    return resp.text();
  }

  await getHtml("/client/overview");
  await getHtml("/client/calls");
  await getHtml("/client/faq");
  await getHtml("/client/routing");
  await getHtml("/client/settings");
  await getHtml("/client/team");
  const setupHtml = await getHtml("/client/setup");

  assert(setupHtml.includes("/client/faq"), "setup missing FAQ deep link");
  assert(setupHtml.includes("/client/team"), "setup missing Team deep link");
  assert(setupHtml.includes("/client/routing"), "setup missing Routing deep link");
  assert(setupHtml.includes("/client/settings"), "setup missing Settings deep link");

  console.log("[client-ui-v2-e2e] complete");
}

run().catch((err) => {
  console.error("[client-ui-v2-e2e] failed:", err.message);
  process.exit(1);
});
