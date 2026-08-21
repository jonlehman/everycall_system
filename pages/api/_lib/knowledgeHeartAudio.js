import crypto from "node:crypto";
import { loadKnowledgeRuntimeProfile } from "./knowledgeReceptionistConfig.js";
import {
  REALTIME_PREVIEW_INSTRUCTION_VERSION,
  synthesizeRealtimeText
} from "../v1/voice/sample.js";
import { validateKnowledgeHeartText } from "./knowledgeHeartCatalog.js";

const AUDIO_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SIGNED_AUDIO_TTL_SECONDS = 10 * 60;

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function signingSecret() {
  return process.env.KB_AUDIO_SIGNING_SECRET
    || process.env.SESSION_SECRET
    || process.env.INTERNAL_SERVICE_SECRET
    || "everycall-local-kb-audio-preview";
}

function signatureFor(tenantKey, cacheKey, expiresAt) {
  return crypto.createHmac("sha256", signingSecret())
    .update(`${tenantKey}:${cacheKey}:${expiresAt}`)
    .digest("base64url");
}

export function verifyKnowledgeHeartAudioSignature({ tenantKey, cacheKey, expiresAt, signature }) {
  const expiry = Number(expiresAt);
  if (!Number.isSafeInteger(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;
  const expected = signatureFor(tenantKey, cacheKey, expiry);
  const left = Buffer.from(expected);
  const right = Buffer.from(String(signature || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function durationMsForWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 44) return null;
  const dataLength = buffer.readUInt32LE(40);
  const byteRate = buffer.readUInt32LE(28);
  return byteRate > 0 ? Math.round((dataLength / byteRate) * 1000) : null;
}

async function synthesisIdentity(db, tenantKey, text) {
  const profile = await loadKnowledgeRuntimeProfile(db, tenantKey);
  const config = profile?.session_config && typeof profile.session_config === "object"
    ? profile.session_config
    : {};
  const provider = "openai";
  const model = normalizeText(config.model) || "gpt-realtime-2.1";
  const voice = normalizeText(config.voice) || "marin";
  const format = "wav-pcm16-24000-mono";
  const identity = {
    text: normalizeText(text),
    provider,
    model,
    voice,
    instructionVersion: REALTIME_PREVIEW_INSTRUCTION_VERSION,
    format
  };
  return { ...identity, cacheKey: sha256(JSON.stringify(identity)) };
}

function signedAudioUrl(cacheKey, tenantKey) {
  const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_AUDIO_TTL_SECONDS;
  const signature = signatureFor(tenantKey, cacheKey, expiresAt);
  const params = new URLSearchParams({ cache_key: cacheKey, expires: String(expiresAt), signature });
  return `/api/v1/knowledge/core-facts/audio?${params.toString()}`;
}

export async function synthesizeKnowledgeHeartItem(db, {
  tenantKey,
  text,
  onCacheMiss = null
} = {}) {
  const validation = validateKnowledgeHeartText(text, { requireFirstPerson: true });
  if (!validation.ok) {
    const error = new Error(`kb_speak_text_invalid:${validation.reasons.join(",")}`);
    error.statusCode = 422;
    throw error;
  }
  const identity = await synthesisIdentity(db, tenantKey, validation.text);
  const cached = await db.query(
    `SELECT cache_key, mime_type, byte_size, checksum, duration_ms
     FROM kb_audio_cache
     WHERE tenant_key = $1 AND cache_key = $2 AND expires_at > NOW()
       AND audio_bytes IS NOT NULL
     LIMIT 1`,
    [tenantKey, identity.cacheKey]
  );
  if (cached.rowCount) {
    await db.query(
      `UPDATE kb_audio_cache SET last_played_at = NOW() WHERE tenant_key = $1 AND cache_key = $2`,
      [tenantKey, identity.cacheKey]
    );
    return {
      text: validation.text,
      cacheKey: identity.cacheKey,
      url: signedAudioUrl(identity.cacheKey, tenantKey),
      durationMs: cached.rows[0].duration_ms,
      cacheHit: true,
      synthesis: identity
    };
  }

  if (typeof onCacheMiss === "function") await onCacheMiss(identity);
  const preview = await synthesizeRealtimeText({
    pool: db,
    tenantKey,
    text: validation.text
  });
  const audioBuffer = preview.audioBuffer;
  const checksum = sha256(audioBuffer);
  const durationMs = durationMsForWav(audioBuffer);
  const storageKey = `db-private/kb-audio/${tenantKey}/${identity.cacheKey}.wav`;
  await db.query(
    `INSERT INTO kb_audio_cache (
       tenant_key, cache_key, storage_key, audio_bytes, mime_type, byte_size,
       checksum, duration_ms, created_at, last_played_at, expires_at
     ) VALUES ($1, $2, $3, $4, 'audio/wav', $5, $6, $7, NOW(), NOW(), $8)
     ON CONFLICT (tenant_key, cache_key)
     DO UPDATE SET storage_key = EXCLUDED.storage_key,
                   audio_bytes = EXCLUDED.audio_bytes,
                   mime_type = EXCLUDED.mime_type,
                   byte_size = EXCLUDED.byte_size,
                   checksum = EXCLUDED.checksum,
                   duration_ms = EXCLUDED.duration_ms,
                   created_at = NOW(), last_played_at = NOW(), expires_at = EXCLUDED.expires_at`,
    [tenantKey, identity.cacheKey, storageKey, audioBuffer, audioBuffer.length, checksum, durationMs, new Date(Date.now() + AUDIO_CACHE_TTL_MS)]
  );
  return {
    text: validation.text,
    cacheKey: identity.cacheKey,
    url: signedAudioUrl(identity.cacheKey, tenantKey),
    durationMs,
    cacheHit: false,
    synthesis: {
      ...identity,
      provider: "openai",
      model: preview.model,
      voice: preview.voice,
      path: preview.path,
      format: preview.format
    }
  };
}

export async function loadKnowledgeHeartAudio(db, tenantKey, cacheKey) {
  const result = await db.query(
    `SELECT audio_bytes, mime_type, checksum
     FROM kb_audio_cache
     WHERE tenant_key = $1 AND cache_key = $2 AND expires_at > NOW()
     LIMIT 1`,
    [tenantKey, cacheKey]
  );
  return result.rows?.[0] || null;
}

export async function purgeExpiredKnowledgeHeartAudio(db) {
  const result = await db.query(`DELETE FROM kb_audio_cache WHERE expires_at <= NOW()`);
  return { deleted: result.rowCount || 0 };
}
