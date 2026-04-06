import { requireFlagApproval } from "./_safety.mjs";

const appBaseUrl = normalizeBaseUrl(process.env.APP_BASE_URL || "https://app.everycall.io");
const callGatewayBaseUrl = normalizeBaseUrl(process.env.CALL_GATEWAY_BASE_URL || "");
const tenantEmail = normalizeText(process.env.PRODUCTION_SMOKE_TENANT_EMAIL);
const tenantPassword = String(process.env.PRODUCTION_SMOKE_TENANT_PASSWORD || "");
const adminEmail = normalizeText(process.env.PRODUCTION_SMOKE_ADMIN_EMAIL);
const adminPassword = String(process.env.PRODUCTION_SMOKE_ADMIN_PASSWORD || "");
const requestTimeoutMs = parsePositiveInteger(process.env.PRODUCTION_SMOKE_TIMEOUT_MS, 30000);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeBaseUrl(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return text.replace(/\/+$/, "");
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value || "");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createCookieJar() {
  const store = new Map();
  return {
    addFromResponse(response) {
      const setCookies = typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
      for (const header of setCookies) {
        const pair = String(header || "").split(";")[0] || "";
        const index = pair.indexOf("=");
        if (index <= 0) continue;
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (!name) continue;
        if (value) {
          store.set(name, value);
        } else {
          store.delete(name);
        }
      }
    },
    header() {
      return Array.from(store.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    }
  };
}

async function request(path, {
  method = "GET",
  baseUrl = appBaseUrl,
  cookieJar = null,
  headers = {},
  json = undefined,
  redirect = "manual"
} = {}) {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const requestHeaders = {
    Accept: "application/json, text/html;q=0.9, */*;q=0.8",
    ...headers
  };
  if (cookieJar?.header()) {
    requestHeaders.cookie = cookieJar.header();
  }
  let body;
  if (json !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }
  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body,
    redirect,
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  if (cookieJar) {
    cookieJar.addFromResponse(response);
  }
  const contentType = normalizeText(response.headers.get("content-type")).toLowerCase();
  const text = await response.text();
  return {
    url,
    response,
    status: response.status,
    contentType,
    text,
    json: contentType.includes("application/json")
      ? safeJsonParse(text)
      : null
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatError(error) {
  return error?.message || String(error || "unknown error");
}

function formatDetail(detail) {
  if (detail === null || detail === undefined || detail === "") return "";
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

async function runCheck(results, name, fn) {
  const startedAt = Date.now();
  try {
    const detail = await fn();
    results.push({
      name,
      ok: true,
      durationMs: Date.now() - startedAt,
      detail: formatDetail(detail)
    });
    return detail;
  } catch (error) {
    results.push({
      name,
      ok: false,
      durationMs: Date.now() - startedAt,
      detail: formatError(error)
    });
    return null;
  }
}

function requireJsonOk(payload, label) {
  assert(payload && typeof payload === "object", `${label}: expected JSON object`);
  if (Object.prototype.hasOwnProperty.call(payload, "ok")) {
    assert(payload.ok === true, `${label}: expected ok=true`);
  }
  return payload;
}

async function login({ email, password, role }) {
  const cookieJar = createCookieJar();
  const result = await request("/api/v1/auth/login", {
    method: "POST",
    cookieJar,
    json: { email, password, role }
  });
  assert(result.status === 200, `login(${role}) returned ${result.status}`);
  const payload = result.json;
  assert(payload?.ok === true, `login(${role}) failed`);
  assert(cookieJar.header().includes("everycall_session="), `login(${role}) missing session cookie`);
  return {
    cookieJar,
    payload
  };
}

async function verifyPage(path, cookieJar = null, expectedStatuses = [200]) {
  const result = await request(path, { cookieJar });
  assert(expectedStatuses.includes(result.status), `${path} returned ${result.status}`);
  assert(result.contentType.includes("text/html"), `${path} did not return HTML`);
  assert(/<html/i.test(result.text), `${path} did not look like HTML`);
  return `${result.status} ${path}`;
}

async function verifyJson(path, {
  cookieJar = null,
  expectedStatuses = [200],
  validate = null
} = {}) {
  const result = await request(path, { cookieJar });
  assert(expectedStatuses.includes(result.status), `${path} returned ${result.status}`);
  assert(result.contentType.includes("application/json"), `${path} did not return JSON`);
  assert(result.json && typeof result.json === "object", `${path} returned invalid JSON`);
  if (typeof validate === "function") {
    validate(result.json);
  }
  return result.json;
}

function printSummary(results) {
  const summaryLines = results.map((item) => {
    const status = item.ok ? "PASS" : "FAIL";
    return `${status} ${item.name} (${item.durationMs}ms)${item.detail ? ` - ${item.detail}` : ""}`;
  });
  for (const line of summaryLines) {
    console.log(line);
  }
  const passed = results.filter((item) => item.ok).length;
  const failed = results.length - passed;
  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
}

export async function runProductionSmokeRegression() {
  requireFlagApproval({
    scriptName: "scripts/smoke-production.mjs",
    action: "run authenticated read-only regression checks against production",
    envName: "EVERYCALL_ALLOW_PRODUCTION_REGRESSION",
    extra: [
      "This script logs into live admin and tenant accounts and performs read-only page/API checks."
    ]
  });

  assert(tenantEmail && tenantPassword, "Missing PRODUCTION_SMOKE_TENANT_EMAIL or PRODUCTION_SMOKE_TENANT_PASSWORD");
  assert(adminEmail && adminPassword, "Missing PRODUCTION_SMOKE_ADMIN_EMAIL or PRODUCTION_SMOKE_ADMIN_PASSWORD");

  const results = [];
  let tenantKey = "";

  await runCheck(results, "public version endpoint", async () => {
    const payload = await verifyJson("/api/version", {
      validate: (json) => {
        assert(Object.prototype.hasOwnProperty.call(json, "commitSha"), "missing commitSha");
      }
    });
    return `commit=${payload.commitSha || "unknown"}`;
  });

  for (const path of ["/login", "/intake", "/privacy", "/terms"]) {
    await runCheck(results, `public page ${path}`, async () => verifyPage(path));
  }

  const tenantSession = await runCheck(results, "tenant login", async () => login({
    email: tenantEmail,
    password: tenantPassword,
    role: "client"
  }));

  if (tenantSession?.cookieJar) {
    await runCheck(results, "tenant auth me", async () => {
      const payload = await verifyJson("/api/v1/auth/me", {
        cookieJar: tenantSession.cookieJar,
        validate: (json) => {
          assert(json.authenticated === true, "tenant auth not authenticated");
          assert(json.role === "tenant", "tenant auth returned wrong role");
        }
      });
      tenantKey = normalizeText(payload.tenantKey);
      assert(tenantKey, "tenant auth missing tenantKey");
      return `tenantKey=${tenantKey}`;
    });

    for (const path of [
      "/client/dashboard",
      "/client/calls",
      "/client/receptionist/basics",
      "/client/receptionist/knowledge",
      "/client/account/general",
      "/client/account/billing",
      "/client/team"
    ]) {
      await runCheck(results, `tenant page ${path}`, async () => verifyPage(path, tenantSession.cookieJar));
    }

    let currentBillingPeriodId = null;
    await runCheck(results, "tenant billing API", async () => {
      const payload = await verifyJson("/api/v1/billing", {
        cookieJar: tenantSession.cookieJar,
        validate: (json) => {
          requireJsonOk(json, "tenant billing API");
          assert(json.billing && typeof json.billing === "object", "billing payload missing");
        }
      });
      currentBillingPeriodId = payload?.billing?.currentBillingPeriodId || null;
      return currentBillingPeriodId ? `currentBillingPeriodId=${currentBillingPeriodId}` : "no current billing period id";
    });

    const tenantApiChecks = [
      ["/api/v1/settings", (json) => assert(json.ok === true, "settings not ok")],
      ["/api/v1/overview", (json) => assert(json.stats && typeof json.stats === "object", "overview stats missing")],
      ["/api/v1/client/dashboard", (json) => assert(json.summary && typeof json.summary === "object", "dashboard summary missing")],
      ["/api/v1/client/dashboard/questions?kind=answered&page=1", (json) => assert(Array.isArray(json.items || json.questions || []), "answered questions missing")],
      ["/api/v1/client/dashboard/questions?kind=unanswered&page=1", (json) => assert(Array.isArray(json.items || json.questions || []), "unanswered questions missing")],
      ["/api/v1/tenant/users", (json) => assert(Array.isArray(json.users), "tenant users missing")],
      ["/api/v1/knowledge/builds", (json) => requireJsonOk(json, "knowledge builds")]
    ];
    for (const [path, validate] of tenantApiChecks) {
      await runCheck(results, `tenant API ${path}`, async () => verifyJson(path, {
        cookieJar: tenantSession.cookieJar,
        validate
      }));
    }

    if (currentBillingPeriodId) {
      await runCheck(results, "tenant billing period detail API", async () => verifyJson(
        `/api/v1/billing/periods/${encodeURIComponent(String(currentBillingPeriodId))}`,
        {
          cookieJar: tenantSession.cookieJar,
          validate: (json) => {
            assert(json.billingPeriod && typeof json.billingPeriod === "object", "billing period detail missing");
            assert(Number(json.billingPeriod.billingPeriodId || 0) === Number(currentBillingPeriodId), "wrong billing period detail returned");
          }
        }
      ));
    }

    await runCheck(results, "tenant logout", async () => {
      const result = await request("/api/v1/auth/logout", {
        method: "POST",
        cookieJar: tenantSession.cookieJar
      });
      assert(result.status === 200, `tenant logout returned ${result.status}`);
      return "logged out";
    });
  }

  const adminSession = await runCheck(results, "admin login", async () => login({
    email: adminEmail,
    password: adminPassword,
    role: "admin"
  }));

  if (adminSession?.cookieJar) {
    await runCheck(results, "admin auth me", async () => {
      const payload = await verifyJson("/api/v1/auth/me", {
        cookieJar: adminSession.cookieJar,
        validate: (json) => {
          assert(json.authenticated === true, "admin auth not authenticated");
          assert(json.role === "admin", "admin auth returned wrong role");
        }
      });
      return "authenticated";
    });

    for (const path of [
      "/admin/overview",
      "/admin/system",
      "/admin/tenants",
      tenantKey ? `/admin/tenants/${encodeURIComponent(tenantKey)}` : ""
    ].filter(Boolean)) {
      await runCheck(results, `admin page ${path}`, async () => verifyPage(path, adminSession.cookieJar));
    }

    const adminApiChecks = [
      ["/api/v1/admin/overview", (json) => assert(json.stats && typeof json.stats === "object", "admin overview stats missing")],
      ["/api/v1/system/config", (json) => assert(json.config && typeof json.config === "object", "system config missing")],
      ["/api/v1/admin/billing/report", (json) => assert(Array.isArray(json.rows), "billing report rows missing")],
      ["/api/v1/admin/usage/report", (json) => {
        assert(Array.isArray(json.tenantRows), "usage report tenantRows missing");
        assert(Array.isArray(json.callRows), "usage report callRows missing");
      }],
      ["/api/v1/admin/phone-numbers/report", (json) => assert(json.summary && typeof json.summary === "object", "phone number report summary missing")]
    ];
    for (const [path, validate] of adminApiChecks) {
      await runCheck(results, `admin API ${path}`, async () => verifyJson(path, {
        cookieJar: adminSession.cookieJar,
        validate
      }));
    }

    if (tenantKey) {
      const tenantAdminApiChecks = [
        [`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/billing`, (json) => assert(json.billing && typeof json.billing === "object", "tenant billing missing")],
        [`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/integrations/webhooks`, (json) => assert(Array.isArray(json.connections || []), "tenant webhook connections missing")],
        [`/api/v1/admin/tenants/${encodeURIComponent(tenantKey)}/integrations/connectors`, (json) => assert(Array.isArray(json.connections || []), "tenant connector connections missing")]
      ];
      for (const [path, validate] of tenantAdminApiChecks) {
        await runCheck(results, `admin tenant API ${path}`, async () => verifyJson(path, {
          cookieJar: adminSession.cookieJar,
          validate
        }));
      }
    }

    await runCheck(results, "admin logout", async () => {
      const result = await request("/api/v1/auth/logout", {
        method: "POST",
        cookieJar: adminSession.cookieJar
      });
      assert(result.status === 200, `admin logout returned ${result.status}`);
      return "logged out";
    });
  }

  if (callGatewayBaseUrl) {
    await runCheck(results, "call gateway health", async () => {
      const result = await request("/healthz", {
        baseUrl: callGatewayBaseUrl
      });
      assert(result.status === 200, `call gateway health returned ${result.status}`);
      return result.text.slice(0, 120);
    });
  }

  printSummary(results);
  const failures = results.filter((item) => !item.ok);
  if (failures.length) {
    const error = new Error(`Production smoke regression failed with ${failures.length} failing checks.`);
    error.results = results;
    throw error;
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runProductionSmokeRegression().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
