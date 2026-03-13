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
    primaryGoals: ["reduce_missed_calls"],
    knowledgeEntries: [
      {
        sectionType: "services_and_capabilities",
        title: "Services and Capabilities",
        contentText: "We handle drain clogs, backups, and line inspections.",
        sourceType: "website",
        sourceUrl: "https://example.com",
        sourceConfidence: 0.88
      }
    ],
    guardrailQuestionTests: [
      {
        questionText: "How does your warranty work?",
        topic: "warranty",
        riskLevel: "critical",
        answer: ""
      }
    ]
  };
}

async function run() {
  console.log(`[intake-v2-e2e] baseUrl=${baseUrl} dryRun=${dryRun}`);
  const seed = id();
  const body = payload(seed);

  if (dryRun) {
    console.log("DRY RUN: enrichment preview -> onboarding -> forwarding -> assistant gated -> resolve blank Guardrail Question -> enable assistant -> tenant page access");
    return;
  }

  const previewResp = await fetch(`${baseUrl}/api/v1/tenants/enrichment/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ownerEmail: body.ownerEmail,
      website: "https://example.com",
      industry: body.industry
    })
  });
  const previewData = await previewResp.json().catch(() => null);
  assert(previewResp.status === 200, `Expected enrichment preview 200, got ${previewResp.status}`);
  assert(Array.isArray(previewData?.enrichment?.knowledgeEntries), "Expected enrichment knowledge entries");
  assert(Array.isArray(previewData?.enrichment?.guardrailQuestionTests), "Expected enrichment guardrail question list");

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

  const statusBeforeEnableResp = await fetch(`${baseUrl}/api/v1/assistant/status`, {
    headers: { cookie }
  });
  const statusBeforeEnableData = await statusBeforeEnableResp.json().catch(() => null);
  assert(statusBeforeEnableResp.status === 200, `Expected assistant-status 200, got ${statusBeforeEnableResp.status}`);
  assert(statusBeforeEnableData?.assistant?.ready === false, "Expected assistant not ready while blank Guardrail Question exists");

  const knowledgeResp = await fetch(`${baseUrl}/api/v1/knowledge`, { headers: { cookie } });
  const knowledgeData = await knowledgeResp.json().catch(() => null);
  assert(knowledgeResp.status === 200, `Expected knowledge 200, got ${knowledgeResp.status}`);
  const blankGuardrail = (knowledgeData?.guardrailQuestionTests || []).find((item) => !String(item.answer || "").trim());
  assert(blankGuardrail?.questionText, "Expected at least one blank Guardrail Question");

  const saveKnowledgeResp = await fetch(`${baseUrl}/api/v1/knowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      knowledgeEntries: knowledgeData?.knowledgeEntries || [],
      guardrailQuestionTests: (knowledgeData?.guardrailQuestionTests || []).map((item) =>
        item.questionText === blankGuardrail.questionText
          ? { ...item, answer: "We provide a one-year workmanship warranty on qualifying repairs and installs." }
          : item
      )
    })
  });
  const saveKnowledgeData = await saveKnowledgeResp.json().catch(() => null);
  assert(saveKnowledgeResp.status === 200, `Expected knowledge save 200, got ${saveKnowledgeResp.status}`);
  assert(saveKnowledgeData?.ok === true, "Expected knowledge save ok=true");

  const enableResp = await fetch(`${baseUrl}/api/v1/assistant/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ enabled: true })
  });
  const enableData = await enableResp.json().catch(() => null);
  assert(enableResp.status === 200, `Expected assistant enable 200, got ${enableResp.status}`);
  assert(enableData?.assistant?.enabled === true, "Expected assistant enabled=true");

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
