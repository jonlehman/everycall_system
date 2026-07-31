import http from "node:http";
import pg from "pg";
import { logError, logInfo } from "@everycall/observability";
import { createSalesCallGateway } from "./gateway.js";
import { createPostgresSalesGatewayRepository } from "./repository.js";
import { createSalesXAIRealtimeClient } from "./salesXAIRealtime.js";
import { createSalesTelnyxClient } from "./salesTelnyxClient.js";

function requiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name.toLowerCase()}_required`);
  return value;
}

function booleanEnv(name: string, fallback = true): boolean {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "no", "off"].includes(value);
}

const databaseUrl = requiredEnv("DATABASE_URL");
const internalServiceSecret = requiredEnv("INTERNAL_SERVICE_SECRET");
requiredEnv("SALES_TELNYX_API_KEY");
const telnyxPublicKey = requiredEnv("SALES_TELNYX_PUBLIC_KEY");
requiredEnv("SALES_TELNYX_CALL_CONTROL_APP_ID");
const telnyxOperatorConnectionId = requiredEnv(
  "SALES_TELNYX_OPERATOR_CONNECTION_ID"
);
requiredEnv("SALES_TELNYX_CALLER_ID");
requiredEnv("SALES_XAI_API_KEY");
requiredEnv("SALES_XAI_PHONE_NUMBER");
const xaiWebhookSecret = requiredEnv("SALES_XAI_WEBHOOK_SECRET");
const port = Math.max(1, Math.min(65_535, Number(process.env.PORT) || 3102));

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: Math.max(1, Math.min(10, Number(process.env.SALES_DATABASE_POOL_MAX) || 5))
});
const repository = createPostgresSalesGatewayRepository(pool);
const telnyx = createSalesTelnyxClient();
const xai = createSalesXAIRealtimeClient();
const gateway = createSalesCallGateway({
  repository,
  telnyx,
  xai,
  internalAuthEnv: { INTERNAL_SERVICE_SECRET: internalServiceSecret },
  telnyxPublicKey,
  telnyxOperatorConnectionId,
  xaiWebhookSecret,
  requireTelnyxSignature: booleanEnv("SALES_TELNYX_SIGNATURE_REQUIRED", true),
  requireXAISignature: booleanEnv("SALES_XAI_SIGNATURE_REQUIRED", true),
  aiDemoMaxSeconds: Number(process.env.SALES_AI_DEMO_MAX_SECONDS) || 600,
  logger: {
    info: (event, fields = {}) => logInfo(event, fields as any),
    warn: (event, fields = {}) => logInfo(event, { ...fields, level: "warn" } as any),
    error: (event, fields = {}) => logError(event, fields as any)
  }
});
const server = http.createServer(gateway.app);
const providerRecoveryIntervalMs = Math.max(
  15_000,
  Math.min(
    300_000,
    Number(process.env.SALES_PROVIDER_EVENT_RECOVERY_INTERVAL_MS) || 30_000
  )
);

await pool.query("SELECT 1");
try {
  const recovery = await gateway.recoverProviderEvents();
  logInfo("sales_call_gateway_provider_event_recovery_completed", recovery);
} catch (error) {
  logError("sales_call_gateway_provider_event_recovery_failed", {
    message: error instanceof Error ? error.message : String(error)
  });
}
try {
  const recovery = await gateway.recoverRealtimeSessions();
  logInfo("sales_call_gateway_realtime_recovery_completed", recovery);
} catch (error) {
  logError("sales_call_gateway_realtime_recovery_failed", {
    message: error instanceof Error ? error.message : String(error)
  });
}

server.listen(port, () => {
  logInfo("sales_call_gateway_started", {
    port,
    runtimeMode: "single_instance",
    productionVoiceIsolation: true
  });
});
const providerRecoveryTimer = setInterval(() => {
  void (async () => {
    try {
      const providerRecovery = await gateway.recoverProviderEvents();
      if (providerRecovery.recovered || providerRecovery.failed) {
        logInfo(
          "sales_call_gateway_provider_event_recovery_tick",
          providerRecovery
        );
      }
      const callRecovery = await gateway.recoverRealtimeSessions();
      if (callRecovery.recovered || callRecovery.failed) {
        logInfo("sales_call_gateway_call_recovery_tick", callRecovery);
      }
    } catch (error) {
      logError("sales_call_gateway_recovery_tick_failed", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  })();
}, providerRecoveryIntervalMs);
providerRecoveryTimer.unref();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(providerRecoveryTimer);
  logInfo("sales_call_gateway_stopping", { signal });
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
