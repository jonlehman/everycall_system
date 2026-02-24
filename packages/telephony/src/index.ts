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
