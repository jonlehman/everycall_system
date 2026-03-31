import crypto from "node:crypto";

function getKeyMaterial() {
  return String(process.env.INTEGRATION_SECRET_ENCRYPTION_KEY || "").trim();
}

function getEncryptionKey() {
  const keyMaterial = getKeyMaterial();
  if (!keyMaterial) {
    throw new Error("integration_secret_encryption_key_missing");
  }
  return crypto.createHash("sha256").update(keyMaterial).digest();
}

export function encryptIntegrationSecret(value) {
  const plaintext = String(value || "").trim();
  if (!plaintext) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64")
  ].join(":");
}

export function decryptIntegrationSecret(value) {
  const encoded = String(value || "").trim();
  if (!encoded) return "";
  const [version, ivBase64, authTagBase64, ciphertextBase64] = encoded.split(":");
  if (version !== "v1" || !ivBase64 || !authTagBase64 || !ciphertextBase64) {
    throw new Error("integration_secret_invalid_format");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivBase64, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64")),
    decipher.final()
  ]);
  return plaintext.toString("utf8");
}

export function encryptIntegrationCredentials(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const sanitized = Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [String(key || "").trim(), typeof item === "string" ? item.trim() : item])
      .filter(([key, item]) => key && item !== null && item !== undefined && item !== "")
  );
  if (!Object.keys(sanitized).length) {
    return null;
  }
  return encryptIntegrationSecret(JSON.stringify(sanitized));
}

export function decryptIntegrationCredentials(value) {
  const plaintext = decryptIntegrationSecret(value);
  if (!plaintext) return {};
  try {
    const parsed = JSON.parse(plaintext);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error("integration_credentials_invalid_json");
  }
}

export function maskSecret(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 8) return "*".repeat(text.length);
  return `${text.slice(0, 4)}${"*".repeat(Math.max(4, text.length - 8))}${text.slice(-4)}`;
}

export function createSigningSecret() {
  return crypto.randomBytes(24).toString("base64url");
}
