import crypto from "crypto";

export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function toPemPublicKey(rawKey) {
  if (!rawKey) return "";
  if (rawKey.includes("BEGIN PUBLIC KEY")) return rawKey;
  const cleaned = rawKey.replace(/[\r\n\s]/g, "");
  const wrapped = cleaned.match(/.{1,64}/g)?.join("\n") || cleaned;
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----`;
}

export function verifyTelnyxSignature({ rawBody, signature, timestamp, publicKey, toleranceSeconds = 300 }) {
  if (!signature || !timestamp || !publicKey) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - ts);
  if (ageSeconds > toleranceSeconds) return false;
  const message = `${timestamp}|${rawBody}`;
  const pemKey = toPemPublicKey(publicKey);
  try {
    return crypto.verify(
      null,
      Buffer.from(message, "utf8"),
      pemKey,
      Buffer.from(signature, "base64")
    );
  } catch {
    return false;
  }
}

export async function sendTelnyxSms({ from, to, text }) {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    throw new Error("TELNYX_API_KEY missing");
  }
  const payload = {
    from,
    to,
    text
  };
  const resp = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`telnyx_sms_failed:${resp.status}:${body.slice(0, 200)}`);
  }
  return resp.json();
}

async function telnyxRequest(path, options = {}) {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    throw new Error("TELNYX_API_KEY missing");
  }
  const resp = await fetch(`https://api.telnyx.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`telnyx_request_failed:${resp.status}:${body.slice(0, 200)}`);
  }
  return resp.json();
}

export async function findAvailableVoiceNumber({ areaCode } = {}) {
  const params = new URLSearchParams();
  params.set("filter[country_code]", "US");
  params.set("filter[phone_number_type]", "local");
  params.set("filter[features][]", "voice");
  params.set("filter[limit]", "1");
  if (areaCode) {
    params.set("filter[national_destination_code]", String(areaCode));
  }
  const data = await telnyxRequest(`/v2/available_phone_numbers?${params.toString()}`, {
    method: "GET"
  });
  const phone = data?.data?.[0]?.phone_number || null;
  return phone;
}

export async function orderVoiceNumber({ phoneNumber, connectionId }) {
  if (!phoneNumber) throw new Error("phone_number_required");
  if (!connectionId) throw new Error("TELNYX_VOICE_CONNECTION_ID missing");
  const payload = {
    connection_id: connectionId,
    phone_numbers: [{ phone_number: phoneNumber }]
  };
  const data = await telnyxRequest("/v2/number_orders", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return data;
}
