import crypto from "node:crypto";
import { cleanupTenantByKey } from "./_tenantCleanup.mjs";

const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
const dryRun = process.env.CLIENT_UI_TEST_DRY_RUN === "1";
const cleanupEnabled = process.env.CLIENT_UI_TEST_KEEP_TENANT !== "1";

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

function onboardingPayload(seed) {
  return {
    businessName: `ClientUI QA ${seed}`,
    industry: "plumbing",
    ownerName: `ClientUI Owner ${seed}`,
    ownerEmail: `client.ui.${seed}@example.test`,
    password: "qa-password-123",
    phone: "+12065550177",
    serviceArea: "Seattle Metro",
    address: "123 Main St, Seattle, WA 98101",
    timezone: "America/Los_Angeles",
    businessHours: "Mon-Fri 8 AM - 6 PM",
    averageCallsPerDay: 8,
    emergencyServices: true,
    servicesOffered: ["Drain cleaning"],
    primaryGoals: ["reduce_missed_calls"]
  };
}

async function request(path, opts = {}) {
  const resp = await fetch(`${baseUrl}${path}`, opts);
  const data = await resp.json().catch(() => null);
  return { status: resp.status, data, headers: resp.headers };
}

async function run() {
  console.log(`[client-ui-v2-api] baseUrl=${baseUrl} dryRun=${dryRun}`);
  if (dryRun) {
    console.log("DRY RUN: onboard -> overview/calls -> knowledge save -> routing save -> settings save -> team invite/status");
    return;
  }

  const seed = id();
  let tenantKey = "";
  try {
    const onboard = await request("/api/v1/tenants/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(onboardingPayload(seed))
    });
    assert(onboard.status === 200 && onboard.data?.ok === true, `onboard failed: ${onboard.status}`);
    tenantKey = onboard.data?.tenantKey || "";

    const cookie = cookieFromHeaders(onboard.headers);
    assert(cookie.includes("everycall_session="), "missing session cookie");

    const authed = (path, opts = {}) =>
      request(path, {
        ...opts,
        headers: {
          ...(opts.headers || {}),
          cookie
        }
      });

    const overview = await authed("/api/v1/overview");
    assert(overview.status === 200 && overview.data?.stats, "overview contract failed");

    const calls = await authed("/api/v1/calls");
    assert(calls.status === 200 && Array.isArray(calls.data?.calls), "calls contract failed");

    const knowledgeBefore = await authed("/api/v1/knowledge");
    assert(knowledgeBefore.status === 200 && knowledgeBefore.data?.ok === true, "knowledge load failed");
    const knowledgeEntries = Array.isArray(knowledgeBefore.data?.knowledgeEntries) ? knowledgeBefore.data.knowledgeEntries : [];
    const guardrailQuestionTests = Array.isArray(knowledgeBefore.data?.guardrailQuestionTests) ? knowledgeBefore.data.guardrailQuestionTests : [];
    assert(knowledgeEntries.length > 0, "knowledge entries empty");
    assert(guardrailQuestionTests.length > 0, "guardrail questions empty");

    const updatedKnowledgeEntries = knowledgeEntries.map((entry) =>
      entry.sectionType === "services_and_capabilities"
        ? { ...entry, contentText: "We handle weekday service requests, drain cleaning, and water heater issues." }
        : entry
    );
    const updatedGuardrailQuestions = guardrailQuestionTests.map((item) =>
      item.topic === "availability"
        ? { ...item, answer: "We are available Monday through Friday from 8 AM to 6 PM." }
        : item
    );

    const knowledgeSave = await authed("/api/v1/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        knowledgeEntries: updatedKnowledgeEntries,
        guardrailQuestionTests: updatedGuardrailQuestions
      })
    });
    assert(knowledgeSave.status === 200 && knowledgeSave.data?.ok === true, "knowledge save failed");

    const knowledgeAfter = await authed("/api/v1/knowledge");
    assert(knowledgeAfter.status === 200 && knowledgeAfter.data?.ok === true, "knowledge reload failed");
    assert(
      (knowledgeAfter.data?.knowledgeEntries || []).some((entry) => String(entry.contentText || "").includes("drain cleaning")),
      "knowledge entry update missing"
    );
    assert(
      (knowledgeAfter.data?.guardrailQuestionTests || []).some((item) => item.topic === "availability" && String(item.answer || "").includes("Monday through Friday")),
      "guardrail answer update missing"
    );

    const routingSave = await authed("/api/v1/routing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primaryQueue: "Dispatch Team",
        emergencyBehavior: "Priority Queue",
        afterHoursBehavior: "Collect details and dispatch callback",
        businessHours: "Mon-Fri 8 AM - 6 PM"
      })
    });
    assert(routingSave.status === 200 && routingSave.data?.ok === true, "routing save failed");

    const settingsSave = await authed("/api/v1/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timezone: "America/Los_Angeles",
        notes: "Client UI v2 test note"
      })
    });
    assert(settingsSave.status === 200 && settingsSave.data?.ok === true, "settings save failed");

    const inviteEmail = `invite.${seed}@example.test`;
    const teamInvite = await authed("/api/v1/tenant/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "QA Team Member",
        email: inviteEmail,
        role: "member",
        status: "invited"
      })
    });
    assert(teamInvite.status === 200 && teamInvite.data?.ok === true, "team invite failed");

    const teamList = await authed("/api/v1/tenant/users");
    assert(teamList.status === 200 && teamList.data?.ok === true, "team list failed");
    const invitedUser = (teamList.data?.users || []).find((u) => u.email === inviteEmail);
    assert(invitedUser?.id, "invited user missing from team list");

    const statusUpdate = await authed("/api/v1/tenant/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "status",
        id: invitedUser.id,
        status: "active"
      })
    });
    assert(statusUpdate.status === 200 && statusUpdate.data?.ok === true, "team status update failed");

    console.log("[client-ui-v2-api] complete");
  } finally {
    if (cleanupEnabled && tenantKey) {
      const result = await cleanupTenantByKey(tenantKey, { releaseNumber: true });
      console.log(`[client-ui-v2-api] cleanup deleted=${result.deleted} tenant=${result.tenantKey}`);
    }
  }
}

run().catch((err) => {
  console.error("[client-ui-v2-api] failed:", err.message);
  process.exit(1);
});
