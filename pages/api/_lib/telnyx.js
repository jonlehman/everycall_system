import crypto from "crypto";
import { normalizePhoneNumber } from "./phone.js";

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
    let detail = body.slice(0, 500);
    try {
      const parsed = JSON.parse(body);
      const errors = Array.isArray(parsed?.errors) ? parsed.errors : [];
      const first = errors[0] || parsed?.error || null;
      if (first && typeof first === "object") {
        const code = first?.code || first?.status || "";
        const title = first?.title || first?.message || "";
        const description = first?.detail || first?.description || "";
        detail = [code, title, description].filter(Boolean).join(" | ") || detail;
      }
    } catch {
      // Keep raw response snippet when JSON parsing fails.
    }
    throw new Error(`telnyx_request_failed:${resp.status}:${detail.slice(0, 500)}`);
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
  const record = data?.data?.[0] || null;
  if (!record?.phone_number) return null;
  return {
    phoneNumber: record.phone_number,
    monthlyCost: Number(record?.cost_information?.monthly_cost || 0) || null,
    upfrontCost: Number(record?.cost_information?.upfront_cost || 0) || null,
    currency: record?.cost_information?.currency || null
  };
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

export async function releaseVoiceNumber({ phoneNumber }) {
  if (!phoneNumber) throw new Error("phone_number_required");
  return telnyxRequest("/v2/phone_numbers/jobs/delete_phone_numbers", {
    method: "POST",
    body: JSON.stringify({
      phone_numbers: [phoneNumber]
    })
  });
}

function normalizeOwnedPhoneNumberRecord(record) {
  if (!record) return null;
  const monthlyCost = Number(record?.cost_information?.monthly_cost);
  const upfrontCost = Number(record?.cost_information?.upfront_cost);
  const connectionId = (
    record?.connection_id
    || record?.connection?.id
    || record?.voice?.connection_id
    || record?.voice?.connection?.id
    || record?.routing?.connection_id
    || record?.routing?.connection?.id
    || ""
  );
  return {
    phoneNumber: normalizePhoneNumber(record.phone_number || ""),
    phoneNumberId: record.id || "",
    status: record.status || "",
    connectionId,
    purchasedAt: record.created_at || null,
    monthlyCost: Number.isFinite(monthlyCost) ? monthlyCost : null,
    upfrontCost: Number.isFinite(upfrontCost) ? upfrontCost : null
  };
}

export async function listOwnedPhoneNumbers({ pageSize = 250 } = {}) {
  const params = new URLSearchParams();
  params.set("page[size]", String(pageSize));
  const data = await telnyxRequest(`/v2/phone_numbers?${params.toString()}`, {
    method: "GET"
  });
  return Array.isArray(data?.data) ? data.data : [];
}

export async function getOwnedPhoneNumber({ phoneNumber }) {
  if (!phoneNumber) throw new Error("phone_number_required");
  const params = new URLSearchParams();
  params.set("filter[phone_number]", String(phoneNumber));
  params.set("page[size]", "1");
  const data = await telnyxRequest(`/v2/phone_numbers?${params.toString()}`, {
    method: "GET"
  });
  return normalizeOwnedPhoneNumberRecord(data?.data?.[0] || null);
}

export async function getPhoneNumberDetails({ phoneNumberId }) {
  if (!phoneNumberId) throw new Error("phone_number_id_required");
  const data = await telnyxRequest(`/v2/phone_numbers/${encodeURIComponent(String(phoneNumberId))}`, {
    method: "GET"
  });
  return normalizeOwnedPhoneNumberRecord(data?.data || null);
}

export async function updatePhoneNumberRouting({ phoneNumberId, connectionId }) {
  if (!phoneNumberId) throw new Error("phone_number_id_required");
  if (!connectionId) throw new Error("TELNYX_VOICE_CONNECTION_ID missing");
  const data = await telnyxRequest(`/v2/phone_numbers/${encodeURIComponent(String(phoneNumberId))}`, {
    method: "PATCH",
    body: JSON.stringify({
      connection_id: connectionId
    })
  });
  return normalizeOwnedPhoneNumberRecord(data?.data || null);
}
