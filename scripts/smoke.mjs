import crypto from "node:crypto";

const callGateway = process.env.CALL_GATEWAY_URL ?? "http://localhost:3101";
const twilioToken = process.env.TWILIO_AUTH_TOKEN ?? "";
const twilioToNumber = process.env.TWILIO_TEST_TO_NUMBER ?? "+13854691336";

function twilioSig(url, params, token) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => `${acc}${key}${params[key]}`, url);
  return crypto.createHmac("sha1", token).update(data, "utf8").digest("base64");
}

async function postForm(url, form, headers = {}) {
  const body = new URLSearchParams(form).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers
    },
    body
  });
  return res;
}

async function main() {
  const health = await fetch(`${callGateway}/healthz`);
  console.log("call-gateway", health.status, (await health.text()).slice(0, 120));

  console.log("ai-orchestrator", "removed");
  console.log("voice-service", "removed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
