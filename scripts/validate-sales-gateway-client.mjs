import assert from "node:assert/strict";
import {
  getSalesGatewayHealth,
  sendSalesCallAction
} from "../pages/api/_lib/salesGatewayClient.js";

const env = {
  SALES_CALL_GATEWAY_BASE_URL: "https://sales-gateway.example/",
  INTERNAL_SERVICE_SECRET: "test-internal-secret"
};
const requests = [];
const fetchImpl = async (url, options) => {
  requests.push({ url, options });
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async text() {
      return JSON.stringify({ ok: true });
    }
  };
};

await sendSalesCallAction("sales-call-1", "Start Demo", {
  payload: { greeting: "hello" },
  fetchImpl,
  env
});
assert.equal(
  requests[0].url,
  "https://sales-gateway.example/internal/calls/sales-call-1/actions"
);
assert.match(requests[0].options.headers.Authorization, /^Bearer [A-Za-z0-9_-]+$/);
assert.deepEqual(JSON.parse(requests[0].options.body), {
  action: "start_demo",
  payload: { greeting: "hello" }
});

await getSalesGatewayHealth({ fetchImpl, env });
assert.equal(
  requests[1].url,
  "https://sales-gateway.example/internal/health"
);
assert.equal(requests[1].options.method, "GET");

console.log("sales gateway client validation passed");
