import crypto from "node:crypto";

export function normalizePhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function buildExpectedSignature(url: string, params: Record<string, string>, authToken: string): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => `${acc}${key}${params[key] ?? ""}`, url);

  return crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function validateTwilioSignature(args: {
  signatureHeader: string | undefined;
  authToken: string | undefined;
  url: string;
  params: Record<string, string>;
}): boolean {
  const { signatureHeader, authToken, url, params } = args;
  if (!signatureHeader || !authToken) {
    return false;
  }

  const expected = buildExpectedSignature(url, params, authToken);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

function toPemPublicKey(rawKey: string | undefined): string {
  if (!rawKey) return "";
  if (rawKey.includes("BEGIN PUBLIC KEY")) return rawKey;
  const cleaned = rawKey.replace(/[\r\n\s]/g, "");
  const wrapped = cleaned.match(/.{1,64}/g)?.join("\n") || cleaned;
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----`;
}

export function validateTelnyxSignature(args: {
  signatureHeader: string | undefined;
  timestampHeader: string | undefined;
  publicKey: string | undefined;
  rawBody: string;
  toleranceSeconds?: number;
}): boolean {
  const { signatureHeader, timestampHeader, publicKey, rawBody } = args;
  const toleranceSeconds = args.toleranceSeconds ?? 300;
  if (!signatureHeader || !timestampHeader || !publicKey) return false;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - ts);
  if (ageSeconds > toleranceSeconds) return false;
  const message = `${timestampHeader}|${rawBody}`;
  const pemKey = toPemPublicKey(publicKey);
  try {
    return crypto.verify(
      null,
      Buffer.from(message, "utf8"),
      pemKey,
      Buffer.from(signatureHeader, "base64")
    );
  } catch {
    return false;
  }
}
