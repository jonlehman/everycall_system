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
